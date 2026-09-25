use super::*;

#[test]
fn rights_nhc_exact_products_issue_marker_and_paths() {
    let description = "NWS National Hurricane Center Miami FL\n800 AM EDT Wed Sep 23 2026\nOfficial supplied advisory.";
    for (title, url) in [
        (
            "Atlantic Tropical Weather Outlook",
            "https://www.nhc.noaa.gov/gtwo.php?basin=atlc",
        ),
        (
            "Hurricane Test Public Advisory Number 1",
            "https://www.nhc.noaa.gov/text/refresh/MIATCPAT1+shtml/231500.shtml",
        ),
        (
            "Hurricane Test Forecast Advisory Number 1",
            "https://www.nhc.noaa.gov/text/refresh/MIATCMAT5+shtml/231500.shtml",
        ),
        (
            "Hurricane Test Forecast Discussion Number 1",
            "https://www.nhc.noaa.gov/text/refresh/MIATCDAT3+shtml/231500.shtml",
        ),
    ] {
        assert_eq!(
            parsed("nhc-atlantic", title, url, description, "")["_rights"]["ai"],
            true,
            "{title}"
        );
        assert_ne!(
            parsed(
                "nhc-atlantic",
                title,
                url,
                "NWS National Hurricane Center no issue time",
                ""
            )["_rights"]["ai"],
            true
        );
        assert_ne!(
            parsed(
                "nhc-atlantic",
                title,
                &format!("{url}#fragment"),
                description,
                ""
            )["_rights"]["ai"],
            true
        );
    }
    for (title, url) in [
        (
            "Atlantic Tropical Weather Outlook",
            "https://www.nhc.noaa.gov/gtwo.php?basin=epac",
        ),
        (
            "Hurricane Test Graphics",
            "https://www.nhc.noaa.gov/text/refresh/MIATCPAT1+shtml/231500.shtml",
        ),
        (
            "Hurricane Test Public Advisory",
            "https://www.nhc.noaa.gov/text/refresh/MIATCPAT6+shtml/231500.shtml",
        ),
        (
            "Hurricane Test Public Advisory",
            "https://www.nhc.noaa.gov/text/refresh/MIATCPAT1+shtml/invalid.shtml",
        ),
    ] {
        assert_ne!(
            parsed("nhc-atlantic", title, url, description, "")["_rights"]["ai"],
            true
        );
    }
}
#[tokio::test]
#[ignore = "explicit live public feed probe"]
async fn rights_live_feed_classifiers() {
    for id in [
        "nhc-atlantic",
        "fed-press_monetary",
        "fed-press_all",
        "nasa-technology",
    ] {
        let src = source(id);
        let u = crate::services::public_url(src["url"].as_str().unwrap()).unwrap();
        let resp = crate::services::public_client(&u)
            .await
            .unwrap()
            .get(u)
            .send()
            .await
            .unwrap();
        let body = crate::services::bounded_body(resp, 2 * 1024 * 1024)
            .await
            .unwrap();
        let raw = feed_rs::parser::parse(body.as_slice()).unwrap();
        println!(
            "DEBUG {id} excluded={} authors={:?} rights={:?}",
            feed_excluded(&body),
            raw.entries[0].authors,
            raw.entries[0].rights
        );
        let result = crate::services::parse_feed(&body, &src).unwrap();
        let items = result["articles"].as_array().unwrap();
        let count = items.iter().filter(|a| a["_rights"]["ai"] == true).count();
        println!("LIVE {id}: items={} ai_eligible={count}", items.len());
        if id != "nasa-technology" {
            assert!(count > 0, "No eligible items in {id}");
        }
    }
}

