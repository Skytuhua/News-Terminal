use serde_json::{json, Value};

/// One gate per reviewed source, shared by all windows. Only bounded normalized JSON
/// is cached. Holding the async mutex coalesces concurrent readers without a task per
/// waiter; cancellation drops the gate and never publishes a half snapshot.
#[derive(Default)]
pub struct MetadataCache {
    value: tokio::sync::Mutex<Option<Value>>,
}
impl MetadataCache {
    pub async fn load<F, Fut>(
        &self,
        persisted: Option<Value>,
        now: i64,
        ttl: i64,
        loader: F,
    ) -> Value
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Value, String>>,
    {
        let mut guard = self.value.lock().await;
        if guard.is_none() {
            *guard = persisted.filter(|v| v["complete"] == true);
        }
        if let Some(value) = guard.as_ref() {
            let next = value["nextCheck"].as_i64().unwrap_or_else(|| {
                value["observedAt"]
                    .as_i64()
                    .unwrap_or(0)
                    .saturating_add(ttl)
            });
            if now < next && next <= now.saturating_add(ttl.max(300)) {
                return value.clone();
            }
        }
        let result = tokio::time::timeout(std::time::Duration::from_secs(120), loader())
            .await
            .map_err(|_| "Metadata snapshot timed out".to_string())
            .and_then(|v| v)
            .and_then(|v| {
                if v["complete"] == true && v.to_string().len() <= 8 * 1024 * 1024 {
                    Ok(v)
                } else {
                    Err("Incomplete or oversized metadata snapshot".into())
                }
            });
        let mut value = match result {
            Ok(mut next) => {
                if next["models"].is_array() {
                    next["changes"] = json!(diff_snapshots(guard.as_ref(), &next, guard.is_none()));
                    let previous = guard.as_ref().and_then(|v| v["models"].as_array());
                    if let Some(models) = next["models"].as_array_mut() {
                        for model in models {
                            model["firstSeen"] = previous
                                .and_then(|rows| rows.iter().find(|m| m["id"] == model["id"]))
                                .and_then(|m| m["firstSeen"].as_i64())
                                .unwrap_or(now)
                                .into();
                        }
                    }
                }
                next["status"] = json!("fresh");
                next["error"] = Value::Null;
                next["nextCheck"] = json!(now.saturating_add(ttl));
                next
            }
            Err(error) => {
                let mut previous = guard.clone().unwrap_or_else(
                    || json!({"complete":false,"observedAt":null,"rows":[],"models":[]}),
                );
                previous["status"] = json!(if previous["complete"] == true {
                    "stale"
                } else {
                    "unavailable"
                });
                previous["error"] = json!(error);
                previous["nextCheck"] = json!(now.saturating_add(300));
                previous
            }
        };
        value["lastChecked"] = json!(now);
        *guard = Some(value.clone());
        value
    }
}

pub const OPENROUTER_MODELS_URL: &str =
    "https://openrouter.ai/api/v1/models?output_modalities=all&limit=500&offset=0";

fn text<'a>(value: &'a Value, key: &str, max: usize) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= max && !s.chars().any(char::is_control))
        .ok_or_else(|| format!("Invalid model {key}"))
}

fn strings(
    value: &Value,
    key: &str,
    max_items: usize,
    max_len: usize,
) -> Result<Vec<String>, String> {
    if value[key].is_null() {
        return Ok(Vec::new());
    }
    let items = value[key]
        .as_array()
        .ok_or_else(|| format!("Invalid model {key} list"))?;
    if items.len() > max_items {
        return Err(format!("Too many model {key} entries"));
    }
    items
        .iter()
        .map(|item| {
            item.as_str()
                .filter(|s| s.len() <= max_len && !s.chars().any(char::is_control))
                .map(str::to_owned)
                .ok_or_else(|| format!("Invalid model {key} entry"))
        })
        .collect()
}

