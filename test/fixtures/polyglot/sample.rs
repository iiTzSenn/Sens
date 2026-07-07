use std::fmt;

const MAX: i32 = 10;

pub struct User {
    name: String,
}

impl User {
    pub fn rename(&self, n: String) {}
}

pub fn greet(name: &str) -> String {
    String::from(name)
}
