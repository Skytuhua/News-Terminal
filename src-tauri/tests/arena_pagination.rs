use news_terminal_lib::benchmarks::assemble_arena_pages;
use serde_json::{json, Value};
#[test]
fn arena_atomic_pages_validate_total_indexes_truncation_before_selecting_category() {
    let mut raw: Value =
        serde_json::from_str(include_str!("fixtures/metadata/arena.json")).unwrap();
    raw["num_rows_total"] = json!(2);
    let mut first = raw.clone();
    first["rows"] = json!([raw["rows"][0].clone()]);
    let mut last = raw.clone();
    last["rows"] = json!([raw["rows"][1].clone()]);
    assert_eq!(
        assemble_arena_pages(&[first.clone(), last.clone()], 1).unwrap()["totalCount"],
        2
    );
    assert!(assemble_arena_pages(&[first.clone()], 1).is_err());
    last["rows"][0]["row_idx"] = json!(0);
    assert!(assemble_arena_pages(&[first.clone(), last.clone()], 1).is_err());
    last["rows"][0]["row_idx"] = json!(1);
    last["partial"] = json!(true);
    assert!(assemble_arena_pages(&[first, last], 1).is_err());
}
