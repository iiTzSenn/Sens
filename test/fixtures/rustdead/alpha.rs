// `run` is called from main; it uses the module-private `helper`.
pub fn run() -> i32 {
    helper()
}

// Private, but reached from `run` -> ALIVE (not a candidate). Same name as
// `beta::helper`; import-scoping must not let this use keep the twin alive.
fn helper() -> i32 {
    1
}

// Reached only through `worker`'s `use crate::alpha::via_use` + call -> ALIVE.
pub fn via_use() -> i32 {
    2
}
