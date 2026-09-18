//! `sens-hook` — the PreToolUse hook as a native binary.
//!
//! Claude Code runs this once per Read/Grep/Glob the model makes. In Node that
//! costs ~80ms of process startup before any work happens, which is most of the
//! hook's latency; a native binary starts in single-digit milliseconds.
//!
//! It only owns the *read* path. Indexing stays in Node, and anything this
//! binary is not certain about — a stale index, a missing one, a payload it
//! does not recognise — is handed to the Node implementation, which can run the
//! full scan and reindex. Nothing it does can produce an answer Node would not
//! have produced; it just produces it sooner.

mod format;
mod freshness;
mod hook;
mod index;
mod query;

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use std::time::Instant;

use freshness::Freshness;
use hook::HookPayload;

fn main() {
    let mut raw = String::new();
    if std::io::stdin().read_to_string(&mut raw).is_err() || raw.trim().is_empty() {
        return; // no payload — never interfere with the tool call
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

/// Print a stage timing when SENS_TIMING is set. Costs nothing otherwise.
fn stage(t: &mut Instant, label: &str) {
    if std::env::var_os("SENS_TIMING").is_some() {
        eprintln!("  {:<22} {:>4} ms", label, t.elapsed().as_millis());
    }
    *t = Instant::now();
}

/// The hook's answer, or None when Node should handle it instead.
fn answer(root: &Path, raw: &str) -> Option<String> {
    let mut t = Instant::now();
    let payload: HookPayload = serde_json::from_str(raw).ok()?;
    stage(&mut t, "parsear payload");

    // SessionStart injects the project's working rules, which live in config
    // and rule files this binary does not read. Node owns it.
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

    let engine = query::Engine::new(&index);
    stage(&mut t, "construir motor");
    let action = hook::decide(&engine, &root.to_string_lossy(), &payload)?;
    stage(&mut t, "consulta");

    // A once-per-session reminder needs the marker file Node writes; rather
    // than duplicate that bookkeeping, hand those back. They are the cheap
    // cases anyway — no index lookup produced them.
    if action.once {
        return None;
    }

    Some(hook::render(&action))
}

/// Hand the payload to the Node implementation and pass its answer through.
///
/// The path comes from SENS_NODE_HOOK (written by `sens init`), because a
/// native binary installed from its own platform package cannot assume where
/// the JavaScript half lives. Without it we stay silent, which is what the hook
/// does on any failure: the tool call proceeds untouched.
fn delegate(raw: &str) {
    let Ok(script) = std::env::var("SENS_NODE_HOOK") else { return };
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
