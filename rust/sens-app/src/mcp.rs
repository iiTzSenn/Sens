use std::collections::HashMap;
use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, SystemTime};

use sens_agent::said;
use serde::Serialize;
use serde_json::{Value, json};

pub const SERVER: &str = "sens";
pub const READ_TERMINAL: &str = "read_terminal";
const PATH: &str = "/mcp";
const LATEST: &str = "2025-06-18";
const PATIENCE: Duration = Duration::from_secs(5);
const STALLED: Duration = Duration::from_secs(10);
const HEAD_CAP: usize = 16 * 1024;
const BODY_CAP: usize = 1024 * 1024;
const LINES: u64 = 200;
const MOST_LINES: u64 = 1000;
const LATE: &str = "Sens no contestó a tiempo: la ventana puede estar cerrada o bloqueada.";

fn broken() -> String {
    said!(
        en: "the bridge to Claude Code broke",
        es: "el puente con Claude Code se rompió",
        fr: "le pont avec Claude Code est rompu",
        de: "die Brücke zu Claude Code ist abgebrochen",
        ja: "Claude Code との連携が切れました",
        zh: "与 Claude Code 的连接已中断",
    )
}

fn unopened(error: std::io::Error) -> String {
    said!(
        en: "couldn’t open the bridge to Claude Code: {error}",
        es: "no pude abrir el puente con Claude Code: {error}",
        fr: "impossible d’ouvrir le pont avec Claude Code : {error}",
        de: "die Brücke zu Claude Code konnte nicht geöffnet werden: {error}",
        ja: "Claude Code との連携を開始できませんでした: {error}",
        zh: "无法建立与 Claude Code 的连接：{error}",
    )
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Reading {
    pub ask: u64,
    pub terminal: Option<u64>,
    pub lines: u64,
    pub within: Vec<String>,
}

type Ask = Arc<dyn Fn(Reading) + Send + Sync>;

#[derive(Default)]
struct Waiting {
    made: AtomicU64,
    answers: Mutex<HashMap<u64, mpsc::Sender<String>>>,
    scopes: Mutex<Vec<Vec<String>>>,
}

impl Waiting {
    fn scope(&self, within: Vec<String>) -> Option<usize> {
        let mut scopes = self.scopes.lock().ok()?;
        Some(match scopes.iter().position(|known| *known == within) {
            Some(at) => at,
            None => {
                scopes.push(within);
                scopes.len() - 1
            }
        })
    }

    fn within(&self, scope: usize) -> Option<Vec<String>> {
        self.scopes.lock().ok()?.get(scope).cloned()
    }

    fn read(&self, ask: &Ask, terminal: Option<u64>, lines: u64, within: Vec<String>) -> Option<String> {
        let id = self.made.fetch_add(1, Ordering::SeqCst) + 1;
        let (answer, heard) = mpsc::channel();
        self.answers.lock().ok()?.insert(id, answer);
        ask(Reading { ask: id, terminal, lines, within });
        let said = heard.recv_timeout(PATIENCE).ok();
        if let Ok(mut answers) = self.answers.lock() {
            answers.remove(&id);
        }
        said
    }

    fn answer(&self, ask: u64, text: String) -> Result<(), String> {
        let waiting = self.answers.lock().map_err(|_| broken())?.remove(&ask);
        if let Some(answer) = waiting {
            let _ = answer.send(text);
        }
        Ok(())
    }
}

struct Served {
    port: u16,
    pass: String,
    waiting: Arc<Waiting>,
}

#[derive(Default)]
pub struct Bridge {
    open: Mutex<Option<Served>>,
}

impl Bridge {
    pub fn config(&self, within: Vec<String>, ask: impl Fn(Reading) + Send + Sync + 'static) -> Result<String, String> {
        let mut open = self.open.lock().map_err(|_| broken())?;
        if open.is_none() {
            *open = Some(start(Arc::new(ask))?);
        }
        let served = open.as_ref().ok_or_else(broken)?;
        let scope = served.waiting.scope(within).ok_or_else(broken)?;
        Ok(json!({
            "mcpServers": {
                SERVER: {
                    "type": "http",
                    "url": format!("http://127.0.0.1:{}{PATH}", served.port),
                    "headers": { "Authorization": format!("Bearer {}.{scope}", served.pass) }
                }
            }
        })
        .to_string())
    }

    pub fn answer(&self, ask: u64, text: String) -> Result<(), String> {
        let open = self.open.lock().map_err(|_| broken())?;
        match open.as_ref() {
            Some(served) => served.waiting.answer(ask, text),
            None => Ok(()),
        }
    }
}

pub fn allowed() -> String {
    format!("mcp__{SERVER}__{READ_TERMINAL}")
}

fn start(ask: Ask) -> Result<Served, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(unopened)?;
    let port = listener.local_addr().map_err(unopened)?.port();
    let pass = pass();
    let waiting = Arc::new(Waiting::default());
    let serving = waiting.clone();
    let checking = pass.clone();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let ask = ask.clone();
            let waiting = serving.clone();
            let pass = checking.clone();
            thread::spawn(move || {
                let _ = serve(stream, &pass, &waiting, &ask);
            });
        }
    });
    Ok(Served { port, pass, waiting })
}

