package com.app;

public class Greeter {
    public String greet() {
        return format("hello");
    }

    private String format(String s) {
        return s.toUpperCase();
    }

    private String unusedPrivate() {
        return "never called";
    }
}
