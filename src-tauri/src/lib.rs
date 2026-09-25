pub mod benchmarks;
pub mod briefing;
pub mod db;
pub mod intelligence;
pub mod live;
pub mod media;
pub mod models;
mod native;
mod native_geometry;
pub mod rights;
mod sector_summary;
pub mod services;
pub mod topics;

use chrono::Timelike;
use futures_util::{stream, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

#[cfg(test)]
#[path = "../tests/host/unit.rs"]
mod host_tests;

#[cfg(test)]
#[path = "../tests/host/sector.rs"]
mod sector_host_tests;

// Counting writer stops serialization at the bound instead of building a String.
struct RequestBudget(usize);
impl std::io::Write for RequestBudget {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0 = self
            .0
            .checked_sub(bytes.len())
            .ok_or_else(|| std::io::Error::other("Request exceeds size limit"))?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl RequestBudget {
    fn check(&mut self, value: &impl serde::Serialize) -> Result<(), String> {
        serde_json::to_writer(self, value).map_err(|_| "Request exceeds size limit".into())
    }
}

#[derive(Default)]
struct SourcePolicy {
    generations: HashMap<String, u64>,
    import_generation: u64,
    media_jobs: HashMap<String, MediaJob>,
    cancelled_media: std::collections::VecDeque<String>,
}
struct MediaJob {
    source_id: String,
    waker: Option<std::task::Waker>,
}
// Registration and semaphore permits are both released if the caller drops or
// aborts its future, not only on normal completion.
struct MediaRegistration<'a> {
    policy: &'a Mutex<SourcePolicy>,
    id: String,
    source_id: String,
    generation: u64,
    import_generation: u64,
    article: Value,
    item: Value,
    request: Value,
}
impl MediaRegistration<'_> {
    fn current(&self, policy: &SourcePolicy) -> bool {
        policy.media_jobs.contains_key(&self.id)
            && policy.import_generation == self.import_generation
            && policy.generation(&self.source_id) == self.generation
    }
}
impl Drop for MediaRegistration<'_> {
    fn drop(&mut self) {
        self.policy
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .media_jobs
            .remove(&self.id);
    }
}
impl SourcePolicy {
    fn generation(&self, id: &str) -> u64 {
        self.generations.get(id).copied().unwrap_or(0)
    }
}

