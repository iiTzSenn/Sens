package com.app;

// Referenced via `calc.add(...)` (obj.method invocation) — alive.
public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
}