#[test]
fn rights_nasa_lunar_real_item_is_exactly_bound_and_not_ai_permission() {
    let src = source("nasa-technology");
    assert!(src.get("sectionScope").is_none());
    let xml = include_str!("../fixtures/nasa-lunar-technologies.xml");
    let result = crate::services::parse_feed(xml.as_bytes(), &src).unwrap();
    let mut article = result["articles"][0].clone();
    crate::topics::apply(&src, &mut article);
    assert_eq!(article["sections"], json!(["technology"]));
    assert_eq!(article["media"].as_array().map_or(0, Vec::len), 1);
    let media = &article["media"][0];
    let url = "https://www.nasa.gov/wp-content/uploads/2026/09/lunar-image-reduced.png";
    assert_eq!(media["url"], url);
    assert_eq!(media["mimeType"], "image/png");
    assert_eq!(media["credit"], "NASA");
    assert!(media["caption"]
        .as_str()
        .unwrap()
        .contains("Artistic concept"));
    assert!(media["caption"]
        .as_str()
        .unwrap()
        .contains("no endorsement"));
    assert!(media["caption"].as_str().unwrap().contains("insignia"));
    assert_eq!(article["_rights"]["assets"], json!([url]));
    assert_eq!(article["_rights"]["ai"], false);

    // No query normalization, other-story substitution, or URL mentions as images.
    for changed in [
        xml.replace(
            "post_type=press-release&amp;p=1045129",
            "post_type=press-release&amp;p=other",
        ),
        xml.replace(
            "/news-release/nasa-calls-for-proposals-to-accelerate-lunar-surface-technologies/",
            "/news-release/other-story/",
        ),
        xml.replace("lunar-image-reduced.png", "unreviewed.png"),
        xml.replace(
            "lunar-image-reduced.png",
            "lunar-image-reduced.png?different=1",
        ),
        xml.replace(
            &format!("&lt;a href=\"{url}\"&gt;"),
            "&lt;a href=\"https://www.nasa.gov/other.png\"&gt;",
        ),
    ] {
        assert_ne!(changed, xml);
        let denied = crate::services::parse_feed(changed.as_bytes(), &src).unwrap();
        assert!(denied["articles"][0].get("media").is_none());
        assert_eq!(denied["articles"][0]["_rights"]["assets"], json!([]));
    }
    let mut disabled = src.clone();
    disabled["mediaAllowed"] = json!(false);
    assert!(
        crate::services::parse_feed(xml.as_bytes(), &disabled).unwrap()["articles"][0]
            .get("media")
            .is_none()
    );
}

#[test]
fn rights_nasa_png_schema_keeps_hash_and_size_requirements() {
    let mut policy = source("nasa-technology")["rightsPolicy"].clone();
    let asset = &mut policy["mediaAllowlist"][0];
    asset["kind"] = json!("image");
    asset["mime"] = json!("image/png");
    asset["bytes"] = json!(4_620_791);
    validate_policy(&policy).expect("bounded SHA-pinned NASA PNG is supported");
    for (key, value) in [
        ("sha256", Value::Null),
        ("bytes", json!(5 * 1024 * 1024 + 1)),
        ("mime", json!("image/svg+xml")),
    ] {
        let mut changed = policy.clone();
        changed["mediaAllowlist"][0][key] = value;
        assert!(validate_policy(&changed).is_err(), "{key}");
    }
    for rule in [
        "mit-exact-media-download-v1",
        "esa-standard-licence-exact-assets-v1",
    ] {
        let mut changed = policy.clone();
        changed["mediaRule"] = json!(rule);
        assert!(validate_policy(&changed).is_err());
    }
}

#[test]
fn rights_nasa_only_exact_item_guid_and_supplied_approved_assets() {
    let src = source("nasa-technology");
    let approved = &src["rightsPolicy"]["mediaAllowlist"][0];
    for (guid, url, expected) in [
        (
            approved["itemGuid"].as_str().unwrap(),
            approved["itemUrl"].as_str().unwrap(),
            1,
        ),
        (
            "https://www.nasa.gov/?p=other",
            approved["itemUrl"].as_str().unwrap(),
            0,
        ),
        (
            approved["itemGuid"].as_str().unwrap(),
            "https://www.nasa.gov/wrong-story",
            0,
        ),
    ] {
        let xml = format!(
            r#"<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>NASA</title><link>https://www.nasa.gov</link><description>NASA</description><item><title>NASA Guam station</title><link>{url}</link><guid isPermaLink="false">{guid}</guid><description>Supplied excerpt</description><media:content url="{}" medium="video"/><media:thumbnail url="https://www.nasa.gov/maxar.jpg"/></item></channel></rss>"#,
            approved["url"].as_str().unwrap()
        );
        let result = crate::services::parse_feed(xml.as_bytes(), &src).unwrap();
        let a = &result["articles"][0];
        assert_eq!(a["media"].as_array().map_or(0, Vec::len), expected);
        assert_eq!(a["_rights"]["assets"].as_array().unwrap().len(), expected);
        if expected > 0 {
            assert_eq!(a["media"][0]["credit"], "NASA");
        }
    }
}

