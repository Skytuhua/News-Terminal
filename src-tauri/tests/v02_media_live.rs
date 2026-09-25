//! Opt-in verification against fixed NASA assets, not synthetic MP4 headers.
//! Reproduce the complete loader + Chromium decode/playback check with:
//! `python scripts/v02-media-probe.py` from the repository root.
//! This exercises production media::load_media, not the host's source-policy gate.
use base64::Engine;
use news_terminal_lib::media;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const VIDEO: &str = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004709/orbit_720p30.mp4";
const IMAGE: &str = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004709/orbit.0175_print.jpg";
const CREDIT: &str = "NASA's Scientific Visualization Studio";

async fn load(kind: &str, mime: &str, url: &str) -> (Value, Vec<u8>) {
    let result = media::load_media(&json!({
        "kind": kind, "url": url, "mimeType": mime,
        "caption": "The Moon's Rotation", "credit": CREDIT, "playback": "inline"
    }))
    .await
    .expect("fixed NASA asset must pass the unchanged production loader");
    assert_eq!(result["kind"], kind);
    assert_eq!(result["mimeType"], mime);
    let prefix = format!("data:{mime};base64,");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(
            result["dataUrl"]
                .as_str()
                .unwrap()
                .strip_prefix(&prefix)
                .unwrap(),
        )
        .expect("decode the actual production data URL, not a replacement download");
    assert_eq!(result["bytes"].as_u64().unwrap(), bytes.len() as u64);
    (
        json!({"url": url, "kind": kind, "mimeType": mime, "bytes": bytes.len(),
        "sha256": format!("{:x}", Sha256::digest(&bytes)), "credit": CREDIT}),
        bytes,
    )
}

#[tokio::test]
#[ignore = "live NASA network; run scripts/v02-media-probe.py explicitly"]
async fn nasa_video_and_image_pass_production_loader() {
    assert_eq!(
        std::env::var("NEWS_TERMINAL_MEDIA_LIVE").as_deref(),
        Ok("1"),
        "explicit opt-in required; no arbitrary URL override is supported"
    );
    let (video, bytes) = load("video", "video/mp4", VIDEO).await;
    assert!(bytes.len() > 100_000 && bytes.len() <= 32 * 1024 * 1024);
    assert!(bytes.windows(4).any(|w| w == b"moov"));
    assert!(bytes.windows(4).any(|w| w == b"mdat"));
    // Full decoding and playback are asserted by the probe, not inferred here.
    let output =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.hermes/backups/v02-video.mp4");
    std::fs::create_dir_all(output.parent().unwrap()).unwrap();
    std::fs::write(&output, &bytes).unwrap();
    let (image, image_bytes) = load("image", "image/jpeg", IMAGE).await;
    assert!(image_bytes.len() > 1_000 && image_bytes.len() <= 5 * 1024 * 1024);
    println!(
        "V02_MEDIA_LIVE={}",
        json!({"video":video, "image":image,
        "videoArtifact":".hermes/backups/v02-video.mp4",
        "artifactOrigin":"decoded bytes of production media::load_media dataUrl"})
    );
}
