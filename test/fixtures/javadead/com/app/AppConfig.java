package com.app;

@Configuration
public class AppConfig {
    @Bean
    public Greeter greeterBean() {
        return new Greeter();
    }

    @EventListener
    public void onEvent() {
        System.out.println("event");
    }
}
