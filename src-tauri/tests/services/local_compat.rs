use super::*;
use std::io::{Read, Write};

fn provider(base_url: &str) -> Value {
    json!({"id":"openai-local","kind":"openai-local","name":"Local OpenAI-compatible",
        "model":"lmstudio-community/local-model@q4_k_m","baseUrl":base_url,
        "enabled":true,"consented":true})
}

fn article() -> Value {
    json!({"aiAllowed":true,"storage":"excerpt","title":"Public-domain test text",
        "excerpt":"Pinebridge opened a library with 1200 books.",
        "url":"https://example.org/fixture","fullText":"DO_NOT_SEND_FULL_TEXT"})
}

fn completion(text: &str) -> Value {
    json!({"choices":[{"index":0,"finish_reason":"stop",
        "message":{"role":"assistant","content":text}}]})
}

#[test]
fn compatible_base_url_is_loopback_without_credentials_or_routing_fields() {
    for (raw, expected) in [
        ("http://127.0.0.1:1234/v1", "http://127.0.0.1:1234/v1"),
        ("http://localhost:8080/v1/", "http://127.0.0.1:8080/v1"),
        ("http://[::1]:9931/v1", "http://[::1]:9931/v1"),
    ] {
        assert_eq!(openai_local_base_url(raw).unwrap().as_str(), expected);
    }
    for raw in [
        "https://api.openai.com/v1",
        "http://example.org:1234/v1",
        "http://localhost.example.org:1234/v1",
        "http://localhost.:1234/v1",
        "http://0.0.0.0:1234/v1",
        "http://192.168.1.2:1234/v1",
        "http://169.254.169.254:1234/v1",
        "http://127.0.0.2:1234/v1",
        "http://[::ffff:127.0.0.1]:1234/v1",
        "http://[::]:1234/v1",
        "https://127.0.0.1:1234/v1",
        "http://127.0.0.1/v1",
        "http://127.0.0.1:0/v1",
        "http://127.0.0.1:65536/v1",
        "http://user:secret@127.0.0.1:1234/v1",
        "http://127.0.0.1:1234@evil.org/v1",
        "http://127.0.0.1:1234/v1?key=secret",
        "http://127.0.0.1:1234/v1#secret",
        "http://127.0.0.1:1234/",
        "http://127.0.0.1:1234/v1/chat/completions",
        "http://127.0.0.1:1234/v1\n",
        " http://127.0.0.1:1234/v1",
    ] {
        let error = openai_local_base_url(raw).unwrap_err();
        assert!(
            !error.contains("secret"),
            "URL credentials must not appear in errors"
        );
    }
    assert!(openai_local_base_url(&"x".repeat(257)).is_err());
}

#[test]
fn compatible_requests_keep_scope_and_explicit_budgets_without_keys_or_tools() {
    let client = client_builder().build().unwrap();
    let p = provider("http://localhost:1234/v1/");
    let mut a = article();
    a["excerpt"] = json!("x".repeat(3000));
    let request = ai_request(&client, &p, &a, Some("NEVER_SEND_KEY"))
        .unwrap()
        .build()
        .unwrap();
    assert_eq!(
        request.url().as_str(),
        "http://127.0.0.1:1234/v1/chat/completions"
    );
    assert!(!request.headers().contains_key("authorization"));
    assert!(!request.headers().contains_key("x-goog-api-key"));
    let body: Value = serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
    assert_eq!(body["model"], p["model"]);
    assert_eq!(body["stream"], false);
    assert_eq!(body["max_tokens"], 512);
    assert!(body.get("tools").is_none());
    assert!(body.get("response_format").is_none());
    assert!(!body.to_string().contains("DO_NOT_SEND_FULL_TEXT"));
    assert!(!body.to_string().contains("NEVER_SEND_KEY"));
    let input: Value =
        serde_json::from_str(body["messages"][1]["content"].as_str().unwrap()).unwrap();
    assert_eq!(input["excerpt"].as_str().unwrap().len(), 2000);
    let sector_request = prompt_request(
        &client,
        &p,
        crate::sector_summary::SYSTEM,
        r#"{"candidates":[]}"#,
        true,
        None,
    )
    .unwrap()
    .build()
    .unwrap();
    let sector_body: Value =
        serde_json::from_slice(sector_request.body().unwrap().as_bytes().unwrap()).unwrap();
    assert_eq!(sector_body["max_tokens"], 1024);
    assert!(sector_body.get("response_format").is_none());
    assert!(prompt_request(
        &client,
        &p,
        SUMMARY_SYSTEM,
        &"x".repeat(128 * 1024 + 1),
        false,
        None
    )
    .is_err());
}