pub struct Backend {
    live: Arc<live::LiveDesk>,
    metadata: [models::MetadataCache; 4],
    database: Mutex<db::Database>,
    cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
    provider_generation: AtomicU64,
    refreshing: AtomicBool,
    source_policy: Mutex<SourcePolicy>,
    // Two transfers maximum across all windows; each loader enforces its own
    // 32 MiB video / 5 MiB image cap. Completed IPC results are not retained here.
    media_permits: tokio::sync::Semaphore,
}
impl Drop for Backend {
    fn drop(&mut self) {
        self.live.set_enabled(false);
    }
}
struct SummaryRegistration<'a> {
    active: &'a Mutex<HashMap<String, Arc<AtomicBool>>>,
    id: String,
    cancel: Arc<AtomicBool>,
}
impl Drop for SummaryRegistration<'_> {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if active
            .get(&self.id)
            .is_some_and(|cancel| Arc::ptr_eq(cancel, &self.cancel))
        {
            active.remove(&self.id);
        }
    }
}
struct RefreshGuard<'a>(&'a AtomicBool);
impl Drop for RefreshGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl Backend {
    pub fn new(database: db::Database) -> Self {
        Self {
            database: Mutex::new(database),
            live: Arc::new(live::LiveDesk::new()),
            metadata: std::array::from_fn(|_| models::MetadataCache::default()),
            cancellations: Mutex::new(HashMap::new()),
            provider_generation: AtomicU64::new(0),
            refreshing: AtomicBool::new(false),
            source_policy: Mutex::new(SourcePolicy::default()),
            media_permits: tokio::sync::Semaphore::new(2),
        }
    }
    async fn metadata_read(&self, index: usize) -> Result<Value, String> {
        let source = ["openrouter", "huggingface", "arena", "swebench"][index];
        let persisted = self.database()?.metadata_cache_get(source)?;
        let now = chrono::Utc::now().timestamp();
        let ttl = if index < 2 { 3600 } else { 86400 };
        let mut value = self.metadata[index]
            .load(persisted, now, ttl, || async move {
                match index {
                    0 => models::fetch_openrouter_models(now).await,
                    1 => models::fetch_huggingface_models(now).await,
                    2 => benchmarks::fetch_arena(now).await,
                    _ => benchmarks::fetch_swebench(now).await,
                }
            })
            .await;
        if value["complete"] == true {
            self.database()?.metadata_cache_put(source, &value)?;
        }
        // An unavailable first fetch still has an attributable source panel.
        if value["source"].is_null() {
            value["source"] = json!(
                [
                    "OpenRouter Models API",
                    "Hugging Face · Qwen",
                    "Arena leaderboard dataset",
                    "SWE-bench leaderboard"
                ][index]
            );
        }
        Ok(value)
    }
    pub fn database(&self) -> Result<MutexGuard<'_, db::Database>, String> {
        self.database
            .lock()
            .map_err(|_| "Local database lock failed; restart the application".into())
    }
    // Lock order: summary gate -> source policy gate -> database (skip unused
    // gates). Never retain a SQLite or policy mutex guard across an await.
    fn cancel_summaries(&self) -> Result<MutexGuard<'_, HashMap<String, Arc<AtomicBool>>>, String> {
        let active = self
            .cancellations
            .lock()
            .map_err(|_| "Summary state lock failed")?;
        for cancel in active.values() {
            cancel.store(true, Ordering::Release);
        }
        Ok(active)
    }
    async fn run_summary<F>(
        &self,
        cancel: &AtomicBool,
        article: &Value,
        future: F,
    ) -> Result<Value, String>
    where
        F: std::future::Future<Output = Result<Value, String>>,
    {
        let mut future = std::pin::pin!(future);
        std::future::poll_fn(|cx| {
            // No provider attempt may start after revocation: hold the same gate
            // through each poll (not across await), including fallback transitions.
            let _active = match self.cancellations.lock() {
                Ok(active) => active,
                Err(_) => return std::task::Poll::Ready(Err("Summary state lock failed".into())),
            };
            if cancel.load(Ordering::Acquire) {
                return std::task::Poll::Ready(Err("Summary cancelled".into()));
            }
            let _policy = match self.source_policy.lock() {
                Ok(policy) => policy,
                Err(_) => return std::task::Poll::Ready(Err("Source policy lock failed".into())),
            };
            if let Err(error) = self.database().and_then(|db| db.authorize_ai(article)) {
                return std::task::Poll::Ready(Err(error));
            }
            // Release SQLite before polling provider IO, but exclude refresh and
            // revocation through the poll (including synchronous fallback).
            match future.as_mut().poll(cx) {
                std::task::Poll::Ready(result) => {
                    if cancel.load(Ordering::Acquire) {
                        return std::task::Poll::Ready(Err("Summary cancelled".into()));
                    }
                    std::task::Poll::Ready(
                        self.database()
                            .and_then(|db| db.authorize_ai(article))
                            .and(result),
                    )
                }
                std::task::Poll::Pending => std::task::Poll::Pending,
            }
        })
        .await
    }
    pub async fn execute(&self, request: Value) -> Result<Value, String> {
        let op = db::text(&request, "op", 50)?;
        // IPC has already deserialized this Value. Bound subsequent processing,
        // without allocating a second escaped copy of a potentially large backup.
        if op == "import" {
            let data = request["data"].as_str().ok_or("Invalid import data")?;
            if data.len() > 32 * 1024 * 1024 {
                return Err("Backup exceeds 32 MiB".into());
            }
            let mut envelope = RequestBudget(64 * 1024 - 2); // outer braces
            for (key, value) in request.as_object().ok_or("Invalid request")? {
                if key != "data" {
                    // A colon and comma per field; count escaped keys and nested
                    // values together, not just the lengths of string values.
                    envelope.0 = envelope
                        .0
                        .checked_sub(2)
                        .ok_or("Request exceeds size limit")?;
                    envelope.check(key)?;
                    envelope.check(value)?;
                }
            }
        } else {
            RequestBudget(34 * 1024 * 1024).check(&request)?;
        }
        match op {
            "sector_summarize" => {
                self.sector_summarize_using(&request, |selection, cancel| async move {
                    services::summarize_sector(&selection, cancel).await
                })
                .await
            }
            "sector_summary_preview" => Ok(sector_summary::select(
                &mut *self.database()?,
                &request,
                chrono::Utc::now().timestamp(),
            )?
            .preview),
            "live_status" => Ok(self.live.status()),
            "benchmark_catalog" => {
                let (arena, swe) = tokio::join!(self.metadata_read(2), self.metadata_read(3));
                Ok(json!({"panels":[arena?,swe?],"comparisonNote":benchmarks::COMPARISON_NOTE}))
            }
            "model_catalog" => {
                let (models, hf) = tokio::join!(self.metadata_read(0), self.metadata_read(1));
                let mut models = models?;
                models["huggingFace"] = hf?;
                Ok(models)
            }
            "live_set" => {
                let enabled = request["enabled"]
                    .as_bool()
                    .ok_or("enabled must be a boolean")?;
                Ok(self.live.set_enabled(enabled))
            }
            "refresh" => self.refresh(request["scheduled"] != true).await,
            "media_cancel" => {
                let id = db::text(&request, "requestId", 200)?;
                let mut policy = self
                    .source_policy
                    .lock()
                    .map_err(|_| "Source policy lock failed")?;
                if let Some(job) = policy.media_jobs.remove(id) {
                    if let Some(waker) = job.waker {
                        waker.wake();
                    }
                } else if !policy.cancelled_media.iter().any(|entry| entry == id) {
                    // Bounded tombstones cover IPC cancellation overtaking registration.
                    if policy.cancelled_media.len() == 256 {
                        policy.cancelled_media.pop_front();
                    }
                    policy.cancelled_media.push_back(id.to_owned());
                }
                Ok(json!({"cancelled":true}))
            }
            "media_preferences_set" => {
                let mut policy = self
                    .source_policy
                    .lock()
                    .map_err(|_| "Source policy lock failed")?;
                let result = self
                    .database()?
                    .request(&request, chrono::Utc::now().timestamp())?;
                for (_, job) in policy.media_jobs.drain() {
                    if let Some(waker) = job.waker {
                        waker.wake();
                    }
                }
                Ok(result)
            }
            "media_load" => {
                self.media_load_using(&request, |item, approval| async move {
                    media::load_authorized_media(&item, approval.as_ref()).await
                })
                .await
            }
            "local_ai_connect" => {
                self.local_ai_connect_using(async {
                    // Fixed loopback only: no credentials, cloud endpoint or renderer URL.
                    let client = reqwest::Client::builder()
                        .no_proxy()
                        .redirect(reqwest::redirect::Policy::none())
                        .timeout(Duration::from_secs(5))
                        .build()
                        .map_err(|_| "Local AI client unavailable")?;
                    let response = client
                        .get("http://127.0.0.1:11434/api/tags")
                        .send()
                        .await
                        .map_err(|_| {
                            "Local AI is not running. Start scripts/local-ai-run.py first."
                        })?
                        .error_for_status()
                        .map_err(|_| "Local AI did not respond successfully")?;
                    let mut body = Vec::new();
                    let mut chunks = response.bytes_stream();
                    while let Some(chunk) = chunks.next().await {
                        let chunk = chunk.map_err(|_| "Local AI response failed")?;
                        if body.len() + chunk.len() > 256 * 1024 {
                            return Err("Local AI model list is too large".into());
                        }
                        body.extend_from_slice(&chunk);
                    }
                    serde_json::from_slice(&body).map_err(|_| "Invalid local AI model list".into())
                })
                .await
            }
            "summarize" => {
                let request_id = db::text(&request, "requestId", 200)?.to_owned();
                let pid = request["profileId"].as_str().unwrap_or("default");
                let aid = db::text(&request, "articleId", 200)?;
                let cancel = Arc::new(AtomicBool::new(false));
                let (article, mut providers) = {
                    let mut active = self
                        .cancellations
                        .lock()
                        .map_err(|_| "Summary state lock failed")?;
                    if active.len() >= 4 || active.contains_key(&request_id) {
                        return Err(
                            "Too many summaries or duplicate request ID; cancel and retry".into(),
                        );
                    }
                    let db = self.database()?;
                    let a = db.article(pid, aid)?;
                    let source = db
                        .list("source", "")?
                        .into_iter()
                        .find(|s| s["id"] == a["sourceId"])
                        .ok_or("Unknown article source")?;
                    if source["storage"] == "metadata" {
                        return Err(
                            "Source is metadata-only; AI summaries are not permitted".into()
                        );
                    }
                    db.authorize_ai(&a)?;
                    if a["aiAllowed"] != true || source["aiAllowed"] != true {
                        return Err(
                            "Source policy does not grant permission for AI summaries".into()
                        );
                    }
                    let providers = db.list("provider", "")?;
                    active.insert(request_id.clone(), cancel.clone());
                    (a, providers)
                };
                let _registration = SummaryRegistration {
                    active: &self.cancellations,
                    id: request_id,
                    cancel: cancel.clone(),
                };
                providers.sort_by_key(|p| match p["id"].as_str() {
                    Some("ollama") => 0,
                    Some("gemini") => 1,
                    _ => 2,
                });
                let result = self
                    .run_summary(
                        &cancel,
                        &article,
                        services::summarize(&providers, &article, cancel.clone()),
                    )
                    .await;
                let _active = self
                    .cancellations
                    .lock()
                    .map_err(|_| "Summary state lock failed")?;
                if cancel.load(Ordering::Acquire) {
                    return Err("Summary cancelled".into());
                }
                let _policy = self
                    .source_policy
                    .lock()
                    .map_err(|_| "Source policy lock failed")?;
                self.database()?.authorize_ai(&article)?;
                result
            }
            "summary_cancel" => {
                let id = db::text(&request, "requestId", 200)?;
                if let Some(cancel) = self
                    .cancellations
                    .lock()
                    .map_err(|_| "Summary state lock failed")?
                    .get(id)
                {
                    cancel.store(true, Ordering::Release);
                }
                Ok(Value::Null)
            }
            "import" => {
                // Atomically exclude both existing refresh jobs and new registrations
                // until the import transaction completes (including error paths).
                self.refreshing.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                    .map_err(|_| "Cannot import while a refresh or import is running; retry after it completes")?;
                let _guard = RefreshGuard(&self.refreshing);
                let _active = self.cancel_summaries()?;
                let mut policy = self
                    .source_policy
                    .lock()
                    .map_err(|_| "Source policy lock failed")?;
                let result = self
                    .database()?
                    .request(&request, chrono::Utc::now().timestamp())?;
                policy.import_generation += 1;
                policy.generations.clear();
                for job in policy.media_jobs.values() {
                    if let Some(waker) = &job.waker {
                        waker.wake_by_ref();
                    }
                }
                self.provider_generation.fetch_add(1, Ordering::AcqRel);
                Ok(result)
            }
            "source_update" => {
                let id = db::text(&request, "sourceId", 200)?;
                let _active = self.cancel_summaries()?;
                let mut policy = self
                    .source_policy
                    .lock()
                    .map_err(|_| "Source policy lock failed")?;
                let result = self
                    .database()?
                    .request(&request, chrono::Utc::now().timestamp())?;
                *policy.generations.entry(id.to_owned()).or_default() += 1;
                for job in policy.media_jobs.values().filter(|job| job.source_id == id) {
                    if let Some(waker) = &job.waker {
                        waker.wake_by_ref();
                    }
                }
                Ok(result)
            }
            "provider_save" => {
                db::validate_provider(&request["provider"])?;
                let _active = self.cancel_summaries()?;
                if let Some(key) = request.get("apiKey") {
                    let key = key.as_str().ok_or("Invalid API key")?;
                    if !key.is_empty() {
                        services::save_key(db::text(&request["provider"], "id", 20)?, key)?;
                    }
                }
                let result = self
                    .database()?
                    .request(&request, chrono::Utc::now().timestamp())?;
                self.provider_generation.fetch_add(1, Ordering::AcqRel);
                Ok(result)
            }
            "article_state" if request.get("hidden").is_some() => {
                let _active = self.cancel_summaries()?;
                self.database()?
                    .request(&request, chrono::Utc::now().timestamp())
            }
            "group_split" | "profile_update" | "profile_reset" => {
                let _active = self.cancel_summaries()?;
                self.database()?
                    .request(&request, chrono::Utc::now().timestamp())
            }
            "snapshot" => {
                let mut snapshot = self
                    .database()?
                    .request(&request, chrono::Utc::now().timestamp())?;
                for p in snapshot["providers"]
                    .as_array_mut()
                    .ok_or("Invalid provider state")?
                {
                    p["hasKey"] = json!(services::has_key(p["id"].as_str().unwrap_or("")));
                }
                Ok(snapshot)
            }
            _ => self
                .database()?
                .request(&request, chrono::Utc::now().timestamp()),
        }
    }
    async fn sector_summarize_using<F, Fut>(
        &self,
        request: &Value,
        load: F,
    ) -> Result<Value, String>
    where
        F: FnOnce(sector_summary::Selection, Arc<AtomicBool>) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        let id = db::text(request, "requestId", 200)?;
        let fingerprint = db::text(request, "fingerprint", 64)?;
        let cancel = Arc::new(AtomicBool::new(false));
        let selection = {
            let mut active = self
                .cancellations
                .lock()
                .map_err(|_| "Summary state lock failed")?;
            if active.len() >= 4 || active.contains_key(id) {
                return Err("Too many summaries or duplicate request ID; cancel and retry".into());
            }
            let selection = sector_summary::select(
                &mut *self.database()?,
                request,
                chrono::Utc::now().timestamp(),
            )?;
            if selection.preview["fingerprint"] != fingerprint {
                return Err("Sector inputs changed; reload the preview".into());
            }
            if selection.articles.len() < 2 {
                return Err("At least two eligible stories are required".into());
            }
            active.insert(id.into(), cancel.clone());
            selection
        };
        let _registration = SummaryRegistration {
            active: &self.cancellations,
            id: id.into(),
            cancel: cancel.clone(),
        };
        let preview = selection.preview.clone();
        let grounding_inputs = sector_summary::inputs(&selection)?;
        let result = {
            let mut future = std::pin::pin!(async { load(selection, cancel.clone()).await });
            let mut heartbeat = tokio::time::interval(Duration::from_millis(50));
            std::future::poll_fn(|cx| {
                let _active = match self.cancellations.lock() {
                    Ok(active) => active,
                    Err(_) => {
                        return std::task::Poll::Ready(Err("Summary state lock failed".into()))
                    }
                };
                let _policy = match self.source_policy.lock() {
                    Ok(policy) => policy,
                    Err(_) => {
                        return std::task::Poll::Ready(Err("Source policy lock failed".into()))
                    }
                };
                if let Err(error) = self.sector_current(request, &cancel) {
                    return std::task::Poll::Ready(Err(error));
                }
                // Wake even when a provider is idle so membership changes promptly abort IO.
                let _ = heartbeat.poll_tick(cx);
                match future.as_mut().poll(cx) {
                    std::task::Poll::Ready(result) => {
                        std::task::Poll::Ready(self.sector_current(request, &cancel).and(result))
                    }
                    std::task::Poll::Pending => std::task::Poll::Pending,
                }
            })
            .await
        };
        let _active = self
            .cancellations
            .lock()
            .map_err(|_| "Summary state lock failed")?;
        let _policy = self
            .source_policy
            .lock()
            .map_err(|_| "Source policy lock failed")?;
        self.sector_current(request, &cancel)?;
        let result = result?;
        let bullets = sector_summary::validate_bullets(
            result["text"].as_str().ok_or("Missing sector synthesis")?,
            &grounding_inputs,
        )?;
        Ok(
            json!({"profileId":preview["profileId"],"date":preview["date"],"sectorId":preview["sectorId"],"fingerprint":preview["fingerprint"],"sources":preview["sources"],"coverageLabel":preview["coverageLabel"],"provider":result["provider"],"model":result["model"],"generatedAt":result["generatedAt"],"bullets":bullets,"warning":"AI-selected quotations, unverified. Exact text and source IDs were checked mechanically, not factual entailment, context or truth. Excerpts may be incomplete. Check the original sources."}),
        )
    }

    fn sector_current(&self, request: &Value, cancel: &AtomicBool) -> Result<(), String> {
        if cancel.load(Ordering::Acquire) {
            return Err("Summary cancelled".into());
        }
        let selection = sector_summary::select(
            &mut *self.database()?,
            request,
            chrono::Utc::now().timestamp(),
        )?;
        if selection.preview["fingerprint"] != request["fingerprint"]
            || selection.articles.len() < 2
        {
            return Err("Sector inputs changed; reload the preview".into());
        }
        Ok(())
    }

    async fn media_load_using<F, Fut>(&self, request: &Value, load: F) -> Result<Value, String>
    where
        F: FnOnce(Value, Option<Value>) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        let aid = db::text(request, "articleId", 200)?;
        let pid = request["profileId"].as_str().unwrap_or("default");
        let index = request["index"]
            .as_u64()
            .filter(|i| *i < 8)
            .ok_or("Invalid media index")? as usize;
        let _permit = self
            .media_permits
            .try_acquire()
            .map_err(|_| "Too many media loads; retry after one completes")?;
        let (approval, registration) = {
            let mut policy = self
                .source_policy
                .lock()
                .map_err(|_| "Source policy lock failed")?;
            let database = self.database()?;
            database.authorize_media_request(request)?;
            let article = database.article(pid, aid)?;
            let source = database
                .list("source", "")?
                .into_iter()
                .find(|s| s["id"] == article["sourceId"])
                .ok_or("Unknown article source")?;
            if source["mediaAllowed"] != true || source["storage"] != "excerpt" {
                return Err("Source policy does not permit media loading".into());
            }
            let item = article["media"]
                .as_array()
                .and_then(|items| items.get(index))
                .cloned()
                .ok_or("Article media is unavailable")?;
            if request["automatic"] == true && item["kind"] != "image" {
                return Err("Automatic loading is limited to images".into());
            }
            let approval = database.authorize_media(&article, &item)?;
            let source_id = source["id"].as_str().ok_or("Invalid source ID")?.to_owned();
            let id = match request.get("requestId") {
                Some(_) => db::text(request, "requestId", 200)?.to_owned(),
                None => uuid::Uuid::new_v4().to_string(),
            };
            if let Some(index) = policy.cancelled_media.iter().position(|entry| entry == &id) {
                policy.cancelled_media.remove(index);
                return Err("Media load cancelled before registration".into());
            }
            if policy.media_jobs.contains_key(&id) {
                return Err("Duplicate media request ID".into());
            }
            let registration = MediaRegistration {
                policy: &self.source_policy,
                id: id.clone(),
                generation: policy.generation(&source_id),
                import_generation: policy.import_generation,
                source_id: source_id.clone(),
                article,
                item,
                request: request.clone(),
            };
            policy.media_jobs.insert(
                id,
                MediaJob {
                    source_id,
                    waker: None,
                },
            );
            (approval, registration)
        };
        // Like run_summary, hold the mutation gate through each poll, never an
        // await. Even loader construction cannot start a request after revoke.
        let item = registration.item.clone();
        self.run_media(&registration, async move { load(item, approval).await })
            .await
    }
    async fn run_media<F>(
        &self,
        registration: &MediaRegistration<'_>,
        future: F,
    ) -> Result<Value, String>
    where
        F: Future<Output = Result<Value, String>>,
    {
        let mut future = std::pin::pin!(future);
        let result = std::future::poll_fn(|cx| {
            let mut policy = match self.source_policy.lock() {
                Ok(policy) => policy,
                Err(_) => return std::task::Poll::Ready(Err("Source policy lock failed".into())),
            };
            if !registration.current(&policy) {
                return std::task::Poll::Ready(Err(
                    "Media load cancelled by a policy change".into()
                ));
            }
            if let Err(error) = self.database().and_then(|db| {
                db.authorize_media_request(&registration.request)?;
                db.authorize_media(&registration.article, &registration.item)
            }) {
                return std::task::Poll::Ready(Err(error));
            }
            if let Some(job) = policy.media_jobs.get_mut(&registration.id) {
                job.waker = Some(cx.waker().clone());
            }
            future.as_mut().poll(cx)
        })
        .await;
        let policy = self
            .source_policy
            .lock()
            .map_err(|_| "Source policy lock failed")?;
        if !registration.current(&policy) {
            return Err("Media load cancelled by a policy change".into());
        }
        self.database()?
            .authorize_media_request(&registration.request)?;
        self.database()?
            .authorize_media(&registration.article, &registration.item)?;
        result
    }
    async fn local_ai_connect_using<F>(&self, tags: F) -> Result<Value, String>
    where
        F: Future<Output = Result<Value, String>>,
    {
        let generation = {
            let _active = self
                .cancellations
                .lock()
                .map_err(|_| "Summary state lock failed")?;
            self.provider_generation.load(Ordering::Acquire)
        };
        let tags = tags.await?;
        let model = "qwen3:4b-instruct-2507-q4_K_M";
        if !tags["models"]
            .as_array()
            .is_some_and(|models| models.iter().any(|m| m["name"] == model))
        {
            return Err(
                "Required local model is missing. Run scripts/local-ai-verify.py --pull.".into(),
            );
        }
        let provider = json!({"id":"ollama","kind":"ollama","name":"Local Qwen · Ollama","model":model,"enabled":true,"consented":true});
        let active = self
            .cancellations
            .lock()
            .map_err(|_| "Summary state lock failed")?;
        if self.provider_generation.load(Ordering::Acquire) != generation {
            return Err("Local AI settings changed while connecting; retry if still wanted".into());
        }
        for cancel in active.values() {
            cancel.store(true, Ordering::Release);
        }
        self.database()?.request(
            &json!({"op":"provider_save","provider":provider}),
            chrono::Utc::now().timestamp(),
        )?;
        self.provider_generation.fetch_add(1, Ordering::AcqRel);
        Ok(provider)
    }
    fn refresh_source_current(
        &self,
        policy: &SourcePolicy,
        source: &Value,
        generation: u64,
    ) -> Result<bool, String> {
        let id = source["id"].as_str().ok_or("Invalid source ID")?;
        if policy.generation(id) != generation {
            return Ok(false);
        }
        Ok(self
            .database()?
            .list("source", "")?
            .iter()
            .any(|s| s["id"] == id && s["enabled"] == true))
    }
    async fn refresh(&self, manual: bool) -> Result<Value, String> {
        self.refresh_using(manual, |source| async move {
            services::fetch_feed(&source).await
        })
        .await
    }
    async fn refresh_using<F, Fut>(&self, manual: bool, fetch: F) -> Result<Value, String>
    where
        F: Fn(Value) -> Fut,
        Fut: std::future::Future<Output = Result<Value, String>>,
    {
        self.refreshing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "A refresh is already running")?;
        let _guard = RefreshGuard(&self.refreshing);
        let sources = {
            let policy = self
                .source_policy
                .lock()
                .map_err(|_| "Source policy lock failed")?;
            self.database()?
                .due_sources(chrono::Utc::now().timestamp(), manual)?
                .into_iter()
                .map(|source| {
                    let generation = policy.generation(source["id"].as_str().unwrap_or(""));
                    (source, generation)
                })
                .collect::<Vec<_>>()
        };
        let mut jobs = stream::iter(sources.into_iter().map(|(source, generation)| {
            let fetch = &fetch;
            async move {
                // Construct and poll the actual transfer only inside the gate.
                // The SQLite guard used for revalidation is gone before polling.
                let fetch_source = source.clone();
                let future = async move { fetch(fetch_source).await };
                let mut future = std::pin::pin!(future);
                let result = std::future::poll_fn(|cx| {
                    let policy = match self.source_policy.lock() {
                        Ok(policy) => policy,
                        Err(_) => {
                            return std::task::Poll::Ready(Err("Source policy lock failed".into()))
                        }
                    };
                    match self.refresh_source_current(&policy, &source, generation) {
                        Ok(true) => future.as_mut().poll(cx).map(|result| result.map(Some)),
                        Ok(false) => std::task::Poll::Ready(Ok(None)),
                        Err(error) => std::task::Poll::Ready(Err(error)),
                    }
                })
                .await;
                (source, generation, result)
            }
        }))
        .buffer_unordered(4);
        let (mut updated, mut failed) = (0usize, 0usize);
        while let Some((source, generation, result)) = jobs.next().await {
            let policy = self
                .source_policy
                .lock()
                .map_err(|_| "Source policy lock failed")?;
            if !self.refresh_source_current(&policy, &source, generation)?
                || matches!(result, Ok(None))
            {
                continue;
            }
            let id = source["id"].as_str().ok_or("Invalid source ID")?;
            let now = chrono::Utc::now().timestamp();
            let mut db = self.database()?;
            match result.and_then(|feed| db.ingest(id, &feed.expect("non-skipped feed"), now)) {
                Ok(n) => updated += n,
                Err(error) => {
                    failed += 1;
                    let _ = db.source_failed(id, &error, now);
                }
            }
        }
        // Retention mutates selected inputs too; exclude provider polls/final delivery.
        let _policy = self
            .source_policy
            .lock()
            .map_err(|_| "Source policy lock failed")?;
        self.database()?.retain(chrono::Utc::now().timestamp())?;
        Ok(json!({"updated":updated,"failed":failed}))
    }
}
fn changed(op: &str) -> bool {
    ![
        "snapshot",
        "hidden_stories",
        "workspace_get",
        "daily_brief",
        "sector_summary_preview",
        "sector_summarize",
        "media_load",
        "media_cancel",
        "media_preferences",
        "benchmark_catalog",
        "model_catalog",
        "live_status",
        "window_monitors",
        "search",
        "export",
        "summarize",
        "summary_cancel",
        "window_context",
        "open_original",
    ]
    .contains(&op)
}
fn deliver_alerts(app: &tauri::AppHandle, state: &Backend) {
    // Resolve the local minute each time; DST and timezone changes are not cached.
    let local = chrono::Local::now();
    let result = state.database().and_then(|mut db| {
        db.deliver_alerts(local.timestamp(), local.hour() * 60 + local.minute(), |a| {
            app.notification()
                .builder()
                .title(format!(
                    "News Terminal · {}",
                    a["profileName"].as_str().unwrap_or("Profile")
                ))
                .body(a["title"].as_str().unwrap_or("Watchlist update"))
                .show()
                .map_err(|_| "Windows notification delivery failed".to_owned())
        })
    });
    if result.is_err() || result.is_ok_and(|failed| failed > 0) {
        let _ = app.emit("notification-status",
            "Windows notifications are unavailable. Delivery will retry briefly; watchlist updates remain in the app.");
    }
}

