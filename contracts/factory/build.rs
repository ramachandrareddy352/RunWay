// The factory embeds the settlement wasm with include_bytes!. Fail early with a clear message
// instead of a confusing "file not found" when it has not been built yet.
use std::path::Path;

fn main() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let rel = if std::env::var("CARGO_FEATURE_TEST_HOOKS").is_ok() {
        "../../res/test/runway_settlement.wasm"
    } else {
        "../../res/runway_settlement.wasm"
    };
    let path = Path::new(&manifest).join(rel);
    println!("cargo:rerun-if-changed={}", path.display());
    if !path.exists() {
        panic!(
            "missing {}: build the settlement contract first (bash scripts/build-contracts.sh)",
            path.display()
        );
    }
}
