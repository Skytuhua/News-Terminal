use super::*;
use serde_json::json;
#[path = "fed_diagram.rs"]
mod fed_diagram;

#[tokio::test]
async fn thumbnail_decoder_rejects_signature_only_and_dimension_bombs() {
    for width in [1_u32, 100_000] {
        let mut bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89".to_vec();
        bytes[16..20].copy_from_slice(&width.to_be_bytes());
        let item =
            json!({"kind":"image","url":"https://example.com/image.png","playback":"inline"});
        let response = fixture_response("200 OK", "Content-Type: image/png\r\n", &bytes).await;
        assert!(
            load_using(
                &item,
                async { Ok(response) },
                std::time::Duration::from_secs(2)
            )
            .await
            .is_err(),
            "corrupt or unbounded image reached renderer"
        );
    }
}

#[tokio::test]
async fn rights_pinned_binary_requires_exact_count_hash_and_compiled_approval() {
    let approval = crate::rights::bundled("nasa-technology").unwrap()["rightsPolicy"]
        ["mediaAllowlist"][0]
        .clone();
    let item =
        json!({"kind":"video","url":approval["url"],"mimeType":"video/mp4","playback":"inline"});
    let response = fixture_response(
        "200 OK",
        "Content-Type: application/octet-stream\r\n",
        b"changed",
    )
    .await;
    let result = load_authorized_using(
        &item,
        Some(&approval),
        async { Ok(response) },
        std::time::Duration::from_secs(2),
    )
    .await;
    assert!(result.unwrap_err().contains("byte count"));
    let wrong_bytes = vec![0; approval["bytes"].as_u64().unwrap() as usize];
    let response = fixture_response(
        "200 OK",
        "Content-Type: application/octet-stream\r\n",
        &wrong_bytes,
    )
    .await;
    assert!(load_authorized_using(
        &item,
        Some(&approval),
        async { Ok(response) },
        std::time::Duration::from_secs(3)
    )
    .await
    .unwrap_err()
    .contains("SHA-256"));
    let mut forged = approval.clone();
    forged["bytes"] = json!(7);
    let response = fixture_response(
        "200 OK",
        "Content-Type: application/octet-stream\r\n",
        b"changed",
    )
    .await;
    assert!(load_authorized_using(
        &item,
        Some(&forged),
        async { Ok(response) },
        std::time::Duration::from_secs(2)
    )
    .await
    .unwrap_err()
    .contains("approval"));
}

#[tokio::test]
async fn rights_reviewed_no_hash_assets_still_require_exact_count_mime_and_compiled_approval() {
    let approval = crate::rights::bundled("esa-space-engineering").unwrap()["rightsPolicy"]
        ["mediaAllowlist"][0]
        .clone();
    let item =
        json!({"kind":"image","url":approval["url"],"mimeType":"image/jpeg","playback":"inline"});
    let mut body = vec![0_u8; approval["bytes"].as_u64().unwrap() as usize];
    body[..3].copy_from_slice(b"\xff\xd8\xff");
    let len = body.len();
    body[len - 2..].copy_from_slice(b"\xff\xd9");
    let response = fixture_response("200 OK", "Content-Type: image/jpeg\r\n", &body).await;
    let result = load_authorized_using(
        &item,
        Some(&approval),
        async { Ok(response) },
        std::time::Duration::from_secs(2),
    )
    .await
    .unwrap_err();
    assert!(
        result.contains("image"),
        "a matching signature and byte count is not a valid decoded image"
    );

    let response = fixture_response(
        "200 OK",
        "Content-Type: image/jpeg\r\n",
        &body[..body.len() - 1],
    )
    .await;
    assert!(load_authorized_using(
        &item,
        Some(&approval),
        async { Ok(response) },
        std::time::Duration::from_secs(2),
    )
    .await
    .unwrap_err()
    .contains("byte count"));
}

#[test]
fn media_accept_prevents_cdn_transcoding_declared_jpeg_to_webp() {
    assert_eq!(
        media_accept(&json!({"kind":"image","mimeType":"image/jpeg"})),
        "image/jpeg"
    );
    assert_eq!(
        media_accept(&json!({"kind":"video","mimeType":"video/mp4"})),
        "video/mp4"
    );
    assert_eq!(
        media_accept(&json!({"kind":"image"})),
        "image/jpeg, image/png, image/gif, image/webp"
    );
    assert_eq!(
        media_accept(&json!({"kind":"video"})),
        "video/mp4, video/webm"
    );
}

