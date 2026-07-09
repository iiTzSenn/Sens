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

    // Called on an instance (`w.value()`) -> ALIVE.
    pub fn value(&self) -> i32 {
        self.v
    }

    // Never called -> LOW (a method: dynamic dispatch might still reach it).
    fn secret(&self) -> i32 {
        42
    }
}

impl Speak for Widget {
    // Reached only through the `Speak` bound in `greet` -> ALIVE (trait method).
    fn speak(&self) -> i32 {
        self.v
    }
}

// Invokes the trait method via a generic bound.
pub fn greet<T: Speak>(t: &T) -> i32 {
    t.speak()
}
