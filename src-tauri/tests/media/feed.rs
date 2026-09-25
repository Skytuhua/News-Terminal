use super::*;

#[test]
fn media_rss_groups_deduplicate_bound_and_sanitize_without_scraping_html() {
    let extras = (0..12)
        .map(|i| format!(r#"<media:content url="https://example.com/{i}.png" type="image/png"/>"#))
        .collect::<String>();
    let body = format!(
        r#"<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Synthetic fixture</title><item><title>Media</title><link>https://example.com/story</link><description>&lt;img src="https://example.com/never-scraped.png"/&gt;</description><media:group><media:title>&lt;b&gt;Plain caption&lt;/b&gt;&lt;script&gt;evil()&lt;/script&gt;</media:title><media:credit>&lt;b&gt;Agency&lt;/b&gt;</media:credit><media:content url="https://example.com/a.jpg?sig=one%2Btwo" type="image/jpeg"/><media:content url="https://example.com/a.jpg?sig=one%2Btwo" type="image/jpeg"/><media:thumbnail url="https://example.com/thumb"/><media:content url="https://example.com/evil.svg" type="image/svg+xml"/><media:content url="https://example.com/evil.jpg" type="text/html"/>{extras}</media:group></item></channel></rss>"#
    );
    let result = parse_feed(
        body.as_bytes(),
        &json!({"url":"https://example.com/feed","mediaAllowed":true,"storage":"excerpt"}),
    )
    .unwrap();
    let items = result["articles"][0]["media"].as_array().unwrap();
    assert_eq!(items.len(), 8);
    assert_eq!(items[0]["caption"], "Plain caption");
    assert_eq!(items[0]["credit"], "Agency");
    let urls: std::collections::HashSet<_> =
        items.iter().map(|m| m["url"].as_str().unwrap()).collect();
    assert_eq!(urls.len(), 8);
    assert!(urls.contains("https://example.com/thumb"));
    assert!(items
        .iter()
        .all(|m| crate::media::validate_media(m).is_ok()));
    assert!(!items
        .iter()
        .any(|m| m["url"].as_str().unwrap().contains("evil")
            || m["url"].as_str().unwrap().contains("never-scraped")));
}

#[test]
fn media_atom_enclosures_keep_supported_video_and_external_fallbacks() {
    let body = br#"<feed xmlns="http://www.w3.org/2005/Atom"><id>urn:f</id><title>Synthetic fixture</title><entry><id>urn:a</id><title>Video</title><link href="../story"/><link rel="enclosure" href="../clip.mp4" type="video/mp4"/><link rel="enclosure" href="https://example.com/stream.m3u8" type="application/vnd.apple.mpegurl"/><link rel="enclosure" href="https://example.com/huge.webm" type="video/webm" length="99999999"/><link rel="enclosure" href="http://example.com/clip.webm" type="video/webm"/><link rel="enclosure" href="https://127.0.0.1/private.mp4" type="video/mp4"/></entry></feed>"#;
    let result = parse_feed(body,&json!({"url":"https://example.com/feed/index.atom","mediaAllowed":true,"storage":"excerpt"})).unwrap();
    let media = result["articles"][0]["media"]
        .as_array()
        .expect("missing Atom enclosures");
    assert_eq!(media.len(), 4);
    assert_eq!(
        media[0],
        json!({"kind":"video","url":"https://example.com/clip.mp4","mimeType":"video/mp4","playback":"inline"})
    );
    assert_eq!(media[1]["playback"], "external");
    assert_eq!(media[2]["playback"], "external");
    assert_eq!(media[3]["playback"], "external");
    assert!(media
        .iter()
        .all(|m| crate::media::validate_media(m).is_ok()));
}

#[test]
fn media_rss_enclosure_extracted_only_with_explicit_permission() {
    let body = br#"<rss version="2.0"><channel><title>Synthetic fixture</title><item><title>Photo</title><link>https://example.com/story</link><enclosure url="https://example.com/image.png?sig=a%2Bb" type="image/png" length="120"/></item></channel></rss>"#;
    let source = json!({"id":"fixture","url":"https://example.com/feed","storage":"excerpt","mediaAllowed":true});
    let result = parse_feed(body, &source).unwrap();
    assert_eq!(
        result["articles"][0]["media"],
        json!([{"kind":"image","url":"https://example.com/image.png?sig=a%2Bb","mimeType":"image/png","playback":"inline"}])
    );
    for denied in [
        json!({"storage":"excerpt"}),
        json!({"storage":"excerpt","mediaAllowed":false}),
        json!({"storage":"metadata","mediaAllowed":true}),
        json!({"mediaAllowed":true}),
    ] {
        assert!(parse_feed(body, &denied).unwrap()["articles"][0]
            .get("media")
            .is_none());
    }
}