#[tokio::test]
#[ignore = "live permitted NASA Apollo 17 image; requires public network; never a fixture"]
async fn media_live_nasa_apollo17_public_image() {
    // NASA page explicitly credits NASA; educational/informational permission, not endorsement.
    // https://www.nasa.gov/image-article/blue-marble-image-of-earth-from-apollo-17/
    // https://www.nasa.gov/nasa-brand-center/images-and-media/
    let url = "https://www.nasa.gov/wp-content/uploads/2023/03/135918main_bm1_high.jpg";
    let item = json!({"kind":"image","url":url,"mimeType":"image/jpeg","playback":"inline","credit":"NASA / Apollo 17"});
    let result = load_media(&item).await.unwrap();
    assert_eq!(result["mimeType"], "image/png");
    let size = result["bytes"].as_u64().unwrap();
    assert!(size > 1000 && size <= IMAGE_LIMIT as u64);
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let payload = result["dataUrl"]
        .as_str()
        .unwrap()
        .strip_prefix("data:image/png;base64,")
        .unwrap();
    let body = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .unwrap();
    assert_eq!(body.len() as u64, size);
    println!(
        "LIVE NASA STATIC PREVIEW: sourceUrl={url}; outputMime=image/png; outputBytes={size}; outputSha256={:x}; observedAt={}",
        Sha256::digest(&body),
        chrono::Utc::now().to_rfc3339()
    );
}

#[tokio::test]
#[ignore = "live exact reviewed MIT and ESA assets; requires public network"]
async fn media_live_reviewed_mit_esa_static_previews() {
    for id in ["mit-news-ai", "esa-space-engineering"] {
        let source = crate::rights::bundled(id).unwrap();
        for approval in source["rightsPolicy"]["mediaAllowlist"].as_array().unwrap() {
            let item = json!({"kind":"image","url":approval["url"],"mimeType":approval["mime"],"playback":"inline"});
            let result = load_authorized_media(&item, Some(approval)).await.unwrap();
            assert_eq!(result["mimeType"], "image/png");
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(
                    result["dataUrl"]
                        .as_str()
                        .unwrap()
                        .strip_prefix("data:image/png;base64,")
                        .unwrap(),
                )
                .unwrap();
            let decoded = image::load_from_memory(&bytes).unwrap();
            assert!(decoded.width() <= 640 && decoded.height() <= 480);
            println!("LIVE REVIEWED STATIC PREVIEW: source={id}; url={}; approvedInputBytes={}; outputBytes={}; dimensions={}x{}", approval["url"], approval["bytes"], bytes.len(), decoded.width(), decoded.height());
        }
    }
}

#[tokio::test]
async fn media_declared_and_streamed_caps_apply_to_images_and_video() {
    assert_eq!(IMAGE_LIMIT, 5 * 1024 * 1024);
    assert_eq!(VIDEO_LIMIT, 32 * 1024 * 1024);
    for (kind, mime, limit) in [
        ("image", "image/png", IMAGE_LIMIT),
        ("video", "video/mp4", VIDEO_LIMIT),
    ] {
        let item = json!({"kind":kind,"url":"https://example.com/media","playback":"inline"});
        let response = fixture_response(
            "200 OK",
            &format!("Content-Type: {mime}\r\nContent-Length: {}\r\n", limit + 1),
            &[],
        )
        .await;
        assert_eq!(
            load_using(
                &item,
                async { Ok(response) },
                std::time::Duration::from_secs(2)
            )
            .await
            .unwrap_err(),
            "Response exceeds size limit"
        );
        // No Content-Length: actual streamed bytes, not just a declared-size check.
        let response = fixture_response(
            "200 OK",
            &format!("Content-Type: {mime}\r\n"),
            &vec![0; limit + 1],
        )
        .await;
        assert_eq!(
            load_using(
                &item,
                async { Ok(response) },
                std::time::Duration::from_secs(2)
            )
            .await
            .unwrap_err(),
            "Response exceeds size limit"
        );
    }
}

#[tokio::test]
async fn media_deadline_bounds_pending_request_and_stalled_body() {
    let item = json!({"kind":"image","url":"https://example.com/media","playback":"inline"});
    let timeout = std::time::Duration::from_millis(20);
    let result = load_using(&item, std::future::pending(), timeout).await;
    assert_eq!(result.unwrap_err(), "Media request timed out");
    let response = fixture_response_delayed(
        "200 OK",
        "Content-Type: image/png\r\n",
        b"not finished",
        std::time::Duration::from_millis(300),
    )
    .await;
    let result = load_using(&item, async { Ok(response) }, timeout).await;
    assert_eq!(result.unwrap_err(), "Media request timed out");
}

