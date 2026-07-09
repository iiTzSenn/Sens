package com.app;

// @Configuration class + @Bean/@EventListener methods are all invoked
// reflectively by the framework — none must be flagged as dead.
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
