package com.app;

// Registered only via a Spring stereotype annotation — nothing constructs it in
// project, yet the container instantiates it. Must NOT be flagged (entry).
@Service
public class NotificationService {
    public void sendNotification(String msg) {
        System.out.println(msg);
    }
}
