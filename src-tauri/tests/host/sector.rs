use super::*;

fn sector_host() -> (Backend, Value, String) {
    let mut db = db::Database::memory().unwrap();
    let now = chrono::Utc::now().timestamp();
    let source = db.request(&json!({"op":"source_add","name":"Synthetic test","url":"https://example.org/sector-feed","termsUrl":"https://example.org/terms","topics":["science"],"language":"en","region":"world","kind":"reporting","storage":"excerpt","aiAllowed":true}),now).unwrap();
    db.ingest(source["id"].as_str().unwrap(), &json!({"articles":[
        {"title":"Library opens","url":"https://example.org/library","excerpt":"Synthetic library story.","publishedAt":now-10},
        {"title":"Observatory adds telescope","url":"https://example.org/observatory","excerpt":"Synthetic observatory story.","publishedAt":now-20}
    ]}),now).unwrap();
    let host = Backend::new(db);
    let mut request = json!({"profileId":"default","date":chrono::Local::now().format("%Y-%m-%d").to_string(),"sectorId":"science","requestId":"sector-unit"});
    let selection = sector_summary::select(&mut host.database().unwrap(), &request, now).unwrap();
    request["fingerprint"] = selection.preview["fingerprint"].clone();
    (host, request, source["id"].as_str().unwrap().into())
}

#[tokio::test]
async fn sector_input_changes_stop_next_poll_and_final_delivery() {
    for mutation in [
        "content",
        "hidden",
        "preferences",
        "provider",
        "source",
        "import",
    ] {
        for final_poll in [false, true] {
            let (host, request, sid) = sector_host();
            let change = || {
                let mut db = host.database().unwrap();
                let now = chrono::Utc::now().timestamp();
                match mutation {
                    "content" => {
                        db.ingest(&sid, &json!({"articles":[{"title":"Changed library","url":"https://example.org/library","excerpt":"Changed body","publishedAt":now-10}]}), now).unwrap();
                    }
                    "hidden" => {
                        let token = db
                            .request(&json!({"op":"workspace_get","profileId":"default"}), now)
                            .unwrap()["replacementToken"]
                            .clone();
                        let aid = db.request(&json!({"op":"snapshot"}), now).unwrap()["articles"]
                            [0]["id"]
                            .clone();
                        db.request(
                            &json!({"op":"article_state","articleId":aid,"hidden":true,"replacementToken":token}),
                            now,
                        )
                        .unwrap();
                    }
                    "preferences" => {
                        db.request(&json!({"op":"profile_update","preferences":{"excludeKeywords":["library"]}}), now).unwrap();
                    }
                    "provider" => {
                        db.request(&json!({"op":"provider_save","provider":{"id":"ollama","kind":"ollama","name":"Changed","model":"changed","enabled":true,"consented":true}}), now).unwrap();
                    }
                    "source" => {
                        db.request(
                            &json!({"op":"source_update","sourceId":sid,"enabled":false}),
                            now,
                        )
                        .unwrap();
                    }
                    "import" => {
                        let backup = db.export().unwrap();
                        db.import(&backup).unwrap();
                    }
                    _ => unreachable!(),
                }
            };
            let polls = std::sync::atomic::AtomicUsize::new(0);
            let (send, wait) = tokio::sync::oneshot::channel();
            let mut job = Box::pin(host.sector_summarize_using(&request, |_, _| async {
                polls.fetch_add(1, Ordering::SeqCst);
                wait.await.unwrap();
                polls.fetch_add(1, Ordering::SeqCst);
                if final_poll {
                    change();
                }
                Ok(provider_result())
            }));
            assert!(futures_util::poll!(&mut job).is_pending());
            if !final_poll {
                change();
            }
            send.send(()).unwrap();
            assert!(
                job.await.is_err(),
                "delivered after {mutation}, final={final_poll}"
            );
            assert_eq!(
                polls.load(Ordering::SeqCst),
                if final_poll { 2 } else { 1 },
                "polled stale {mutation}"
            );
            assert!(host.cancellations.lock().unwrap().is_empty());
        }
    }
}

#[tokio::test]
async fn sector_dropped_jobs_release_registration_and_cancel_provider() {
    let (host, request, _) = sector_host();
    let observed = std::sync::Mutex::new(None);
    let mut job = Box::pin(host.sector_summarize_using(&request, |_, cancel| async {
        *observed.lock().unwrap() = Some(cancel);
        std::future::pending::<Result<Value, String>>().await
    }));
    assert!(futures_util::poll!(&mut job).is_pending());
    assert_eq!(host.cancellations.lock().unwrap().len(), 1);
    drop(job);
    assert!(
        host.cancellations.lock().unwrap().is_empty(),
        "dropped job leaked capacity"
    );
    assert!(observed
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .load(Ordering::Acquire));
}

