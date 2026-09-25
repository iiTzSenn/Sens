use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hash, Hasher};
use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::SystemTime;

use crate::files;

const INDEX: &str = "index.html";
const TEXT: &str = "text/plain; charset=utf-8";
const HTML: &str = "text/html; charset=utf-8";
const MISSING: &[u8] = b"no encontrado";
const BUSY: &str = "la vista previa esta ocupada";

#[derive(Default)]
pub struct Site {
    open: Mutex<Option<Served>>,
}

struct Served {
    port: u16,
    pass: String,
    root: Arc<Mutex<PathBuf>>,
}

pub fn url(site: &Site, root: &Path, path: &str) -> Result<String, String> {
    let full = files::inside(root, path)?;
    let relative = full
        .strip_prefix(files::home(root)?)
        .map_err(|_| format!("{path} está fuera del proyecto"))?
        .to_path_buf();
    let mut open = site.open.lock().map_err(|_| BUSY.to_string())?;
    if open.is_none() {
        *open = Some(start(root)?);
    }
    let Some(served) = open.as_ref() else {
        return Err(BUSY.to_string());
    };
    *served.root.lock().map_err(|_| BUSY.to_string())? = root.to_path_buf();
    Ok(format!(
        "http://127.0.0.1:{}/{}/{}",
        served.port,
        served.pass,
        web(&relative)
    ))
}

fn start(root: &Path) -> Result<Served, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("no pude abrir la vista previa: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("no pude abrir la vista previa: {error}"))?
        .port();

    let pass = pass();
    let root = Arc::new(Mutex::new(root.to_path_buf()));
    let served = Served {
        port,
        pass: pass.clone(),
        root: root.clone(),
    };

    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let root = root.clone();
            let pass = pass.clone();
            thread::spawn(move || {
                let _ = answer(stream, &root, &pass);
            });
        }
    });

    Ok(served)
}

fn answer(stream: TcpStream, root: &Mutex<PathBuf>, pass: &str) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut asked = String::new();
    reader.read_line(&mut asked)?;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 || header.trim().is_empty() {
            break;
        }
    }

    let mut stream = stream;
    let mut parts = asked.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let head = method == "HEAD";

    if method != "GET" && !head {
        return send(&mut stream, "405 Method Not Allowed", TEXT, MISSING, head);
    }

    let Some(file) = wanted(root, pass, target) else {
        return send(&mut stream, "404 Not Found", TEXT, MISSING, head);
    };
    let Ok(body) = std::fs::read(&file) else {
        return send(&mut stream, "404 Not Found", TEXT, MISSING, head);
    };

    send(&mut stream, "200 OK", kind(&file), &body, head)
}

fn wanted(root: &Mutex<PathBuf>, pass: &str, target: &str) -> Option<PathBuf> {
    let path = target.split(['?', '#']).next().unwrap_or("");
    let rest = decoded(path)
        .strip_prefix('/')?
        .strip_prefix(pass)
        .map(|rest| rest.trim_start_matches('/').to_string())?;
    let here = root.lock().ok()?.clone();
    resolve(&here, &rest)
}

fn resolve(root: &Path, target: &str) -> Option<PathBuf> {
    let mut here = root.to_path_buf();
    for part in target.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return None;
        }
        here.push(part);
    }
    if here.is_dir() {
        here.push(INDEX);
    }
    let home = root.canonicalize().ok()?;
    let found = here.canonicalize().ok()?;
    found.starts_with(&home).then_some(found)
}

fn send(
    stream: &mut TcpStream,
    status: &str,
    kind: &str,
    body: &[u8],
    head: bool,
) -> std::io::Result<()> {
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(headers.as_bytes())?;
    if !head {
        stream.write_all(body)?;
    }
    stream.flush()
}

fn kind(path: &Path) -> &'static str {
    let found = path
        .extension()
        .and_then(|one| one.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match found.as_str() {
        "html" | "htm" => HTML,
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "pdf" => "application/pdf",
        _ => TEXT,
    }
}

