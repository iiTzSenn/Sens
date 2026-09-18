mod fallback;
mod cli;
mod format;
mod freshness;
mod hook;
mod index;
mod json;
mod query;
mod reflective;
mod testfile;

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use std::time::Instant;

use freshness::Freshness;
use hook::HookPayload;

const CANNOT_ANSWER: i32 = 2;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("query") {
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
    let buffer = index::read_index(&root)?;
    let index = index::parse_index(&buffer)?;
    let meta = index::load_meta(&root, index.created_at)?;
    if freshness::check(&root, &index, &meta) != Freshness::Fresh {
        return None;
    }
    let engine = query::Engine::new(&index, &meta.entry_points);
    cli::run(&engine, &root, args)
}

fn answer(root: &Path, raw: &str) -> Option<String> {
    let mut t = Instant::now();
    let payload: HookPayload = serde_json::from_str(raw).ok()?;
    stage(&mut t, "parsear payload");

    if payload.hook_event_name.as_deref() == Some("SessionStart") {
        return None;
    }

    let buffer = index::read_index(root)?;
    stage(&mut t, "leer índice");
    let index = index::parse_index(&buffer)?;
    stage(&mut t, "parsear índice");
    let meta = index::load_meta(root, index.created_at)?;
    stage(&mut t, "leer meta");
    if freshness::check(root, &index, &meta) != Freshness::Fresh {
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
