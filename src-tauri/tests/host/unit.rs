use super::*;

#[test]
fn hidden_stories_is_read_only_for_change_events() {
    assert!(!changed("hidden_stories"));
    assert!(changed("article_state"));
}

#[test]
fn workspace_get_is_read_only_for_change_events() {
    assert!(!changed("workspace_get"));
    assert!(changed("workspace_save"));
}

struct WakeCounter(std::sync::atomic::AtomicUsize);
impl std::task::Wake for WakeCounter {
    fn wake(self: Arc<Self>) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

#[tokio::test]
async fn media_host_passes_only_compiled_byte_pinned_approval() {
    let dir = tempfile::tempdir().unwrap();
    let mut database = db::Database::open(dir.path().join("rights.sqlite3")).unwrap();
    let source = rights::bundled("nasa-technology").unwrap();
    let approval = &source["rightsPolicy"]["mediaAllowlist"][0];
    let xml = format!(
        r#"<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>NASA synthetic parser test</title><link>https://www.nasa.gov</link><description>Test</description><item><title>NASA synthetic media item</title><guid isPermaLink="false">{}</guid><link>{}</link><description>Supplied test excerpt</description><media:content url="{}" type="video/mp4"/></item></channel></rss>"#,
        approval["itemGuid"].as_str().unwrap(),
        approval["itemUrl"].as_str().unwrap(),
        approval["url"].as_str().unwrap()
    );
    let feed = services::parse_feed(xml.as_bytes(), source).unwrap();
    database
        .ingest("nasa-technology", &feed, chrono::Utc::now().timestamp())
        .unwrap();
    let article = database
        .request(&json!({"op":"snapshot"}), chrono::Utc::now().timestamp())
        .unwrap()["articles"][0]
        .clone();
    let host = Backend::new(database);
    let request = json!({"op":"media_load","profileId":"default","replacementToken":host.database().unwrap().media_preferences("default").unwrap()["replacementToken"],"articleId":article["id"],"index":0,"url":"https://forged.invalid/asset.mp4","approval":{"sha256":"forged","bytes":1}});
    let result = host
        .media_load_using(&request, |item, trusted| {
            assert_eq!(item, article["media"][0]);
            assert_eq!(trusted.as_ref(), Some(approval));
            assert_eq!(
                trusted.as_ref().unwrap()["sha256"].as_str().unwrap().len(),
                64
            );
            assert!(trusted.as_ref().unwrap()["bytes"].as_u64().unwrap() > 0);
            assert!(host.database.try_lock().is_ok());
            std::future::ready(Ok(json!({"bytes":123})))
        })
        .await
        .unwrap();
    assert_eq!(result["bytes"], 123);
    assert!(result.get("approval").is_none());
}

#[tokio::test]
async fn media_imported_custom_receipt_is_checked_before_loader() {
    let (host, mut request, _) = media_host();
    let backup = host.database().unwrap().export().unwrap();
    host.execute(json!({"op":"import","data":backup}))
        .await
        .unwrap();
    request["replacementToken"] = host
        .database()
        .unwrap()
        .media_preferences("default")
        .unwrap()["replacementToken"]
        .clone();
    let started = AtomicBool::new(false);
    let result = host
        .media_load_using(&request, |_, _| async {
            started.store(true, Ordering::SeqCst);
            Ok(Value::Null)
        })
        .await;
    assert!(
        !started.load(Ordering::SeqCst),
        "unattested imported media reached loader"
    );
    assert!(result.unwrap_err().contains("after import"));
    assert_eq!(host.media_permits.available_permits(), 2);
}

#[tokio::test]
async fn media_refreshed_same_id_stops_next_poll_and_final_delivery() {
    for at_delivery in [false, true] {
        let (host, request, sid) = media_host();
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let (send, wait) = tokio::sync::oneshot::channel();
        let change = || {
            host.database().unwrap().ingest(&sid, &json!({"articles":[{"title":"Changed rights input","url":"https://example.org/story","excerpt":"Changed body","media":[{"kind":"image","url":"https://example.org/trusted.png","mimeType":"image/png","playback":"inline"}]}]}), chrono::Utc::now().timestamp()).unwrap();
        };
        let mut job = Box::pin(host.media_load_using(&request, |_, _| async {
            calls.fetch_add(1, Ordering::SeqCst);
            wait.await.unwrap();
            calls.fetch_add(1, Ordering::SeqCst);
            if at_delivery {
                change();
            }
            Ok(json!({"dataUrl":"data:image/png;base64,stale"}))
        }));
        assert!(futures_util::poll!(&mut job).is_pending());
        if !at_delivery {
            change();
        }
        send.send(()).unwrap();
        let result = job.await;
        assert!(
            result.is_err(),
            "changed same-ID article delivered stale bytes (final={at_delivery})"
        );
        assert!(result.unwrap_err().contains("changed"));
        assert_eq!(
            calls.load(Ordering::SeqCst),
            if at_delivery { 2 } else { 1 }
        );
        assert!(host.source_policy.lock().unwrap().media_jobs.is_empty());
        assert_eq!(host.media_permits.available_permits(), 2);
    }
}

#[tokio::test]
async fn media_revoked_before_first_poll_never_starts_loader() {
    let (host, request, source_id) = media_host();
    let article = host
        .database()
        .unwrap()
        .article("default", request["articleId"].as_str().unwrap())
        .unwrap();
    let registration = {
        let mut policy = host.source_policy.lock().unwrap();
        let id = "pre-poll".to_owned();
        let registration = MediaRegistration {
            policy: &host.source_policy,
            id: id.clone(),
            source_id: source_id.clone(),
            generation: policy.generation(&source_id),
            import_generation: policy.import_generation,
            request: request.clone(),
            item: article["media"][0].clone(),
            article,
        };
        policy.media_jobs.insert(
            id,
            MediaJob {
                source_id: source_id.clone(),
                waker: None,
            },
        );
        registration
    };
    host.execute(json!({"op":"source_update","sourceId":source_id,"mediaAllowed":false}))
        .await
        .unwrap();
    let started = AtomicBool::new(false);
    let result = host
        .run_media(&registration, async {
            started.store(true, Ordering::SeqCst);
            Ok(Value::Null)
        })
        .await;
    assert!(result.unwrap_err().contains("cancelled"));
    assert!(!started.load(Ordering::SeqCst));
    drop(registration);
    assert!(host.source_policy.lock().unwrap().media_jobs.is_empty());
}

#[tokio::test]
async fn media_revocation_stops_subsequent_polls_and_stale_delivery() {
    media_policy_change(false).await;
}
#[tokio::test]
async fn media_import_stops_subsequent_polls_and_stale_delivery() {
    media_policy_change(true).await;
}
async fn media_policy_change(import: bool) {
    let (host, request, sid) = media_host();
    let backup = db::Database::memory().unwrap().export().unwrap();
    let attempts = std::sync::atomic::AtomicUsize::new(0);
    let (release, wait) = tokio::sync::oneshot::channel::<()>();
    let mut running = Box::pin(host.media_load_using(&request, |_, _| async {
        assert!(
            host.source_policy.try_lock().is_err(),
            "loader must be polled under the mutation gate"
        );
        assert!(
            host.database.try_lock().is_ok(),
            "SQLite mutex retained while polling network"
        );
        attempts.fetch_add(1, Ordering::SeqCst); // e.g. DNS begins
        wait.await.unwrap();
        attempts.fetch_add(1, Ordering::SeqCst); // connection must not begin after revoke
        Ok(json!({"dataUrl":"data:image/png;base64,stale"}))
    }));
    let wakes = Arc::new(WakeCounter(std::sync::atomic::AtomicUsize::new(0)));
    let waker = std::task::Waker::from(wakes.clone());
    assert!(running
        .as_mut()
        .poll(&mut std::task::Context::from_waker(&waker))
        .is_pending());
    if import {
        host.execute(json!({"op":"import","data":backup}))
            .await
            .unwrap();
    } else {
        host.execute(json!({"op":"source_update","sourceId":sid,"mediaAllowed":false}))
            .await
            .unwrap();
        assert!(host
            .database()
            .unwrap()
            .article("default", request["articleId"].as_str().unwrap())
            .unwrap()
            .get("media")
            .is_none());
    }
    assert!(
        wakes.0.load(Ordering::SeqCst) > 0,
        "revocation must wake a stalled download"
    );
    release.send(()).unwrap();
    let result = running.await;
    assert_eq!(
        attempts.load(Ordering::SeqCst),
        1,
        "loader polled after policy changed"
    );
    assert!(result.unwrap_err().contains("cancelled"));
    assert_eq!(host.media_permits.available_permits(), 2);
    assert!(host.source_policy.lock().unwrap().media_jobs.is_empty());
}

#[tokio::test]
async fn media_consent_withdrawal_and_compact_cancel_pending_host_transfer() {
    for (automatic, mode) in [(false, "visual"), (true, "compact")] {
        let (host, mut request, _) = media_host();
        request["automatic"] = json!(true);
        let token = request["replacementToken"].clone();
        host.execute(json!({"op":"media_preferences_set","replacementToken":token,"automatic":true,"mode":"visual"})).await.unwrap();
        let mut job = Box::pin(host.media_load_using(&request, |_, _| std::future::pending()));
        assert!(futures_util::poll!(job.as_mut()).is_pending());
        host.execute(json!({"op":"media_preferences_set","replacementToken":token,"automatic":automatic,"mode":mode})).await.unwrap();
        assert!(job.await.unwrap_err().contains("cancelled"));
        assert_eq!(host.media_permits.available_permits(), 2);
        assert!(host
            .media_load_using(&request, |_, _| async { Ok(Value::Null) })
            .await
            .is_err());
        request["automatic"] = json!(false);
        assert!(
            host.media_load_using(&request, |_, _| async { Ok(Value::Null) })
                .await
                .is_ok(),
            "manual click remains available"
        );
    }
}

#[tokio::test]
async fn media_cancel_before_registration_never_starts_network() {
    let (host, mut request, _) = media_host();
    request["requestId"] = json!("early-cancel");
    host.execute(json!({"op":"media_cancel","requestId":"early-cancel"}))
        .await
        .unwrap();
    let result = host
        .media_load_using(&request, |_, _| async { Ok(Value::Null) })
        .await;
    assert!(
        result.is_err(),
        "an IPC cancellation can overtake load registration"
    );
}

#[tokio::test]
async fn media_automatic_requires_consent_and_viewport_cancel_drops_transfer() {
    let (host, mut request, _) = media_host();
    request["automatic"] = json!(true);
    request["requestId"] = json!("viewport-job");
    request["replacementToken"] = host
        .database()
        .unwrap()
        .media_preferences("default")
        .unwrap()["replacementToken"]
        .clone();
    request["profileId"] = json!("default");
    let denied = host
        .media_load_using(&request, |_, _| async { Ok(Value::Null) })
        .await;
    assert!(denied.is_err(), "automatic loading must require consent");
    host.execute(json!({"op":"media_preferences_set","replacementToken":request["replacementToken"],"automatic":true,"mode":"visual"})).await.unwrap();
    let mut job = Box::pin(host.media_load_using(&request, |_, _| std::future::pending()));
    assert!(futures_util::poll!(job.as_mut()).is_pending());
    host.execute(json!({"op":"media_cancel","requestId":"viewport-job"}))
        .await
        .unwrap();
    assert!(job.await.unwrap_err().contains("cancelled"));
    assert_eq!(host.media_permits.available_permits(), 2);
}

fn media_host() -> (Backend, Value, String) {
    let mut database = db::Database::memory().unwrap();
    let source = database.request(&json!({"op":"source_add","name":"Media","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt","mediaAllowed":true,"aiAllowed":true}),1000).unwrap();
    let sid = source["id"].as_str().unwrap().to_owned();
    database.ingest(&sid, &json!({"articles":[{"title":"Media story","url":"https://example.org/story","excerpt":"Body","media":[{"kind":"image","url":"https://example.org/trusted.png","mimeType":"image/png","playback":"inline"}]}]}), chrono::Utc::now().timestamp()).unwrap();
    let snapshot = database
        .request(&json!({"op":"snapshot"}), chrono::Utc::now().timestamp())
        .unwrap();
    let request = json!({"op":"media_load","profileId":"default","replacementToken":snapshot["replacementToken"],"articleId":snapshot["articles"][0]["id"],"index":0,"url":"https://untrusted.invalid/ignored"});
    (Backend::new(database), request, sid)
}

#[tokio::test]
async fn media_host_permits_bound_transfers_and_release_on_drop_error_success() {
    let (host, request, _) = media_host();
    let attempts = std::sync::atomic::AtomicUsize::new(0);
    let load = |item: Value, approval: Option<Value>| {
        assert!(approval.is_none());
        assert_eq!(item["url"], "https://example.org/trusted.png");
        attempts.fetch_add(1, Ordering::SeqCst);
        std::future::pending::<Result<Value, String>>()
    };
    let mut first = Box::pin(host.media_load_using(&request, load));
    let mut second = Box::pin(host.media_load_using(&request, load));
    assert!(futures_util::poll!(&mut first).is_pending());
    assert!(futures_util::poll!(&mut second).is_pending());
    let mut third = Box::pin(host.media_load_using(&request, load));
    assert!(
        matches!(futures_util::poll!(&mut third), std::task::Poll::Ready(Err(ref e)) if e.contains("Too many media")),
        "third transfer must be rejected before the loader starts"
    );
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
    drop(first);
    // The second blocked transfer still owns one permit.
    for _ in 0..3 {
        let error = host
            .media_load_using(&request, |_, _| async { Err("fixture failure".into()) })
            .await
            .unwrap_err();
        assert_eq!(error, "fixture failure");
        assert_eq!(
            host.media_load_using(&request, |_, _| async { Ok(json!({"bytes":1})) })
                .await
                .unwrap()["bytes"],
            1
        );
    }
    drop(second);
    let mut next = Box::pin(host.media_load_using(&request, load));
    assert!(futures_util::poll!(&mut next).is_pending());
    drop(next);
    assert!(host.source_policy.lock().unwrap().media_jobs.is_empty());
    assert_eq!(host.media_permits.available_permits(), 2);
}

#[tokio::test]
async fn delayed_local_ai_connect_cannot_overwrite_newer_consent() {
    delayed_local_ai_connection(false).await;
}
#[tokio::test]
async fn delayed_local_ai_connect_cannot_overwrite_import() {
    delayed_local_ai_connection(true).await;
}
async fn delayed_local_ai_connection(import: bool) {
    let host = Backend::new(db::Database::memory().unwrap());
    let backup = host.database().unwrap().export().unwrap();
    let (release, wait) = tokio::sync::oneshot::channel::<()>();
    let mut connect = Box::pin(host.local_ai_connect_using(async {
        wait.await.unwrap();
        Ok(json!({"models":[{"name":"qwen3:4b-instruct-2507-q4_K_M"}]}))
    }));
    assert!(futures_util::poll!(&mut connect).is_pending());
    if import {
        host.execute(json!({"op":"import","data":backup}))
            .await
            .unwrap();
    } else {
        host.execute(json!({"op":"provider_save","provider":{"id":"ollama","kind":"ollama","name":"New choice","model":"other-model","enabled":false,"consented":false}})).await.unwrap();
    }
    release.send(()).unwrap();
    let result = connect.await;
    let provider = host
        .database()
        .unwrap()
        .list("provider", "")
        .unwrap()
        .into_iter()
        .find(|p| p["id"] == "ollama")
        .unwrap();
    assert_eq!(
        provider["consented"], false,
        "delayed tags reversed consent (import={import})"
    );
    assert_eq!(provider["enabled"], false);
    if !import {
        assert_eq!(provider["model"], "other-model");
    }
    assert!(result.unwrap_err().contains("changed"));
}

#[tokio::test]
async fn disabled_queued_refresh_never_starts_or_ingests() {
    let mut database = db::Database::memory().unwrap();
    // Keep this independent of the bundled catalog's enabled defaults.
    for source in database.list("source", "").unwrap() {
        database
            .request(
                &json!({"op":"source_update","sourceId":source["id"],"enabled":false}),
                1000,
            )
            .unwrap();
    }
    for i in 0..6 {
        database.request(&json!({"op":"source_add","name":format!("Source {i}"),"url":format!("https://example.org/{i}/feed"),"termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt"}),1000).unwrap();
    }
    let sources = database
        .due_sources(chrono::Utc::now().timestamp(), true)
        .unwrap();
    assert_eq!(sources.len(), 6);
    let queued = sources[4]["id"].as_str().unwrap().to_owned();
    let inflight = sources[0]["id"].as_str().unwrap().to_owned();
    let host = Backend::new(database);
    let started = Mutex::new(Vec::new());
    let release = tokio::sync::Notify::new();
    let mut refresh = Box::pin(host.refresh_using(true, |source| {
        let started = &started;
        let release = &release;
        async move {
            started.lock().unwrap().push(source["id"].as_str().unwrap().to_owned());
            // Only the original four block; queued jobs finish immediately.
            if started.lock().unwrap().len() <= 4 { release.notified().await; }
            Ok(json!({"articles":[{"title":"Refresh story","url":format!("https://example.org/{}", source["id"].as_str().unwrap()),"excerpt":"Body"}]}))
        }
    }));
    assert!(futures_util::poll!(&mut refresh).is_pending());
    assert_eq!(started.lock().unwrap().len(), 4);
    for sid in [&queued, &inflight] {
        host.execute(json!({"op":"source_update","sourceId":sid,"enabled":false}))
            .await
            .unwrap();
    }
    // Re-enable an inflight source: a pre-disable result must still be stale.
    host.execute(json!({"op":"source_update","sourceId":inflight,"enabled":true}))
        .await
        .unwrap();
    release.notify_waiters();
    let result = refresh.await.unwrap();
    assert!(
        !started.lock().unwrap().contains(&queued),
        "disabled queued transfer was polled"
    );
    assert_eq!(
        result["updated"], 4,
        "disabled or pre-disable work was committed"
    );
    assert_eq!(result["failed"], 0, "policy skips are not network failures");
    let snapshot = host
        .database()
        .unwrap()
        .request(&json!({"op":"snapshot"}), chrono::Utc::now().timestamp())
        .unwrap();
    assert!(snapshot["articles"]
        .as_array()
        .unwrap()
        .iter()
        .all(|a| a["sourceId"] != queued && a["sourceId"] != inflight));
}

#[tokio::test]
async fn import_rejects_inflight_refresh_and_preserves_source_attribution() {
    let mut database = db::Database::memory().unwrap();
    let source = database.request(&json!({"op":"source_add","name":"Original","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt"}),1000).unwrap();
    let mut backup: Value = serde_json::from_str(&database.export().unwrap()).unwrap();
    backup["documents"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|d| d["kind"] == "source")
        .unwrap()["data"]["name"] = json!("Imported replacement");
    let host = Backend::new(database);
    let release = Arc::new(tokio::sync::Notify::new());
    let mut refresh = Box::pin(host.refresh_using(true, |_| {
        let release = release.clone();
        async move {
            release.notified().await;
            Ok(json!({"articles":[{"title":"Original source story","url":"https://example.org/a","excerpt":"Original content"}]}))
        }
    }));
    assert!(futures_util::poll!(&mut refresh).is_pending());
    let error = host
        .execute(json!({"op":"import","data":backup.to_string()}))
        .await;
    assert!(
        error.is_err(),
        "inflight old feed must not be attributed to imported source"
    );
    assert!(error.unwrap_err().contains("refresh"));
    release.notify_one();
    assert_eq!(refresh.await.unwrap()["updated"], 1);
    let snapshot = host
        .database()
        .unwrap()
        .request(&json!({"op":"snapshot"}), chrono::Utc::now().timestamp())
        .unwrap();
    assert_eq!(snapshot["articles"][0]["sourceName"], "Original");
    assert_eq!(snapshot["articles"][0]["sourceId"], source["id"]);
    host.execute(json!({"op":"import","data":backup.to_string()}))
        .await
        .unwrap();
    assert_eq!(
        host.database().unwrap().list("source", "").unwrap()[0]["name"],
        "Imported replacement"
    );
    assert!(host
        .execute(json!({"op":"import","data":"invalid"}))
        .await
        .is_err());
    // Invalid imports must release the same registration guard too.
    assert!(!host.refreshing.load(Ordering::Acquire));
}

#[tokio::test]
async fn revoked_summary_is_never_polled_for_a_fallback_request() {
    let (host, request, _) = media_host();
    let article = host
        .database()
        .unwrap()
        .article("default", request["articleId"].as_str().unwrap())
        .unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    host.cancellations
        .lock()
        .unwrap()
        .insert("active".into(), cancel.clone());
    let attempts = std::sync::atomic::AtomicUsize::new(0);
    let (release, wait) = tokio::sync::oneshot::channel::<()>();
    let job = async {
        attempts.fetch_add(1, Ordering::SeqCst); // first provider network attempt
        wait.await.unwrap();
        attempts.fetch_add(1, Ordering::SeqCst); // fallback must never be polled
        Ok(json!({"text":"stale"}))
    };
    let mut running = Box::pin(host.run_summary(&cancel, &article, job));
    assert!(futures_util::poll!(&mut running).is_pending());
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
    host.execute(json!({"op":"provider_save","provider":{"id":"groq","kind":"groq","name":"Groq","model":"test","enabled":false,"consented":false}})).await.unwrap();
    release.send(()).unwrap();
    let result = running.await;
    assert_eq!(
        attempts.load(Ordering::SeqCst),
        1,
        "fallback sent after consent revocation"
    );
    assert!(result.unwrap_err().contains("cancelled"));
}

#[tokio::test]
async fn summary_refreshed_same_id_stops_fallback_and_final_delivery() {
    for at_delivery in [false, true] {
        let (host, request, sid) = media_host();
        let article = host
            .database()
            .unwrap()
            .article("default", request["articleId"].as_str().unwrap())
            .unwrap();
        let cancel = AtomicBool::new(false);
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let (send, wait) = tokio::sync::oneshot::channel();
        let change = || {
            host.database().unwrap().ingest(&sid, &json!({"articles":[{"title":"Changed AI input","url":"https://example.org/story","excerpt":"Changed body"}]}), chrono::Utc::now().timestamp()).unwrap();
        };
        let mut job = Box::pin(host.run_summary(&cancel, &article, async {
            assert!(host.cancellations.try_lock().is_err());
            assert!(
                host.database.try_lock().is_ok(),
                "SQLite held while polling provider"
            );
            calls.fetch_add(1, Ordering::SeqCst);
            wait.await.unwrap();
            calls.fetch_add(1, Ordering::SeqCst);
            if at_delivery {
                change();
            }
            Ok(json!({"text":"stale summary"}))
        }));
        assert!(futures_util::poll!(&mut job).is_pending());
        if !at_delivery {
            change();
        }
        send.send(()).unwrap();
        let result = job.await;
        assert!(
            result.is_err(),
            "changed same-ID input allowed fallback/delivery (final={at_delivery})"
        );
        assert!(result.unwrap_err().contains("changed"));
        assert_eq!(
            calls.load(Ordering::SeqCst),
            if at_delivery { 2 } else { 1 }
        );
    }
}

#[tokio::test]
async fn source_disable_cancels_registered_summaries_even_after_reenable() {
    let (host, _, sid) = media_host();
    let cancel = Arc::new(AtomicBool::new(false));
    host.cancellations
        .lock()
        .unwrap()
        .insert("source-revoke".into(), cancel.clone());
    host.execute(json!({"op":"source_update","sourceId":sid,"enabled":false}))
        .await
        .unwrap();
    host.execute(json!({"op":"source_update","sourceId":sid,"enabled":true}))
        .await
        .unwrap();
    assert!(
        cancel.load(Ordering::Acquire),
        "source disable left an active summary authorized"
    );
}

#[tokio::test]
async fn provider_save_cancels_every_registered_summary_before_mutation() {
    let host = Backend::new(db::Database::memory().unwrap());
    let first = Arc::new(AtomicBool::new(false));
    let second = Arc::new(AtomicBool::new(false));
    host.cancellations
        .lock()
        .unwrap()
        .insert("first".into(), first.clone());
    host.cancellations
        .lock()
        .unwrap()
        .insert("second".into(), second.clone());
    host.execute(json!({"op":"provider_save","provider":{"id":"groq","kind":"groq","name":"Groq","model":"test","enabled":false,"consented":false}})).await.unwrap();
    assert!(
        first.load(Ordering::Acquire),
        "first summary retains stale consent"
    );
    assert!(
        second.load(Ordering::Acquire),
        "all summaries must be cancelled"
    );
}

#[tokio::test]
async fn import_cancels_registered_summaries() {
    let host = Backend::new(db::Database::memory().unwrap());
    let backup = host.database().unwrap().export().unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    host.cancellations
        .lock()
        .unwrap()
        .insert("active".into(), cancel.clone());
    host.execute(json!({"op":"import","data":backup}))
        .await
        .unwrap();
    assert!(
        cancel.load(Ordering::Acquire),
        "import retained stale provider/source snapshot"
    );
}