#[tokio::test]
async fn media_external_and_unsafe_items_never_poll_network() {
    for item in [
        json!({"kind":"video","url":"https://example.com/story","playback":"external"}),
        json!({"kind":"image","url":"https://127.0.0.1/private","playback":"inline"}),
        json!({"kind":"image","url":"https://x.local/private","playback":"inline"}),
        json!({"kind":"image","url":"http://example.com/a","playback":"inline"}),
        json!({"kind":"image","url":"https://example.com/a","mimeType":"image/svg+xml","playback":"inline"}),
    ] {
        let polled = std::cell::Cell::new(false);
        let request = async {
            polled.set(true);
            Err("network was polled".to_string())
        };
        assert!(
            load_using(&item, request, std::time::Duration::from_secs(1))
                .await
                .is_err()
        );
        assert!(!polled.get(), "fetched unpermitted item {item}");
    }
    assert!(
        load_media(&json!({"kind":"image","url":"https://127.0.0.1/a","playback":"inline"}))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn media_supported_format_signatures_roundtrip_synthetic_containers() {
    // These deliberately minimal container signatures are NOT playable video fixtures.
    for (kind, mime, body) in [
        (
            "image",
            "image/jpeg",
            &b"\xff\xd8\xff\xe0fixture\xff\xd9"[..],
        ),
        (
            "image",
            "image/gif",
            &b"GIF89a\x01\x00\x01\x00\x00\x00\x00;"[..],
        ),
        (
            "image",
            "image/webp",
            &b"RIFF\x0c\x00\x00\x00WEBPVP8 \x00\x00\x00\x00"[..],
        ),
        (
            "video",
            "video/mp4",
            &b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isomiso2"[..],
        ),
        (
            "video",
            "video/webm",
            &b"\x1a\x45\xdf\xa3\x87\x42\x82\x84webm"[..],
        ),
    ] {
        let item = json!({"kind":kind,"url":"https://example.com/media","playback":"inline"});
        let response = fixture_response(
            "200 OK",
            &format!("Content-Type: {mime}; charset=binary\r\n"),
            body,
        )
        .await;
        let result = load_using(
            &item,
            async { Ok(response) },
            std::time::Duration::from_secs(1),
        )
        .await;
        if kind == "image" {
            assert!(result.is_err(), "signature-only images must fail decoding");
        } else {
            let result = result.unwrap();
            assert_eq!(result["mimeType"], mime);
            assert_eq!(result["bytes"], body.len());
            assert_eq!(result["kind"], kind);
        }
        assert!(!matches_magic(mime, b"<html>not media</html>"));
        assert!(!matches_magic(mime, &body[..3]));
    }
    assert!(!matches_magic(
        "video/mp4",
        b"\x00\x00\x00\x18ftypavif\x00\x00\x00\x00avifmif1"
    ));
    assert!(!matches_magic(
        "video/webm",
        b"\x1a\x45\xdf\xa3\x8b\x42\x82\x88matroska"
    ));
    assert!(!matches_magic(
        "image/webp",
        b"RIFF\xff\xff\xff\xffWEBPVP8 \x00\x00\x00\x00"
    ));
}

#[tokio::test]
async fn media_response_rejects_active_mismatched_empty_and_redirect_payloads() {
    let item = json!({"kind":"image","url":"https://example.com/a","mimeType":"image/png","playback":"inline"});
    for (status, headers, bytes) in [
        (
            "200 OK",
            "Content-Type: image/png\r\n",
            &b"<html><script>evil()</script></html>"[..],
        ),
        ("200 OK", "Content-Type: image/svg+xml\r\n", &b"<svg/>"[..]),
        ("200 OK", "Content-Type: text/html\r\n", &b"html"[..]),
        ("200 OK", "Content-Type: image/png\r\n", &b""[..]),
        (
            "200 OK",
            "Content-Type: image/png\r\n",
            &b"\x89PNG\r\n\x1a\n"[..],
        ),
        (
            "200 OK",
            "Content-Type: image/gif\r\n",
            &b"GIF89a\x01\x00\x01\x00\x00\x00\x00;"[..],
        ),
        (
            "200 OK",
            "Content-Type: image/png\r\nContent-Encoding: gzip\r\n",
            &b"payload"[..],
        ),
        (
            "200 OK",
            "Content-Type: image/png\r\nContent-Type: text/html\r\n",
            &b"payload"[..],
        ),
        (
            "302 Found",
            "Content-Type: image/png\r\nLocation: http://127.0.0.1/secret\r\n",
            &b"SECRET"[..],
        ),
        (
            "206 Partial Content",
            "Content-Type: image/png\r\n",
            &b"partial"[..],
        ),
    ] {
        let response = fixture_response(status, headers, bytes).await;
        let result = load_using(
            &item,
            async { Ok(response) },
            std::time::Duration::from_secs(1),
        )
        .await;
        assert!(result.is_err(), "accepted {status}, {headers}");
        assert!(!result.unwrap_err().contains("SECRET"));
    }
}

// Synthetic HTTP/container fixture: exercises host MIME/magic/encoding, not playback.
#[tokio::test]
async fn media_load_validates_response_and_returns_data_url() {
    let mut encoded = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(1, 1)
        .write_to(&mut encoded, image::ImageFormat::Png)
        .unwrap();
    let bytes = encoded.get_ref().as_slice();
    let item = json!({"kind":"image","url":"https://example.com/photo.png","mimeType":"image/png","playback":"inline"});
    let response = fixture_response("200 OK", "Content-Type: image/png\r\n", bytes).await;
    let result = load_using(
        &item,
        async { Ok(response) },
        std::time::Duration::from_secs(1),
    )
    .await
    .unwrap();
    assert_eq!(result["kind"], "image");
    assert_eq!(result["mimeType"], "image/png");
    assert_eq!(result["bytes"], bytes.len());
    use base64::Engine;
    let payload = result["dataUrl"]
        .as_str()
        .unwrap()
        .strip_prefix("data:image/png;base64,")
        .unwrap();
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(payload)
            .unwrap(),
        bytes
    );
}

async fn fixture_response(status: &str, headers: &str, body: &[u8]) -> reqwest::Response {
    fixture_response_delayed(status, headers, body, std::time::Duration::ZERO).await
}
async fn fixture_response_delayed(
    status: &str,
    headers: &str,
    body: &[u8],
    delay: std::time::Duration,
) -> reqwest::Response {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/synthetic-media", listener.local_addr().unwrap());
    let mut response =
        format!("HTTP/1.1 {status}\r\n{headers}Connection: close\r\n\r\n").into_bytes();
    let header_end = response.len();
    response.extend_from_slice(body);
    std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(std::time::Duration::from_secs(2)))
            .unwrap();
        let mut request = [0; 4096];
        let mut read = 0;
        while !request[..read].windows(4).any(|w| w == b"\r\n\r\n") {
            assert!(read < request.len(), "fixture request header too large");
            let n = socket.read(&mut request[read..]).unwrap();
            assert!(n > 0, "fixture request closed before headers");
            read += n;
        }
        let _ = socket.write_all(&response[..header_end]);
        std::thread::sleep(delay);
        let _ = socket.write_all(&response[header_end..]);
    });
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
        .get(url)
        .send()
        .await
        .unwrap()
}

