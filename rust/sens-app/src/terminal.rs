use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use sens_agent::process::Family;
use serde::Serialize;

const CHUNK: usize = 16 * 1024;
const BROKEN: &str = "el registro de terminales se rompió";
const GONE: &str = "esa terminal ya se cerró";
const ENDING: Duration = Duration::from_secs(3);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Heard {
    Out { id: u32, data: String },
    Ended { id: u32, code: Option<u32> },
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Opened {
    id: u32,
    shell: String,
}

type Input = Arc<Mutex<Box<dyn Write + Send>>>;

struct Console {
    cwd: PathBuf,
    master: Box<dyn MasterPty + Send>,
    input: Input,
    killer: Box<dyn ChildKiller + Send + Sync>,
    family: Option<Family>,
}

impl Console {
    fn end(&mut self) {
        match &self.family {
            Some(family) => family.end(),
            None => {
                let _ = self.killer.kill();
            }
        }
    }
}

#[derive(Default)]
pub struct Consoles {
    open: Arc<Mutex<HashMap<u32, Console>>>,
    made: AtomicU32,
}

impl Consoles {
    pub fn open(&self, root: &Path, cols: u16, rows: u16, tell: impl Fn(Heard) + Send + 'static) -> Result<Opened, String> {
        let pair = native_pty_system().openpty(size(cols, rows)).map_err(failed)?;
        let cwd = folder(root);
        let (command, shell) = shell(&cwd);
        let mut child = pair.slave.spawn_command(command).map_err(failed)?;
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().map_err(failed)?;
        let writer = pair.master.take_writer().map_err(failed)?;

        let id = self.made.fetch_add(1, Ordering::SeqCst) + 1;
        let console = Console {
            cwd,
            master: pair.master,
            input: Arc::new(Mutex::new(writer)),
            killer: child.clone_killer(),
            family: family(child.as_ref()),
        };
        self.open.lock().map_err(|_| BROKEN)?.insert(id, console);

        let (ended, code) = mpsc::channel();
        let open = self.open.clone();
        thread::spawn(move || {
            let status = child.wait().ok().map(|status| status.exit_code());
            let gone = open.lock().ok().and_then(|mut open| open.remove(&id));
            drop(gone);
            let _ = ended.send(status);
        });
        thread::spawn(move || relay(id, reader, code, tell));
        Ok(Opened { id, shell })
    }

    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let input = self.open.lock().map_err(|_| BROKEN)?.get(&id).ok_or(GONE)?.input.clone();
        let mut input = input.lock().map_err(|_| BROKEN)?;
        input
            .write_all(data.as_bytes())
            .and_then(|()| input.flush())
            .map_err(|error| format!("la terminal no acepta lo que escribes: {error}"))
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let open = self.open.lock().map_err(|_| BROKEN)?;
        let console = open.get(&id).ok_or(GONE)?;
        console
            .master
            .resize(size(cols, rows))
            .map_err(|error| format!("no pude ajustar la terminal: {error}"))
    }

    pub fn close(&self, id: u32) -> Result<(), String> {
        if let Some(console) = self.open.lock().map_err(|_| BROKEN)?.get_mut(&id) {
            console.end();
        }
        Ok(())
    }

    pub fn close_within(&self, folder: &Path) {
        let closing: Vec<u32> = match self.open.lock() {
            Ok(mut open) => open
                .iter_mut()
                .filter(|(_, console)| console.cwd.starts_with(folder))
                .map(|(id, console)| {
                    console.end();
                    *id
                })
                .collect(),
            Err(_) => return,
        };
        let until = Instant::now() + ENDING;
        while Instant::now() < until && self.open.lock().is_ok_and(|open| closing.iter().any(|id| open.contains_key(id))) {
            thread::sleep(Duration::from_millis(50));
        }
    }

    pub fn shutdown(&self) {
        if let Ok(mut open) = self.open.lock() {
            for (_, mut console) in open.drain() {
                console.end();
            }
        }
    }
}

fn failed(error: impl std::fmt::Display) -> String {
    format!("no pude abrir la terminal: {error}")
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.max(2),
        rows: rows.max(1),
        ..PtySize::default()
    }
}

