use super::*;

#[tokio::test]
async fn fed_diagram_loader_enforces_exact_mime_bytes_hash_and_compiled_pin() {
    pinned_png_case("fed-feds-notes").await;
}

#[tokio::test]
async fn nasa_lunar_loader_enforces_exact_mime_bytes_hash_and_compiled_pin() {
    pinned_png_case("nasa-technology").await;
}

async fn pinned_png_case(source_id: &str) {
    let approval = crate::rights::bundled(source_id).unwrap()["rightsPolicy"]["mediaAllowlist"]
        .as_array()
        .unwrap()
        .iter()
        .find(|pin| pin["mime"] == "image/png")
        .unwrap()
        .clone();
    let item =
        json!({"kind":"image", "url":approval["url"], "mimeType":"image/png", "playback":"inline"});
    // Deliberately invalid transport bytes; never presented as publisher evidence.
    let changed = vec![0_u8; approval["bytes"].as_u64().unwrap() as usize];
    for (content_type, body, error) in [
        ("image/jpeg", changed.as_slice(), "Content-Type"),
        ("image/png", &changed[..changed.len() - 1], "byte count"),
        ("image/png", changed.as_slice(), "SHA-256"),
    ] {
        let response =
            fixture_response("200 OK", &format!("Content-Type: {content_type}\r\n"), body).await;
        let result = load_authorized_using(
            &item,
            Some(&approval),
            async { Ok(response) },
            std::time::Duration::from_secs(3),
        )
        .await;
        assert!(result.unwrap_err().contains(error));
    }
    let mut forged = approval.clone();
    forged["sha256"] = json!("0".repeat(64));
    let result = load_authorized_using(
        &item,
        Some(&forged),
        async { panic!("forged policy must not issue a request") },
        std::time::Duration::from_secs(3),
    )
    .await;
    assert!(result.unwrap_err().contains("compiled media approval"));
    let mut other = item.clone();
    other["url"] = json!(if source_id == "fed-feds-notes" {
        item["url"].as_str().unwrap().replace("fig1-", "fig2-")
    } else {
        format!("{}?w=1280", item["url"].as_str().unwrap())
    });
    let result = load_authorized_using(
        &other,
        Some(&approval),
        async { panic!("Figure 2 must not issue a request") },
        std::time::Duration::from_secs(3),
    )
    .await;
    assert!(result.unwrap_err().contains("compiled media approval"));
}
