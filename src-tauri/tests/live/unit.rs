use super::*;
use serde_json::json;

#[tokio::test]
async fn shared_worker_disable_cancels_idle_and_rapid_toggles_never_overlap() {
    let desk = Arc::new(LiveDesk::new());
    let active = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let maximum = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    struct Active(Arc<std::sync::atomic::AtomicUsize>);
    impl Drop for Active {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }
    let start = || {
        let active = active.clone();
        let maximum = maximum.clone();
        desk.start(true, move |_, _| async move {
            let count = active.fetch_add(1, Ordering::SeqCst) + 1;
            maximum.fetch_max(count, Ordering::SeqCst);
            let _guard = Active(active);
            std::future::pending::<()>().await;
        })
    };
    assert_eq!(start()["state"], "connecting");
    tokio::task::yield_now().await;
    assert_eq!(active.load(Ordering::SeqCst), 1);
    // Idempotent enables from another window must not create a second worker.
    start();
    for _ in 0..20 {
        desk.start(false, |_, _| async {});
        start();
        tokio::task::yield_now().await;
    }
    let stale = desk.generation.load(Ordering::Acquire);
    desk.start(false, |_, _| async {});
    desk.update(stale, |s| s["state"] = json!("connected"));
    tokio::time::timeout(std::time::Duration::from_millis(300), async {
        while active.load(Ordering::SeqCst) != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(maximum.load(Ordering::SeqCst), 1);
    assert_eq!(desk.status()["state"], "off");
}

#[test]
fn metadata_projects_only_story_fields_and_removes_deleted_items() {
    let raw = json!({"id":10,"type":"story","title":"A story", "by":"someone", "time":1700000000,
        "url":"https://example.com/story", "score":3, "text":"DO NOT STORE", "kids":[99]});
    let item = story_metadata(10, &raw).unwrap();
    assert_eq!(
        item["discussionUrl"],
        "https://news.ycombinator.com/item?id=10"
    );
    assert_eq!(item["contentKind"], "discussion");
    assert_eq!(item["aiAllowed"], false);
    assert!(item.get("text").is_none());
    assert!(item.get("kids").is_none());
    assert!(chrono::DateTime::parse_from_rfc3339(item["publishedAt"].as_str().unwrap()).is_ok());
    for bad in [
        json!(null),
        json!({"id":10,"type":"comment"}),
        json!({"id":10,"deleted":true}),
        json!({"id":10,"dead":true}),
        json!({"id":11,"type":"story"}),
    ] {
        assert!(story_metadata(10, &bad).is_none());
    }
    let mut state = off_snapshot();
    apply_item(&mut state, 10, Some(item));
    assert_eq!(state["items"].as_array().unwrap().len(), 1);
    apply_item(&mut state, 10, None);
    assert!(state["items"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn reconnect_backs_off_then_retries_and_auth_failure_stops() {
    let desk = Arc::new(LiveDesk::new());
    let attempts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = attempts.clone();
    desk.start(true, move |desk, generation| async move {
        desk.reconnect(generation, || {
            let n = count.fetch_add(1, Ordering::SeqCst);
            async move {
                if n == 0 {
                    Err(Failure::retry("test disconnect"))
                } else {
                    Err(Failure::Stop("Access revoked".into()))
                }
            }
        })
        .await;
    });
    tokio::task::yield_now().await;
    assert_eq!(desk.status()["state"], "backoff");
    assert!(desk.status()["retryAt"].as_str().is_some());
    tokio::time::timeout(Duration::from_secs(2), async {
        while desk.status()["enabled"] == true {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
    assert_eq!(desk.status()["state"], "off");
    assert_eq!(desk.status()["message"], "Access revoked");
}

#[test]
fn retry_backoff_has_jitter_cap_and_retry_after_floor() {
    assert_ne!(retry_delay(0, 0, None), retry_delay(0, 321, None));
    for attempt in 0..100 {
        for seed in [0, 1, 123, u64::MAX] {
            let delay = retry_delay(attempt, seed, None);
            assert!(delay >= Duration::from_millis(500));
            assert!(delay <= Duration::from_secs(60));
        }
    }
    assert_eq!(
        retry_delay(0, 0, Some(Duration::from_secs(120))),
        Duration::from_secs(120)
    );
}

#[tokio::test]
async fn stream_hydrates_initial_snapshot_and_later_ids_with_four_request_cap() {
    use futures_util::{stream, StreamExt};
    let desk = Arc::new(LiveDesk::new());
    let fetched = Arc::new(Mutex::new(Vec::new()));
    let active = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let maximum = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let results = fetched.clone();
    let max = maximum.clone();
    desk.start(true, move |desk, generation| async move {
        let snapshot = format!("event: put\ndata: {}\n\n", json!({"path":"/", "data":(1..=30).collect::<Vec<_>>()}));
        let change = "event: patch\ndata: {\"path\":\"/\",\"data\":{\"0\":100}}\n\n";
        let stream = stream::iter(vec![Ok(snapshot.into_bytes()), Ok(change.as_bytes().to_vec())])
            .chain(stream::pending());
        let _ = desk.consume_stream(generation, stream, move |id| {
            let results = results.clone(); let active = active.clone(); let max = max.clone();
            async move {
                let n = active.fetch_add(1,Ordering::SeqCst)+1;
                max.fetch_max(n,Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(5)).await;
                results.lock().unwrap().push(id);
                active.fetch_sub(1,Ordering::SeqCst);
                Ok(story_metadata(id,&json!({"id":id,"type":"story","title":"story", "by":"a", "time":1700000000})))
            }
        }, SessionTiming::default()).await;
    });
    tokio::time::timeout(Duration::from_millis(500), async {
        while fetched.lock().unwrap().len() < 21 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    desk.start(false, |_, _| async {});
    let fetched = fetched.lock().unwrap();
    assert_eq!(fetched.len(), 21);
    assert!(fetched.contains(&100));
    assert!(!fetched.contains(&21));
    assert_eq!(maximum.load(Ordering::SeqCst), 4);
}

#[test]
fn http_status_retry_after_and_fixed_destination_guards() {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(reqwest::header::RETRY_AFTER, "120".parse().unwrap());
    assert!(
        matches!(check_http(429, &headers), Err(Failure::Retry(_, Some(d))) if d == Duration::from_secs(120))
    );
    assert!(matches!(
        check_http(503, &headers),
        Err(Failure::Retry(_, _))
    ));
    for code in [301, 302, 307, 308, 401, 403] {
        assert!(matches!(check_http(code, &headers), Err(Failure::Stop(_))));
    }
    assert!(check_http(200, &headers).is_ok());
    for ip in [
        "127.0.0.1",
        "10.0.0.1",
        "169.254.169.254",
        "100.64.0.1",
        "::1",
        "::ffff:127.0.0.1",
        "fc00::1",
        "2001:db8::1",
    ] {
        assert!(!public_ip(ip.parse().unwrap()));
    }
    assert!(public_ip("8.8.8.8".parse().unwrap()));
    assert!(public_ip("2606:4700:4700::1111".parse().unwrap()));
}

#[tokio::test]
#[ignore = "real fixed-origin HTTPS/SSE smoke; needs network, bounded to 30 seconds"]
async fn real_network_smoke() {
    let desk = Arc::new(LiveDesk::new());
    assert_eq!(desk.set_enabled(true)["enabled"], true);
    let observed = tokio::time::timeout(Duration::from_secs(27), async {
        loop {
            let s = desk.status();
            if s["enabled"] == false {
                return Err(s);
            }
            if s["state"] == "connected" && !s["items"].as_array().unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
        Ok(desk.status())
    })
    .await;
    let before_disable = desk.status();
    desk.set_enabled(false);
    let snapshot = observed
        .expect("Network smoke timed out")
        .unwrap_or_else(|s| panic!("Stream stopped: {s}"));
    println!(
        "LIVE_SMOKE {}",
        json!({"observedAt":now_iso(), "state":snapshot["state"],
        "count":snapshot["items"].as_array().unwrap().len(), "firstId":snapshot["items"][0]["id"],
        "firstPublishedAt":snapshot["items"][0]["publishedAt"], "firstReceivedAt":snapshot["items"][0]["receivedAt"],
        "lastEventAt":snapshot["lastEventAt"],"lastItemAt":snapshot["lastItemAt"],"message":snapshot["message"]})
    );
    assert_eq!(before_disable["enabled"], true);
    assert_eq!(desk.status()["state"], "off");
    drop(
        tokio::time::timeout(Duration::from_millis(500), desk.worker_gate.lock())
            .await
            .unwrap(),
    );
}

#[test]
fn retry_after_http_date_never_rounds_down_before_the_deadline() {
    let now = chrono::DateTime::parse_from_rfc3339("2026-09-23T21:00:00.500Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    assert_eq!(
        parse_retry_after("Wed, 23 Sep 2026 21:00:01 GMT", now).unwrap(),
        Some(Duration::from_secs(1))
    );
    assert_eq!(
        parse_retry_after("Wed, 23 Sep 2026 20:00:00 GMT", now).unwrap(),
        Some(Duration::ZERO)
    );
    assert!(parse_retry_after("9999999999999999999999", now).is_err());
    assert!(parse_retry_after("not a date", now).unwrap().is_none());
}

#[test]
fn sse_optional_bom_is_only_ignored_at_start() {
    let mut parser = SseParser::default();
    let frames = parser
        .push("\u{feff}event: put\ndata: null\n\n".as_bytes())
        .unwrap();
    assert_eq!(frames[0].event, "put");
}

#[tokio::test]
async fn revalidation_deadline_survives_reconnect_and_removes_deleted_story() {
    let desk = Arc::new(LiveDesk::new());
    desk.start(true, |_, _| std::future::pending());
    let generation = desk.generation.load(Ordering::Acquire);
    desk.update(generation, |s| {
        apply_item(
            s,
            10,
            story_metadata(
                10,
                &json!({"id":10,"type":"story","title":"story","by":"a","time":1700000000}),
            ),
        )
    });
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    for idle in [60, 80] {
        let calls = calls.clone();
        let result = desk
            .consume_stream(
                generation,
                futures_util::stream::pending(),
                move |_| {
                    calls.fetch_add(1, Ordering::SeqCst);
                    async { Ok(None) }
                },
                SessionTiming {
                    idle: Duration::from_millis(idle),
                    revalidate: Duration::from_millis(100),
                },
            )
            .await;
        assert!(matches!(result, Err(Failure::Retry(_, None))));
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(desk.status()["items"].as_array().unwrap().is_empty());
    desk.set_enabled(false);
}

#[test]
fn parser_and_firebase_state_are_bounded_and_fail_atomically() {
    let mut parser = SseParser::default();
    assert!(parser.push(&vec![b'x'; FRAME_LIMIT + 1]).is_err());
    assert!(SseParser::default()
        .push(&vec![b'x'; CHUNK_LIMIT + 1])
        .is_err());
    assert!(SseParser::default().push(b"data: \xff\n\n").is_err());
    assert!(SseParser::default()
        .push(b"event: put\ndata: null")
        .unwrap()
        .is_empty());
    assert!(SseParser::default()
        .push(": ping\n\n".repeat(FRAME_BATCH_LIMIT + 1).as_bytes())
        .is_err());
    let mut list = StoryList::default();
    list.apply("put", &json!({"path":"/", "data":{"0":10,"1":11}}))
        .unwrap();
    for invalid in [
        json!({"path":"/1000", "data":12}),
        json!({"path":"/1/foo", "data":12}),
        json!({"path":"/", "data":{"0":12,"bad":13}}),
        json!({"path":"/", "data":{"0":12,"1":-1}}),
        json!({"path":"/", "data":{"0":12,"01":13}}),
    ] {
        assert!(list.apply("patch", &invalid).is_err());
        assert_eq!(list.ids(), vec![10, 11]);
    }
    assert!(list
        .apply("put", &json!({"path":"/", "data":vec![1; LIST_LIMIT+1]}))
        .is_err());
    assert!(list
        .apply("patch", &json!({"path":"/", "data":{"0":10}}))
        .unwrap()
        .is_empty());
    let mut queue = VecDeque::new();
    let mut pending = HashSet::new();
    enqueue(&mut queue, &mut pending, 1..=1000);
    assert_eq!(queue.len(), ITEM_LIMIT);
    enqueue(&mut queue, &mut pending, 1..=1000);
    assert_eq!(pending.len(), ITEM_LIMIT);
}

#[tokio::test]
async fn keepalive_is_transport_only_cancel_and_auth_revoked_are_terminal() {
    let desk = Arc::new(LiveDesk::new());
    desk.start(true, |_, _| std::future::pending());
    let generation = desk.generation.load(Ordering::Acquire);
    let mut list = StoryList::default();
    for input in ["event: keep-alive\ndata: null\n\n", ": ping\r\r"] {
        for frame in SseParser::default().push(input.as_bytes()).unwrap() {
            assert!(desk
                .handle_frame(generation, &mut list, frame)
                .unwrap()
                .is_empty());
        }
    }
    let state = desk.status();
    assert!(state["lastEventAt"].as_str().is_some());
    assert!(state["lastItemAt"].is_null());
    assert!(state["items"].as_array().unwrap().is_empty());
    assert!(!list.initialized);
    for event in ["cancel", "auth_revoked"] {
        assert!(matches!(
            desk.handle_frame(
                generation,
                &mut list,
                Frame {
                    event: event.into(),
                    data: "untrusted reason is not reflected".into()
                }
            ),
            Err(Failure::Stop(_))
        ));
    }
    desk.set_enabled(false);
}

#[test]
fn retained_metadata_is_capped_deduplicated_and_revalidation_preserves_receipt() {
    let mut state = off_snapshot();
    for id in 1..=120 {
        let item = story_metadata(id,&json!({"id":id,"type":"story","title":"story","by":"a","time":1700000000+id,"url":"javascript:alert(1)"})).unwrap();
        assert_eq!(item["url"], item["discussionUrl"]);
        apply_item(&mut state, id, Some(item));
    }
    assert_eq!(state["items"].as_array().unwrap().len(), 100);
    let receipt = state["items"][0]["receivedAt"].clone();
    let last = state["lastItemAt"].clone();
    apply_item(
        &mut state,
        120,
        story_metadata(
            120,
            &json!({"id":120,"type":"story","title":"changed","by":"a","time":1700000120,"score":42}),
        ),
    );
    assert_eq!(state["items"].as_array().unwrap().len(), 100);
    assert_eq!(state["items"][0]["receivedAt"], receipt);
    assert_eq!(state["lastItemAt"], last);
    assert_eq!(state["items"][0]["score"], 42);
}

#[tokio::test]
async fn disable_interrupts_retry_after_without_another_attempt() {
    let desk = Arc::new(LiveDesk::new());
    let attempts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = attempts.clone();
    desk.start(true, move |desk, generation| async move {
        desk.reconnect(generation, || {
            count.fetch_add(1, Ordering::SeqCst);
            async { Err(Failure::Retry("429".into(), Some(Duration::from_secs(120)))) }
        })
        .await;
    });
    tokio::task::yield_now().await;
    assert_eq!(desk.status()["state"], "backoff");
    desk.set_enabled(false);
    drop(
        tokio::time::timeout(Duration::from_millis(300), desk.worker_gate.lock())
            .await
            .unwrap(),
    );
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
    assert_eq!(desk.status()["state"], "off");
}

#[test]
fn enable_without_runtime_fails_closed() {
    let desk = Arc::new(LiveDesk::new());
    let status = desk.set_enabled(true);
    assert_eq!(status["enabled"], false);
    assert_eq!(status["state"], "off");
    assert!(status["message"].as_str().unwrap().contains("runtime"));
}

#[tokio::test]
async fn reconnect_fresh_snapshot_merges_without_duplicate_publications() {
    use futures_util::{stream, StreamExt};
    let desk = Arc::new(LiveDesk::new());
    let attempts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = attempts.clone();
    desk.start(true, move |desk,generation| async move {
        desk.reconnect(generation, || {
            let n = count.fetch_add(1,Ordering::SeqCst);
            let ids = if n == 0 { vec![10] } else { vec![11,10] };
            let snapshot = format!("event: put\ndata: {}\n\n", json!({"path":"/","data":ids}));
            let ending = stream::once(async move {
                if n == 0 { tokio::time::sleep(Duration::from_millis(40)).await; }
                else { std::future::pending::<()>().await; }
                Err(Failure::retry("synthetic disconnect"))
            });
            let stream = stream::iter(vec![Ok(snapshot.into_bytes())]).chain(ending).boxed();
            desk.consume_stream(generation,stream, |id| async move {
                Ok(story_metadata(id,&json!({"id":id,"type":"story","title":"story","by":"a","time":1700000000+id})))
            }, SessionTiming::default())
        }).await;
    });
    tokio::time::timeout(Duration::from_secs(1), async {
        while desk.status()["items"].as_array().unwrap().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let received = desk.status()["items"][0]["receivedAt"].clone();
    tokio::time::timeout(Duration::from_secs(2), async {
        while desk.status()["items"].as_array().unwrap().len() != 2 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let state = desk.status();
    assert_eq!(state["items"][1]["id"], 10);
    assert_eq!(state["items"][1]["receivedAt"], received);
    assert!(state["message"].as_str().unwrap().contains("initial"));
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
    desk.set_enabled(false);
}

#[test]
fn default_status_is_off_without_network_or_items() {
    let desk = LiveDesk::new();
    let status = desk.status();
    assert_eq!(status["enabled"], false);
    assert_eq!(status["state"], "off");
    assert_eq!(status["items"], json!([]));
    assert!(status["lastItemAt"].is_null());
}

#[test]
fn firebase_snapshot_patch_paths_and_null() {
    let mut list = StoryList::default();
    assert_eq!(
        list.apply("put", &json!({"path":"/", "data":[11,12,13]}))
            .unwrap(),
        vec![11, 12, 13]
    );
    assert_eq!(
        list.apply("patch", &json!({"path":"/", "data":{"0":14,"2":null}}))
            .unwrap(),
        vec![14]
    );
    assert_eq!(list.ids(), vec![14, 12]);
    assert_eq!(
        list.apply("put", &json!({"path":"/1", "data":15})).unwrap(),
        vec![15]
    );
    list.apply("put", &json!({"path":"/1", "data":null}))
        .unwrap();
    assert_eq!(list.ids(), vec![14]);
    list.apply("put", &json!({"path":"/", "data":null}))
        .unwrap();
    assert!(list.ids().is_empty());
}

#[test]
fn sse_fragmented_utf8_crlf_and_multiline_data() {
    let input = "event: put\r\ndata: {\"path\":\"/\",\r\ndata: \"data\":[\"café\"]}\r\n\r\n";
    let mut parser = SseParser::default();
    let mut frames = Vec::new();
    for byte in input.as_bytes() {
        frames.extend(parser.push(&[*byte]).unwrap());
    }
    assert_eq!(
        frames,
        vec![Frame {
            event: "put".into(),
            data: "{\"path\":\"/\",\n\"data\":[\"café\"]}".into()
        }]
    );
}
