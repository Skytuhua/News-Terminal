use news_terminal_lib::db::Database;
use news_terminal_lib::media::decode_thumbnail;
use serde_json::json;

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_luma8(width, height)
        .write_to(&mut out, image::ImageFormat::Png)
        .unwrap();
    out.into_inner()
}
#[test]
fn thumbnail_bounds_encoded_dimensions_pixels_and_output() {
    assert!(decode_thumbnail("image/png", &vec![0; 5 * 1024 * 1024 + 1]).is_err());
    assert!(decode_thumbnail("image/png", &png(8193, 1)).is_err());
    assert!(decode_thumbnail("image/png", &png(4096, 4096)).is_err());
    assert!(decode_thumbnail("image/svg+xml", b"<svg/>").is_err());
    assert!(decode_thumbnail("text/html", b"<html/>").is_err());
    assert!(decode_thumbnail("image/jpeg", &png(1, 1)).is_err());
    let preview = decode_thumbnail("image/png", &png(2000, 1000)).unwrap();
    let decoded = image::load_from_memory(&preview).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (640, 320));
    assert!(preview.len() <= 2 * 1024 * 1024);
    let small =
        image::load_from_memory(&decode_thumbnail("image/png", &png(1, 1)).unwrap()).unwrap();
    assert_eq!((small.width(), small.height()), (1, 1));
}
#[test]
fn animation_becomes_only_a_static_first_frame() {
    let mut gif = Vec::new();
    {
        let mut encoder = image::codecs::gif::GifEncoder::new(&mut gif);
        encoder
            .encode_frame(image::Frame::new(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([255, 0, 0, 255]),
            )))
            .unwrap();
        encoder
            .encode_frame(image::Frame::new(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([0, 255, 0, 255]),
            )))
            .unwrap();
    }
    let preview = decode_thumbnail("image/gif", &gif).unwrap();
    assert!(preview.starts_with(b"\x89PNG"));
    assert_eq!(
        image::load_from_memory(&preview)
            .unwrap()
            .to_rgba8()
            .get_pixel(0, 0)
            .0,
        [255, 0, 0, 255]
    );
}

#[test]
fn image_consent_is_profile_scoped_host_owned_and_cleared_on_import() {
    let mut db = Database::memory().unwrap();
    let snapshot = db.request(&json!({"op":"snapshot"}), 1000).unwrap();
    let token = snapshot["replacementToken"].clone();
    assert_eq!(
        db.request(&json!({"op":"media_preferences"}), 1000)
            .unwrap()["automatic"],
        false
    );
    assert!(db
        .request(
            &json!({"op":"media_preferences_set","automatic":true,"mode":"visual"}),
            1000
        )
        .is_err());
    db.request(&json!({"op":"media_preferences_set","replacementToken":token,"automatic":true,"mode":"visual"}), 1000).unwrap();
    assert_eq!(
        db.request(&json!({"op":"media_preferences"}), 1000)
            .unwrap()["automatic"],
        true
    );
    let profile = db
        .request(&json!({"op":"profile_create","name":"Other"}), 1000)
        .unwrap();
    assert_eq!(
        db.request(
            &json!({"op":"media_preferences","profileId":profile["id"]}),
            1000
        )
        .unwrap()["automatic"],
        false
    );
    let backup = db.export().unwrap();
    db.import(&backup).unwrap();
    assert_eq!(
        db.request(&json!({"op":"media_preferences"}), 1000)
            .unwrap()["automatic"],
        false
    );
    assert!(db.request(&json!({"op":"media_preferences_set","replacementToken":token,"automatic":true,"mode":"visual"}), 1000).is_err());
}
