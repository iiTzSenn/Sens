package com.app;

import com.app.util.StringUtil;

public class Main {
    public static void main(String[] args) {
        Greeter greeter = new Greeter();
        System.out.println(greeter.greet());

        Calculator calc = new Calculator();
        System.out.println(calc.add(2, 3));

        Runnable task = new PrintTask();
        task.run();

        System.out.println(StringUtil.shout("hi"));
    }
}
