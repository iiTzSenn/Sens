mod alpha;
mod beta;
mod widgets;
mod worker;

fn main() {

    alpha::run();
    beta::run();

    let w = widgets::Widget::new(3);
    let _ = w.value();
    let _ = widgets::greet(&w);

    worker::work();
}

fn private_unused() {}

pub fn public_unused() {}

#[no_mangle]
pub extern "C" fn ffi_entry() {}

#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {
        assert_eq!(2 + 2, 4);
    }
}
