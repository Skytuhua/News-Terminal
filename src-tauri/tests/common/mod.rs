use news_terminal_lib::Backend;
use serde_json::{json, Value};

pub fn current_settings(host: &Backend, mut request: Value) -> Value {
    if request.get("replacementToken").is_none() {
        request["replacementToken"] = host
            .database()
            .unwrap()
            .request(&json!({"op":"workspace_get","profileId":"default"}), 0)
            .unwrap()["replacementToken"]
            .clone();
    }
    request
}