#[test]
fn compatible_configuration_requires_model_and_consent_and_never_uses_keyring() {
    let client = client_builder().build().unwrap();
    for field in ["enabled", "consented"] {
        let mut p = provider("http://127.0.0.1:1234/v1");
        p[field] = json!(false);
        assert!(ai_request(&client, &p, &article(), None).is_err());
    }
    for model in [
        "",
        "../../bad",
        "http://remote/model",
        "model\ninjected",
        "gpt-oss:cloud",
    ] {
        let mut p = provider("http://127.0.0.1:1234/v1");
        p["model"] = json!(model);
        assert!(ai_request(&client, &p, &article(), None).is_err());
    }
    for kind in ["gemini", "groq", "openai"] {
        let mut p = provider("http://127.0.0.1:1234/v1");
        p["kind"] = json!(kind);
        assert!(provider_endpoint(&p)
            .unwrap_err()
            .contains("Zero-paid mode blocks cloud AI providers"));
    }
    for id in ["ollama", "openai-local"] {
        assert!(!has_key(id));
        assert_eq!(
            save_key(id, "NEVER_STORE_KEY").unwrap_err(),
            "Local AI providers do not use API keys"
        );
    }
}

#[test]
fn compatible_response_requires_one_complete_assistant_text_without_tools() {
    let p = provider("http://127.0.0.1:1234/v1");
    assert_eq!(
        checked_response_text(&completion("Fixture summary."), &p, None, 4000).unwrap(),
        "Fixture summary."
    );
    let mut rejected = vec![
        json!({}),
        json!({"choices":[]}),
        completion(""),
        completion(" \n "),
        completion(&"x".repeat(4001)),
        json!({"choices":[{"finish_reason":"stop","message":{"content":"Missing role"}}]}),
    ];
    for reason in [
        "length",
        "tool_calls",
        "content_filter",
        "function_call",
        "",
    ] {
        let mut result = completion("Partial text");
        result["choices"][0]["finish_reason"] = json!(reason);
        rejected.push(result);
    }
    for (field, value) in [
        ("tool_calls", json!([{"id":"tool1"}])),
        ("tool_calls", json!("malformed")),
        ("function_call", json!({"name":"fetch"})),
        ("refusal", json!("refused")),
        ("content", Value::Null),
        ("content", json!([{"type":"text","text":"Parts"}])),
        ("role", json!("tool")),
    ] {
        let mut result = completion("Unsafe text");
        result["choices"][0]["message"][field] = value;
        rejected.push(result);
    }
    let mut two_choices = completion("One");
    two_choices["choices"]
        .as_array_mut()
        .unwrap()
        .push(completion("Two")["choices"][0].clone());
    rejected.push(two_choices);
    for (field, value) in [
        ("error", json!({"message":"PRIVATE_ERROR"})),
        ("remote_host", json!("https://remote.example")),
        ("remote_model", json!("remote")),
    ] {
        let mut result = completion("Text");
        result[field] = value;
        rejected.push(result);
    }
    for result in rejected {
        let error = checked_response_text(&result, &p, None, 4000).unwrap_err();
        assert!(!error.contains("PRIVATE_ERROR"));
    }
}

