use super::*;

const FEED: &str = include_str!("../fixtures/fed-repo-note.xml");
const SID: &str = "fed-feds-notes";
const ASSET: &str = "https://www.federalreserve.gov/econres/notes/feds-notes/fig1-4069.png";

#[test]
fn fed_diagram_unrelated_items_are_metadata_only_without_media_authority() {
    let source = bundled(SID).unwrap();
    let item = source["rightsPolicy"]["mediaAllowlist"][0]["itemUrl"]
        .as_str()
        .unwrap();
    for xml in [
        FEED.replace(
            &format!("<guid>{item}</guid>"),
            "<guid>https://www.federalreserve.gov/unrelated</guid>",
        ),
        FEED.replace(
            &format!("<link>{item}</link>"),
            "<link>https://www.federalreserve.gov/unrelated</link>",
        ),
        FEED.replace(item, &format!("{item}?different=1")),
    ] {
        let parsed = crate::services::parse_feed(xml.as_bytes(), source).unwrap();
        let article = &parsed["articles"][0];
        assert!(article.get("media").is_none());
        assert_eq!(article["_rights"]["assets"], json!([]));
        assert_eq!(
            article["excerpt"], "",
            "unreviewed FEDS Notes introduction must not be retained"
        );
    }
}

#[test]
fn fed_diagram_figure_two_and_unrelated_assets_never_inherit_approval() {
    let source = bundled(SID).unwrap();
    let extra = format!(
        r#"<enclosure url="{}" type="image/png"/><enclosure url="https://www.federalreserve.gov/seal.png" type="image/png"/>"#,
        ASSET.replace("fig1-", "fig2-")
    );
    let xml = FEED.replace("</item>", &format!("{extra}</item>"));
    let parsed = crate::services::parse_feed(xml.as_bytes(), source).unwrap();
    assert_eq!(parsed["articles"][0]["media"].as_array().unwrap().len(), 1);
    assert_eq!(parsed["articles"][0]["media"][0]["url"], ASSET);
    assert_eq!(parsed["articles"][0]["_rights"]["assets"], json!([ASSET]));
    let item = source["rightsPolicy"]["mediaAllowlist"][0]["itemUrl"]
        .as_str()
        .unwrap();
    let unrelated = xml.replace(item, "https://www.federalreserve.gov/unrelated");
    assert!(
        crate::services::parse_feed(unrelated.as_bytes(), source).unwrap()["articles"][0]
            .get("media")
            .is_none()
    );
}

#[test]
fn fed_diagram_changed_source_policy_or_missing_hash_fails_closed() {
    let source = bundled(SID).unwrap();
    for field in ["url", "enabled", "mediaAllowed", "storage", "rightsPolicy"] {
        let mut changed = source.clone();
        changed[field] = match field {
            "url" => json!("https://www.federalreserve.gov/feeds/other.xml"),
            "enabled" | "mediaAllowed" => json!(false),
            "storage" => json!("metadata"),
            _ => json!({}),
        };
        let parsed = crate::services::parse_feed(FEED.as_bytes(), &changed).unwrap();
        assert!(parsed["articles"][0].get("media").is_none(), "{field}");
        assert_eq!(parsed["articles"][0]["excerpt"], "", "{field}");
    }
    for hash in [Value::Null, json!("0"), json!("G".repeat(64))] {
        let mut policy = source["rightsPolicy"].clone();
        policy["mediaAllowlist"][0]["sha256"] = hash;
        assert!(validate_policy(&policy).is_err());
    }
    // Existing policies remain separate; the Fed PNG extension cannot relabel them.
    for id in ["nasa-technology", "mit-news-ai", "esa-space-engineering"] {
        validate_policy(&bundled(id).unwrap()["rightsPolicy"]).unwrap();
    }
}

#[test]
fn fed_diagram_real_rss_item_has_exact_reviewed_media_and_evidence_based_stocks() {
    let source = bundled(SID).expect("reviewed FEDS Notes source must be bundled");
    assert!(
        source.get("sectionScope").is_none(),
        "do not force financial-market labels"
    );
    assert_eq!(source["kind"], "official notice");
    assert_eq!(source["aiAllowed"], false);
    assert_eq!(source["accessMode"], "free-keyless");
    validate_policy(&source["rightsPolicy"]).unwrap();
    let mut parsed = crate::services::parse_feed(FEED.as_bytes(), source).unwrap();
    let article = &mut parsed["articles"][0];
    assert_eq!(article["media"].as_array().map_or(0, Vec::len), 1);
    assert_eq!(article["media"][0]["url"], ASSET);
    assert_eq!(article["media"][0]["mimeType"], "image/png");
    assert_eq!(article["_rights"]["assets"], json!([ASSET]));
    assert_eq!(article["_rights"]["ai"], false);
    let caption = article["media"][0]["caption"].as_str().unwrap();
    assert!(caption.contains("Financial-market diagram"));
    assert!(caption.contains("authors' views"));
    assert!(caption.contains("not an official recommendation"));
    assert!(article["media"][0]["credit"]
        .as_str()
        .unwrap()
        .contains("Board of Governors"));
    crate::topics::apply(source, article);
    assert_eq!(article["sections"], json!(["stocks"]));
    assert_eq!(
        article["classificationReasons"],
        json!(["Headline/excerpt contains stock or market terminology"])
    );
}
