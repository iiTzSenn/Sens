use std::path::PathBuf;

fn scratch(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("sens-live-{name}"));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    root
}

#[test]
#[ignore]
fn the_installed_claude_says_who_pays_for_it() {
    let version = sens_agent::account::version().expect("leer la versión de Claude Code");
    let account = sens_agent::account::read().expect("leer la cuenta de Claude Code");
    println!("{version} · {account:?}");
    assert!(version.chars().next().is_some_and(|first| first.is_ascii_digit()));
}

#[test]
#[ignore]
fn the_installed_claude_lists_every_model_it_offers() {
    let started = std::time::Instant::now();
    let cards = sens_agent::catalog::discover("claude").expect("pedir los modelos a Claude Code");
    for card in &cards {
        println!("{} · {} · {:?} · {}", card.id, card.label, card.efforts, card.latest);
    }
    println!("{} modelos en {:?}", cards.len(), started.elapsed());
    assert!(cards.len() > 4);
    assert!(cards.iter().any(|card| card.latest));
}

#[test]
#[ignore]
fn haiku_names_a_session_after_its_first_exchange() {
    use sens_agent::chat::Event;
    use sens_agent::session::{self, Entry};

    let root = scratch("title");
    let id = session::open(&root).unwrap();
    session::append(&root, &id, &Entry::Task { at: 1, text: "el login falla cuando el token caduca, mira auth.rs".into(), files: Vec::new(), images: Vec::new() }).unwrap();
    session::append(&root, &id, &Entry::Agent { at: 2, event: Event::Said { text: "El refresco se lanzaba después de validar; lo moví antes y añadí un test.".into() } }).unwrap();

    let title = sens_agent::title::suggest(&root, &id).expect("pedir el título").expect("un título");
    println!("{title}");

    assert_eq!(session::list(&root)[0].title, title);
    assert!(sens_agent::title::suggest(&root, &id).unwrap().is_none());
}
