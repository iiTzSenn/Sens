pub struct Widget {
    v: i32,
}

pub trait Speak {
    fn speak(&self) -> i32;
}

impl Widget {
    pub fn new(v: i32) -> Self {
        Widget { v }
    }

    pub fn value(&self) -> i32 {
        self.v
    }

    fn secret(&self) -> i32 {
        42
    }
}

impl Speak for Widget {

    fn speak(&self) -> i32 {
        self.v
    }
}

pub fn greet<T: Speak>(t: &T) -> i32 {
    t.speak()
}