#[test]
fn rights_mit_exact_media_download_asset_and_stock_credit_denials() {
    let src = source("mit-news-ai");
    let approved = &src["rightsPolicy"]["mediaAllowlist"][0];
    let xml = format!(
        r#"<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>MIT AI</title><link>https://news.mit.edu</link><description>Feed</description><item><title>New AI technique could make minimally invasive surgeries safer and more precise</title><link>{}</link><guid isPermaLink="false">{}</guid><description>Supplied excerpt</description><media:content url="{}" medium="image"/><media:credit>{}</media:credit></item></channel></rss>"#,
        approved["itemUrl"].as_str().unwrap(),
        approved["itemGuid"].as_str().unwrap(),
        approved["url"].as_str().unwrap(),
        approved["credit"].as_str().unwrap(),
    );
    let result = crate::services::parse_feed(xml.as_bytes(), &src).unwrap();
    let article = &result["articles"][0];
    assert_eq!(article["media"].as_array().map_or(0, Vec::len), 1);
    assert_eq!(article["media"][0]["credit"], approved["credit"]);
    assert_eq!(article["_rights"]["assets"][0], approved["url"]);

    for (url, credit) in [
        (
            "https://news.mit.edu/sites/default/files/styles/news_article__cover_image__original/public/images/202609/MIT-AI-City-01.jpg",
            "Credit: MIT News",
        ),
        (
            "https://news.mit.edu/sites/default/files/styles/news_article__cover_image__original/public/images/202609/stock.jpg",
            "Credit: MIT News; iStock",
        ),
    ] {
        let xml = format!(
            r#"<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>MIT AI</title><item><title>Stock image counterexample</title><link>{}</link><guid isPermaLink="false">{}</guid><description>Supplied excerpt</description><media:content url="{url}" medium="image"/><media:credit>{credit}</media:credit></item></channel></rss>"#,
            approved["itemUrl"].as_str().unwrap(),
            approved["itemGuid"].as_str().unwrap(),
        );
        let denied = crate::services::parse_feed(xml.as_bytes(), &src).unwrap();
        assert!(denied["articles"][0].get("media").is_none(), "{url}");
        assert!(denied["articles"][0]["_rights"]["assets"]
            .as_array()
            .unwrap()
            .is_empty());
    }
}

#[test]
fn rights_esa_exact_standard_licence_assets_and_atmos_denial() {
    let src = source("esa-space-engineering");
    let approved = &src["rightsPolicy"]["mediaAllowlist"][0];
    let xml = format!(
        r#"<rss version="2.0"><channel><title>ESA</title><link>https://www.esa.int</link><description>Feed</description><item><title>The silicon brains steering next-generation antennas</title><link>{}</link><guid isPermaLink="false">{}</guid><description><![CDATA[<p>Image:</p><img src="{}" alt="Silicon brains"/>]]></description></item></channel></rss>"#,
        approved["itemUrl"].as_str().unwrap(),
        approved["itemGuid"].as_str().unwrap(),
        approved["url"].as_str().unwrap(),
    );
    let result = crate::services::parse_feed(xml.as_bytes(), &src).unwrap();
    let article = &result["articles"][0];
    assert_eq!(article["media"].as_array().map_or(0, Vec::len), 1);
    assert_eq!(article["media"][0]["credit"], approved["credit"]);

    let atmos_xml = r#"<rss version="2.0"><channel><title>ESA</title><item><title>Phoenix 3 counterexample</title><link>https://www.esa.int/ESA_Multimedia/Images/2026/08/ESA_and_ATMOS_during_CDF_concept_study_for_Phoenix_3</link><guid isPermaLink="false">https://www.esa.int/ESA_Multimedia/Images/2026/08/ESA_and_ATMOS_during_CDF_concept_study_for_Phoenix_3</guid><description><![CDATA[<img src="https://www.esa.int/var/esa/storage/images/esa_multimedia/images/2026/08/esa_and_atmos_during_cdf_concept_study_for_phoenix_3/27400000-1-eng-GB/ESA_and_ATMOS_during_CDF_concept_study_for_Phoenix_3_card_full.jpg" alt="ATMOS"/>]]></description></item></channel></rss>"#;
    let denied = crate::services::parse_feed(atmos_xml.as_bytes(), &src).unwrap();
    assert!(denied["articles"][0].get("media").is_none());
}

#[test]
fn rights_mastodon_missing_headline_is_labeled_post_not_untitled() {
    let xml=br#"<rss version="2.0"><channel><title>Mastodon</title><link>https://mastodon.social</link><description>Feed</description><item><link>https://mastodon.social/@Mastodon/123</link><description>&lt;p&gt;A supplied public post&lt;/p&gt;</description></item></channel></rss>"#;
    let result = crate::services::parse_feed(xml, &source("mastodon-official")).unwrap();
    assert_eq!(result["articles"][0]["title"], "Mastodon post — @Mastodon");
    assert_eq!(result["articles"][0]["excerpt"], "A supplied public post");
}

