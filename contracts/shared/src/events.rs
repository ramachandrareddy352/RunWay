//! NEP-297 events: `EVENT_JSON:{"standard":"runway","version":"2.0.0","event":..,"data":[..]}`.

use crate::consts::{EVENT_STANDARD, EVENT_VERSION};
use near_sdk::{env, serde_json::json, serde_json::Value};

pub fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}