fn decoded(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%'
            && let Some(byte) = bytes.get(at + 1..at + 3).and_then(hex)
        {
            out.push(byte);
            at += 3;
            continue;
        }
        out.push(bytes[at]);
        at += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(pair: &[u8]) -> Option<u8> {
    let [high, low] = pair else { return None };
    let digit = |byte: &u8| char::from(*byte).to_digit(16);
    Some((digit(high)? * 16 + digit(low)?) as u8)
}

fn web(path: &Path) -> String {
    path.components()
        .filter_map(|one| one.as_os_str().to_str())
        .map(escaped)
        .collect::<Vec<_>>()
        .join("/")
}

fn escaped(part: &str) -> String {
    part.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

fn pass() -> String {
    let mut hasher = RandomState::new().build_hasher();
    SystemTime::now().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn scratch(name: &str) -> PathBuf {
        let here = std::env::temp_dir().join(format!("sens-preview-{name}"));
        let _ = std::fs::remove_dir_all(&here);
        std::fs::create_dir_all(&here).expect("scratch");
        here
    }

    #[test]
    fn serves_a_page_and_its_neighbours() {
        let here = scratch("serves");
        std::fs::write(here.join(INDEX), "<html><head><title>a</title></head><body>hola</body></html>")
            .expect("index");
        std::fs::write(here.join("app.js"), "console.log(1)").expect("script");

        let site = Site::default();
        let url = url(&site, &here, INDEX).expect("url");
        let (port, pass) = {
            let open = site.open.lock().expect("open");
            let served = open.as_ref().expect("served");
            (served.port, served.pass.clone())
        };
        assert_eq!(url, format!("http://127.0.0.1:{port}/{pass}/index.html"));

        let page = fetch(port, &format!("/{pass}/index.html"));
        assert!(page.contains("text/html"));
        assert!(page.contains("<head><title>a</title></head><body>hola</body>"));

        let script = fetch(port, &format!("/{pass}/app.js"));
        assert!(script.contains("text/javascript"));
        assert!(script.contains("console.log(1)"));

        assert!(fetch(port, "/app.js").contains("404"));
        assert!(fetch(port, &format!("/{pass}/no-existe.html")).contains("404"));
    }

    fn fetch(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        stream
            .write_all(format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").as_bytes())
            .expect("ask");
        let mut said = Vec::new();
        stream.read_to_end(&mut said).expect("read");
        String::from_utf8_lossy(&said).into_owned()
    }

    #[test]
    fn refuses_to_climb_out_of_the_project() {
        let here = scratch("climb");
        std::fs::create_dir_all(here.join("web")).expect("web");
        std::fs::write(here.join("secreto.txt"), "no").expect("secret");
        std::fs::write(here.join("web").join(INDEX), "<html></html>").expect("index");

        assert!(resolve(&here.join("web"), "../secreto.txt").is_none());
        assert!(resolve(&here.join("web"), "").is_some());
        assert!(url(&Site::default(), &here.join("web"), "../secreto.txt").is_err());
    }

    #[test]
    fn names_the_type_from_the_extension() {
        assert_eq!(kind(Path::new("a/b.css")), "text/css; charset=utf-8");
        assert_eq!(kind(Path::new("a/B.PNG")), "image/png");
        assert_eq!(kind(Path::new("a/sin")), TEXT);
    }

    #[test]
    fn spells_paths_for_the_web() {
        assert_eq!(web(Path::new("docs/mi web/index.html")), "docs/mi%20web/index.html");
        assert_eq!(decoded("/x/mi%20web/a.js"), "/x/mi web/a.js");
    }

    #[test]
    fn a_percent_before_a_letter_beyond_ascii_is_kept_as_it_came() {
        assert_eq!(decoded("/%aé"), "/%aé");
        assert_eq!(decoded("/%€"), "/%€");
        assert_eq!(decoded("/%é/a"), "/%é/a");
        assert_eq!(decoded("/a%2"), "/a%2");
        assert_eq!(decoded("/a%+1"), "/a%+1");
        assert_eq!(decoded("/caf%C3%A9"), "/café");
    }
}
