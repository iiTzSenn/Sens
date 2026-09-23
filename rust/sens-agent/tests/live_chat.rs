use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sens_agent::chat::{Decision, Engine, Event, Image, Message, Settings, Sink};
use sens_agent::session;

type Heard = Arc<Mutex<Vec<Event>>>;

struct Turn {
    said: String,
    asked_for: Vec<String>,
}

fn project() -> PathBuf {
    let root = std::env::temp_dir().join("sens-live-chat");
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("a.txt"), "la clave es 4217\n").unwrap();
    root
}

fn ear() -> (Heard, Sink) {
    let heard: Heard = Arc::default();
    let kept = heard.clone();
    let sink: Sink = Arc::new(move |_, event| {
        if !matches!(event, Event::Delta { .. }) {
            println!("{}", serde_json::to_string(event).unwrap().chars().take(220).collect::<String>());
        }
        kept.lock().unwrap().push(event.clone());
    });
    (heard, sink)
}

fn words(text: &str) -> Message {
    Message { text: text.into(), ..Message::default() }
}

fn turn(engine: &Engine, root: &Path, id: &str, message: &Message, settings: &Settings) -> Turn {
    let (heard, sink) = ear();
    engine.send(root, id, message, settings.clone(), sink).unwrap();

    let until = Instant::now() + Duration::from_secs(180);
    let mut answered = HashSet::new();
    let mut asked_for = Vec::new();
    loop {
        let events = heard.lock().unwrap().clone();
        for event in &events {
            match event {
                Event::Failed { reason } => panic!("Claude Code falló: {reason}"),
                Event::Asking { request, tool, .. } if answered.insert(request.clone()) => {
                    asked_for.push(tool.clone());
                    engine.answer(id, request, &Decision { allow: true, ..Decision::default() }).unwrap();
                }
                _ => {}
            }
        }
        if let Some(Event::Finished { ok, error, .. }) = events.iter().find(|event| matches!(event, Event::Finished { .. })) {
            assert!(ok, "el turno terminó mal: {error}");
            break;
        }
        assert!(Instant::now() < until, "Claude Code no respondió a tiempo");
        std::thread::sleep(Duration::from_millis(100));
    }

    let said = heard
        .lock()
        .unwrap()
        .iter()
        .filter_map(|event| match event {
            Event::Said { text } => Some(text.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    Turn { said, asked_for }
}

#[test]
#[ignore]
fn a_real_claude_code_reads_asks_writes_and_remembers_across_a_restart() {
    let root = project();
    let id = session::open(&root).unwrap();
    let engine = Engine::default();
    let settings = Settings {
        model: "claude-sonnet-5".into(),
        effort: "low".into(),
        ..Settings::default()
    };

    let first = turn(&engine, &root, &id, &words("Lee a.txt y responde solo con la clave."), &settings);
    assert!(first.said.contains("4217"), "{}", first.said);

    let second = turn(&engine, &root, &id, &words("Crea el fichero b.txt con el texto hola usando la herramienta Write."), &settings);
    assert!(second.asked_for.iter().any(|tool| tool == "Write"), "{:?}", second.asked_for);
    assert_eq!(std::fs::read_to_string(root.join("b.txt")).unwrap().trim(), "hola");

    let deeper = Settings { effort: "medium".into(), ..settings };
    let third = turn(&engine, &root, &id, &words("¿Qué clave leíste al principio? Responde solo el número."), &deeper);
    assert!(third.said.contains("4217"), "{}", third.said);

    engine.shutdown();
}

const RED_SQUARE: &str = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACLSURBVHhe7dAhAQBADIDAJVn/UN9l76kA4gySebtnNgw2DWCwaQCDTQMYbBrAYNMABpsGMNg0gMGmAQw2DWCwaQCDTQMYbBrAYNMABpsGMNg0gMGmAQw2DWCwaQCDTQMYbBrAYNMABpsGMNg0gMGmAQw2DWCwaQCDTQMYbBrAYNMABpsGMNg0gMHmA+xncfBUukEyAAAAAElFTkSuQmCC";

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join(name)
}

#[test]
#[ignore]
fn a_real_claude_code_sees_pictures_and_loads_the_skills_and_servers_sens_adds() {
    let root = project();
    let config = root.join("mcp.json");
    let servers = serde_json::json!({ "mcpServers": { "eco": {
        "type": "stdio",
        "command": "node",
        "args": [fixture("eco-mcp.mjs").to_string_lossy()],
        "env": {}
    }}});
    std::fs::write(&config, servers.to_string()).unwrap();

    let id = session::open(&root).unwrap();
    let engine = Engine::default();
    let settings = Settings {
        model: "claude-sonnet-5".into(),
        effort: "low".into(),
        extra: vec![
            "--plugin-dir".into(),
            fixture("plugin").to_string_lossy().into_owned(),
            "--mcp-config".into(),
            config.to_string_lossy().into_owned(),
        ],
        ..Settings::default()
    };

    let picture = Image { media_type: "image/png".into(), data: RED_SQUARE.into(), kept: String::new() };
    let seen = turn(
        &engine,
        &root,
        &id,
        &Message { images: vec![picture], ..words("¿De qué color es esta imagen? Responde con una palabra.") },
        &settings,
    );
    assert!(seen.said.to_lowercase().contains("rojo"), "{}", seen.said);

    let greeted = turn(&engine, &root, &id, &words("Dime el saludo secreto de Sens."), &settings);
    assert!(greeted.said.contains("la cuchilla corta en S"), "{}", greeted.said);

    let echoed = turn(&engine, &root, &id, &words("Usa la herramienta eco con el texto 'hola sens' y dime qué devolvió."), &settings);
    assert!(echoed.asked_for.iter().any(|tool| tool == "mcp__eco__eco"), "{:?}", echoed.asked_for);
    assert!(echoed.said.contains("snes aloh"), "{}", echoed.said);

    engine.shutdown();
}
