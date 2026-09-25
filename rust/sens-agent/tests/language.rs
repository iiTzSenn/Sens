use sens_agent::language::{self, Language};
use sens_agent::said;

fn goodbye() -> String {
    said!(en: "Goodbye", es: "Adiós", fr: "Au revoir", de: "Tschüss", ja: "さようなら", zh: "再见")
}

#[test]
fn the_language_set_is_spoken_on_every_thread_until_it_changes() {
    assert_eq!(language::now(), Language::En);
    assert_eq!(goodbye(), "Goodbye");

    language::set(Language::Fr);
    assert_eq!(language::now(), Language::Fr);
    assert_eq!(std::thread::spawn(goodbye).join().unwrap(), "Au revoir");
    assert_eq!(language::speaking(Language::Ja, goodbye), "さようなら");
    assert_eq!(goodbye(), "Au revoir");

    language::set(Language::Zh);
    assert_eq!(goodbye(), "再见");
    language::set(Language::En);
    assert_eq!(goodbye(), "Goodbye");
}
