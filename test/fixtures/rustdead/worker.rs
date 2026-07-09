use crate::alpha::via_use;

// Uses a cross-module function via `use` + unqualified call.
pub fn work() -> i32 {
    via_use()
}
