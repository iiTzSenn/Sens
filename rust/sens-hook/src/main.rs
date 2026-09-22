use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use std::time::Instant;

use sens_hook::freshness::{self, Freshness};
use sens_hook::hook::{self, HookPayload};
use sens_hook::{cli, daemon, engine, fallback, gate, index, indexer, json, query};

const CANNOT_ANSWER: i32 = 2;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    if args.first().map(String::as_str) == Some("daemon") {
        daemon_mode(&args[1..]);
        return;
    }

    if args.first().map(String::as_str) == Some("index") {
        match index_mode(&args[1..]) {
            Some(json) if !json.is_empty() => println!("{json}"),
            Some(_) => {}
            None => std::process::exit(CANNOT_ANSWER),
        }
        return;
    }

    if args.first().map(String::as_str) == Some("gate") {
        match gate_mode() {
            Some(json) => println!("{json}"),
            None => std::process::exit(CANNOT_ANSWER),
        }
        return;
    }

    if args.first().map(String::as_str) == Some("query") {
        if let Some(text) = try_daemon("query", args[1..].to_vec()) {
            println!("{text}");
            return;
        }
        match query_mode(&args[1..]) {
            Some(text) => println!("{text}"),
            None => std::process::exit(CANNOT_ANSWER),
        }
        return;
    }

    let mut raw = String::new();
    if std::io::stdin().read_to_string(&mut raw).is_err() || raw.trim().is_empty() {
        return;
    }

    if let Some(text) = try_daemon("hook", vec![raw.clone()]) {
        if !text.is_empty() {
            print!("{text}");
        }
        return;
    }

    let root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    match answer(&root, &raw) {
        Some(output) => {
            if !output.is_empty() {
                print!("{output}");
            }
        }
        None => delegate(&raw),
    }
}

fn stage(t: &mut Instant, label: &str) {
    if std::env::var_os("SENS_TIMING").is_some() {
        eprintln!("  {:<22} {:>4} ms", label, t.elapsed().as_millis());
    }
    *t = Instant::now();
}

fn query_mode(args: &[String]) -> Option<String> {
    let root = std::env::current_dir().ok()?;
    let (index, meta) = engine::load(&root)?;
    if freshness::check(&root, &index.files, &meta) != Freshness::Fresh {
        return None;
    }
    let engine = query::Engine::new(&index, &meta.entry_points);
    cli::run(&engine, &root, args)
}

fn gate_mode() -> Option<String> {
    let root = std::env::current_dir().ok()?;
    let mut raw = String::new();
    std::io::stdin().read_to_string(&mut raw).ok()?;

    let mut patch: gate::Patch = serde_json::from_str(&raw).ok()?;
    let outcome = gate::judge(&root, &mut patch)?;
    serde_json::to_string(&outcome).ok()
}

fn answer(root: &Path, raw: &str) -> Option<String> {
    let mut t = Instant::now();
    let payload: HookPayload = serde_json::from_str(raw).ok()?;
    stage(&mut t, "parsear payload");

    if payload.hook_event_name.as_deref() == Some("SessionStart") {
        return None;
    }

    let (index, meta) = engine::load(root)?;
    stage(&mut t, "cargar índice");
    if freshness::check(root, &index.files, &meta) != Freshness::Fresh {
        return None;
    }
    stage(&mut t, "comprobar frescura");
    let engine = query::Engine::new(&index, &meta.entry_points);
    stage(&mut t, "construir motor");
    let action = hook::decide(&engine, &root.to_string_lossy(), &payload)?;
    stage(&mut t, "consulta");

    if action.once {
        return None;
    }

    Some(hook::render(&action))
}

fn delegate(raw: &str) {
    let Some(script) = fallback::node_hook_path() else { return };
    let Ok(mut child) = Command::new("node")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::null())
        .spawn()
    else {
        return;
    };
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(raw.as_bytes());
    }
    drop(child.stdin.take());
    let _ = child.wait();
}

fn index_mode(args: &[String]) -> Option<String> {
    let root = std::env::current_dir().ok()?;
    let built = indexer::build(&root)?;
    let document = serde_json::json!({
        "schemaVersion": index::INDEX_SCHEMA_VERSION,
        "root": root.to_string_lossy(),
        "createdAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_millis() as f64,
        "files": built.files,
        "symbols": built.symbols,
        "references": built.references,
        "imports": built.imports,
    });
    if args.iter().any(|a| a == "--write") {
        let dir = index::sens_dir(&root);
        std::fs::create_dir_all(&dir).ok()?;
        let file = std::fs::File::create(dir.join("index.json")).ok()?;
        serde_json::to_writer(std::io::BufWriter::new(file), &document).ok()?;
        return Some(String::new());
    }
    Some(json::encode(&document))
}


fn daemon_mode(args: &[String]) -> bool {
    let Ok(root) = std::env::current_dir() else { return true };
    if args.iter().any(|a| a == "--stop") {
        println!("{}", if daemon::shutdown(&root) { "detenido" } else { "no estaba en marcha" });
        return true;
    }
    if args.iter().any(|a| a == "--status") {
        println!("{}", if daemon::running(&root) { "en marcha" } else { "parado" });
        return true;
    }

    let Some((index, meta)) = engine::load(&root) else { return true };
    let engine = query::Engine::new(&index, &meta.entry_points);
    let stale = std::sync::atomic::AtomicBool::new(false);

    let _ = daemon::serve(&root, &stale, |req| {
        if freshness::check(&root, &index.files, &meta) != Freshness::Fresh {
            stale.store(true, std::sync::atomic::Ordering::Relaxed);
            return None;
        }
        match req.kind.as_str() {
            "hook" => {
                let payload: hook::HookPayload = serde_json::from_str(req.args.first()?).ok()?;
                let action = hook::decide(&engine, &root.to_string_lossy(), &payload)?;
                if action.once {
                    return None;
                }
                Some(hook::render(&action))
            }
            "query" => cli::run(&engine, &root, &req.args),
            _ => None,
        }
    });
    true
}

fn try_daemon(kind: &str, args: Vec<String>) -> Option<String> {
    let root = std::env::current_dir().ok()?;
    match daemon::request(&root, &daemon::Request { kind: kind.to_string(), args }) {
        daemon::Answer::Served(text) => Some(text),
        daemon::Answer::Declined => None,
        daemon::Answer::Unreachable => {
            daemon::ensure(&root);
            None
        }
    }
}
