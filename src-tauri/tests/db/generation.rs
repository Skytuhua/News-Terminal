use super::*;

#[test]
fn generation_catches_membership_aba_and_ignores_read_save_workspace_changes() {
    let mut db = Database::memory().unwrap();
    let now = 1_800_000_000;
    let source = db.request(&json!({"op":"source_add","name":"Fixture","url":"https://example.org/feed","termsUrl":"https://example.org/terms","topics":[],"language":"en","region":"world","kind":"reporting","storage":"excerpt"}), now).unwrap();
    db.ingest(source["id"].as_str().unwrap(), &json!({"articles":[{"title":"Fixture","url":"https://example.org/story","excerpt":"text"}]}), now).unwrap();
    let snapshot = db.request(&json!({"op":"snapshot"}), now).unwrap();
    let article = &snapshot["articles"][0]["id"];
    let token = &snapshot["replacementToken"];
    let before = db.input_generation();
    for hidden in [true, false] {
        db.request(&json!({"op":"article_state","articleId":article,"hidden":hidden,"replacementToken":token}), now).unwrap();
    }
    assert_eq!(db.input_generation(), before + 2);
    let before = db.input_generation();
    db.request(&json!({"op":"article_state_many","profileId":"default","items":[{"articleId":article,"hidden":false}],"replacementToken":token}), now).unwrap();
    assert_eq!(db.input_generation(), before + 1);
    let before = db.input_generation();
    for keywords in [json!(["changed"]), json!([])] {
        db.request(
            &json!({"op":"profile_update","preferences":{"keywords":keywords}}),
            now,
        )
        .unwrap();
    }
    assert_eq!(db.input_generation(), before + 2);
    let before = db.input_generation();
    db.request(&json!({"op":"article_state","articleId":article,"read":true,"saved":true,"replacementToken":token}), now).unwrap();
    db.request(&json!({"op":"article_state_many","profileId":"default","items":[{"articleId":article,"read":false}],"replacementToken":token}), now).unwrap();
    let workspace = db
        .request(&json!({"op":"workspace_get","profileId":"default"}), now)
        .unwrap();
    db.request(&json!({"op":"workspace_save","profileId":"default","workspace":workspace,"expectedRevision":0,"replacementToken":token}), now).unwrap();
    db.request(&json!({"op":"visit"}), now).unwrap();
    assert!(db
        .request(
            &json!({"op":"profile_update","preferences":{"unknown":true}}),
            now
        )
        .is_err());
    assert_eq!(db.input_generation(), before);
}
