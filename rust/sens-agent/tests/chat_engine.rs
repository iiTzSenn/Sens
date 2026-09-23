use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sens_agent::chat::{Decision, Engine, Event, Image, Message, Settings, Sink};
use sens_agent::session::{self, Entry};

type Heard = Arc<Mutex<Vec<Event>>>;

fn project(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("sens-chat-{name}"));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    root
}

fn engine() -> Engine {
    let fake = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join("fake-claude.mjs");
    Engine::launching(vec!["node".into(), fake.to_string_lossy().into_owned()])
}

fn ear() -> (Heard, Sink) {
    let heard: Heard = Arc::default();
    let kept = heard.clone();
    let sink: Sink = Arc::new(move |_, event| kept.lock().unwrap().push(event.clone()));
    (heard, sink)
}

fn text(said: &str) -> Message {
    Message { text: said.into(), ..Message::default() }
}

fn settings() -> Settings {
    Settings {
        model: "claude-sonnet-5".into(),
        effort: "high".into(),
        ..Settings::default()
    }
}

fn wait_for(heard: &Heard, what: impl Fn(&Event) -> bool) -> Event {
    let until = Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(found) = heard.lock().unwrap().iter().find(|event| what(event)) {
            return found.clone();
        }
        assert!(Instant::now() < until, "no llegó; oído: {:?}", heard.lock().unwrap());
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn finished(event: &Event) -> bool {
    matches!(event, Event::Finished { .. })
}

fn kinds(root: &Path, id: &str) -> Vec<String> {
    session::read(root, id)
        .iter()
        .map(|entry| match entry {
            Entry::Opened { .. } => "opened".to_string(),
            Entry::Task { .. } => "task".to_string(),
            Entry::Agent { event, .. } => serde_json::to_value(event).unwrap()["kind"].as_str().unwrap().to_string(),
        })
        .collect()
}

#[test]
fn a_turn_streams_its_text_and_writes_down_only_what_lasts() {
    let root = project("turn");
    let id = session::open(&root).unwrap();
    let engine = engine();
    let (heard, sink) = ear();

    engine.send(&root, &id, &text("hola"), settings(), sink).unwrap();
    let done = wait_for(&heard, finished);

    assert!(matches!(done, Event::Finished { ok: true, stopped: false, tokens_in: 8, tokens_out: 2, .. }));
    let deltas: Vec<Event> = heard.lock().unwrap().iter().filter(|event| matches!(event, Event::Delta { .. })).cloned().collect();
    assert_eq!(deltas.len(), 2);
    assert!(heard.lock().unwrap().contains(&Event::Said { text: "Hola".into() }));
    assert_eq!(kinds(&root, &id), vec!["opened", "task", "started", "said", "finished"]);
    assert!(!engine.busy(&id));
    engine.shutdown();
}

#[test]
fn a_permission_waits_for_the_user_and_goes_on_once_allowed() {
    let root = project("permission");
    let id = session::open(&root).unwrap();
    let engine = engine();
    let (heard, sink) = ear();

    engine.send(&root, &id, &text("pide permiso"), settings(), sink).unwrap();
    let Event::Asking { request, tool, .. } = wait_for(&heard, |event| matches!(event, Event::Asking { .. })) else { unreachable!() };
    assert_eq!(tool, "Write");
    assert!(engine.busy(&id));

    engine.answer(&id, &request, &Decision { allow: true, ..Decision::default() }).unwrap();
    wait_for(&heard, finished);

    assert!(heard.lock().unwrap().contains(&Event::Said { text: "permitido".into() }));
    assert!(kinds(&root, &id).contains(&"answered".to_string()));
    assert!(engine.answer(&id, &request, &Decision::default()).is_err());
    engine.shutdown();
}

#[test]
fn a_refused_permission_reaches_claude_as_a_refusal() {
    let root = project("refusal");
    let id = session::open(&root).unwrap();
    let engine = engine();
    let (heard, sink) = ear();

    engine.send(&root, &id, &text("pide permiso"), settings(), sink).unwrap();
    let Event::Asking { request, .. } = wait_for(&heard, |event| matches!(event, Event::Asking { .. })) else { unreachable!() };
    engine.answer(&id, &request, &Decision::default()).unwrap();
    wait_for(&heard, finished);

    assert!(heard.lock().unwrap().contains(&Event::Said { text: "rechazado".into() }));
    engine.shutdown();
}

#[test]
fn stopping_interrupts_the_turn_and_says_so() {
    let root = project("stop");
    let id = session::open(&root).unwrap();
    let engine = engine();
    let (heard, sink) = ear();

    engine.send(&root, &id, &text("lento"), settings(), sink).unwrap();
    wait_for(&heard, |event| matches!(event, Event::Delta { .. }));
    engine.stop(&id).unwrap();
    let done = wait_for(&heard, finished);

    assert!(matches!(done, Event::Finished { ok: false, stopped: true, .. }), "{done:?}");
    assert!(!engine.busy(&id));
    engine.shutdown();
}

#[test]
fn a_busy_session_refuses_a_second_message() {
    let root = project("busy");
    let id = session::open(&root).unwrap();
    let engine = engine();
    let (heard, sink) = ear();

    engine.send(&root, &id, &text("lento"), settings(), sink.clone()).unwrap();
    let refused = engine.send(&root, &id, &text("otra"), settings(), sink).unwrap_err();

    assert!(refused.contains("sigue trabajando"));
    engine.stop(&id).unwrap();
    wait_for(&heard, finished);
    engine.shutdown();
}

#[test]
fn changing_the_settings_restarts_claude_on_the_same_conversation() {
    let root = project("restart");
    let id = session::open(&root).unwrap();
    let engine = engine();
    let (heard, sink) = ear();

    engine.send(&root, &id, &text("hola"), settings(), sink.clone()).unwrap();
    wait_for(&heard, finished);
    heard.lock().unwrap().clear();

    let deeper = Settings { effort: "max".into(), ..settings() };
    engine.send(&root, &id, &text("otra vez"), deeper, sink).unwrap();
    let Event::Started { model: launched } = wait_for(&heard, |event| matches!(event, Event::Started { .. })) else { unreachable!() };
    wait_for(&heard, finished);

    assert!(launched.contains(&format!("--resume {id}")), "{launched}");
    assert!(launched.contains("--effort max"), "{launched}");
    engine.shutdown();
}

#[test]
fn the_same_settings_keep_talking_to_the_same_process() {
    let root = project("same");
    let id = session::open(&root).unwrap();
    let engine = engine();
    let (heard, sink) = ear();

    engine.send(&root, &id, &text("hola"), settings(), sink.clone()).unwrap();
    wait_for(&heard, finished);
    heard.lock().unwrap().clear();
    engine.send(&root, &id, &text("otra vez"), settings(), sink).unwrap();
    let Event::Started { model: launched } = wait_for(&heard, |event| matches!(event, Event::Started { .. })) else { unreachable!() };

    assert!(launched.contains(&format!("--session-id {id}")), "{launched}");
    wait_for(&heard, finished);
    engine.shutdown();
}

#[test]
fn each_message_is_heard_by_whoever_sent_it() {
    let root = project("listeners");
    let id = session::open(&root).unwrap();
    let engine = engine();
    let (first, first_sink) = ear();
    let (second, second_sink) = ear();

    engine.send(&root, &id, &text("hola"), settings(), first_sink).unwrap();
    wait_for(&first, finished);
    engine.send(&root, &id, &text("pide permiso"), settings(), second_sink).unwrap();
    let Event::Asking { request, .. } = wait_for(&second, |event| matches!(event, Event::Asking { .. })) else { unreachable!() };
    engine.answer(&id, &request, &Decision { allow: true, ..Decision::default() }).unwrap();
    wait_for(&second, finished);

    assert!(!first.lock().unwrap().iter().any(|event| matches!(event, Event::Asking { .. })));
    engine.shutdown();
}

#[test]
fn a_pasted_picture_reaches_claude_and_the_log_remembers_where_it_was_kept() {
    let root = project("picture");
    let id = session::open(&root).unwrap();
    let engine = engine();
    let (heard, sink) = ear();
    let picture = Image { media_type: "image/png".into(), data: "iVBORw0KGgo=".into(), kept: ".sens/artifacts/x/imagen.png".into() };
    let message = Message { images: vec![picture], ..text("¿qué es?") };

    engine.send(&root, &id, &message, settings(), sink).unwrap();
    wait_for(&heard, finished);

    assert!(heard.lock().unwrap().contains(&Event::Said { text: "vi 1 imagen image/png antes de \"¿qué es?\"".into() }));
    let kept = session::read(&root, &id).into_iter().find_map(|entry| match entry {
        Entry::Task { images, .. } => Some(images),
        _ => None,
    });
    assert_eq!(kept, Some(vec![".sens/artifacts/x/imagen.png".to_string()]));
    engine.shutdown();
}

#[test]
fn warming_a_session_first_changes_nothing_about_how_it_starts() {
    let root = project("warm");
    let id = session::fresh_id();
    let engine = engine();
    let (heard, sink) = ear();

    engine.warm(&root, &id, settings(), sink.clone()).unwrap();
    assert!(!engine.busy(&id));
    engine.warm(&root, &id, settings(), sink.clone()).unwrap();
    session::open_as(&root, &id).unwrap();
    engine.send(&root, &id, &text("hola"), settings(), sink).unwrap();
    let Event::Started { model: launched } = wait_for(&heard, |event| matches!(event, Event::Started { .. })) else { unreachable!() };
    wait_for(&heard, finished);

    assert!(launched.contains(&format!("--session-id {id}")), "{launched}");
    assert_eq!(heard.lock().unwrap().iter().filter(|event| matches!(event, Event::Started { .. })).count(), 1);
    engine.shutdown();
}

#[test]
fn claude_dying_mid_turn_is_reported_with_what_it_said() {
    let root = project("dies");
    let id = session::open(&root).unwrap();
    let engine = engine();
    let (heard, sink) = ear();

    engine.send(&root, &id, &text("muere"), settings(), sink).unwrap();
    let Event::Failed { reason } = wait_for(&heard, |event| matches!(event, Event::Failed { .. })) else { unreachable!() };

    assert!(reason.contains("se acabó la cuerda"), "{reason}");
    assert!(!engine.busy(&id));
    assert!(kinds(&root, &id).contains(&"failed".to_string()));
}
