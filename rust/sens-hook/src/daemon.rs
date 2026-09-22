use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use interprocess::local_socket::traits::{Listener, Stream as StreamTrait};
use interprocess::local_socket::{GenericNamespaced, ListenerOptions, Stream, ToNsName};
use serde::{Deserialize, Serialize};

use crate::index::VERSION_TAG;

const IDLE_TIMEOUT: Duration = Duration::from_secs(600);
const SPAWN_COOLDOWN: Duration = Duration::from_secs(10);

#[derive(Serialize, Deserialize)]
pub struct Request {
    pub kind: String,
    pub args: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct Response {
    pub ok: bool,
    pub text: String,
}

fn key(root: &Path) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in root.to_string_lossy().to_lowercase().bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("sens-{VERSION_TAG}-{hash:016x}.sock")
}

fn disabled() -> bool {
    matches!(std::env::var("SENS_NO_DAEMON").as_deref(), Ok("1") | Ok("true"))
}

fn marker(root: &Path) -> PathBuf {
    std::env::temp_dir().join(format!("{}.spawn", key(root)))
}

pub enum Answer {
    Served(String),
    Declined,
    Unreachable,
}

pub fn request(root: &Path, req: &Request) -> Answer {
    if disabled() {
        return Answer::Unreachable;
    }
    let Ok(name) = key(root).to_ns_name::<GenericNamespaced>() else { return Answer::Unreachable };
    let Ok(stream) = Stream::connect(name) else { return Answer::Unreachable };
    let mut writer = &stream;
    let Ok(encoded) = serde_json::to_string(req) else { return Answer::Unreachable };
    if writeln!(writer, "{encoded}").is_err() || writer.flush().is_err() {
        return Answer::Unreachable;
    }

    let mut line = String::new();
    if BufReader::new(&stream).read_line(&mut line).is_err() {
        return Answer::Unreachable;
    }
    match serde_json::from_str::<Response>(line.trim()) {
        Ok(r) if r.ok => Answer::Served(r.text),
        Ok(_) => Answer::Declined,
        Err(_) => Answer::Unreachable,
    }
}

pub fn ensure(root: &Path) {
    if disabled() || spawned_recently(root) {
        return;
    }
    let Ok(exe) = std::env::current_exe() else { return };
    let _ = std::fs::write(marker(root), b"1");

    let mut command = std::process::Command::new(exe);
    command
        .arg("daemon")
        .arg("--serve")
        .current_dir(root)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    detach(&mut command);
    let _ = command.spawn();
}

#[cfg(windows)]
fn detach(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn detach(_command: &mut std::process::Command) {}

fn spawned_recently(root: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(marker(root)) else { return false };
    let Ok(modified) = meta.modified() else { return false };
    SystemTime::now().duration_since(modified).is_ok_and(|age| age < SPAWN_COOLDOWN)
}

pub fn running(root: &Path) -> bool {
    let Ok(name) = key(root).to_ns_name::<GenericNamespaced>() else { return false };
    Stream::connect(name).is_ok()
}

pub fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

static LAST_SEEN: AtomicU64 = AtomicU64::new(0);

pub fn serve(
    root: &Path,
    stale: &std::sync::atomic::AtomicBool,
    handle: impl Fn(&Request) -> Option<String>,
) -> Option<()> {
    let name = key(root).to_ns_name::<GenericNamespaced>().ok()?;
    let listener = ListenerOptions::new().name(name).create_sync().ok()?;
    let started = Instant::now();
    LAST_SEEN.store(0, Ordering::Relaxed);

    loop {
        let incoming = listener.accept();
        if started.elapsed() > IDLE_TIMEOUT
            && started.elapsed().as_secs() - LAST_SEEN.load(Ordering::Relaxed) > IDLE_TIMEOUT.as_secs()
        {
            break;
        }
        let Ok(stream) = incoming else { continue };
        LAST_SEEN.store(started.elapsed().as_secs(), Ordering::Relaxed);

        let mut line = String::new();
        if BufReader::new(&stream).read_line(&mut line).is_err() {
            continue;
        }
        let response = match serde_json::from_str::<Request>(line.trim()) {
            Ok(req) if req.kind == "shutdown" => {
                let _ = respond(&stream, &Response { ok: true, text: String::new() });
                break;
            }
            Ok(req) => match handle(&req) {
                Some(text) => Response { ok: true, text },
                None => Response { ok: false, text: String::new() },
            },
            Err(_) => Response { ok: false, text: String::new() },
        };
        let _ = respond(&stream, &response);
        if stale.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
    }
    Some(())
}

fn respond(stream: &Stream, response: &Response) -> std::io::Result<()> {
    let mut writer = stream;
    writeln!(writer, "{}", serde_json::to_string(response).unwrap_or_default())?;
    writer.flush()
}

pub fn shutdown(root: &Path) -> bool {
    matches!(
        request(root, &Request { kind: "shutdown".into(), args: Vec::new() }),
        Answer::Served(_)
    )
}
