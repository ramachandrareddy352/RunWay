//! Helpers to read the result of the promise a callback is chained on.
//! Callbacks must never panic on unexpected results, so these return `Option`/`bool`.

use near_sdk::{env, json_types::U128, serde_json};

const MAX_RESULT_LEN: usize = 16 * 1024;

/// Raw bytes of promise result `idx`, or `None` if it failed (or is too long).
pub fn result_bytes(idx: u64) -> Option<Vec<u8>> {
    if env::promise_results_count() <= idx {
        return None;
    }
    env::promise_result_checked(idx, MAX_RESULT_LEN).ok()
}

/// `true` if promise result `idx` succeeded (any value).
pub fn succeeded(idx: u64) -> bool {
    result_bytes(idx).is_some()
}

/// Parse promise result `idx` as a JSON `U128` (e.g. the `used` amount of `ft_transfer_call`).
pub fn result_u128(idx: u64) -> Option<u128> {
    let bytes = result_bytes(idx)?;
    serde_json::from_slice::<U128>(&bytes).ok().map(|v| v.0)
}

/// Parse promise result `idx` as a JSON bool.
pub fn result_bool(idx: u64) -> Option<bool> {
    let bytes = result_bytes(idx)?;
    serde_json::from_slice::<bool>(&bytes).ok()
}