#[test]
fn rights_nhc_duplicate_summary_does_not_hide_cleared_official_advisory() {
    let url = "https://www.nhc.noaa.gov/text/refresh/MIATCPAT1+shtml/231500.shtml";
    let xml = format!(
        r#"<rss version="2.0"><channel><title>NHC</title><link>https://www.nhc.noaa.gov</link><description>Feed</description><item><title>Summary for Hurricane Test</title><link>{url}</link><description>No agency marker</description></item><item><title>Hurricane Test Public Advisory Number 1</title><link>{url}</link><description>NWS National Hurricane Center Miami FL
800 AM EDT Wed Sep 23 2026
Supplied advisory</description><pubDate>Wed, 23 Sep 2026 15:00:00 GMT</pubDate></item></channel></rss>"#
    );
    let result = crate::services::parse_feed(xml.as_bytes(), &source("nhc-atlantic")).unwrap();
    assert_eq!(result["articles"].as_array().unwrap().len(), 1);
    assert_eq!(result["articles"][0]["_rights"]["ai"], true);
}

#[test]
fn rights_schema_is_bounded_typed_and_rejects_unknown_nested_fields() {
    for id in [
        "nhc-atlantic",
        "fed-press_monetary",
        "fed-press_all",
        "nasa-technology",
    ] {
        validate_policy(&source(id)["rightsPolicy"]).unwrap();
    }
    for (field, value) in [
        ("version", json!(2)),
        ("requiresItemGate", json!(false)),
        ("secret", json!("not permitted")),
        ("attribution", json!("")),
        ("attribution", json!("x".repeat(4097))),
        ("aiRule", json!("unreviewed-v2")),
        ("mediaRule", json!("nasa-exact-assets-v1")),
    ] {
        let mut p = source("fed-press_all")["rightsPolicy"].clone();
        p[field] = value;
        assert!(validate_policy(&p).is_err(), "{field}");
    }
    for (field, value) in [
        ("sha256", json!("A".repeat(64))),
        ("bytes", json!(0)),
        ("bytes", json!(33554433)),
        ("mime", json!("application/octet-stream")),
        ("url", json!("https://user:password@example.org/a.mp4")),
        ("privateGrant", json!(true)),
    ] {
        let mut p = source("nasa-technology")["rightsPolicy"].clone();
        p["mediaAllowlist"][0][field] = value;
        assert!(validate_policy(&p).is_err(), "{field}");
    }
    let mut p = source("nasa-technology")["rightsPolicy"].clone();
    p["mediaAllowlist"] = json!(vec![p["mediaAllowlist"][0].clone(); 17]);
    assert!(validate_policy(&p).is_err());
}

#[test]
fn rights_nhc_requires_a_distinct_issue_line_not_a_date_mentioned_in_prose() {
    let title = "Atlantic Tropical Weather Outlook";
    let url = "https://www.nhc.noaa.gov/gtwo.php?basin=atlc";
    assert_ne!(parsed("nhc-atlantic",title,url,"NWS National Hurricane Center discusses a report from 800 AM EDT Wed Sep 23 2026 in prose.","")["_rights"]["ai"],true);
}

fn source(id: &str) -> Value {
    let all: Vec<Value> =
        serde_json::from_str(include_str!("../../../resources/sources.json")).unwrap();
    all.into_iter().find(|s| s["id"] == id).unwrap()
}
fn parsed(id: &str, title: &str, url: &str, description: &str, extra: &str) -> Value {
    let xml = format!(
        r#"<rss version="2.0"><channel><title>Fixture</title><link>https://example.org</link><description>Fixture</description><item><title><![CDATA[{title}]]></title><link><![CDATA[{url}]]></link><description><![CDATA[{description}]]></description><pubDate>Wed, 23 Sep 2026 15:00:00 GMT</pubDate>{extra}</item></channel></rss>"#
    );
    crate::services::parse_feed(xml.as_bytes(), &source(id)).unwrap()["articles"][0].clone()
}
#[test]
fn rights_fed_positive_requires_exact_headline_and_rejects_pretruncate_exceptions() {
    let title = "Federal Reserve issues FOMC statement";
    let url = "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260923a.htm";
    assert_eq!(
        parsed("fed-press_monetary", title, url, title, "")["_rights"]["ai"],
        true
    );
    for (t, u, d, extra) in [
        (
            "Agencies issue joint statement",
            url,
            "Agencies issue joint statement".to_string(),
            "",
        ),
        (
            title,
            url,
            format!("{title} {} courtesy of Reuters", " ".repeat(3000)),
            "",
        ),
        (
            title,
            url,
            title.to_string(),
            "<copyright>All rights reserved</copyright>",
        ),
        (
            title,
            "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260923a.htm#x",
            title.to_string(),
            "",
        ),
        (title, url, format!("{title} Full body"), ""),
    ] {
        assert_ne!(
            parsed("fed-press_monetary", t, u, &d, extra)["_rights"]["ai"],
            true
        );
    }
}
