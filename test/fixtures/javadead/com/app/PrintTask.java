package com.app;

public class PrintTask implements Runnable {
    @Override
    public void run() {
        System.out.println("running");
    }
}