fn shell(cwd: &Path) -> (CommandBuilder, String) {
    let program = program();
    let name = program
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut command = CommandBuilder::new(&program);
    if cfg!(windows) {
        command.arg("-NoLogo");
    } else {
        command.arg("-l");
        command.env("TERM", "xterm-256color");
    }
    command.env("COLORTERM", "truecolor");
    command.cwd(cwd);
    (command, name)
}

fn program() -> PathBuf {
    if cfg!(windows) {
        return on_path("pwsh.exe").unwrap_or_else(|| PathBuf::from("powershell.exe"));
    }
    std::env::var_os("SHELL")
        .filter(|shell| !shell.is_empty())
        .map_or_else(|| PathBuf::from("/bin/sh"), PathBuf::from)
}

fn on_path(name: &str) -> Option<PathBuf> {
    let listed = std::env::var_os("PATH")?;
    std::env::split_paths(&listed)
        .map(|folder| folder.join(name))
        .find(|candidate| candidate.is_absolute() && candidate.is_file())
}

fn folder(root: &Path) -> PathBuf {
    if root.is_dir() {
        return root.to_path_buf();
    }
    std::env::home_dir().unwrap_or_else(std::env::temp_dir)
}

#[cfg(windows)]
fn family(child: &(dyn portable_pty::Child + Send + Sync)) -> Option<Family> {
    child.as_raw_handle().map(Family::of)
}

#[cfg(not(windows))]
fn family(_child: &(dyn portable_pty::Child + Send + Sync)) -> Option<Family> {
    None
}

fn relay(id: u32, mut reader: Box<dyn Read + Send>, code: mpsc::Receiver<Option<u32>>, tell: impl Fn(Heard)) {
    let mut buffer = vec![0; CHUNK];
    let mut pending = Vec::new();
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                pending.extend_from_slice(&buffer[..read]);
                let data = whole(&mut pending);
                if !data.is_empty() {
                    tell(Heard::Out { id, data });
                }
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    if !pending.is_empty() {
        tell(Heard::Out { id, data: String::from_utf8_lossy(&pending).into_owned() });
    }
    tell(Heard::Ended { id, code: code.recv().ok().flatten() });
}

fn whole(pending: &mut Vec<u8>) -> String {
    let rest = pending.split_off(complete(pending));
    let text = String::from_utf8_lossy(pending).into_owned();
    *pending = rest;
    text
}

