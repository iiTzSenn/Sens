// `run` is called from main -> ALIVE.
pub fn run() {}

// Private and never called from anywhere beta can see. Same name as
// `alpha::helper` (which IS used) — name-only matching would wrongly keep this
// alive; import-scoping sees it is dead -> HIGH.
fn helper() -> i32 {
    0
}