fn cdp_browser_args(port: &str) -> Result<String, String> {
    let parsed = port
        .parse::<u16>()
        .map_err(|_| "Invalid NEWS_TERMINAL_CDP_PORT")?;
    if parsed == 0 {
        return Err("Invalid NEWS_TERMINAL_CDP_PORT".into());
    }
    Ok(format!(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port={parsed} --remote-debugging-address=127.0.0.1"
    ))
}

fn create_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }
    let mut builder =
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
            .title("News Terminal")
            .inner_size(1440.0, 900.0)
            .min_inner_size(800.0, 600.0);
    if let Some(port) = std::env::var_os("NEWS_TERMINAL_CDP_PORT") {
        let args = cdp_browser_args(&port.to_string_lossy())?;
        builder = builder.additional_browser_args(&args);
        let directory = std::env::var_os("NEWS_TERMINAL_WEBVIEW_DATA_DIR")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("NEWS_TERMINAL_DATA_DIR")
                    .map(|path| PathBuf::from(path).join("webview-cdp"))
            })
            .ok_or("NEWS_TERMINAL_CDP_PORT requires an isolated WebView data directory")?;
        std::fs::create_dir_all(&directory)
            .map_err(|_| "Could not create isolated WebView data directory")?;
        builder = builder.data_directory(directory);
    }
    builder
        .build()
        .map(|_| ())
        .map_err(|_| "Could not create main window".into())
}

