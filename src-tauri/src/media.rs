//! Explicit-action media loading; URLs and bytes are never trusted from a feed.
use serde_json::Value;

pub(crate) const IMAGE_LIMIT: usize = 5 * 1024 * 1024;
pub(crate) const VIDEO_LIMIT: usize = 32 * 1024 * 1024;

pub(crate) fn supported_kind(mime: &str) -> Option<&'static str> {
    match mime {
        "image/jpeg" | "image/png" | "image/gif" | "image/webp" => Some("image"),
        "video/mp4" | "video/webm" => Some("video"),
        _ => None,
    }
}

/// Validate one stored/imported media item. This does not confer source permission;
/// the host must look up the trusted article/source before calling load_media.
pub fn validate_media(value: &Value) -> Result<(), String> {
    let object = value.as_object().ok_or("Invalid media item")?;
    if object.keys().any(|key| {
        !matches!(
            key.as_str(),
            "kind" | "url" | "mimeType" | "caption" | "credit" | "playback"
        )
    }) {
        return Err("Unknown media field".into());
    }
    let kind = value["kind"].as_str().ok_or("Missing media kind")?;
    if !matches!(kind, "image" | "video") {
        return Err("Unsupported media kind".into());
    }
    let url = value["url"].as_str().ok_or("Missing media URL")?;
    let inline = match value["playback"].as_str() {
        Some("inline") => {
            crate::services::public_url(url)?;
            true
        }
        Some("external") => {
            crate::services::canonical_url(url)?;
            false
        }
        _ => return Err("Invalid media playback".into()),
    };
    if let Some(mime) = object.get("mimeType") {
        let mime = mime.as_str().ok_or("Invalid media MIME type")?;
        if mime.is_empty()
            || mime.len() > 120
            || !mime.bytes().all(|b| b.is_ascii_graphic())
            || !mime.contains('/')
            || (inline && supported_kind(mime) != Some(kind))
        {
            return Err("Unsupported media MIME type".into());
        }
    }
    for field in ["caption", "credit"] {
        if let Some(text) = object.get(field) {
            let text = text.as_str().ok_or("Invalid media text")?;
            if text.chars().count() > 500
                || text
                    .chars()
                    .any(|c| c.is_control() || matches!(c, '<' | '>'))
            {
                return Err("Invalid media text".into());
            }
        }
    }
    Ok(())
}

/// Explicit user action only. The host must supply a permitted, trusted stored item,
/// not a renderer-provided URL. No cookies, credentials, proxy, redirects or disk cache.
pub async fn load_media(media: &Value) -> Result<Value, String> {
    load_authorized_media(media, None).await
}
/// Explicit action only. Approval must come from Database::authorize_media.
/// Complete bounded bytes are verified BEFORE base64 reaches any decoder/webview.
pub async fn load_authorized_media(
    media: &Value,
    approval: Option<&Value>,
) -> Result<Value, String> {
    load_authorized_using(
        media,
        approval,
        async {
            let url =
                crate::services::public_url(media["url"].as_str().ok_or("Missing media URL")?)?;
            crate::services::public_client(&url)
                .await?
                .get(url)
                .header("Accept", media_accept(media))
                .header("Cache-Control", "no-store")
                .send()
                .await
                .map_err(|_| "Media connection failed or timed out".to_string())
        },
        std::time::Duration::from_secs(20),
    )
    .await
}

fn media_accept(media: &Value) -> &str {
    media["mimeType"].as_str().unwrap_or_else(|| {
        if media["kind"] == "image" {
            "image/jpeg, image/png, image/gif, image/webp"
        } else {
            "video/mp4, video/webm"
        }
    })
}