pub fn parse_openrouter_snapshot(raw: &Value, observed_at: i64) -> Result<Value, String> {
    let data = raw["data"]
        .as_array()
        .ok_or("OpenRouter model response missing data")?;
    if data.is_empty() || data.len() > 2500 {
        return Err("OpenRouter snapshot exceeds item limit or is empty".into());
    }
    let total = raw["total_count"]
        .as_u64()
        .filter(|count| *count > 0 && *count <= 2500)
        .ok_or("Invalid OpenRouter model total")?;
    if raw.get("links").and_then(|l| l.get("next")) != Some(&Value::Null)
        || total != data.len() as u64
    {
        return Err("Incomplete OpenRouter snapshot".into());
    }
    let complete = true;
    let mut ids = std::collections::HashSet::new();
    let mut models = Vec::new();
    for item in data {
        let id = text(item, "id", 240)?;
        if !ids.insert(id) {
            return Err("Duplicate OpenRouter model ID".into());
        }
        let name = text(item, "name", 240).unwrap_or(id);
        let created = item["created"].as_i64().filter(|t| *t > 0);
        let context = if item["context_length"].is_null() {
            None
        } else {
            Some(
                item["context_length"]
                    .as_u64()
                    .filter(|n| *n <= 100_000_000)
                    .ok_or("Invalid model context_length")?,
            )
        };
        let architecture = &item["architecture"];
        let input = strings(architecture, "input_modalities", 16, 40)?;
        let output = strings(architecture, "output_modalities", 16, 40)?;
        let supported = strings(item, "supported_parameters", 64, 80)?;
        let mut pricing = json!({});
        if !item["pricing"].is_null() && !item["pricing"].is_object() {
            return Err("Invalid model pricing".into());
        }
        // Store reviewed price fields only, not arbitrary provider benchmark data.
        for key in [
            "prompt",
            "completion",
            "request",
            "image",
            "web_search",
            "internal_reasoning",
            "input_cache_read",
            "input_cache_write",
        ] {
            if let Some(value) = item["pricing"].get(key) {
                if !value.is_null()
                    && value.as_str().is_none_or(|s| {
                        s.len() > 80 || s.parse::<f64>().ok().is_none_or(|n| !n.is_finite())
                    })
                {
                    return Err("Invalid model price".into());
                }
                pricing[key] = value.clone();
            }
        }
        models.push(json!({
            "id": id,
            "name": name,
            "provider": id.split('/').next().unwrap_or("unknown"),
            "contextLength": context,
            "inputModalities": input,
            "outputModalities": output,
            "supportedParameters": supported,
            "pricing": pricing,
            "topProvider": item.get("top_provider").cloned().unwrap_or(Value::Null),
            "addedToOpenRouter": created,
            "observedAt": observed_at,
            "sourceUrl": format!("https://openrouter.ai/{}", id),
            "releaseDateLabel": "Added to OpenRouter",
            "inferenceNote": "Metadata only. Free model labels are not permission to run inference."
        }));
    }
    models.sort_by(|a, b| {
        b["addedToOpenRouter"]
            .as_i64()
            .cmp(&a["addedToOpenRouter"].as_i64())
            .then_with(|| a["id"].as_str().cmp(&b["id"].as_str()))
    });
    Ok(json!({
        "source": "OpenRouter Models API",
        "sourceUrl": "https://openrouter.ai/docs/guides/overview/models",
        "observedAt": observed_at,
        "complete": complete,
        "totalCount": total,
        "models": models
    }))
}