fn scope_of(authorization: Option<&String>, pass: &str) -> Option<usize> {
    let (given, scope) = authorization?.strip_prefix("Bearer ")?.split_once('.')?;
    (given == pass).then(|| scope.parse().ok()).flatten()
}

fn pass() -> String {
    let now = SystemTime::now();
    format!("{:016x}{:016x}", RandomState::new().hash_one(now), RandomState::new().hash_one(now))
}

struct Asked {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn heard(stream: &TcpStream) -> std::io::Result<Option<Asked>> {
    let mut reader = BufReader::new(stream.try_clone()?).take(HEAD_CAP as u64);
    let mut first = String::new();
    reader.read_line(&mut first)?;
    let mut parts = first.split_whitespace();
    let (Some(method), Some(target)) = (parts.next(), parts.next()) else {
        return Ok(None);
    };
    let mut headers = HashMap::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Ok(None);
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let length: usize = headers.get("content-length").and_then(|value| value.parse().ok()).unwrap_or(0);
    if length > BODY_CAP {
        return Ok(None);
    }
    let mut body = vec![0; length];
    let mut reader = reader.into_inner();
    reader.read_exact(&mut body)?;
    Ok(Some(Asked {
        method: method.to_string(),
        path: target.split('?').next().unwrap_or_default().to_string(),
        headers,
        body,
    }))
}

fn serve(stream: TcpStream, pass: &str, waiting: &Waiting, ask: &Ask) -> std::io::Result<()> {
    stream.set_read_timeout(Some(STALLED))?;
    let Some(asked) = heard(&stream)? else {
        return reply(&stream, "400 Bad Request", None);
    };
    if asked.path != PATH {
        return reply(&stream, "404 Not Found", None);
    }
    if asked.headers.contains_key("origin") {
        return reply(&stream, "403 Forbidden", None);
    }
    let Some(within) = scope_of(asked.headers.get("authorization"), pass).and_then(|scope| waiting.within(scope)) else {
        return reply(&stream, "401 Unauthorized", None);
    };
    if asked.method != "POST" {
        return reply(&stream, "405 Method Not Allowed", None);
    }
    let Ok(message) = serde_json::from_slice::<Value>(&asked.body) else {
        return reply(&stream, "400 Bad Request", Some(&failure(Value::Null, -32700, "Parse error")));
    };
    match respond(&message, &|terminal, lines| waiting.read(ask, terminal, lines, within.clone())) {
        Some(answer) => reply(&stream, "200 OK", Some(&answer)),
        None => reply(&stream, "202 Accepted", None),
    }
}

fn reply(mut stream: &TcpStream, status: &str, body: Option<&Value>) -> std::io::Result<()> {
    let text = body.map(Value::to_string).unwrap_or_default();
    let kind = if body.is_some() { "Content-Type: application/json\r\n" } else { "" };
    let allow = if status.starts_with("405") { "Allow: POST\r\n" } else { "" };
    write!(stream, "HTTP/1.1 {status}\r\n{kind}{allow}Content-Length: {}\r\nConnection: close\r\n\r\n{text}", text.len())?;
    stream.flush()
}

fn failure(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn success(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn respond(message: &Value, read: &dyn Fn(Option<u64>, u64) -> Option<String>) -> Option<Value> {
    let id = message.get("id")?.clone();
    let params = &message["params"];
    Some(match message["method"].as_str().unwrap_or_default() {
        "initialize" => success(
            id,
            json!({
                "protocolVersion": params["protocolVersion"].as_str().unwrap_or(LATEST),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": SERVER, "version": env!("CARGO_PKG_VERSION") }
            }),
        ),
        "ping" => success(id, json!({})),
        "tools/list" => success(id, json!({ "tools": [tool()] })),
        "tools/call" if params["name"] == READ_TERMINAL => {
            let terminal = params["arguments"]["terminal"].as_u64();
            let lines = params["arguments"]["lines"].as_u64().unwrap_or(LINES).clamp(1, MOST_LINES);
            let (text, failed) = match read(terminal, lines) {
                Some(text) => (text, false),
                None => (LATE.to_string(), true),
            };
            success(id, json!({ "content": [{ "type": "text", "text": text }], "isError": failed }))
        }
        "tools/call" => failure(id, -32602, "Unknown tool"),
        _ => failure(id, -32601, "Method not found"),
    })
}

fn tool() -> Value {
    json!({
        "name": READ_TERMINAL,
        "title": "Leer la terminal",
        "description": "Lee lo que hay en la terminal que la persona usa dentro de Sens: las últimas líneas, con sus prompts, los comandos que escribió y lo que imprimieron. Úsala cuando hable de algo que ejecutó o vio en su terminal («el error de la consola», «lo que acabo de lanzar»). Solo lee; no ejecuta nada.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "terminal": { "type": "integer", "minimum": 1, "description": "Qué terminal leer, por el número que da una lectura anterior. Sin él, la que se ve en el panel." },
                "lines": { "type": "integer", "minimum": 1, "maximum": MOST_LINES, "description": "Cuántas líneas del final (200 si no se dice)." }
            },
            "additionalProperties": false
        },
        "annotations": { "readOnlyHint": true, "openWorldHint": false }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(message: Value) -> Option<Value> {
        respond(&message, &|terminal, lines| Some(format!("leída {terminal:?} · {lines}")))
    }

    #[test]
    fn it_introduces_itself_in_the_version_it_was_asked_for() {
        let answer = call(json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } })).unwrap();
        assert_eq!(answer["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(answer["result"]["serverInfo"]["name"], SERVER);
        assert!(answer["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn it_offers_one_read_only_tool() {
        let answer = call(json!({ "jsonrpc": "2.0", "id": "a", "method": "tools/list" })).unwrap();
        let tools = answer["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], READ_TERMINAL);
        assert_eq!(tools[0]["annotations"]["readOnlyHint"], true);
        assert_eq!(answer["id"], "a");
    }

    #[test]
    fn a_read_takes_the_terminal_and_keeps_the_lines_within_bounds() {
        let read = |arguments: Value| call(json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": READ_TERMINAL, "arguments": arguments } })).unwrap()["result"]["content"][0]["text"].clone();
        assert_eq!(read(json!({})), "leída None · 200");
        assert_eq!(read(json!({ "terminal": 3, "lines": 5000 })), "leída Some(3) · 1000");
        assert_eq!(read(json!({ "lines": 0 })), "leída None · 1");
    }

    #[test]
    fn a_read_nobody_answers_says_so_as_an_error() {
        let answer = respond(&json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": READ_TERMINAL } }), &|_, _| None).unwrap();
        assert_eq!(answer["result"]["isError"], true);
        assert_eq!(answer["result"]["content"][0]["text"], LATE);
    }

    #[test]
    fn notifications_get_no_answer_and_the_unknown_gets_an_error() {
        assert_eq!(call(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })), None);
        assert_eq!(call(json!({ "jsonrpc": "2.0", "id": 4, "method": "resources/list" })).unwrap()["error"]["code"], -32601);
        assert_eq!(call(json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": { "name": "rm" } })).unwrap()["error"]["code"], -32602);
    }

    fn post(port: u16, token: &str, extra: &str, body: &str) -> String {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        write!(
            stream,
            "POST {PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
        let mut said = String::new();
        stream.read_to_string(&mut said).unwrap();
        said
    }

    #[test]
    #[ignore = "calls Claude Code, which calls the model"]
    fn claude_code_reads_the_terminal_through_the_bridge() {
        let bridge = Arc::new(Bridge::default());
        let answering = bridge.clone();
        let config = bridge
            .config(vec![std::env::temp_dir().to_string_lossy().into_owned()], move |reading| {
                let _ = answering.answer(reading.ask, "PS C:\\demo> npm run dev\nError: el puerto 5173 ya está en uso".into());
            })
            .unwrap();
        let mut claude = sens_agent::process::claude();
        claude
            .args(["-p", "--output-format", "json", "--model", "haiku", "--strict-mcp-config", "--mcp-config", &config, "--allowedTools", &allowed()])
            .current_dir(std::env::temp_dir());
        let said = sens_agent::process::run(claude, "Lee mi terminal con la herramienta read_terminal y responde solo con el número de puerto del error.");
        assert!(said.as_deref().is_ok_and(|said| said.contains("5173")), "{said:?}");
    }

    #[test]
    fn over_http_it_asks_sens_within_the_session_folders_and_turns_strangers_away() {
        let bridge = Arc::new(Bridge::default());
        let answering = bridge.clone();
        let ask = move |reading: Reading| {
            let answering = answering.clone();
            thread::spawn(move || answering.answer(reading.ask, format!("pantalla {} en {}", reading.lines, reading.within.join(" y "))).unwrap());
        };
        let here: Value = serde_json::from_str(&bridge.config(vec!["C:/demo".into()], ask).unwrap()).unwrap();
        let there: Value = serde_json::from_str(&bridge.config(vec!["C:/api".into(), "C:/api/.sens/worktrees/ab12cd34".into()], |_| {}).unwrap()).unwrap();
        let token = |config: &Value| config["mcpServers"][SERVER]["headers"]["Authorization"].as_str().unwrap().trim_start_matches("Bearer ").to_string();
        let url = here["mcpServers"][SERVER]["url"].as_str().unwrap().to_string();
        let port: u16 = url.trim_start_matches("http://127.0.0.1:").trim_end_matches(PATH).parse().unwrap();
        let call = r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"read_terminal","arguments":{"lines":12}}}"#;

        let said = post(port, &token(&here), "", call);
        assert!(said.starts_with("HTTP/1.1 200 OK"), "{said}");
        assert!(said.contains(r#""text":"pantalla 12 en C:/demo""#), "{said}");
        assert!(post(port, &token(&there), "", call).contains(r#""text":"pantalla 12 en C:/api y C:/api/.sens/worktrees/ab12cd34""#));
        assert_eq!(there["mcpServers"][SERVER]["url"], url.as_str());

        let pass = token(&here).split_once('.').unwrap().0.to_string();
        for stranger in ["otro", pass.as_str(), &format!("{pass}.9"), "otro.0"] {
            assert!(post(port, stranger, "", call).starts_with("HTTP/1.1 401"), "{stranger}");
        }
        assert!(post(port, &token(&here), "Origin: https://evil.example\r\n", call).starts_with("HTTP/1.1 403"));
        assert!(post(port, &token(&here), "", r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).starts_with("HTTP/1.1 202"));
        assert_eq!(bridge.config(vec!["C:/demo".into()], |_| {}).unwrap(), here.to_string());
    }
}
