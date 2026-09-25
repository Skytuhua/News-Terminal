//! Opt-in, shared Hacker News metadata stream. No article/comment retrieval.
#[cfg(test)]
#[path = "../tests/live/unit.rs"]
mod tests;

use futures_util::{stream::FuturesUnordered, Stream, StreamExt};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet, VecDeque};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

/// Own exactly one Arc in Backend and share it with all windows. Off on every launch.
pub struct LiveDesk {
    snapshot: Mutex<Value>,
    enabled: AtomicBool,
    generation: AtomicU64,
    changes: tokio::sync::watch::Sender<u64>,
    worker_gate: tokio::sync::Mutex<()>,
    revalidate_at: Mutex<Option<tokio::time::Instant>>,
}
impl Default for LiveDesk {
    fn default() -> Self {
        Self::new()
    }
}
impl LiveDesk {
    pub fn new() -> Self {
        Self {
            snapshot: Mutex::new(off_snapshot()),
            enabled: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            changes: tokio::sync::watch::channel(0).0,
            worker_gate: tokio::sync::Mutex::new(()),
            revalidate_at: Mutex::new(None),
        }
    }
    fn start<F, Fut>(self: &Arc<Self>, enabled: bool, runner: F) -> Value
    where
        F: FnOnce(Arc<Self>, u64) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = ()> + Send + 'static,
    {
        // All toggles and generation-checked writes share this lock.
        let mut snapshot = self.snapshot.lock().unwrap_or_else(|e| e.into_inner());
        if self.enabled.load(Ordering::Acquire) == enabled {
            return snapshot.clone();
        }
        let runtime = if enabled {
            tokio::runtime::Handle::try_current().ok()
        } else {
            None
        };
        if enabled && runtime.is_none() {
            snapshot["message"] = json!("Live stream requires the backend async runtime");
            return snapshot.clone();
        }
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.enabled.store(enabled, Ordering::Release);
        self.changes.send_replace(generation);
        *snapshot = off_snapshot();
        *self.revalidate_at.lock().unwrap_or_else(|e| e.into_inner()) = None;
        if let Some(runtime) = runtime {
            snapshot["enabled"] = json!(true);
            snapshot["state"] = json!("connecting");
            snapshot["message"] = json!("Connecting to Hacker News discussion metadata");
            let mut changes = self.changes.subscribe();
            let desk = Arc::clone(self);
            runtime.spawn(async move {
                tokio::select! {
                    biased;
                    _ = changes.changed() => {},
                    _ = async {
                        // Serialize across generations: old network futures are dropped
                        // before a rapid disable/enable can open the replacement stream.
                        let _guard = desk.worker_gate.lock().await;
                        if desk.active(generation) { runner(Arc::clone(&desk), generation).await; }
                    } => {},
                }
            });
        }
        snapshot.clone()
    }
    fn active(&self, generation: u64) -> bool {
        self.enabled.load(Ordering::Acquire)
            && self.generation.load(Ordering::Acquire) == generation
    }
    fn update(&self, generation: u64, change: impl FnOnce(&mut Value)) {
        let mut snapshot = self.snapshot.lock().unwrap_or_else(|e| e.into_inner());
        if self.active(generation) {
            change(&mut snapshot);
        }
    }
    pub fn status(&self) -> Value {
        self.snapshot
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}
#[derive(Debug)]
enum Failure {
    Retry(String, Option<Duration>),
    Stop(String),
}
impl Failure {
    fn retry(message: &str) -> Self {
        Self::Retry(message.into(), None)
    }
}
fn retry_delay(attempt: u32, seed: u64, minimum: Option<Duration>) -> Duration {
    let ceiling = (1000u64 << attempt.min(6)).min(60_000);
    let jitter = Duration::from_millis(ceiling / 2 + seed % (ceiling / 2 + 1));
    jitter.max(minimum.unwrap_or_default())
}
impl LiveDesk {
    async fn reconnect<F, Fut>(&self, generation: u64, mut attempt: F)
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<(), Failure>>,
    {
        let mut failures = 0u32;
        while self.active(generation) {
            self.update(generation, |s| {
                s["state"] = json!("connecting");
                s["retryAt"] = Value::Null;
                s["message"] = json!("Connecting; previous discussion metadata may be stale");
            });
            let started = tokio::time::Instant::now();
            match attempt()
                .await
                .err()
                .unwrap_or_else(|| Failure::retry("Stream disconnected; retrying"))
            {
                Failure::Stop(message) => {
                    let mut s = self.snapshot.lock().unwrap_or_else(|e| e.into_inner());
                    if self.active(generation) {
                        self.enabled.store(false, Ordering::Release);
                        // Permission loss purges cached discussion metadata too.
                        *s = off_snapshot();
                        s["message"] = json!(message);
                    }
                    return;
                }
                Failure::Retry(message, minimum) => {
                    // An initial snapshot alone is not a stable connection. Avoid a
                    // rapid reconnect storm when the server repeatedly closes after it.
                    if started.elapsed() >= Duration::from_secs(60) {
                        failures = 0;
                    }
                    let seed = uuid::Uuid::new_v4().as_u128() as u64;
                    let delay = retry_delay(failures, seed, minimum);
                    failures = failures.saturating_add(1);
                    self.update(generation, |s| {
                        s["state"] = json!("backoff");
                        s["message"] = json!(message);
                        s["retryAt"] = json!((chrono::Utc::now()
                            + chrono::Duration::from_std(delay).unwrap_or_default())
                        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
                    });
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }
}
struct SessionTiming {
    idle: Duration,
    revalidate: Duration,
}
impl Default for SessionTiming {
    fn default() -> Self {
        Self {
            idle: Duration::from_secs(60),
            revalidate: Duration::from_secs(300),
        }
    }
}
impl LiveDesk {
    async fn consume_stream<S, F, Fut>(
        &self,
        generation: u64,
        mut stream: S,
        mut fetch: F,
        timing: SessionTiming,
    ) -> Result<(), Failure>
    where
        S: Stream<Item = Result<Vec<u8>, Failure>> + Unpin,
        F: FnMut(u64) -> Fut,
        Fut: std::future::Future<Output = Result<Option<Value>, Failure>>,
    {
        let mut parser = SseParser::default();
        let mut list = StoryList::default();
        let mut queue = VecDeque::new();
        let mut pending = HashSet::new();
        let mut jobs = FuturesUnordered::new();
        let mut idle_deadline = tokio::time::Instant::now() + timing.idle;
        let next_revalidation = *self
            .revalidate_at
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get_or_insert_with(|| tokio::time::Instant::now() + timing.revalidate);
        let mut revalidate = tokio::time::interval_at(next_revalidation, timing.revalidate);
        revalidate.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            while jobs.len() < 4 {
                let Some(id) = queue.pop_front() else { break };
                let future = fetch(id);
                jobs.push(async move { (id, future.await) });
            }
            tokio::select! {
                chunk = stream.next() => {
                    let bytes = chunk.ok_or_else(|| Failure::retry("Stream disconnected; retrying"))??;
                    if bytes.is_empty() { continue; }
                    idle_deadline = tokio::time::Instant::now() + timing.idle;
                    let frames = parser.push(&bytes).map_err(|e| Failure::Retry(e, None))?;
                    for frame in frames {
                        let ids = self.handle_frame(generation, &mut list, frame)?;
                        enqueue(&mut queue, &mut pending, ids);
                    }
                }
                Some((id, result)) = jobs.next(), if !jobs.is_empty() => {
                    pending.remove(&id);
                    let item = result?;
                    self.update(generation, |s| apply_item(s, id, item));
                }
                _ = revalidate.tick() => {
                    *self.revalidate_at.lock().unwrap_or_else(|e| e.into_inner()) =
                        Some(tokio::time::Instant::now() + timing.revalidate);
                    // HN's newstories subscription does not report individual item
                    // deletion. Refresh retained IDs conservatively, even if evicted
                    // from that upstream list, and remove null/dead/deleted results.
                    let ids: Vec<u64> = self.status()["items"].as_array().into_iter().flatten()
                        .filter_map(|item| item["id"].as_u64()).collect();
                    enqueue(&mut queue, &mut pending, ids);
                    enqueue(&mut queue, &mut pending, list.ids().into_iter().take(INITIAL_LIMIT));
                }
                _ = tokio::time::sleep_until(idle_deadline) => {
                    return Err(Failure::retry("Stream idle timeout; reconnecting"));
                }
            }
        }
    }
    fn handle_frame(
        &self,
        generation: u64,
        list: &mut StoryList,
        frame: Frame,
    ) -> Result<Vec<u64>, Failure> {
        self.update(generation, |s| s["lastEventAt"] = json!(now_iso()));
        match frame.event.as_str() {
            "cancel" | "auth_revoked" => Err(Failure::Stop(
                "Hacker News stream access was cancelled or revoked; enable manually to retry"
                    .into(),
            )),
            "put" | "patch" => {
                let value: Value = serde_json::from_str(&frame.data)
                    .map_err(|_| Failure::retry("Invalid Firebase JSON"))?;
                let initial = !list.initialized;
                let ids = list
                    .apply(&frame.event, &value)
                    .map_err(|e| Failure::Retry(e, None))?;
                self.update(generation, |s| {
                    s["state"] = json!("connected");
                    s["retryAt"] = Value::Null;
                    s["message"] = json!(if initial {
                        "Connected: initial discussion snapshot (not new publications)"
                    } else {
                        "Connected: incoming discussion list updates"
                    });
                });
                Ok(ids)
            }
            _ => Ok(Vec::new()), // Keep-alives affect transport freshness only.
        }
    }
}
fn enqueue(
    queue: &mut VecDeque<u64>,
    pending: &mut HashSet<u64>,
    ids: impl IntoIterator<Item = u64>,
) {
    for id in ids {
        // Total queued + in-flight work is bounded, including duplicate frames.
        if pending.len() >= ITEM_LIMIT {
            break;
        }
        if pending.insert(id) {
            queue.push_back(id);
        }
    }
}
const HOST: &str = "hacker-news.firebaseio.com";
const STREAM_URL: &str = "https://hacker-news.firebaseio.com/v0/newstories.json";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
const ITEM_BYTES_LIMIT: usize = 128 * 1024;

fn check_http(status: u16, headers: &reqwest::header::HeaderMap) -> Result<(), Failure> {
    if (200..300).contains(&status) {
        return Ok(());
    }
    if status == 429 || status == 408 || (500..600).contains(&status) {
        let minimum = match headers
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|h| h.to_str().ok())
        {
            Some(raw) => parse_retry_after(raw, chrono::Utc::now())?,
            None => None,
        };
        return Err(Failure::Retry(
            format!("Hacker News HTTP {status}; backing off"),
            minimum,
        ));
    }
    // Redirects are deliberately rejected, never followed to another origin.
    Err(Failure::Stop(format!(
        "Hacker News HTTP {status}; access or redirect rejected, enable manually to retry"
    )))
}
fn parse_retry_after(
    raw: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<Option<Duration>, Failure> {
    let raw = raw.trim();
    let seconds = if !raw.is_empty() && raw.bytes().all(|b| b.is_ascii_digit()) {
        Some(raw.parse::<u64>().map_err(|_| {
            Failure::Stop("Retry-After exceeds supported range; stream stopped".into())
        })?)
    } else {
        chrono::DateTime::parse_from_rfc2822(raw).ok().map(|date| {
            let remaining = date.with_timezone(&chrono::Utc) - now;
            let whole = remaining.num_seconds().max(0) as u64;
            whole + u64::from(remaining > chrono::Duration::seconds(whole as i64))
        })
    };
    // Never truncate a server cooldown and retry early. Unreasonably long delays
    // fail closed rather than overflowing an Instant/ISO timestamp.
    if seconds.is_some_and(|s| s > 365 * 24 * 3600) {
        return Err(Failure::Stop(
            "Retry-After exceeds one year; stream stopped".into(),
        ));
    }
    Ok(seconds.map(Duration::from_secs))
}
fn public_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192
                    && (b == 168 || (b == 0 && (c == 0 || c == 2)) || (b == 88 && c == 99)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        std::net::IpAddr::V6(ip) => {
            let s = ip.segments();
            (s[0] & 0xe000) == 0x2000
                && s[0] != 0x2002
                && !(s[0] == 0x2001 && (s[1] < 0x200 || s[1] == 0xdb8))
                && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}
async fn stream_client() -> Result<reqwest::Client, Failure> {
    let addresses: Vec<_> =
        tokio::time::timeout(Duration::from_secs(3), tokio::net::lookup_host((HOST, 443)))
            .await
            .map_err(|_| Failure::retry("Hacker News DNS timed out"))?
            .map_err(|_| Failure::retry("Hacker News DNS unavailable"))?
            .take(33)
            .collect();
    if addresses.is_empty() || addresses.len() > 32 || addresses.iter().any(|a| !public_ip(a.ip()))
    {
        return Err(Failure::Stop(
            "Hacker News resolved to a private/reserved or invalid destination; blocked".into(),
        ));
    }
    // Validate once and pin ALL resolved addresses: no DNS rebinding, proxies,
    // redirects, cookies, credentials, referer, or arbitrary upstream URLs.
    // Unlike services' 15s total-timeout client, SSE has an idle read deadline.
    reqwest::Client::builder()
        .no_proxy()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .referer(false)
        .connect_timeout(Duration::from_secs(5))
        .resolve_to_addrs(HOST, &addresses)
        .user_agent("NewsTerminal/0.2 (opt-in HN discussion metadata)")
        .build()
        .map_err(|_| Failure::retry("Live HTTP client unavailable"))
}
async fn fetch_item(client: reqwest::Client, id: u64) -> Result<Option<Value>, Failure> {
    tokio::time::timeout(REQUEST_TIMEOUT, async {
        let response = client
            .get(format!("https://{HOST}/v0/item/{id}.json"))
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|_| Failure::retry("Story metadata request failed"))?;
        check_http(response.status().as_u16(), response.headers())?;
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| Failure::retry("Story metadata read failed"))?;
            if bytes.len() + chunk.len() > ITEM_BYTES_LIMIT {
                return Err(Failure::retry("Story metadata exceeds byte limit"));
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|_| Failure::retry("Invalid story metadata JSON"))?;
        Ok(story_metadata(id, &value))
    })
    .await
    .map_err(|_| Failure::retry("Story metadata timed out"))?
}
impl LiveDesk {
    /// Call from the host's Tokio runtime. Returns the immediately current status.
    /// Disabling clears memory and wakes/drops the worker even during idle I/O.
    pub fn set_enabled(self: &Arc<Self>, enabled: bool) -> Value {
        self.start(enabled, |desk, generation| async move {
            desk.reconnect(generation, || desk.session(generation))
                .await;
        })
    }
    async fn session(&self, generation: u64) -> Result<(), Failure> {
        let client = stream_client().await?;
        let response = tokio::time::timeout(
            REQUEST_TIMEOUT,
            client
                .get(STREAM_URL)
                .header(reqwest::header::ACCEPT, "text/event-stream")
                .header(reqwest::header::CACHE_CONTROL, "no-cache")
                .send(),
        )
        .await
        .map_err(|_| Failure::retry("Live stream connection timed out"))?
        .map_err(|_| Failure::retry("Live stream connection failed"))?;
        check_http(response.status().as_u16(), response.headers())?;
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if !content_type
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .eq_ignore_ascii_case("text/event-stream")
        {
            return Err(Failure::retry("Hacker News did not return an SSE stream"));
        }
        self.update(generation, |s| {
            s["state"] = json!("connected");
            s["message"] = json!("Connected; awaiting initial discussion snapshot");
        });
        let stream = response.bytes_stream().map(|chunk| {
            chunk
                .map(|b| b.to_vec())
                .map_err(|_| Failure::retry("Live stream read failed"))
        });
        self.consume_stream(
            generation,
            stream,
            move |id| fetch_item(client.clone(), id),
            SessionTiming::default(),
        )
        .await
    }
}
fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn story_metadata(id: u64, value: &Value) -> Option<Value> {
    if value["id"].as_u64() != Some(id)
        || value["type"] != "story"
        || value["dead"] == true
        || value["deleted"] == true
    {
        return None;
    }
    let title: String = value["title"]
        .as_str()?
        .chars()
        .filter(|c| !c.is_control())
        .take(500)
        .collect();
    if title.trim().is_empty() {
        return None;
    }
    let by: String = value["by"]
        .as_str()?
        .chars()
        .filter(|c| !c.is_control())
        .take(100)
        .collect();
    let published = chrono::DateTime::from_timestamp(value["time"].as_i64()?, 0)?;
    let discussion = format!("https://news.ycombinator.com/item?id={id}");
    // This is an outbound link ONLY, never a fetch destination. Invalid schemes
    // fall back to the original HN discussion. Render title/by as text, not HTML.
    let link = value["url"]
        .as_str()
        .filter(|raw| raw.len() <= 4096 && !raw.chars().any(|c| c.is_control()))
        .and_then(|raw| url::Url::parse(raw).ok())
        .filter(|url| {
            matches!(url.scheme(), "https" | "http")
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none()
        })
        .map(|url| url.to_string())
        .unwrap_or_else(|| discussion.clone());
    Some(
        json!({"id":id,"title":title,"url":link,"discussionUrl":discussion,"by":by,
        "publishedAt":published.to_rfc3339_opts(chrono::SecondsFormat::Secs,true),
        "receivedAt":now_iso(),"score":value["score"].as_u64().unwrap_or(0),
        "sourceId":"hacker-news", "sourceLabel":"Hacker News", "contentKind":"discussion", "aiAllowed":false}),
    )
}
fn apply_item(snapshot: &mut Value, id: u64, item: Option<Value>) {
    let items = snapshot["items"]
        .as_array_mut()
        .expect("internal items array");
    let mut changed = false;
    if let Some(mut item) = item {
        if let Some(existing) = items.iter_mut().find(|old| old["id"].as_u64() == Some(id)) {
            // Revalidation is not a new receipt/publication. Keep the first receipt.
            item["receivedAt"] = existing["receivedAt"].clone();
            *existing = item;
        } else {
            items.push(item);
            changed = true;
        }
    } else {
        items.retain(|old| old["id"].as_u64() != Some(id));
    }
    items.sort_by(|a, b| {
        b["publishedAt"]
            .as_str()
            .cmp(&a["publishedAt"].as_str())
            .then_with(|| b["id"].as_u64().cmp(&a["id"].as_u64()))
    });
    items.truncate(ITEM_LIMIT);
    if changed {
        snapshot["lastItemAt"] = json!(now_iso());
    }
}
fn off_snapshot() -> Value {
    json!({"enabled":false,"state":"off","lastEventAt":null,"lastItemAt":null,
        "retryAt":null,"message":"Live discussion stream is off", "items":[]})
}

const LIST_LIMIT: usize = 1000;
const INITIAL_LIMIT: usize = 20;
const ITEM_LIMIT: usize = 100;

/// The subscribed node is an array of scalar IDs, not arbitrary Firebase JSON.
#[derive(Default)]
struct StoryList {
    entries: BTreeMap<usize, u64>,
    initialized: bool,
}
impl StoryList {
    fn apply(&mut self, event: &str, value: &Value) -> Result<Vec<u64>, String> {
        let path = value["path"].as_str().ok_or("Missing Firebase path")?;
        let data = value.get("data").ok_or("Missing Firebase data")?;
        let mut next = self.entries.clone();
        match (event, path) {
            ("put", "/") => {
                next.clear();
                match data {
                    Value::Null => {}
                    Value::Array(ids) if ids.len() <= LIST_LIMIT => {
                        for (index, id) in ids.iter().enumerate() {
                            set_id(&mut next, index, id)?;
                        }
                    }
                    Value::Object(ids) if ids.len() <= LIST_LIMIT => {
                        for (index, id) in ids {
                            set_id(&mut next, list_index(index)?, id)?;
                        }
                    }
                    _ => return Err("Invalid or oversized Firebase list".into()),
                }
            }
            ("patch", "/") => {
                if data.is_null() {
                    next.clear();
                } else {
                    let updates = data.as_object().ok_or("Invalid Firebase list patch")?;
                    if updates.len() > LIST_LIMIT {
                        return Err("Firebase patch exceeds limit".into());
                    }
                    for (index, id) in updates {
                        set_id(&mut next, list_index(index)?, id)?;
                    }
                }
            }
            ("put" | "patch", _) => {
                // Deeper paths cannot exist underneath a scalar story ID.
                let index = list_index(path.strip_prefix('/').ok_or("Invalid Firebase path")?)?;
                set_id(&mut next, index, data)?;
            }
            _ => return Err("Unsupported Firebase event".into()),
        }
        let previous: HashSet<_> = self.entries.values().copied().collect();
        self.entries = next;
        let ids = self.ids();
        let result = if self.initialized {
            ids.into_iter()
                .filter(|id| !previous.contains(id))
                .take(ITEM_LIMIT)
                .collect()
        } else {
            ids.into_iter().take(INITIAL_LIMIT).collect()
        };
        self.initialized = true;
        Ok(result)
    }
    fn ids(&self) -> Vec<u64> {
        let mut seen = HashSet::new();
        self.entries
            .values()
            .copied()
            .filter(|id| seen.insert(*id))
            .collect()
    }
}
fn list_index(raw: &str) -> Result<usize, String> {
    if raw.is_empty()
        || !raw.bytes().all(|b| b.is_ascii_digit())
        || (raw.len() > 1 && raw.starts_with('0'))
    {
        return Err("Invalid Firebase list index".into());
    }
    raw.parse::<usize>()
        .ok()
        .filter(|index| *index < LIST_LIMIT)
        .ok_or_else(|| "Firebase list index exceeds limit".into())
}
fn set_id(entries: &mut BTreeMap<usize, u64>, index: usize, id: &Value) -> Result<(), String> {
    if id.is_null() {
        entries.remove(&index);
    } else {
        let id = id
            .as_u64()
            .filter(|id| *id > 0 && *id <= i64::MAX as u64)
            .ok_or("Invalid story ID")?;
        entries.insert(index, id);
    }
    Ok(())
}

#[derive(Debug, PartialEq)]
struct Frame {
    event: String,
    data: String,
}
const FRAME_LIMIT: usize = 64 * 1024;
const CHUNK_LIMIT: usize = 128 * 1024;
const FRAME_BATCH_LIMIT: usize = 256;

/// Bytes are buffered until a complete line: UTF-8 code points may span chunks.
#[derive(Default)]
struct SseParser {
    line: Vec<u8>,
    event: String,
    data: String,
    has_data: bool,
    has_comment: bool,
    skip_lf: bool,
    seen_line: bool,
    frame_bytes: usize,
}
impl SseParser {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<Frame>, String> {
        if bytes.len() > CHUNK_LIMIT {
            return Err("SSE chunk exceeds limit".into());
        }
        let mut frames = Vec::new();
        for &byte in bytes {
            if self.skip_lf {
                self.skip_lf = false;
                if byte == b'\n' {
                    continue;
                }
            }
            self.frame_bytes += 1;
            if self.frame_bytes > FRAME_LIMIT {
                return Err("SSE frame exceeds limit".into());
            }
            if matches!(byte, b'\r' | b'\n') {
                self.skip_lf = byte == b'\r';
                self.finish_line(&mut frames)?;
                if frames.len() > FRAME_BATCH_LIMIT {
                    return Err("Too many SSE frames".into());
                }
            } else {
                self.line.push(byte);
            }
        }
        Ok(frames)
    }
    fn finish_line(&mut self, frames: &mut Vec<Frame>) -> Result<(), String> {
        let bytes = std::mem::take(&mut self.line);
        let line = std::str::from_utf8(&bytes).map_err(|_| "Invalid SSE UTF-8")?;
        let line = if !self.seen_line {
            line.strip_prefix('\u{feff}').unwrap_or(line)
        } else {
            line
        };
        self.seen_line = true;
        if line.is_empty() {
            if self.has_data || self.has_comment {
                frames.push(Frame {
                    event: if self.event.is_empty() {
                        if self.has_data {
                            "message"
                        } else {
                            "keep-alive"
                        }
                        .into()
                    } else {
                        std::mem::take(&mut self.event)
                    },
                    data: std::mem::take(&mut self.data),
                });
            }
            self.event.clear();
            self.data.clear();
            self.has_data = false;
            self.has_comment = false;
            self.frame_bytes = 0;
        } else if line.starts_with(':') {
            self.has_comment = true;
        } else {
            let (field, value) = line.split_once(':').unwrap_or((line, ""));
            let value = value.strip_prefix(' ').unwrap_or(value);
            match field {
                "event" => self.event = value.into(),
                "data" => {
                    if self.has_data {
                        self.data.push('\n');
                    }
                    self.data.push_str(value);
                    self.has_data = true;
                }
                // HN does not provide a durable SSE id/replay cursor.
                _ => {}
            }
        }
        Ok(())
    }
}
