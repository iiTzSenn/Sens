mod fallback;
mod binindex;
mod cli;
mod format;
mod freshness;
mod hook;
mod index;
mod indexer;
mod json;
mod lang;
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

    if args.first().map(String::as_str) == Some("index") {
        match index_mode(&args[1..]) {
            Some(json) if !json.is_empty() => println!("{json}"),
            Some(_) => {}
            None => std::process::exit(CANNOT_ANSWER),
        }
        return;
    }

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
    let (index, meta) = load_engine_index(&root)?;
    if freshness::check(&root, &index.files, &meta) != Freshness::Fresh {
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

    let (index, meta) = load_engine_index(root)?;
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

fn load_engine_index(root: &Path) -> Option<(binindex::BinIndex, index::IndexMeta)> {
    let json_path = index::sens_dir(root).join("index.json");
    let json_len = std::fs::metadata(&json_path).ok()?.len();

    let use_cache = std::env::var_os("SENS_NO_BINCACHE").is_none();
    if let Some(cached) = use_cache.then(|| binindex::load(root, json_len)).flatten() {
        let meta = index::load_meta(root, cached.created_at)?;
        return Some((cached, meta));
    }

    let buffer = std::fs::read(&json_path).ok()?;
    let built = binindex::from_json(&buffer)?;
    if built.schema_version != index::INDEX_SCHEMA_VERSION {
        return None;
    }
    let meta = index::load_meta(root, built.created_at)?;
    if use_cache {
        binindex::save(root, &built);
    }
    Some((built, meta))
}
