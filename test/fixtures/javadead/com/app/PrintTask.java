package com.app;

// run() is called through the Runnable interface (task.run()) — the @Override
// method must not be flagged as dead.
public class PrintTask implements Runnable {
    @Override
    public void run() {
        System.out.println("running");
    }
}