#[cfg(test)]
async fn load_using(
    media: &Value,
    request: impl std::future::Future<Output = Result<reqwest::Response, String>>,
    timeout: std::time::Duration,
) -> Result<Value, String> {
    load_authorized_using(media, None, request, timeout).await
}
async fn load_authorized_using(
    media: &Value,
    approval: Option<&Value>,
    request: impl std::future::Future<Output = Result<reqwest::Response, String>>,
    timeout: std::time::Duration,
) -> Result<Value, String> {
    validate_media(media)?;
    if let Some(a) = approval {
        if !crate::rights::compiled_media_approval(a)
            || a["url"] != media["url"]
            || a["kind"] != media["kind"]
        {
            return Err("Invalid compiled media approval".into());
        }
    }
    if media["playback"] != "inline" {
        return Err("External media must be opened on the original site".into());
    }
    tokio::time::timeout(timeout, async {
        let response = request.await?;
        if response.status() != reqwest::StatusCode::OK {
            return Err(format!("HTTP {}; media unavailable", response.status().as_u16()));
        }
        if response.headers().get_all("content-type").iter().count() != 1
            || response.headers().get_all("content-encoding").iter()
                .any(|v| v.to_str().map_or(true, |v| !v.eq_ignore_ascii_case("identity"))) {
            return Err("Invalid media response headers".into());
        }
        let mime = response.headers().get("content-type").and_then(|h| h.to_str().ok())
            .ok_or("Missing media Content-Type")?.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
        let kind = media["kind"].as_str().ok_or("Missing media kind")?;
        let pinned_binary = approval.is_some_and(|a| a["mime"] == "video/mp4" && mime == "application/octet-stream");
        if !pinned_binary && (supported_kind(&mime) != Some(kind)
            || media["mimeType"].as_str().is_some_and(|declared| declared != mime)) {
            return Err("Media Content-Type does not match permitted format".into());
        }
        let limit = if kind == "image" { IMAGE_LIMIT } else { VIDEO_LIMIT };
        let body = crate::services::bounded_body(response, limit).await?;
        let mime = if let Some(a) = approval {
            if a["bytes"].as_u64() != Some(body.len() as u64) { return Err("Approved media byte count changed".into()); }
            if let Some(expected) = a["sha256"].as_str() {
                use sha2::{Digest, Sha256};
                if expected != format!("{:x}", Sha256::digest(&body)).as_str() { return Err("Approved media SHA-256 changed".into()); }
            } else if a["integrity"].as_str() != Some("size-mime-reviewed-no-hash") {
                return Err("Approved media integrity mode is unsupported".into());
            }
            let approved_mime = a["mime"].as_str().ok_or("Missing approved MIME")?;
            if !pinned_binary && mime != approved_mime { return Err("Approved media MIME changed".into()); }
            approved_mime.to_owned()
        } else { mime };
        if !matches_magic(&mime, &body) {
            return Err("Media content does not match its MIME type".into());
        }
        let (mime, body) = if kind == "image" {
            // CPU work is separately bounded even if a caller cancels while decoding.
            static DECODERS: std::sync::LazyLock<std::sync::Arc<tokio::sync::Semaphore>> = std::sync::LazyLock::new(|| std::sync::Arc::new(tokio::sync::Semaphore::new(2)));
            let permit = DECODERS.clone().acquire_owned().await.map_err(|_| "Image decoder unavailable")?;
            let bytes = body.to_vec();
            let output = tokio::task::spawn_blocking(move || {
                let _permit = permit;
                decode_thumbnail(&mime, &bytes)
            }).await.map_err(|_| "Image decoder failed")??;
            ("image/png".to_owned(), output)
        } else { (mime, body.to_vec()) };
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&body);
        Ok(serde_json::json!({"kind":kind,"mimeType":mime,"bytes":body.len(),"dataUrl":format!("data:{mime};base64,{encoded}")}))
    }).await.map_err(|_| "Media request timed out".to_string())?
}