#[test]
fn media_contract_allows_only_bounded_safe_metadata() {
    let valid = json!({"kind":"image","url":"https://example.com/photo.png?signature=a%2Bb","mimeType":"image/png","playback":"inline","caption":"Plain caption","credit":"Photographer"});
    assert_eq!(validate_media(&valid), Ok(()));
    let external = json!({"kind":"video","url":"http://example.com/story","playback":"external"});
    assert_eq!(validate_media(&external), Ok(()));
    for (key, value) in [
        ("kind", json!("iframe")),
        ("playback", json!("auto")),
        ("url", json!("javascript:alert(1)")),
        ("url", json!("data:image/png;base64,AAAA")),
        ("url", json!("https://127.0.0.1/secret")),
        ("url", json!("https://x.internal/")),
        ("url", json!("https://user:pass@example.com/")),
        ("url", json!("https://example.com:8443/a")),
        ("url", json!("http://example.com/a")),
        ("url", json!("https://example.com/a\n")),
        ("mimeType", json!("image/svg+xml")),
        ("mimeType", json!("video/mp4")),
        ("caption", json!("<script>evil()</script>")),
        ("credit", json!("x".repeat(501))),
        ("html", json!("<iframe/>")),
    ] {
        let mut invalid = valid.clone();
        invalid[key] = value;
        assert!(validate_media(&invalid).is_err(), "accepted {invalid}");
    }
    for url in [
        "http://127.1/",
        "https://[::1]/",
        "http://server.local/",
        "ftp://example.com/a",
    ] {
        let mut invalid = external.clone();
        invalid["url"] = json!(url);
        assert!(validate_media(&invalid).is_err(), "accepted {invalid}");
    }
    assert!(validate_media(&json!([])).is_err());
}