fn complete(bytes: &[u8]) -> usize {
    let length = bytes.len();
    for back in 1..=length.min(3) {
        let byte = bytes[length - back];
        if byte & 0xC0 == 0x80 {
            continue;
        }
        let needs = match byte {
            0xC0..=0xDF => 2,
            0xE0..=0xEF => 3,
            0xF0..=0xF7 => 4,
            _ => 1,
        };
        return if needs > back { length - back } else { length };
    }
    length
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    const ASKS_WHERE: &str = "\x1b[6n";

    #[test]
    fn a_character_cut_in_half_waits_for_its_other_half() {
        assert_eq!(complete(b"ls\r\n"), 4);
        assert_eq!(complete(&[b'a', 0xC3]), 1);
        assert_eq!(complete(&[b'a', 0xC3, 0xA9]), 3);
        assert_eq!(complete(&[0xE2, 0x82]), 0);
        assert_eq!(complete(&[b'x', 0xE2, 0x82, 0xAC]), 4);
        assert_eq!(complete(&[0xF0, 0x9F, 0x98]), 0);
        assert_eq!(complete(&[0x80, 0x80, 0x80, 0x80]), 4);
        assert_eq!(complete(&[]), 0);
    }

    #[test]
    fn what_is_read_goes_out_whole_and_the_rest_waits() {
        let mut pending = vec![b'o', b'k', 0xE2, 0x82];
        assert_eq!(whole(&mut pending), "ok");
        assert_eq!(pending, vec![0xE2, 0x82]);
        pending.push(0xAC);
        assert_eq!(whole(&mut pending), "€");
        assert!(pending.is_empty());
    }

    #[test]
    fn a_size_never_reaches_zero() {
        let tiny = size(0, 0);
        assert_eq!((tiny.cols, tiny.rows), (2, 1));
        let fair = size(120, 30);
        assert_eq!((fair.cols, fair.rows), (120, 30));
    }

    #[test]
    fn a_folder_that_is_not_there_opens_at_home() {
        let here = std::env::temp_dir();
        assert_eq!(folder(&here), here);
        assert_ne!(folder(Path::new("Z:/sens/no-such-folder")), PathBuf::from("Z:/sens/no-such-folder"));
    }

    #[test]
    fn the_events_read_as_the_interface_expects() {
        let out = serde_json::to_value(Heard::Out { id: 3, data: "hola".into() }).unwrap();
        assert_eq!(out, serde_json::json!({ "kind": "out", "id": 3, "data": "hola" }));
        let ended = serde_json::to_value(Heard::Ended { id: 3, code: Some(0) }).unwrap();
        assert_eq!(ended, serde_json::json!({ "kind": "ended", "id": 3, "code": 0 }));
    }

    fn heard_until(heard: &mpsc::Receiver<Heard>, done: impl Fn(&[Heard]) -> bool) -> Vec<Heard> {
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut all = Vec::new();
        while !done(&all) && Instant::now() < deadline {
            if let Ok(one) = heard.recv_timeout(Duration::from_millis(200)) {
                all.push(one);
            }
        }
        all
    }

    fn said(all: &[Heard]) -> String {
        all.iter()
            .filter_map(|one| match one {
                Heard::Out { data, .. } => Some(data.as_str()),
                Heard::Ended { .. } => None,
            })
            .collect()
    }

    fn ended(all: &[Heard]) -> bool {
        all.iter().any(|one| matches!(one, Heard::Ended { .. }))
    }

    #[test]
    #[ignore = "opens a real shell"]
    fn closing_a_folder_ends_the_shells_started_in_it_and_no_other() {
        let base = std::env::temp_dir().join("sens-terminal-within");
        let inside = base.join("worktree");
        std::fs::create_dir_all(&inside).unwrap();
        let consoles = Consoles::default();
        let (tell, heard) = mpsc::channel();
        let answer = move |one| {
            let _ = tell.send(one);
        };
        let within = consoles.open(&inside, 80, 24, answer.clone()).unwrap();
        let outside = consoles.open(&std::env::temp_dir(), 80, 24, answer).unwrap();

        consoles.close_within(&base);

        assert_eq!(consoles.write(within.id, "x"), Err(GONE.to_string()));
        if cfg!(windows) {
            let asked = heard_until(&heard, |all| said(all).contains(ASKS_WHERE));
            assert!(!asked.is_empty());
            consoles.write(outside.id, "\x1b[1;1R").unwrap();
        }
        assert!(consoles.write(outside.id, "\r").is_ok());
        consoles.shutdown();
    }

    #[test]
    #[ignore = "opens a real shell"]
    fn a_shell_answers_and_ends_when_closed() {
        let consoles = Consoles::default();
        let (tell, heard) = mpsc::channel();
        let opened = consoles
            .open(&std::env::temp_dir(), 80, 24, move |one| {
                let _ = tell.send(one);
            })
            .unwrap();
        consoles.resize(opened.id, 100, 30).unwrap();
        let mut all = Vec::new();
        if cfg!(windows) {
            all = heard_until(&heard, |all| said(all).contains(ASKS_WHERE));
            consoles.write(opened.id, "\x1b[1;1R").unwrap();
        }
        consoles.write(opened.id, "echo sens-$((20+22))\r").unwrap();
        all.extend(heard_until(&heard, |all| said(all).contains("sens-42")));
        assert!(said(&all).contains("sens-42"), "{:?}", said(&all));

        consoles.close(opened.id).unwrap();
        let rest = heard_until(&heard, ended);
        assert!(ended(&rest));
        assert_eq!(consoles.write(opened.id, "x"), Err(GONE.to_string()));
    }
}