#[test]
fn ollama_metadata_rejects_remote_aliases_ambiguity_and_missing_models() {
    assert!(
        require_local_ollama_entry(&json!({"models":[{"name":"local:latest"}]}), "local").is_ok()
    );
    assert!(require_local_ollama_entry(
        &json!({"models":[{"model":"org/local:q4"}]}),
        "org/local:q4"
    )
    .is_ok());
    for tags in [
        json!({}),
        json!({"models":[]}),
        json!({"models":[{"name":"other:latest"}]}),
        json!({"error":"PRIVATE_ERROR","models":[{"name":"local:latest"}]}),
        json!({"models":[{"name":"local:latest","remote_host":"https://ollama.com"}]}),
        json!({"models":[{"name":"local:latest","remote_model":"remote:cloud"}]}),
        json!({"models":[{"name":"local:latest","remote_host":true}]}),
        json!({"models":[{"name":"local:latest"},{"name":"local"}]}),
    ] {
        assert!(require_local_ollama_entry(&tags, "local").is_err());
    }
}

#[test]
fn ollama_completion_rejects_malformed_stop_reasons_and_tools() {
    let p = json!({"kind":"ollama"});
    for patch in [
        json!({"done_reason":7,"message":{"content":"Invalid stop reason"}}),
        json!({"done_reason":"stop","message":{"content":"Tool output","tool_calls":true}}),
        json!({"done_reason":"stop","message":{"content":"Remote output"},"remote_host":"https://ollama.com"}),
    ] {
        let mut result = patch;
        result["done"] = json!(true);
        assert!(checked_response_text(&result, &p, None, 4000).is_err());
    }
}

// A bounded, test-only HTTP server on an ephemeral loopback port. It reads the
// full request body so the tests observe actual wire content, not only headers.
fn fixture(response: String, delay: Duration) -> (String, std::sync::mpsc::Receiver<String>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        listener.set_nonblocking(true).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error)
                    if error.kind() == std::io::ErrorKind::WouldBlock
                        && std::time::Instant::now() < deadline =>
                {
                    std::thread::sleep(Duration::from_millis(5))
                }
                Err(_) => return,
            }
        };
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut buf = [0; 4096];
        loop {
            let count = stream.read(&mut buf).unwrap();
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&buf[..count]);
            assert!(bytes.len() < 256 * 1024);
            if let Some(index) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..index]).to_ascii_lowercase();
                let content_length = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length:"))
                    .map(|value| value.trim().parse::<usize>().unwrap())
                    .unwrap_or(0);
                if bytes.len() >= index + 4 + content_length {
                    break;
                }
            }
        }
        let _ = tx.send(String::from_utf8(bytes).unwrap());
        std::thread::sleep(delay);
        let _ = stream.write_all(response.as_bytes());
    });
    (base_url, rx)
}

fn json_response(value: Value) -> String {
    let body = value.to_string();
    format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
}

#[tokio::test]
async fn compatible_adapter_runs_article_and_sector_validation_over_fixture_http() {
    let (base, received) = fixture(
        json_response(completion("The fixture library opened.")),
        Duration::ZERO,
    );
    let result = summarize(
        &[provider(&base)],
        &article(),
        Arc::new(AtomicBool::new(false)),
    )
    .await
    .unwrap();
    let request = received.recv_timeout(Duration::from_secs(1)).unwrap();
    assert!(request.starts_with("POST /v1/chat/completions "));
    assert!(request.contains("Pinebridge"));
    assert!(!request.to_ascii_lowercase().contains("authorization:"));
    assert_eq!(result["provider"], "openai-local");
    assert_eq!(result["text"], "The fixture library opened.");

    let selection = crate::sector_summary::Selection {
        preview: json!({"date":"2026-10-18","sectorTitle":"Fixture","sources":[
            {"id":"S1","inputLabel":"Feed excerpt"},{"id":"S2","inputLabel":"Feed excerpt"}]}),
        articles: vec![article(), article()],
        providers: vec![],
    };
    let sources = crate::sector_summary::inputs(&selection).unwrap();
    let candidates = crate::sector_summary::quotation_candidates(&sources).unwrap();
    let answer = json!({"selectedCandidateIds":[candidates[0]["id"]]}).to_string();
    let (base, received) = fixture(json_response(completion(&answer)), Duration::ZERO);
    let mut selection = selection;
    selection.providers = vec![provider(&base)];
    let result = summarize_sector(&selection, Arc::new(AtomicBool::new(false)))
        .await
        .unwrap();
    let request = received.recv_timeout(Duration::from_secs(1)).unwrap();
    assert!(request.starts_with("POST /v1/chat/completions "));
    let bullets =
        crate::sector_summary::validate_bullets(result["text"].as_str().unwrap(), &sources)
            .unwrap();
    assert_eq!(bullets[0]["text"], candidates[0]["quote"]);
}