pub fn diff_snapshots(previous: Option<&Value>, next: &Value, first_sync: bool) -> Vec<Value> {
    if first_sync
        || previous.is_none()
        || next["complete"] != true
        || next["discoveryWindow"] == true
        || previous.is_some_and(|p| p["complete"] != true)
    {
        return Vec::new();
    }
    let previous = previous.unwrap();
    let previous_models = previous["models"].as_array().cloned().unwrap_or_default();
    let next_models = next["models"].as_array().cloned().unwrap_or_default();
    let previous_ids = previous_models
        .iter()
        .filter_map(|m| m["id"].as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let next_ids = next_models
        .iter()
        .filter_map(|m| m["id"].as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let mut changes = Vec::new();
    for id in next_ids.difference(&previous_ids) {
        changes.push(json!({"kind":"added","modelId":id,"label":"Added to OpenRouter"}));
    }
    for model in &next_models {
        if let Some(old) = previous_models.iter().find(|old| old["id"] == model["id"]) {
            let fields: Vec<_> = [
                "name",
                "contextLength",
                "inputModalities",
                "outputModalities",
                "supportedParameters",
                "pricing",
                "topProvider",
            ]
            .into_iter()
            .filter(|key| old[*key] != model[*key])
            .collect();
            if !fields.is_empty() {
                changes.push(json!({"kind":"changed","modelId":model["id"],"fields":fields,"label":"OpenRouter metadata changed"}));
            }
        }
    }
    if next["complete"] == true {
        for id in previous_ids.difference(&next_ids) {
            changes.push(json!({"kind":"removed","modelId":id,"label":"Absent from complete OpenRouter snapshot"}));
        }
    }
    changes
}

pub fn validate_openrouter_next(base: &str, next: &str, offset: usize) -> Result<String, String> {
    let url = url::Url::parse(base)
        .map_err(|_| "Invalid pagination base")?
        .join(next)
        .map_err(|_| "Invalid pagination link")?;
    if url.scheme() != "https"
        || url.host_str() != Some("openrouter.ai")
        || url.path() != "/api/v1/models"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("OpenRouter pagination left the reviewed endpoint".into());
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    let params: std::collections::HashMap<_, _> = pairs.iter().cloned().collect();
    if pairs.len() != 3
        || params.len() != 3
        || params.get("output_modalities").map(|s| s.as_ref()) != Some("all")
        || params.get("limit").map(|s| s.as_ref()) != Some("500")
        || params.get("offset").and_then(|s| s.parse::<usize>().ok()) != Some(offset)
    {
        return Err("Invalid OpenRouter pagination parameters".into());
    }
    Ok(url.to_string())
}

pub fn assemble_openrouter_pages(pages: &[Value], observed_at: i64) -> Result<Value, String> {
    if pages.is_empty() || pages.len() > 5 {
        return Err("Invalid OpenRouter page count".into());
    }
    let total = pages[0]["total_count"]
        .as_u64()
        .filter(|n| *n > 0 && *n <= 2500)
        .ok_or("Invalid OpenRouter total")?;
    let mut rows = Vec::new();
    for (index, page) in pages.iter().enumerate() {
        if page["total_count"].as_u64() != Some(total) {
            return Err("OpenRouter total changed during snapshot".into());
        }
        let data = page["data"]
            .as_array()
            .filter(|a| !a.is_empty() && a.len() <= 500)
            .ok_or("Invalid OpenRouter page")?;
        rows.extend(data.iter().cloned());
        let next = page
            .get("links")
            .and_then(|l| l.get("next"))
            .ok_or("Missing OpenRouter links")?;
        if index + 1 == pages.len() {
            if !next.is_null() {
                return Err("OpenRouter page cap or incomplete snapshot".into());
            }
        } else {
            validate_openrouter_next(
                OPENROUTER_MODELS_URL,
                next.as_str().ok_or("Invalid OpenRouter next link")?,
                rows.len(),
            )?;
        }
    }
    parse_openrouter_snapshot(
        &json!({"data":rows,"total_count":total,"links":{"next":null}}),
        observed_at,
    )
}

pub async fn fetch_openrouter_models(observed_at: i64) -> Result<Value, String> {
    let mut url = OPENROUTER_MODELS_URL.to_string();
    let mut pages = Vec::new();
    let mut count = 0;
    for _ in 0..5 {
        let page = crate::benchmarks::fetch_json(&url, 2 * 1024 * 1024).await?;
        count += page["data"]
            .as_array()
            .ok_or("OpenRouter missing data")?
            .len();
        let next = page
            .get("links")
            .and_then(|l| l.get("next"))
            .ok_or("Missing OpenRouter links")?;
        let next = if next.is_null() {
            None
        } else {
            Some(validate_openrouter_next(
                &url,
                next.as_str().ok_or("Invalid OpenRouter next")?,
                count,
            )?)
        };
        pages.push(page);
        match next {
            Some(next) => url = next,
            None => break,
        }
    }
    assemble_openrouter_pages(&pages, observed_at)
}

pub const HUGGINGFACE_MODELS_URL: &str = "https://huggingface.co/api/models?author=Qwen&sort=createdAt&direction=-1&limit=50&full=true&cardData=true";
// Identity verified against QwenLM/Qwen3 README's https://huggingface.co/Qwen link.
// No name-similarity aliases, inference, gated files or weight downloads.
pub fn parse_huggingface_models(raw: &Value, observed_at: i64) -> Result<Value, String> {
    let rows = raw
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 50)
        .ok_or("Invalid Hugging Face discovery window")?;
    let mut models = Vec::new();
    let mut ids = std::collections::HashSet::new();
    for item in rows {
        let id = text(item, "id", 240)?;
        if item["author"] != "Qwen"
            || !id.starts_with("Qwen/")
            || !ids.insert(id)
            || item["private"] != false
        {
            return Err("Unexpected Hugging Face repository identity".into());
        }
        let tags = strings(item, "tags", 300, 500)?;
        let relation = tags.iter().find_map(|tag| {
            if tag.starts_with("base_model:quantized:")
                || tag == "gguf"
                || tag == "awq"
                || tag == "gptq"
            {
                Some("quantization")
            } else if tag.starts_with("base_model:adapter:") || tag == "peft" {
                Some("adapter")
            } else if tag.starts_with("base_model:merge:") || tag == "mergekit" {
                Some("merge")
            } else if tag.starts_with("base_model:finetune:") {
                Some("fine-tune")
            } else {
                None
            }
        });
        let card = &item["cardData"];
        if !card["license"].is_null() {
            text(card, "license", 240)?;
        }
        let bases = match &card["base_model"] {
            Value::String(s) => vec![s.clone()],
            Value::Array(_) => strings(card, "base_model", 32, 240)?,
            Value::Null => Vec::new(),
            _ => return Err("Invalid HF base_model relationship".into()),
        };
        let subtype = relation.unwrap_or(if bases.is_empty() {
            "unspecified"
        } else {
            "derived"
        });
        let created = text(item, "createdAt", 40)?;
        let updated = text(item, "lastModified", 40)?;
        chrono::DateTime::parse_from_rfc3339(created)
            .map_err(|_| "Invalid repository creation date")?;
        chrono::DateTime::parse_from_rfc3339(updated)
            .map_err(|_| "Invalid repository update date")?;
        models.push(json!({"id":id,"name":id,"provider":"Qwen","repositoryCreated":created,"repositoryUpdated":updated,
            "sourceUrl":format!("https://huggingface.co/{id}"),"observedAt":observed_at,"subtype":subtype,"baseModels":bases,
            "license":card.get("license").cloned().unwrap_or(Value::Null),"pipelineTag":item.get("pipeline_tag").cloned().unwrap_or(Value::Null),
            "gated":item.get("gated").cloned().unwrap_or(Value::Null),"releaseDateLabel":"Repository created (not a release announcement)"}));
    }
    Ok(
        json!({"source":"Hugging Face · Qwen","sourceUrl":"https://huggingface.co/Qwen","identityUrl":"https://github.com/QwenLM/Qwen3",
        "scope":"Newest 50 public repositories from Qwen; not a complete organization archive",
        "complete":true,"discoveryWindow":true,"observedAt":observed_at,"totalCount":models.len(),"models":models}),
    )
}
pub async fn fetch_huggingface_models(observed_at: i64) -> Result<Value, String> {
    parse_huggingface_models(
        &crate::benchmarks::fetch_json(HUGGINGFACE_MODELS_URL, 2 * 1024 * 1024).await?,
        observed_at,
    )
}