#[cfg(test)]
mod window_setup_tests {
    use super::cdp_browser_args;

    #[test]
    fn cdp_args_are_explicitly_opt_in_and_port_bounded() {
        assert!(cdp_browser_args("0").is_err());
        assert!(cdp_browser_args("70000").is_err());
        assert!(cdp_browser_args("abc").is_err());
        assert_eq!(
            cdp_browser_args("9232").unwrap(),
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=9232 --remote-debugging-address=127.0.0.1"
        );
    }
}

#[tauri::command]
async fn dispatch(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Backend>,
    request: Value,
) -> Result<Value, String> {
    let op = request["op"].as_str().unwrap_or("").to_owned();
    if ["detach_tab", "reattach_tab"].contains(&op.as_str()) {
        let pid = db::text(&request, "profileId", 200)?;
        let tid = db::text(&request, "tabId", 200)?;
        if !state.database()?.workspace_owner_exists(pid, Some(tid))? {
            return Err("Unknown profile/tab; reload the workspace".into());
        }
    }
    if let Some(result) = native::handle(&app, &window, &request) {
        return result;
    }
    let result = state.execute(request).await?;
    if op == "import" {
        // Replacement committed even if native layout reconciliation fails.
        let reconciled = native::reconcile(&app);
        let _ = app.emit("database-replaced", ());
        reconciled?;
    }
    if matches!(op.as_str(), "media_preferences_set" | "source_update") {
        let _ = app.emit("media-policy-changed", ());
    }
    if changed(&op) {
        let _ = app.emit("data-changed", ());
    }
    if op == "refresh" {
        deliver_alerts(&app, &state);
    }
    Ok(result)
}
pub fn run() {
    tauri::Builder::default()
      .plugin(tauri_plugin_opener::init())
      .plugin(tauri_plugin_notification::init())
      .setup(|app| {
          create_main_window(app.handle()).map_err(std::io::Error::other)?;
          let dir=std::env::var_os("NEWS_TERMINAL_DATA_DIR").map(PathBuf::from).unwrap_or(app.path().app_data_dir()?);
          std::fs::create_dir_all(&dir)?;
          let database=db::Database::open(dir.join("news-terminal.sqlite3")).map_err(std::io::Error::other)?;
          app.manage(Backend::new(database));
          native::setup(app.handle()).map_err(std::io::Error::other)?;
          let handle=app.handle().clone();
          tauri::async_runtime::spawn(async move {
              loop {
                  let state=handle.state::<Backend>();
                  if state.execute(json!({"op":"refresh","scheduled":true})).await.is_ok() { let _=handle.emit("data-changed",()); deliver_alerts(&handle,&state); }
                  tokio::time::sleep(Duration::from_secs(60)).await;
              }
          });
          Ok(())
      })
      .invoke_handler(tauri::generate_handler![dispatch])
      .run(tauri::generate_context!())
      .expect("Unable to start News Terminal; check local data directory access and WebView2 installation");
}