#[tokio::test]
async fn sector_membership_change_then_restore_still_cancels_inflight_work() {
    let (host, request, _) = sector_host();
    let snapshot = host.execute(json!({"op":"snapshot"})).await.unwrap();
    let token = &snapshot["replacementToken"];
    let aid = snapshot["articles"][0]["id"].clone();
    let (send, wait) = tokio::sync::oneshot::channel();
    let mut job = Box::pin(host.sector_summarize_using(&request, |_, _| async {
        wait.await.unwrap();
        Ok(provider_result())
    }));
    assert!(futures_util::poll!(&mut job).is_pending());
    for hidden in [true, false] {
        host.execute(
            json!({"op":"article_state","articleId":aid,"hidden":hidden,"replacementToken":token}),
        )
        .await
        .unwrap();
    }
    send.send(()).unwrap();
    assert!(job.await.unwrap_err().contains("cancelled"));
    assert!(host.cancellations.lock().unwrap().is_empty());
}

#[test]
fn sector_read_operations_never_emit_data_changed_and_invalidate_their_own_ui() {
    assert!(!changed("sector_summary_preview"));
    assert!(!changed("sector_summarize"));
}

#[tokio::test]
async fn sector_cancel_stops_pending_provider_and_releases_capacity() {
    let (host, request, _) = sector_host();
    let mut job = Box::pin(host.sector_summarize_using(&request, |_, _| async {
        assert!(host.cancellations.try_lock().is_err());
        assert!(host.source_policy.try_lock().is_err());
        assert!(host.database.try_lock().is_ok());
        std::future::pending::<Result<Value, String>>().await
    }));
    assert!(futures_util::poll!(&mut job).is_pending());
    let duplicate = host
        .sector_summarize_using(&request, |_, _| async { panic!("duplicate started IO") })
        .await;
    assert!(duplicate.unwrap_err().contains("duplicate"));
    host.execute(json!({"op":"summary_cancel","requestId":request["requestId"]}))
        .await
        .unwrap();
    let result = tokio::time::timeout(Duration::from_secs(1), job)
        .await
        .unwrap();
    assert!(result.unwrap_err().contains("cancelled"));
    assert!(host.cancellations.lock().unwrap().is_empty());
}

#[tokio::test]
async fn sector_changed_then_restored_feed_content_cannot_reuse_inflight_preview() {
    let (host, request, sid) = sector_host();
    let now = chrono::Utc::now().timestamp();
    let original = host
        .database()
        .unwrap()
        .request(&json!({"op":"snapshot"}), now)
        .unwrap()["articles"][0]
        .clone();
    let (send, wait) = tokio::sync::oneshot::channel();
    let mut job = Box::pin(host.sector_summarize_using(&request, |_, _| async {
        wait.await.unwrap();
        Ok(provider_result())
    }));
    assert!(futures_util::poll!(&mut job).is_pending());
    let mut replacement = original.clone();
    replacement["excerpt"] = json!("Transient changed input");
    for article in [replacement, original] {
        host.database()
            .unwrap()
            .ingest(&sid, &json!({"articles":[article]}), now)
            .unwrap();
    }
    send.send(()).unwrap();
    assert!(job.await.unwrap_err().contains("changed"));
}

#[tokio::test]
async fn sector_read_and_save_state_changes_do_not_cancel_unchanged_inputs() {
    let (host, request, _) = sector_host();
    let snapshot = host.execute(json!({"op":"snapshot"})).await.unwrap();
    let token = &snapshot["replacementToken"];
    let aid = snapshot["articles"][0]["id"].clone();
    let (send, wait) = tokio::sync::oneshot::channel();
    let mut job = Box::pin(host.sector_summarize_using(&request, |_, _| async {
        wait.await.unwrap();
        Ok(provider_result())
    }));
    assert!(futures_util::poll!(&mut job).is_pending());
    host.execute(json!({"op":"article_state","articleId":aid,"read":true,"saved":true,"replacementToken":token}))
        .await
        .unwrap();
    send.send(()).unwrap();
    assert!(
        job.await.is_ok(),
        "ordinary reading changed no sector input"
    );
}

fn provider_result() -> Value {
    json!({"text":r#"{"bullets":[{"text":"Synthetic library story.","citations":["S1"],"evidence":[{"sourceId":"S1","quote":"Synthetic library story."}]}]}"#,"provider":"ollama","model":"fixture","generatedAt":1})
}

#[tokio::test]
async fn sector_synthesis_returns_validated_bullets_and_host_owned_sources() {
    let (host, request, _) = sector_host();
    let backup_before = host.database().unwrap().export().unwrap();
    let result = host
        .sector_summarize_using(&request, |selection, _| async move {
            assert_eq!(selection.articles.len(), 2);
            assert_eq!(selection.preview["sources"][0]["id"], "S1");
            Ok(provider_result())
        })
        .await
        .unwrap();
    assert_eq!(result["bullets"][0]["citations"], json!(["S1"]));
    assert_eq!(
        result["bullets"][0]["evidence"],
        json!([{"sourceId":"S1","quote":"Synthetic library story."}])
    );
    assert_eq!(result["sources"][0]["url"], "https://example.org/library");
    assert_eq!(result["fingerprint"], request["fingerprint"]);
    assert_eq!(result["profileId"], "default");
    assert!(result["warning"].as_str().unwrap().contains("unverified"));
    assert!(result.get("text").is_none());
    assert_eq!(host.database().unwrap().export().unwrap(), backup_before);
    assert!(host.cancellations.lock().unwrap().is_empty());
}