/// Decode only a bounded first frame; animations never enter the webview.
/// Pixel/allocation limits are checked before decode, including custom-feed images.
pub fn decode_thumbnail(mime: &str, body: &[u8]) -> Result<Vec<u8>, String> {
    use image::ImageDecoder;
    if body.len() > IMAGE_LIMIT {
        return Err("Image encoded size limit exceeded".into());
    }
    let format = match mime {
        "image/jpeg" => image::ImageFormat::Jpeg,
        "image/png" => image::ImageFormat::Png,
        "image/gif" => image::ImageFormat::Gif,
        "image/webp" => image::ImageFormat::WebP,
        _ => return Err("Unsupported image format".into()),
    };
    let mut reader = image::ImageReader::with_format(std::io::Cursor::new(body), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits.clone());
    let mut decoder = reader
        .into_decoder()
        .map_err(|_| "Invalid image header or dimensions")?;
    let (width, height) = decoder.dimensions();
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || u64::from(width) * u64::from(height) > 16_000_000
        || decoder.total_bytes() > 64 * 1024 * 1024
    {
        return Err("Image decoded/pixel limit exceeded".into());
    }
    decoder
        .set_limits(limits)
        .map_err(|_| "Image decoder limits unsupported")?;
    let decoded =
        image::DynamicImage::from_decoder(decoder).map_err(|_| "Image could not be decoded")?;
    let thumbnail = decoded
        .thumbnail(width.min(640), height.min(480))
        .to_rgba8();
    let mut output = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(thumbnail)
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|_| "Image encoding failed")?;
    let output = output.into_inner();
    if output.len() > 2 * 1024 * 1024 {
        return Err("Thumbnail encoded limit exceeded".into());
    }
    Ok(output)
}

// Conservative signatures/container headers; images also pass a full bounded decoder. The renderer may
// still reject unsupported codecs or corrupt media; it must retain original-page fallback.
fn matches_magic(mime: &str, body: &[u8]) -> bool {
    match mime {
        "image/png" => {
            body.len() >= 33
                && body.starts_with(b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR")
                && body[16..20] != [0; 4]
                && body[20..24] != [0; 4]
        }
        "image/jpeg" => {
            body.len() >= 4 && body.starts_with(b"\xff\xd8\xff") && body.ends_with(b"\xff\xd9")
        }
        "image/gif" => {
            body.len() >= 14
                && (body.starts_with(b"GIF87a") || body.starts_with(b"GIF89a"))
                && body[6..8] != [0; 2]
                && body[8..10] != [0; 2]
                && body.ends_with(b";")
        }
        "image/webp" => {
            body.len() >= 20
                && body.starts_with(b"RIFF")
                && &body[8..12] == b"WEBP"
                && matches!(&body[12..16], b"VP8 " | b"VP8L" | b"VP8X")
                && u32::from_le_bytes(body[4..8].try_into().unwrap()) as u64 + 8
                    == body.len() as u64
        }
        "video/mp4" => {
            if body.len() < 16 || &body[4..8] != b"ftyp" {
                return false;
            }
            let size = u32::from_be_bytes(body[..4].try_into().unwrap()) as usize;
            // Fail closed for extended/unknown boxes and image-only HEIF/AVIF brands.
            (16..=body.len()).contains(&size)
                && size.is_multiple_of(4)
                && matches!(
                    &body[8..12],
                    b"isom"
                        | b"iso2"
                        | b"iso3"
                        | b"iso4"
                        | b"iso5"
                        | b"iso6"
                        | b"mp41"
                        | b"mp42"
                        | b"avc1"
                        | b"M4V "
                        | b"dash"
                )
        }
        "video/webm" => {
            if body.len() < 12 || !body.starts_with(b"\x1a\x45\xdf\xa3") {
                return false;
            }
            // WebM requires EBML DocType 'webm', not just Matroska's shared magic.
            let first = body[4];
            let width = first.leading_zeros() as usize + 1;
            if width > 8 || body.len() < 4 + width {
                return false;
            }
            let mut size = (first as u64) & (0xff_u64 >> width);
            for b in &body[5..4 + width] {
                size = (size << 8) | *b as u64;
            }
            if size > 4096 || size as usize > body.len() - 4 - width {
                return false;
            }
            body[4 + width..4 + width + size as usize]
                .windows(7)
                .any(|w| w == b"\x42\x82\x84webm")
        }
        _ => false,
    }
}

#[cfg(test)]
#[path = "../tests/media/unit.rs"]
mod tests;
