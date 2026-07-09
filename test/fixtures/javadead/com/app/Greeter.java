package com.app;

// Same-package class used by Main WITHOUT an import — must stay alive.
public class Greeter {
    public String greet() {
        return format("hello");
    }

    // Private helper reached from greet() — alive.
    private String format(String s) {
        return s.toUpperCase();
    }

    // Private method nobody calls — a genuine dead-code candidate.
    private String unusedPrivate() {
        return "never called";
    }
}
