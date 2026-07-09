mod alpha;
mod beta;
mod widgets;
mod worker;

fn main() {
    // cross-module calls via qualified paths keep these modules' items alive
    alpha::run();
    beta::run();

    let w = widgets::Widget::new(3);
    let _ = w.value();
    let _ = widgets::greet(&w);

    worker::work();
}

// internal, never referenced -> HIGH
fn private_unused() {}

// exported but never used in-project -> LOW (could be public API)
pub fn public_unused() {}

// FFI export: a live entry point even though nothing in-crate calls it
#[no_mangle]
pub extern "C" fn ffi_entry() {}

#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {
        assert_eq!(2 + 2, 4);
    }
}