#[tokio::test]
async fn compatible_adapter_rejects_redirects_and_oversized_responses() {
    for response in [
        "HTTP/1.1 302 Found\r\nLocation: https://example.org/PRIVATE_REDIRECT\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
        "HTTP/1.1 200 OK\r\nContent-Length: 65537\r\nConnection: close\r\n\r\n".to_string(),
        json_response(completion(&"x".repeat(65536))),
    ] {
        let (base, received) = fixture(response, Duration::ZERO);
        let error = summarize(&[provider(&base)], &article(), Arc::new(AtomicBool::new(false))).await.unwrap_err();
        received.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(!error.contains("PRIVATE_REDIRECT"));
        assert!(!error.contains("example.org"));
    }
}

#[tokio::test]
async fn compatible_adapter_stops_before_send_on_missing_rights_or_consent() {
    let p = provider("http://127.0.0.1:1/v1");
    let mut a = article();
    a["aiAllowed"] = json!(false);
    let error = summarize(&[p.clone()], &a, Arc::new(AtomicBool::new(false)))
        .await
        .unwrap_err();
    assert_eq!(error, "Source permission does not allow AI summarization");
    a["aiAllowed"] = json!(true);
    a["storage"] = json!("metadata");
    assert_eq!(
        summarize(&[p.clone()], &a, Arc::new(AtomicBool::new(false)))
            .await
            .unwrap_err(),
        "Source permission does not allow AI summarization"
    );
    let mut disabled = p.clone();
    disabled["consented"] = json!(false);
    assert_eq!(
        summarize(&[disabled], &article(), Arc::new(AtomicBool::new(false)))
            .await
            .unwrap_err(),
        "No enabled, consented AI provider is configured"
    );
    assert_eq!(
        summarize(&[p], &article(), Arc::new(AtomicBool::new(true)))
            .await
            .unwrap_err(),
        "Summary cancelled"
    );
}

#[tokio::test]
async fn compatible_cancellation_discards_the_pending_fixture_response() {
    let (base, received) = fixture(
        json_response(completion("Late fixture output")),
        Duration::from_millis(500),
    );
    let cancel = Arc::new(AtomicBool::new(false));
    let signal = cancel.clone();
    let p = provider(&base);
    let providers = [p];
    let a = article();
    let (result, ()) = tokio::join!(summarize(&providers, &a, cancel), async {
        tokio::task::spawn_blocking(move || received.recv_timeout(Duration::from_secs(2)).unwrap())
            .await
            .unwrap();
        signal.store(true, Ordering::Release);
    });
    assert_eq!(result.unwrap_err(), "Summary cancelled");
}

#[tokio::test]
async fn ollama_metadata_request_contains_no_excerpts_and_rejects_remote_models() {
    let (base, received) = fixture(
        json_response(
            json!({"models":[{"name":"local:latest","remote_host":"https://ollama.com"}]}),
        ),
        Duration::ZERO,
    );
    let endpoint = Url::parse(&base).unwrap();
    let client = client_builder().build().unwrap();
    assert!(require_local_ollama_model(&client, &endpoint, "local")
        .await
        .is_err());
    let request = received.recv_timeout(Duration::from_secs(1)).unwrap();
    assert!(request.starts_with("GET /api/tags "));
    assert!(request.ends_with("\r\n\r\n"));
    assert!(!request.contains("Pinebridge"));
}
