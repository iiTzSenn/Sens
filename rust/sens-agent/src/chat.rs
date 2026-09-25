use std::collections::{BTreeMap, HashMap, HashSet};
use std::hash::{DefaultHasher, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::catalog::{self, Thinking};
use crate::process::{self, Family, hidden, unlaunched};
use crate::said;
use crate::session::{self, Entry};

pub const BYPASS: &str = "bypassPermissions";
pub const MODES: &[&str] = &["default", "acceptEdits", "auto", "plan", BYPASS];

const STREAMING: &[&str] = &[
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-prompt-tool",
    "stdio",
    "--thinking-display",
    "summarized",
];

const OUTPUT_CAP: usize = 6_000;
const TEXT_CAP: usize = 20_000;
const ITEM_CAP: usize = 200;
const HEARD_CAP: usize = 4_000;
const BULKY: &[&str] = &["originalFile"];
const SOURCES_CAP: usize = 20;
const DESCRIPTION_CAP: usize = 160;
const OFFER_PATIENCE: Duration = Duration::from_secs(10);
const GREETING: &str = "sens-initialize";
const SEARCHED: &str = "Web search results for query:";

fn denied() -> String {
    said!(
        en: "The user declined it.",
        es: "El usuario lo rechazó.",
        fr: "L’utilisateur l’a refusé.",
        de: "Der Nutzer hat es abgelehnt.",
        ja: "ユーザーが拒否しました。",
        zh: "用户拒绝了。",
    )
}

fn halted() -> String {
    said!(
        en: "The user stopped the task.",
        es: "El usuario paró la tarea.",
        fr: "L’utilisateur a arrêté la tâche.",
        de: "Der Nutzer hat die Aufgabe gestoppt.",
        ja: "ユーザーがタスクを停止しました。",
        zh: "用户停止了任务。",
    )
}

pub fn still_working() -> String {
    said!(
        en: "Claude is still working in this session.",
        es: "Claude sigue trabajando en esta sesión.",
        fr: "Claude travaille encore dans cette session.",
        de: "Claude arbeitet noch in dieser Sitzung.",
        ja: "Claude はこのセッションでまだ作業中です。",
        zh: "Claude 仍在这个会话中工作。",
    )
}

fn gone() -> String {
    said!(
        en: "That session is no longer running.",
        es: "Esa sesión ya no está en marcha.",
        fr: "Cette session n’est plus en cours.",
        de: "Diese Sitzung läuft nicht mehr.",
        ja: "そのセッションはもう実行されていません。",
        zh: "该会话已不在运行。",
    )
}

pub fn picture() -> String {
    said!(en: "[picture]", es: "[imagen]", fr: "[image]", de: "[Bild]", ja: "[画像]", zh: "[图片]")
}

pub type Sink = Arc<dyn Fn(&str, &Event) + Send + Sync>;

type Lives = Arc<Mutex<HashMap<String, Arc<Live>>>>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Event {
    Started {
        model: String,
    },
    Delta {
        thinking: bool,
        text: String,
    },
    Said {
        text: String,
    },
    Thought {
        text: String,
    },
    Tool {
        id: String,
        name: String,
        input: Value,
    },
    ToolDone {
        id: String,
        output: String,
        error: bool,
        detail: Value,
    },
    Asking {
        request: String,
        tool: String,
        input: Value,
        suggestions: Value,
    },
    Answered {
        request: String,
        allowed: bool,
        answers: Value,
    },
    Limits {
        #[serde(default)]
        status: String,
        #[serde(default)]
        window: String,
        utilization: Option<f64>,
        resets_at: Option<u64>,
        threshold: Option<f64>,
        overage: Option<Overage>,
        #[serde(default)]
        windows: BTreeMap<String, Window>,
    },
    Consulted {
        tool: String,
        links: Vec<Link>,
    },
    TaskStarted {
        id: String,
        tool: String,
        runner: String,
        description: String,
        prompt: String,
    },
    TaskProgress {
        id: String,
        doing: String,
        last: String,
        tools: u64,
        tokens: u64,
        millis: u64,
    },
    TaskEnded {
        id: String,
        status: String,
        summary: String,
        output: String,
        tools: u64,
        tokens: u64,
        millis: u64,
    },
    Compacted {
        before: u64,
        auto: bool,
    },
    Finished {
        ok: bool,
        stopped: bool,
        millis: u64,
        turns: u64,
        tokens_in: u64,
        tokens_out: u64,
        #[serde(default)]
        context: u64,
        #[serde(default)]
        window: u64,
        error: String,
    },
    Failed {
        reason: String,
    },
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Slash {
    pub name: String,
    pub description: String,
    pub hint: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Window {
    pub utilization: Option<f64>,
    pub resets_at: Option<u64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Overage {
    pub status: String,
    pub using: bool,
    pub resets_at: Option<u64>,
    pub disabled: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Link {
    pub url: String,
    #[serde(default)]
    pub title: String,
}

impl Event {
    pub fn lasting(&self) -> bool {
        !matches!(
            self,
            Event::Delta { .. } | Event::Limits { .. } | Event::TaskProgress { .. }
        )
    }

    fn abandoned(id: String) -> Self {
        Event::TaskEnded {
            id,
            status: "stopped".into(),
            summary: String::new(),
            output: String::new(),
            tools: 0,
            tokens: 0,
            millis: 0,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub provider: String,
    pub model: String,
    pub effort: String,
    pub thinking: bool,
    pub mode: String,
    #[serde(skip)]
    pub extra: Vec<String>,
    #[serde(skip)]
    pub env: BTreeMap<String, String>,
    #[serde(skip)]
    pub cwd: Option<PathBuf>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            provider: "claude".into(),
            model: String::new(),
            effort: String::new(),
            thinking: true,
            mode: "default".into(),
            extra: Vec::new(),
            env: BTreeMap::new(),
            cwd: None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Message {
    pub text: String,
    pub files: Vec<String>,
    pub images: Vec<Image>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Image {
    pub media_type: String,
    pub data: String,
    #[serde(skip)]
    pub kept: String,
}

impl Settings {
    pub fn vet(&self) -> Result<(), String> {
        let Settings { provider, model, effort, mode, .. } = self;
        catalog::provider(provider.trim()).ok_or_else(|| catalog::unknown(provider))?;
        if !catalog::plausible(model.trim()) {
            return Err(said!(
                en: "{model} doesn’t look like a model",
                es: "{model} no parece un modelo",
                fr: "{model} ne ressemble pas à un modèle",
                de: "{model} sieht nicht wie ein Modell aus",
                ja: "{model} はモデル名ではないようです",
                zh: "{model} 似乎不是有效的模型名称",
            ));
        }
        if !effort.is_empty() && !catalog::EFFORTS.contains(&effort.as_str()) {
            return Err(said!(
                en: "unknown effort {effort}",
                es: "no conozco el esfuerzo {effort}",
                fr: "effort inconnu : {effort}",
                de: "unbekannter Aufwand: {effort}",
                ja: "不明な推論の強さです: {effort}",
                zh: "未知的推理强度：{effort}",
            ));
        }
        if !MODES.contains(&mode.as_str()) {
            return Err(said!(
                en: "unknown mode {mode}",
                es: "no conozco el modo {mode}",
                fr: "mode inconnu : {mode}",
                de: "unbekannter Modus: {mode}",
                ja: "不明なモードです: {mode}",
                zh: "未知的模式：{mode}",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Decision {
    pub allow: bool,
    pub answers: Value,
    pub remember: bool,
    pub mode: String,
    pub message: String,
}

struct Pending {
    input: Value,
    suggestions: Value,
}

struct Live {
    root: PathBuf,
    session: String,
    input: Mutex<ChildStdin>,
    child: Mutex<Child>,
    family: Family,
    settings: Mutex<Settings>,
    busy: AtomicBool,
    stopping: AtomicBool,
    requests: AtomicU64,
    pending: Mutex<HashMap<String, Pending>>,
    tasks: Mutex<HashSet<String>>,
    log: Mutex<()>,
    sink: Mutex<Sink>,
    offered: Mutex<Option<Vec<Slash>>>,
    told: Condvar,
    compacted: AtomicBool,
    forgotten: AtomicBool,
}

impl Live {
    fn offer(&self, slashes: Vec<Slash>) {
        if let Ok(mut offered) = self.offered.lock() {
            offered.get_or_insert(slashes);
            self.told.notify_all();
        }
    }

    fn slashes(&self, patience: Duration) -> Vec<Slash> {
        let Ok(offered) = self.offered.lock() else {
            return Vec::new();
        };
        self.told
            .wait_timeout_while(offered, patience, |offered| offered.is_none())
            .ok()
            .and_then(|(offered, _)| offered.clone())
            .unwrap_or_default()
    }

    fn tell(&self, event: &Event) {
        if self.forgotten.load(Ordering::SeqCst) {
            return;
        }
        let sink = self.sink.lock().map(|sink| sink.clone());
        if let Ok(sink) = sink {
            sink(&self.session, event);
        }
    }

    fn write(&self, message: &Value) -> Result<(), String> {
        let mut input = self.input.lock().map_err(|_| {
            said!(
                en: "the pipe to Claude Code broke",
                es: "la tubería con Claude Code se rompió",
                fr: "la liaison avec Claude Code est rompue",
                de: "die Verbindung zu Claude Code ist abgerissen",
                ja: "Claude Code との接続が切れました",
                zh: "与 Claude Code 的管道已断开",
            )
        })?;
        writeln!(input, "{message}")
            .and_then(|_| input.flush())
            .map_err(|error| process::unheard("Claude Code", error))
    }

    fn control(&self, request: Value) -> Result<(), String> {
        let id = format!("sens-{}", self.requests.fetch_add(1, Ordering::SeqCst));
        self.write(&json!({ "type": "control_request", "request_id": id, "request": request }))
    }

    fn reply(&self, request: &str, response: Value) -> Result<(), String> {
        self.write(&json!({
            "type": "control_response",
            "response": { "subtype": "success", "request_id": request, "response": response }
        }))
    }

    fn keep(&self, event: Event) {
        if self.forgotten.load(Ordering::SeqCst) {
            return;
        }
        let _order = self.log.lock();
        let _ = session::append(
            &self.root,
            &self.session,
            &Entry::Agent {
                at: session::now(),
                event,
            },
        );
    }

    fn alive(&self) -> bool {
        self.child
            .lock()
            .ok()
            .and_then(|mut child| child.try_wait().ok())
            .is_some_and(|status| status.is_none())
    }

    fn kill(&self) {
        self.family.end();
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }

    fn running(&self) -> Vec<String> {
        self.tasks
            .lock()
            .map(|tasks| tasks.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn follow(&self, event: &Event) {
        let Ok(mut tasks) = self.tasks.lock() else {
            return;
        };
        match event {
            Event::TaskStarted { id, .. } => {
                tasks.insert(id.clone());
            }
            Event::TaskEnded { id, .. } => {
                tasks.remove(id);
            }
            _ => {}
        }
    }

    fn abandon(&self) -> Vec<Event> {
        self.tasks
            .lock()
            .map(|mut tasks| tasks.drain().map(Event::abandoned).collect())
            .unwrap_or_default()
    }

    fn settle(&self, event: Event) -> Event {
        self.follow(&event);
        match event {
            Event::Asking {
                request,
                tool,
                input,
                suggestions,
            } => {
                let shown = slim(&input);
                if let Ok(mut pending) = self.pending.lock() {
                    pending.insert(
                        request.clone(),
                        Pending {
                            input,
                            suggestions: suggestions.clone(),
                        },
                    );
                }
                Event::Asking {
                    request,
                    tool,
                    input: shown,
                    suggestions,
                }
            }
            Event::Compacted { .. } => {
                self.compacted.store(true, Ordering::SeqCst);
                event
            }
            Event::Finished {
                millis,
                turns,
                tokens_in,
                tokens_out,
                context,
                window,
                ok,
                error,
                ..
            } => {
                self.busy.store(false, Ordering::SeqCst);
                if let Ok(mut pending) = self.pending.lock() {
                    pending.clear();
                }
                let stopped = self.stopping.swap(false, Ordering::SeqCst);
                let compacted = self.compacted.swap(false, Ordering::SeqCst);
                Event::Finished {
                    ok: ok && !stopped,
                    stopped,
                    millis,
                    turns,
                    tokens_in,
                    tokens_out,
                    context: if compacted { 0 } else { context },
                    window,
                    error: if stopped { String::new() } else { error },
                }
            }
            other => other,
        }
    }
}

pub struct Engine {
    launcher: Vec<String>,
    lives: Lives,
}

impl Default for Engine {
    fn default() -> Self {
        Self::launching(Vec::new())
    }
}

impl Engine {
    pub fn launching(launcher: Vec<String>) -> Self {
        Self {
            launcher,
            lives: Arc::default(),
        }
    }

    pub fn send(&self, root: &Path, session: &str, message: &Message, settings: Settings, sink: Sink) -> Result<(), String> {
        settings.vet()?;
        if message.text.trim().is_empty() && message.images.is_empty() && message.files.is_empty() {
            return Err(said!(
                en: "there is nothing to send",
                es: "no hay nada que enviar",
                fr: "il n’y a rien à envoyer",
                de: "es gibt nichts zu senden",
                ja: "送信する内容がありません",
                zh: "没有可发送的内容",
            ));
        }
        let live = self.ready(root, session, settings, sink)?;
        if live.busy.swap(true, Ordering::SeqCst) {
            return Err(still_working());
        }
        live.stopping.store(false, Ordering::SeqCst);
        {
            let _order = live.log.lock();
            let _ = session::append(
                root,
                session,
                &Entry::Task {
                    at: session::now(),
                    text: message.text.clone(),
                    files: message.files.clone(),
                    images: message.images.iter().map(|image| image.kept.clone()).collect(),
                },
            );
        }
        live.write(&user_message(message))
            .inspect_err(|_| live.busy.store(false, Ordering::SeqCst))
    }

    pub fn warm(&self, root: &Path, session: &str, settings: Settings, sink: Sink) -> Result<Vec<Slash>, String> {
        settings.vet()?;
        Ok(self.ready(root, session, settings, sink)?.slashes(OFFER_PATIENCE))
    }

    pub fn stop(&self, session: &str) -> Result<(), String> {
        let live = self.live(session).ok_or_else(gone)?;
        if !live.busy.load(Ordering::SeqCst) {
            return Ok(());
        }
        live.stopping.store(true, Ordering::SeqCst);
        let waiting: Vec<String> = live
            .pending
            .lock()
            .map(|mut pending| pending.drain().map(|(request, _)| request).collect())
            .unwrap_or_default();
        for request in waiting {
            live.reply(&request, json!({ "behavior": "deny", "message": halted(), "interrupt": true }))?;
            live.keep(Event::Answered {
                request,
                allowed: false,
                answers: Value::Null,
            });
        }
        live.control(json!({ "subtype": "interrupt" }))
    }

    pub fn answer(&self, session: &str, request: &str, decision: &Decision) -> Result<(), String> {
        let live = self.live(session).ok_or_else(gone)?;
        let pending = live
            .pending
            .lock()
            .map_err(|_| {
                said!(
                    en: "couldn’t read the pending questions",
                    es: "no pude leer las preguntas pendientes",
                    fr: "impossible de lire les questions en attente",
                    de: "die offenen Fragen konnten nicht gelesen werden",
                    ja: "保留中の質問を読み取れませんでした",
                    zh: "无法读取待回答的问题",
                )
            })?
            .remove(request)
            .ok_or_else(|| {
                said!(
                    en: "that question has already been answered",
                    es: "esa pregunta ya tiene respuesta",
                    fr: "cette question a déjà une réponse",
                    de: "diese Frage wurde schon beantwortet",
                    ja: "その質問にはすでに回答済みです",
                    zh: "这个问题已经有回答了",
                )
            })?;

        live.reply(request, respond(&pending, decision))?;
        if let Some(mode) = mode_after(&pending, decision)
            && let Ok(mut settings) = live.settings.lock()
        {
            settings.mode = mode;
        }
        live.keep(Event::Answered {
            request: request.to_string(),
            allowed: decision.allow,
            answers: decision.answers.clone(),
        });
        Ok(())
    }

    pub fn busy(&self, session: &str) -> bool {
        self.live(session)
            .is_some_and(|live| live.busy.load(Ordering::SeqCst))
    }

    pub fn tasks(&self, session: &str) -> Vec<String> {
        self.live(session).map(|live| live.running()).unwrap_or_default()
    }

    pub fn working(&self) -> usize {
        self.lives.lock().map_or(0, |lives| {
            lives
                .values()
                .filter(|live| live.busy.load(Ordering::SeqCst) || !live.running().is_empty())
                .count()
        })
    }

    pub fn stop_task(&self, session: &str, task: &str) -> Result<(), String> {
        let live = self.live(session).ok_or_else(gone)?;
        live.control(json!({ "subtype": "stop_task", "task_id": task }))
    }

    pub fn forget(&self, session: &str) {
        let Some(live) = self.lives.lock().ok().and_then(|mut lives| lives.remove(session)) else {
            return;
        };
        live.forgotten.store(true, Ordering::SeqCst);
        live.kill();
        if let Ok(mut child) = live.child.lock() {
            let _ = child.wait();
        }
    }

    pub fn shutdown(&self) {
        if let Ok(mut lives) = self.lives.lock() {
            for (_, live) in lives.drain() {
                live.kill();
            }
        }
    }

    fn live(&self, session: &str) -> Option<Arc<Live>> {
        self.lives.lock().ok()?.get(session).cloned()
    }

    fn ready(&self, root: &Path, session: &str, settings: Settings, sink: Sink) -> Result<Arc<Live>, String> {
        let mut lives = self.lives.lock().map_err(|_| {
            said!(
                en: "the session registry broke",
                es: "el registro de sesiones se rompió",
                fr: "le registre des sessions est endommagé",
                de: "das Sitzungsregister ist beschädigt",
                ja: "セッションの登録情報が壊れました",
                zh: "会话注册表已损坏",
            )
        })?;
        if let Some(live) = lives.get(session).cloned() {
            let same = live.settings.lock().is_ok_and(|kept| *kept == settings);
            if same && live.alive() {
                if let Ok(mut kept) = live.sink.lock() {
                    *kept = sink;
                }
                return Ok(live);
            }
            if live.busy.load(Ordering::SeqCst) {
                return Err(still_working());
            }
            live.kill();
            lives.remove(session);
        }
        lives.retain(|_, other| {
            let working = other.busy.load(Ordering::SeqCst) || !other.running().is_empty();
            if !working {
                other.kill();
            }
            working
        });

        let live = self.spawn(root, session, settings, sink)?;
        lives.insert(session.to_string(), live.clone());
        Ok(live)
    }

    fn command(&self) -> Command {
        match self.launcher.split_first() {
            Some((program, leading)) => {
                let mut command = Command::new(program);
                command.args(leading);
                command
            }
            None => Command::new(process::program()),
        }
    }

    fn spawn(&self, root: &Path, session: &str, settings: Settings, sink: Sink) -> Result<Arc<Live>, String> {
        let args = arguments(&settings, &claude_id(session), session::has_begun(root, session));
        let cwd = settings.cwd.clone().unwrap_or_else(|| root.to_path_buf());

        let mut child = hidden(&mut self.command())
            .args(&args)
            .envs(&settings.env)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(unlaunched)?;

        let input = child.stdin.take().ok_or_else(process::no_input)?;
        let output = child.stdout.take().ok_or_else(process::no_output)?;
        let complaints = child.stderr.take().ok_or_else(|| {
            said!(
                en: "Claude Code gives no error output",
                es: "Claude Code no da errores",
                fr: "Claude Code ne renvoie pas sa sortie d’erreur",
                de: "Claude Code liefert keine Fehlerausgabe",
                ja: "Claude Code のエラー出力を取得できません",
                zh: "无法获取 Claude Code 的错误输出",
            )
        })?;

        let live = Arc::new(Live {
            root: root.to_path_buf(),
            session: session.to_string(),
            input: Mutex::new(input),
            family: Family::around(&child),
            child: Mutex::new(child),
            settings: Mutex::new(settings),
            busy: AtomicBool::new(false),
            stopping: AtomicBool::new(false),
            requests: AtomicU64::new(1),
            pending: Mutex::default(),
            tasks: Mutex::default(),
            log: Mutex::default(),
            sink: Mutex::new(sink),
            offered: Mutex::default(),
            told: Condvar::new(),
            compacted: AtomicBool::new(false),
            forgotten: AtomicBool::new(false),
        });
        live.write(&json!({ "type": "control_request", "request_id": GREETING, "request": { "subtype": "initialize", "hooks": null } }))?;

        let heard = Arc::new(Mutex::new(String::new()));
        let collected = heard.clone();
        std::thread::spawn(move || collect(complaints, collected));

        let reader = live.clone();
        let lives = self.lives.clone();
        std::thread::spawn(move || listen(reader, output, heard, lives));
        Ok(live)
    }
}

fn collect(mut complaints: ChildStderr, heard: Arc<Mutex<String>>) {
    let mut chunk = [0u8; 1024];
    while let Ok(read) = complaints.read(&mut chunk) {
        if read == 0 {
            break;
        }
        if let Ok(mut text) = heard.lock() {
            text.push_str(&String::from_utf8_lossy(&chunk[..read]));
            let excess = text.len().saturating_sub(HEARD_CAP);
            if excess > 0 {
                let cut = (excess..text.len()).find(|at| text.is_char_boundary(*at)).unwrap_or(text.len());
                text.drain(..cut);
            }
        }
    }
}

fn listen(live: Arc<Live>, output: ChildStdout, heard: Arc<Mutex<String>>, lives: Lives) {
    for line in BufReader::new(output).lines().map_while(Result::ok) {
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(slashes) = offered(&message) {
            live.offer(slashes);
            continue;
        }
        for event in interpret(&message) {
            let event = live.settle(event);
            if event.lasting() {
                live.keep(event.clone());
            }
            live.tell(&event);
        }
    }
    live.offer(Vec::new());

    if live.busy.swap(false, Ordering::SeqCst) {
        let said = heard.lock().map(|text| text.trim().to_string()).unwrap_or_default();
        let event = Event::Failed {
            reason: match said.is_empty() {
                true => said!(
                    en: "Claude Code closed before finishing its turn.",
                    es: "Claude Code se cerró sin terminar el turno.",
                    fr: "Claude Code s’est fermé avant de terminer son tour.",
                    de: "Claude Code wurde beendet, bevor die Antwort fertig war.",
                    ja: "Claude Code が応答を終える前に終了しました。",
                    zh: "Claude Code 在完成本轮之前关闭了。",
                ),
                false => said!(
                    en: "Claude Code closed: {said}",
                    es: "Claude Code se cerró: {said}",
                    fr: "Claude Code s’est fermé : {said}",
                    de: "Claude Code wurde beendet: {said}",
                    ja: "Claude Code が終了しました: {said}",
                    zh: "Claude Code 已关闭：{said}",
                ),
            },
        };
        live.keep(event.clone());
        live.tell(&event);
    }

    for event in live.abandon() {
        live.keep(event.clone());
        live.tell(&event);
    }

    if let Ok(mut lives) = lives.lock()
        && lives.get(&live.session).is_some_and(|kept| Arc::ptr_eq(kept, &live))
    {
        lives.remove(&live.session);
    }
}

pub fn arguments(settings: &Settings, id: &str, resume: bool) -> Vec<String> {
    let traits = catalog::traits(&settings.model);
    let mut args: Vec<String> = STREAMING.iter().map(|arg| arg.to_string()).collect();
    args.extend(["--permission-mode".to_string(), settings.mode.clone()]);
    if !settings.model.is_empty() {
        args.extend(["--model".to_string(), settings.model.clone()]);
    }
    if traits.efforts.contains(&settings.effort.as_str()) {
        args.extend(["--effort".to_string(), settings.effort.clone()]);
    }
    if !settings.thinking && traits.thinking == Thinking::Toggle {
        args.extend(["--thinking".to_string(), "disabled".to_string()]);
    }
    args.extend(settings.extra.iter().cloned());
    let session_flag = if resume { "--resume" } else { "--session-id" };
    args.extend([session_flag.to_string(), id.to_string()]);
    args
}

pub fn claude_id(session: &str) -> String {
    if session::is_uuid(session) {
        return session.to_ascii_lowercase();
    }
    let hashed = |salt: u64| {
        let mut hasher = DefaultHasher::new();
        hasher.write_u64(salt);
        hasher.write(session.as_bytes());
        hasher.finish() as u128
    };
    session::uuid_from((hashed(1) << 64) | hashed(2))
}

pub const FILES_BRIEF: &str = "Attached files (read them before answering):";
pub const FOLDERS_BRIEF: &str = "Attached folders (explore them as needed):";
pub const BRIEFS: [&str; 3] = [FILES_BRIEF, FOLDERS_BRIEF, "Ficheros adjuntos (léelos antes de responder):"];

fn briefed(text: &str, files: &[String]) -> String {
    let (folders, files): (Vec<&String>, Vec<&String>) = files.iter().partition(|file| file.ends_with(['/', '\\']));
    let mut said = text.to_string();
    for (head, listed) in [(FILES_BRIEF, files), (FOLDERS_BRIEF, folders)] {
        if listed.is_empty() {
            continue;
        }
        if !said.trim().is_empty() {
            said.push_str("\n\n");
        }
        said.push_str(head);
        for file in listed {
            said.push_str("\n- ");
            said.push_str(file);
        }
    }
    said
}

fn user_message(message: &Message) -> Value {
    let text = briefed(&message.text, &message.files);
    let content = match message.images.is_empty() {
        true => Value::String(text),
        false => Value::Array(
            message
                .images
                .iter()
                .map(|image| {
                    json!({
                        "type": "image",
                        "source": { "type": "base64", "media_type": image.media_type, "data": image.data }
                    })
                })
                .chain((!text.trim().is_empty()).then(|| json!({ "type": "text", "text": text })))
                .collect(),
        ),
    };
    json!({
        "type": "user",
        "message": { "role": "user", "content": content },
        "parent_tool_use_id": null,
        "session_id": ""
    })
}

fn respond(pending: &Pending, decision: &Decision) -> Value {
    if !decision.allow {
        let message = decision.message.trim();
        return json!({
            "behavior": "deny",
            "message": if message.is_empty() { denied() } else { message.to_string() }
        });
    }

    let mut input = pending.input.clone();
    if decision.answers.is_object() && input.is_object() {
        input["answers"] = decision.answers.clone();
    }

    let mut updates = Vec::new();
    if decision.remember {
        updates.extend(for_this_session(&pending.suggestions));
    }
    if MODES.contains(&decision.mode.as_str()) {
        updates.push(json!({ "type": "setMode", "mode": decision.mode, "destination": "session" }));
    }

    let mut response = json!({ "behavior": "allow", "updatedInput": input });
    if !updates.is_empty() {
        response["updatedPermissions"] = Value::Array(updates);
    }
    response
}

fn for_this_session(suggestions: &Value) -> Vec<Value> {
    suggestions
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .map(|suggestion| {
            let mut kept = suggestion.clone();
            kept.insert("destination".into(), json!("session"));
            Value::Object(kept)
        })
        .collect()
}

fn mode_after(pending: &Pending, decision: &Decision) -> Option<String> {
    if !decision.allow {
        return None;
    }
    if MODES.contains(&decision.mode.as_str()) {
        return Some(decision.mode.clone());
    }
    if !decision.remember {
        return None;
    }
    pending
        .suggestions
        .as_array()?
        .iter()
        .find(|suggestion| suggestion["type"] == "setMode")
        .and_then(|suggestion| suggestion["mode"].as_str())
        .filter(|mode| MODES.contains(mode))
        .map(str::to_string)
}

pub fn translate(line: &str) -> Vec<Event> {
    let Ok(message) = serde_json::from_str::<Value>(line) else {
        return Vec::new();
    };
    interpret(&message)
}

pub fn interpret(message: &Value) -> Vec<Event> {
    if let Some(parent) = message["parent_tool_use_id"].as_str() {
        return consulted_by(parent, message).into_iter().collect();
    }
    match message["type"].as_str().unwrap_or_default() {
        "stream_event" => delta(&message["event"]).into_iter().collect(),
        "assistant" => blocks(&message["message"]["content"])
            .filter_map(said)
            .collect(),
        "user" => results(message),
        "control_request" => asking(message).into_iter().collect(),
        "system" => system(message).into_iter().collect(),
        "rate_limit_event" => limits(message).into_iter().collect(),
        "result" => vec![finished(message)],
        _ => Vec::new(),
    }
}

fn offered(message: &Value) -> Option<Vec<Slash>> {
    if message["type"] != "control_response" || message["response"]["request_id"] != GREETING {
        return None;
    }
    Some(
        blocks(&message["response"]["response"]["commands"])
            .filter_map(|command| {
                let name = text_of(&command["name"]);
                (!name.is_empty() && !name.starts_with('_')).then(|| Slash {
                    name,
                    description: capped(text_of(&command["description"]).trim(), DESCRIPTION_CAP),
                    hint: text_of(&command["argumentHint"]),
                })
            })
            .collect(),
    )
}

fn blocks(content: &Value) -> impl Iterator<Item = &Value> {
    content.as_array().into_iter().flatten()
}

fn text_of(value: &Value) -> String {
    value.as_str().unwrap_or_default().to_string()
}

fn delta(event: &Value) -> Option<Event> {
    if event["type"] != "content_block_delta" {
        return None;
    }
    let delta = &event["delta"];
    let (thinking, text) = match delta["type"].as_str()? {
        "text_delta" => (false, text_of(&delta["text"])),
        "thinking_delta" => (true, text_of(&delta["thinking"])),
        _ => return None,
    };
    (!text.is_empty()).then_some(Event::Delta { thinking, text })
}

fn said(block: &Value) -> Option<Event> {
    match block["type"].as_str()? {
        "text" => {
            let text = text_of(&block["text"]);
            (!text.trim().is_empty()).then_some(Event::Said { text })
        }
        "thinking" => {
            let text = text_of(&block["thinking"]);
            (!text.trim().is_empty()).then_some(Event::Thought { text })
        }
        "tool_use" => Some(Event::Tool {
            id: text_of(&block["id"]),
            name: text_of(&block["name"]),
            input: slim(&block["input"]),
        }),
        _ => None,
    }
}

fn results(message: &Value) -> Vec<Event> {
    let answered: Vec<&Value> = blocks(&message["message"]["content"])
        .filter(|block| block["type"] == "tool_result")
        .collect();
    let detail = match answered.len() {
        1 => slim(&message["tool_use_result"]),
        _ => Value::Null,
    };
    let mut events = Vec::new();
    for block in answered {
        let id = text_of(&block["tool_use_id"]);
        let text = flatten(&block["content"]);
        let links = searched_links(&text);
        events.push(Event::ToolDone {
            id: id.clone(),
            output: capped(&text, OUTPUT_CAP),
            error: block["is_error"].as_bool().unwrap_or(false),
            detail: detail.clone(),
        });
        if !links.is_empty() {
            events.push(Event::Consulted { tool: id, links });
        }
    }
    events
}

fn searched_links(text: &str) -> Vec<Link> {
    let Some(rest) = text.strip_prefix(SEARCHED) else {
        return Vec::new();
    };
    let Some(at) = rest.find("Links: ") else {
        return Vec::new();
    };
    serde_json::Deserializer::from_str(&rest[at + "Links: ".len()..])
        .into_iter::<Vec<Link>>()
        .next()
        .and_then(Result::ok)
        .map(|mut links| {
            links.truncate(SOURCES_CAP);
            links
        })
        .unwrap_or_default()
}

fn fetched_link(block: &Value) -> Option<Link> {
    (block["type"] == "tool_use" && block["name"] == "WebFetch").then(|| Link {
        url: text_of(&block["input"]["url"]),
        title: String::new(),
    })
}

fn consulted_by(parent: &str, message: &Value) -> Option<Event> {
    let content = &message["message"]["content"];
    let links: Vec<Link> = match message["type"].as_str()? {
        "assistant" => blocks(content).filter_map(fetched_link).filter(|link| !link.url.is_empty()).collect(),
        "user" => blocks(content)
            .filter(|block| block["type"] == "tool_result")
            .flat_map(|block| searched_links(&flatten(&block["content"])))
            .collect(),
        _ => return None,
    };
    (!links.is_empty()).then(|| Event::Consulted {
        tool: parent.to_string(),
        links,
    })
}

fn flatten(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| match part["type"].as_str()? {
                "text" => part["text"].as_str().map(str::to_string),
                "image" => Some(picture()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn asking(message: &Value) -> Option<Event> {
    let request = &message["request"];
    if request["subtype"] != "can_use_tool" {
        return None;
    }
    Some(Event::Asking {
        request: text_of(&message["request_id"]),
        tool: text_of(&request["tool_name"]),
        input: request["input"].clone(),
        suggestions: match &request["permission_suggestions"] {
            Value::Array(listed) => Value::Array(listed.clone()),
            _ => json!([]),
        },
    })
}

fn system(message: &Value) -> Option<Event> {
    match message["subtype"].as_str()? {
        "init" => Some(Event::Started {
            model: text_of(&message["model"]),
        }),
        "task_started" => Some(Event::TaskStarted {
            id: text_of(&message["task_id"]),
            tool: text_of(&message["tool_use_id"]),
            runner: text_of(&message["task_type"]),
            description: text_of(&message["description"]),
            prompt: capped(&text_of(&message["prompt"]), TEXT_CAP),
        }),
        "task_progress" => Some(Event::TaskProgress {
            id: text_of(&message["task_id"]),
            doing: text_of(&message["description"]),
            last: text_of(&message["last_tool_name"]),
            tools: spent(message, "tool_uses"),
            tokens: spent(message, "total_tokens"),
            millis: spent(message, "duration_ms"),
        }),
        "task_notification" => Some(Event::TaskEnded {
            id: text_of(&message["task_id"]),
            status: ending(&message["status"]),
            summary: capped(&text_of(&message["summary"]), TEXT_CAP),
            output: text_of(&message["output_file"]),
            tools: spent(message, "tool_uses"),
            tokens: spent(message, "total_tokens"),
            millis: spent(message, "duration_ms"),
        }),
        "compact_boundary" => Some(Event::Compacted {
            before: message["compact_metadata"]["pre_tokens"].as_u64().unwrap_or_default(),
            auto: message["compact_metadata"]["trigger"] == "auto",
        }),
        _ => None,
    }
}

fn spent(message: &Value, key: &str) -> u64 {
    message["usage"][key].as_u64().unwrap_or_default()
}

fn ending(status: &Value) -> String {
    match status.as_str().unwrap_or_default() {
        "killed" | "stopped" => "stopped".into(),
        "failed" => "failed".into(),
        _ => "completed".into(),
    }
}

fn limits(message: &Value) -> Option<Event> {
    let info = message["rate_limit_info"].as_object()?;
    let field = |key: &str| info.get(key).unwrap_or(&Value::Null);
    let window = text_of(field("rateLimitType"));
    let mut windows: BTreeMap<String, Window> = entries(field("unifiedWindows"))
        .map(|(key, one)| (key.clone(), Window { utilization: one["utilization"].as_f64(), resets_at: moment(&one["resetsAt"]) }))
        .collect();
    let utilization = field("utilization").as_f64();
    let resets_at = moment(field("resetsAt"));
    if !window.is_empty() && window != "overage" && (utilization.is_some() || resets_at.is_some()) {
        windows.entry(window.clone()).or_insert(Window { utilization, resets_at });
    }
    let overage = OVERAGE.iter().any(|key| !field(key).is_null()).then(|| Overage {
        status: text_of(field("overageStatus")),
        using: field("isUsingOverage").as_bool().unwrap_or_default(),
        resets_at: moment(field("overageResetsAt")),
        disabled: text_of(field("overageDisabledReason")),
    });
    Some(Event::Limits {
        status: text_of(field("status")),
        window,
        utilization,
        resets_at,
        threshold: field("surpassedThreshold").as_f64(),
        overage,
        windows,
    })
}

const OVERAGE: &[&str] = &["overageStatus", "isUsingOverage", "overageResetsAt", "overageDisabledReason"];

fn entries(value: &Value) -> impl Iterator<Item = (&String, &Value)> {
    value.as_object().into_iter().flatten()
}

fn moment(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_f64().filter(|at| at.is_finite() && *at > 0.0).map(|at| at.round() as u64)).filter(|at| *at > 0)
}

fn read_in(usage: &Value) -> u64 {
    ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]
        .iter()
        .map(|key| usage[key].as_u64().unwrap_or_default())
        .sum()
}

fn finished(message: &Value) -> Event {
    let usage = &message["usage"];
    let failed = message["is_error"].as_bool().unwrap_or(false);
    let last_call = usage["iterations"].as_array().and_then(|calls| calls.last());
    Event::Finished {
        ok: !failed,
        stopped: false,
        millis: message["duration_ms"].as_u64().unwrap_or_default(),
        turns: message["num_turns"].as_u64().unwrap_or_default(),
        tokens_in: read_in(usage),
        tokens_out: usage["output_tokens"].as_u64().unwrap_or_default(),
        context: last_call.map_or(0, |call| read_in(call) + call["output_tokens"].as_u64().unwrap_or_default()),
        window: message["modelUsage"]
            .as_object()
            .into_iter()
            .flat_map(|models| models.values())
            .filter_map(|model| model["contextWindow"].as_u64())
            .max()
            .unwrap_or_default(),
        error: if failed { complaint(message) } else { String::new() },
    }
}

fn complaint(message: &Value) -> String {
    let said = text_of(&message["result"]);
    if !said.trim().is_empty() {
        return said;
    }
    let listed: Vec<String> = blocks(&message["errors"]).map(text_of).collect();
    if !listed.is_empty() {
        return listed.join(" · ");
    }
    let subtype = text_of(&message["subtype"]);
    said!(
        en: "Claude Code ended with {subtype}",
        es: "Claude Code terminó con {subtype}",
        fr: "Claude Code s’est terminé avec {subtype}",
        de: "Claude Code endete mit {subtype}",
        ja: "Claude Code が {subtype} で終了しました",
        zh: "Claude Code 以 {subtype} 结束",
    )
}

fn slim(value: &Value) -> Value {
    match value {
        Value::String(text) => Value::String(capped(text, TEXT_CAP)),
        Value::Array(items) => Value::Array(items.iter().take(ITEM_CAP).map(slim).collect()),
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .filter(|(key, _)| !BULKY.contains(&key.as_str()))
                .map(|(key, inner)| (key.clone(), slim(inner)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn capped(text: &str, cap: usize) -> String {
    if text.len() <= cap {
        return text.to_string();
    }
    let end = (0..=cap).rev().find(|at| text.is_char_boundary(*at)).unwrap_or_default();
    format!("{}…", &text[..end])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::language::{Language, speaking};

    fn opus(mode: &str) -> Settings {
        Settings {
            model: "claude-opus-5-5".into(),
            effort: "high".into(),
            mode: mode.into(),
            ..Settings::default()
        }
    }

    fn one(line: &str) -> Event {
        let mut found = translate(line);
        assert_eq!(found.len(), 1, "{line} dio {found:?}");
        found.remove(0)
    }

    #[test]
    fn an_engine_without_sessions_is_not_working() {
        assert_eq!(Engine::default().working(), 0);
    }

    #[test]
    fn streamed_text_and_thinking_arrive_as_deltas() {
        assert_eq!(
            one(r#"{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"La clave"}},"parent_tool_use_id":null}"#),
            Event::Delta { thinking: false, text: "La clave".into() }
        );
        assert_eq!(
            one(r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Sumo 2h55"}},"parent_tool_use_id":null}"#),
            Event::Delta { thinking: true, text: "Sumo 2h55".into() }
        );
    }

    #[test]
    fn empty_thinking_and_tool_input_deltas_are_dropped() {
        assert!(translate(r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":""}}}"#).is_empty());
        assert!(translate(r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\"a"}}}"#).is_empty());
        assert!(translate(r#"{"type":"stream_event","event":{"type":"message_start"}}"#).is_empty());
    }

    #[test]
    fn a_finished_message_gives_its_text_thinking_and_tool_calls() {
        let found = translate(r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"Leo el fichero.","signature":"x"},{"type":"text","text":"Voy."},{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"C:\\p\\a.txt"}}]},"parent_tool_use_id":null}"#);
        assert_eq!(
            found,
            vec![
                Event::Thought { text: "Leo el fichero.".into() },
                Event::Said { text: "Voy.".into() },
                Event::Tool { id: "toolu_1".into(), name: "Read".into(), input: json!({ "file_path": "C:\\p\\a.txt" }) },
            ]
        );
    }

    #[test]
    fn redacted_thinking_says_nothing() {
        assert!(translate(r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"","signature":"x"}]}}"#).is_empty());
    }

    #[test]
    fn a_tool_result_carries_its_output_and_the_structured_detail() {
        let found = one(r#"{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_2","type":"tool_result","content":"hola-desde-bash","is_error":false}]},"parent_tool_use_id":null,"tool_use_result":{"stdout":"hola-desde-bash","stderr":"","interrupted":false}}"#);
        assert_eq!(
            found,
            Event::ToolDone {
                id: "toolu_2".into(),
                output: "hola-desde-bash".into(),
                error: false,
                detail: json!({ "stdout": "hola-desde-bash", "stderr": "", "interrupted": false }),
            }
        );
    }

    #[test]
    fn an_edit_result_keeps_the_patch_but_not_the_whole_original_file() {
        let found = one(r#"{"type":"user","message":{"content":[{"tool_use_id":"t","type":"tool_result","content":[{"type":"text","text":"ok"}]}]},"tool_use_result":{"filePath":"a.txt","originalFile":"Azul","structuredPatch":[{"oldStart":1,"oldLines":1,"newStart":1,"newLines":1,"lines":["-Azul","+Verde"]}]}}"#);
        let Event::ToolDone { output, detail, .. } = found else { panic!() };
        assert_eq!(output, "ok");
        assert!(detail.get("originalFile").is_none());
        assert_eq!(detail["structuredPatch"][0]["lines"][1], "+Verde");
    }

    #[test]
    fn a_failed_tool_is_marked_as_an_error() {
        let Event::ToolDone { error, output, .. } = one(r#"{"type":"user","message":{"content":[{"tool_use_id":"t","type":"tool_result","content":"Error: nope","is_error":true}]}}"#) else { panic!() };
        assert!(error);
        assert_eq!(output, "Error: nope");
    }

    #[test]
    fn a_permission_request_becomes_a_question_for_the_user() {
        let found = one(r#"{"type":"control_request","request_id":"66","request":{"subtype":"can_use_tool","tool_name":"Write","input":{"file_path":"n.txt","content":"hecho"},"permission_suggestions":[{"type":"setMode","mode":"acceptEdits","destination":"session"}],"tool_use_id":"toolu_3"}}"#);
        assert_eq!(
            found,
            Event::Asking {
                request: "66".into(),
                tool: "Write".into(),
                input: json!({ "file_path": "n.txt", "content": "hecho" }),
                suggestions: json!([{ "type": "setMode", "mode": "acceptEdits", "destination": "session" }]),
            }
        );
    }

    #[test]
    fn a_request_that_is_not_about_tools_is_ignored() {
        assert!(translate(r#"{"type":"control_request","request_id":"1","request":{"subtype":"hook_callback"}}"#).is_empty());
        assert!(translate(r#"{"type":"control_response","response":{"subtype":"success","request_id":"sens-1"}}"#).is_empty());
    }

    #[test]
    fn the_session_start_names_the_model_and_other_system_chatter_is_dropped() {
        assert_eq!(
            one(r#"{"type":"system","subtype":"init","session_id":"s","model":"claude-sonnet-5","permissionMode":"default"}"#),
            Event::Started { model: "claude-sonnet-5".into() }
        );
        assert!(translate(r#"{"type":"system","subtype":"task_summary","detail":"Reading a.txt"}"#).is_empty());
        assert!(translate(r#"{"type":"system","subtype":"status","status":"requesting"}"#).is_empty());
    }

    #[test]
    fn a_background_task_is_followed_from_start_to_end() {
        assert_eq!(
            one(r#"{"type":"system","subtype":"task_started","task_id":"b4nz","tool_use_id":"toolu_5","description":"Dormir y avisar","is_backgrounded":true,"task_type":"local_bash"}"#),
            Event::TaskStarted {
                id: "b4nz".into(),
                tool: "toolu_5".into(),
                runner: "local_bash".into(),
                description: "Dormir y avisar".into(),
                prompt: String::new(),
            }
        );
        assert_eq!(
            one(r#"{"type":"system","subtype":"task_progress","task_id":"a2d6","tool_use_id":"toolu_6","description":"Running Echo two","usage":{"total_tokens":24382,"tool_uses":2,"duration_ms":2361},"last_tool_name":"Bash"}"#),
            Event::TaskProgress {
                id: "a2d6".into(),
                doing: "Running Echo two".into(),
                last: "Bash".into(),
                tools: 2,
                tokens: 24382,
                millis: 2361,
            }
        );
        assert_eq!(
            one(r#"{"type":"system","subtype":"task_notification","task_id":"a2d6","tool_use_id":"toolu_6","status":"completed","output_file":"C:\\t\\a2d6.output","summary":"done","usage":{"total_tokens":26275,"tool_uses":2,"duration_ms":4094}}"#),
            Event::TaskEnded {
                id: "a2d6".into(),
                status: "completed".into(),
                summary: "done".into(),
                output: "C:\\t\\a2d6.output".into(),
                tools: 2,
                tokens: 26275,
                millis: 4094,
            }
        );
    }

    #[test]
    fn a_killed_task_reads_as_stopped_and_its_patch_is_left_to_the_notification() {
        let Event::TaskEnded { status, .. } = one(r#"{"type":"system","subtype":"task_notification","task_id":"b","status":"killed","summary":"x"}"#) else { panic!() };
        assert_eq!(status, "stopped");
        assert!(translate(r#"{"type":"system","subtype":"task_updated","task_id":"b","patch":{"status":"killed"}}"#).is_empty());
        assert!(translate(r#"{"type":"system","subtype":"background_tasks_changed","tasks":[]}"#).is_empty());
    }

    #[test]
    fn task_progress_is_not_kept_in_the_log() {
        assert!(!Event::TaskProgress { id: "a".into(), doing: String::new(), last: String::new(), tools: 0, tokens: 0, millis: 0 }.lasting());
        assert!(Event::abandoned("a".into()).lasting());
    }

    #[test]
    fn the_subscription_windows_are_passed_along() {
        let Event::Limits { windows, .. } = one(r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","unifiedWindows":{"five_hour":{"utilization":0.47,"resetsAt":1790167200}}}}"#) else { panic!() };
        assert_eq!(windows["five_hour"], Window { utilization: Some(0.47), resets_at: Some(1_790_167_200) });
    }

    #[test]
    fn the_limits_say_which_window_warns_and_every_window_of_the_plan() {
        let heard = one(
            r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1790485200,"rateLimitType":"seven_day","utilization":0.8,"isUsingOverage":false,"surpassedThreshold":0.75,"unifiedWindows":{"five_hour":{"utilization":0.03,"resetsAt":1790356200},"seven_day":{"utilization":0.8,"resetsAt":1790485200},"seven_day_opus":{"utilization":0.19,"resetsAt":1790485200.0}}}}"#,
        );
        let Event::Limits { status, window, utilization, resets_at, threshold, overage, windows } = heard else { panic!() };
        assert_eq!((status.as_str(), window.as_str(), utilization, resets_at, threshold), ("allowed_warning", "seven_day", Some(0.8), Some(1_790_485_200), Some(0.75)));
        assert_eq!(overage, Some(Overage { status: String::new(), using: false, resets_at: None, disabled: String::new() }));
        assert_eq!(windows.keys().collect::<Vec<_>>(), ["five_hour", "seven_day", "seven_day_opus"]);
        assert_eq!(windows["seven_day_opus"].resets_at, Some(1_790_485_200));
    }

    #[test]
    fn a_limit_named_only_at_the_top_still_reads_as_a_window() {
        let Event::Limits { windows, overage, .. } = one(r#"{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1790356200,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"out_of_credits"}}"#) else { panic!() };
        assert_eq!(windows["five_hour"], Window { utilization: None, resets_at: Some(1_790_356_200) });
        assert_eq!(overage.map(|one| (one.status, one.disabled)), Some(("rejected".into(), "out_of_credits".into())));
        assert!(translate(r#"{"type":"rate_limit_event"}"#).is_empty());
    }

    #[test]
    fn the_limits_travel_to_the_app_in_camel_case() {
        let sent = serde_json::to_value(one(r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1790356200,"unifiedWindows":{"five_hour":{"utilization":0.1,"resetsAt":1790356200}}}}"#)).unwrap();
        assert_eq!((sent["kind"].as_str(), sent["resetsAt"].as_u64(), sent["windows"]["five_hour"]["resetsAt"].as_u64()), (Some("limits"), Some(1_790_356_200), Some(1_790_356_200)));
        assert!(sent["overage"].is_null());
    }

    #[test]
    fn a_result_closes_the_turn_with_its_numbers() {
        assert_eq!(
            one(r#"{"type":"result","subtype":"success","is_error":false,"duration_ms":8698,"num_turns":2,"result":"La clave es 4217.","usage":{"input_tokens":2,"cache_creation_input_tokens":100,"cache_read_input_tokens":900,"output_tokens":17}}"#),
            Event::Finished { ok: true, stopped: false, millis: 8698, turns: 2, tokens_in: 1002, tokens_out: 17, context: 0, window: 0, error: String::new() }
        );
    }

    #[test]
    fn a_result_says_how_full_the_context_is_after_the_last_call() {
        let Event::Finished { tokens_in, context, window, .. } = one(
            r#"{"type":"result","subtype":"success","is_error":false,"usage":{"input_tokens":20,"cache_creation_input_tokens":0,"cache_read_input_tokens":40000,"output_tokens":300,"iterations":[{"input_tokens":10,"cache_read_input_tokens":18000,"cache_creation_input_tokens":0,"output_tokens":100},{"input_tokens":10,"cache_read_input_tokens":22000,"cache_creation_input_tokens":500,"output_tokens":200}]},"modelUsage":{"claude-haiku-4-5":{"contextWindow":200000},"claude-opus-5-5":{"contextWindow":1000000}}}"#
        ) else {
            panic!()
        };
        assert_eq!((tokens_in, context, window), (40020, 22710, 1_000_000));
    }

    #[test]
    fn a_result_without_calls_leaves_the_context_unknown() {
        let Event::Finished { context, window, .. } = one(r#"{"type":"result","subtype":"success","is_error":false,"usage":{"input_tokens":2}}"#) else { panic!() };
        assert_eq!((context, window), (0, 0));
    }

    #[test]
    fn a_compaction_is_told_with_its_size_and_whether_it_was_asked() {
        assert_eq!(
            one(r#"{"type":"system","subtype":"compact_boundary","compact_metadata":{"trigger":"manual","pre_tokens":154000}}"#),
            Event::Compacted { before: 154_000, auto: false }
        );
        let Event::Compacted { auto, .. } = one(r#"{"type":"system","subtype":"compact_boundary","compact_metadata":{"trigger":"auto","pre_tokens":1}}"#) else { panic!() };
        assert!(auto);
    }

    #[test]
    fn the_commands_claude_code_offers_come_with_the_answer_to_initialize() {
        let answer = json!({
            "type": "control_response",
            "response": { "subtype": "success", "request_id": GREETING, "response": { "commands": [
                { "name": "compact", "description": "Resume la conversación (bundled)", "argumentHint": "<instrucciones>" },
                { "name": "__remote-workflow", "description": "interno", "argumentHint": "" },
                { "name": "frontend-design", "description": "x".repeat(400), "argumentHint": "" }
            ] } }
        });
        let slashes = offered(&answer).unwrap();
        assert_eq!(slashes.iter().map(|one| one.name.as_str()).collect::<Vec<_>>(), ["compact", "frontend-design"]);
        assert_eq!(slashes[0].hint, "<instrucciones>");
        assert!(slashes[1].description.chars().count() <= DESCRIPTION_CAP + 1);
        assert_eq!(offered(&json!({ "type": "control_response", "response": { "subtype": "success", "request_id": "sens-2", "response": { "commands": [] } } })), None);
        assert_eq!(offered(&json!({ "type": "control_response", "response": { "subtype": "error", "request_id": GREETING, "error": "no" } })), Some(Vec::new()));
        assert_eq!(offered(&json!({ "type": "assistant" })), None);
    }

    #[test]
    fn a_failed_result_explains_itself() {
        let Event::Finished { ok, error, .. } = one(r#"{"type":"result","subtype":"error_during_execution","is_error":true,"result":"","errors":["[ede_diagnostic] result_type=user"]}"#) else { panic!() };
        assert!(!ok);
        assert_eq!(error, "[ede_diagnostic] result_type=user");
    }

    fn search_result(tool: &str, parent: Value, text: &str) -> String {
        json!({
            "type": "user",
            "message": { "content": [{ "tool_use_id": tool, "type": "tool_result", "content": text }] },
            "parent_tool_use_id": parent,
        })
        .to_string()
    }

    const SEARCH_TEXT: &str = "Web search results for query: \"tauri\"\n\nLinks: [{\"title\":\"Tauri 2.0\",\"url\":\"https://v2.tauri.app/blog/tauri-20/\"},{\"title\":\"Repo\",\"url\":\"https://github.com/tauri-apps/tauri\"}]\n\nTauri 2 adds [x](y).";

    #[test]
    fn a_search_names_its_sources() {
        let found = translate(&search_result("toolu_s", Value::Null, SEARCH_TEXT));
        assert_eq!(found.len(), 2);
        assert!(matches!(&found[0], Event::ToolDone { id, .. } if id == "toolu_s"));
        assert_eq!(
            found[1],
            Event::Consulted {
                tool: "toolu_s".into(),
                links: vec![
                    Link { url: "https://v2.tauri.app/blog/tauri-20/".into(), title: "Tauri 2.0".into() },
                    Link { url: "https://github.com/tauri-apps/tauri".into(), title: "Repo".into() },
                ],
            }
        );
    }

    #[test]
    fn what_a_subagent_reads_on_the_web_reaches_its_card() {
        let fetched = json!({
            "type": "assistant",
            "message": { "content": [
                { "type": "text", "text": "Busco." },
                { "type": "tool_use", "id": "toolu_f", "name": "WebFetch", "input": { "url": "https://serde.rs", "prompt": "title?" } }
            ] },
            "parent_tool_use_id": "toolu_agent",
        });
        assert_eq!(
            one(&fetched.to_string()),
            Event::Consulted { tool: "toolu_agent".into(), links: vec![Link { url: "https://serde.rs".into(), title: String::new() }] }
        );
        let Event::Consulted { tool, links } = one(&search_result("toolu_w", json!("toolu_agent"), SEARCH_TEXT)) else { panic!() };
        assert_eq!(tool, "toolu_agent");
        assert_eq!(links.len(), 2);
        assert!(translate(&search_result("t", json!("toolu_agent"), "one")).is_empty());
    }

    #[test]
    fn what_a_subagent_says_stays_inside_its_own_card() {
        assert!(translate(r#"{"type":"assistant","message":{"content":[{"type":"text","text":"sub"}]},"parent_tool_use_id":"toolu_9"}"#).is_empty());
    }

    #[test]
    fn noise_is_not_an_event() {
        assert!(translate("no es json").is_empty());
        assert!(translate(r#"{"type":"system","subtype":"hook_started"}"#).is_empty());
    }

    #[test]
    fn a_first_turn_names_the_session_and_later_ones_resume_it() {
        let id = "819e8d71-4433-4aff-ac86-07939fe6241c";
        let fresh = arguments(&opus("default"), id, false);
        let again = arguments(&opus("default"), id, true);

        assert!(fresh.windows(2).any(|pair| pair == ["--session-id", id]));
        assert!(again.windows(2).any(|pair| pair == ["--resume", id]));
        assert!(fresh.windows(2).any(|pair| pair == ["--thinking-display", "summarized"]));
        assert!(fresh.windows(2).any(|pair| pair == ["--permission-prompt-tool", "stdio"]));
        assert!(fresh.windows(2).any(|pair| pair == ["--effort", "high"]));
        assert!(fresh.windows(2).any(|pair| pair == ["--model", "claude-opus-5-5"]));
    }

    #[test]
    fn thinking_is_only_turned_off_where_the_model_allows_it() {
        let quiet_opus = Settings { thinking: false, ..opus("default") };
        assert!(!arguments(&quiet_opus, "x", false).contains(&"--thinking".to_string()));

        let quiet_sonnet = Settings { model: "claude-sonnet-5".into(), thinking: false, ..opus("default") };
        assert!(arguments(&quiet_sonnet, "x", false).windows(2).any(|pair| pair == ["--thinking", "disabled"]));
    }

    #[test]
    fn an_effort_the_model_does_not_have_is_left_out() {
        let haiku = Settings { model: "claude-haiku-4-5-20251001".into(), ..opus("default") };
        assert!(!arguments(&haiku, "x", false).contains(&"--effort".to_string()));

        let old = Settings { model: "claude-sonnet-4-6".into(), effort: "xhigh".into(), ..opus("default") };
        assert!(!arguments(&old, "x", false).contains(&"--effort".to_string()));
    }

    #[test]
    fn the_permission_mode_travels_as_chosen() {
        let planning = arguments(&opus("plan"), "x", false);
        assert!(planning.windows(2).any(|pair| pair == ["--permission-mode", "plan"]));
    }

    #[test]
    fn settings_refuse_what_they_do_not_know() {
        assert!(opus("default").vet().is_ok());
        assert!(Settings { provider: "gemini".into(), ..opus("default") }.vet().is_err());
        assert!(Settings { model: "--dangerously-skip-permissions".into(), ..opus("default") }.vet().is_err());
        assert!(Settings { effort: "turbo".into(), ..opus("default") }.vet().is_err());
        assert!(opus("bypassPermissions").vet().is_ok());
        assert!(opus("dontAsk").vet().is_err());
    }

    fn pending(input: Value, suggestions: Value) -> Pending {
        Pending { input, suggestions }
    }

    #[test]
    fn a_refusal_tells_claude_why() {
        let asked = pending(json!({ "command": "rm -rf build" }), json!([]));
        assert_eq!(respond(&asked, &Decision::default()), json!({ "behavior": "deny", "message": denied() }));
        assert_eq!(speaking(Language::Es, || respond(&asked, &Decision::default()))["message"], "El usuario lo rechazó.");
        assert_eq!(speaking(Language::En, || respond(&asked, &Decision::default()))["message"], "The user declined it.");

        let redirected = Decision { message: "Borra solo dist".into(), ..Decision::default() };
        assert_eq!(respond(&asked, &redirected)["message"], "Borra solo dist");
    }

    #[test]
    fn an_approval_runs_the_tool_exactly_as_claude_asked() {
        let asked = pending(json!({ "file_path": "a.txt", "content": "x".repeat(50_000) }), json!([]));
        let response = respond(&asked, &Decision { allow: true, ..Decision::default() });
        assert_eq!(response["behavior"], "allow");
        assert_eq!(response["updatedInput"]["content"].as_str().unwrap().len(), 50_000);
        assert!(response.get("updatedPermissions").is_none());
    }

    #[test]
    fn answers_ride_along_with_the_original_questions() {
        let questions = json!([{ "question": "¿Color?", "options": [{ "label": "Rojo" }, { "label": "Azul" }] }]);
        let asked = pending(json!({ "questions": questions }), json!([]));
        let decision = Decision { allow: true, answers: json!({ "¿Color?": "Azul" }), ..Decision::default() };

        let response = respond(&asked, &decision);

        assert_eq!(response["updatedInput"]["questions"], questions);
        assert_eq!(response["updatedInput"]["answers"]["¿Color?"], "Azul");
    }

    #[test]
    fn remembering_only_ever_lasts_this_session() {
        let asked = pending(json!({}), json!([{ "type": "addRules", "rules": [{ "toolName": "Bash" }], "destination": "localSettings" }]));
        let response = respond(&asked, &Decision { allow: true, remember: true, ..Decision::default() });
        assert_eq!(response["updatedPermissions"][0]["destination"], "session");
        assert_eq!(response["updatedPermissions"][0]["type"], "addRules");
    }

    #[test]
    fn approving_a_plan_can_switch_the_mode() {
        let asked = pending(json!({ "plan": "# Plan" }), json!([]));
        let decision = Decision { allow: true, mode: "acceptEdits".into(), ..Decision::default() };

        let response = respond(&asked, &decision);

        assert_eq!(response["updatedPermissions"], json!([{ "type": "setMode", "mode": "acceptEdits", "destination": "session" }]));
        assert_eq!(mode_after(&asked, &decision).as_deref(), Some("acceptEdits"));
    }

    #[test]
    fn remembering_a_mode_suggestion_changes_the_mode_the_session_is_in() {
        let asked = pending(json!({}), json!([{ "type": "setMode", "mode": "acceptEdits", "destination": "session" }]));
        let decision = Decision { allow: true, remember: true, ..Decision::default() };
        assert_eq!(mode_after(&asked, &decision).as_deref(), Some("acceptEdits"));
        assert_eq!(mode_after(&asked, &Decision { allow: true, ..Decision::default() }), None);
    }

    #[test]
    fn a_session_from_the_old_engine_still_gets_a_stable_claude_id() {
        let old = claude_id("s1758620000000");
        assert!(session::is_uuid(&old));
        assert_eq!(old, claude_id("s1758620000000"));
        assert_eq!(claude_id("819E8D71-4433-4AFF-AC86-07939FE6241C"), "819e8d71-4433-4aff-ac86-07939fe6241c");
    }

    fn picture() -> Image {
        Image { media_type: "image/png".into(), data: "iVBORw0KGgo=".into(), kept: String::new() }
    }

    #[test]
    fn a_plain_message_travels_as_plain_text() {
        let sent = user_message(&Message { text: "hola".into(), ..Message::default() });
        assert_eq!(sent["message"]["content"], "hola");
        assert_eq!(sent["type"], "user");
    }

    #[test]
    fn pictures_go_before_the_text_as_base64_blocks() {
        let sent = user_message(&Message { text: "¿De qué color es?".into(), images: vec![picture()], ..Message::default() });
        let content = &sent["message"]["content"];
        assert_eq!(content[0]["type"], "image");
        assert_eq!(content[0]["source"], json!({ "type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo=" }));
        assert_eq!(content[1], json!({ "type": "text", "text": "¿De qué color es?" }));
    }

    #[test]
    fn a_picture_can_be_sent_without_words() {
        let sent = user_message(&Message { images: vec![picture()], ..Message::default() });
        assert_eq!(sent["message"]["content"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn the_host_adds_its_own_arguments_and_changing_them_means_a_new_process() {
        let equipped = Settings { extra: vec!["--mcp-config".into(), "mcp.json".into()], ..opus("default") };
        assert!(arguments(&equipped, "x", false).windows(2).any(|pair| pair == ["--mcp-config", "mcp.json"]));
        assert_ne!(equipped, opus("default"));
    }

    #[test]
    fn a_new_environment_for_the_plugins_also_means_a_new_process() {
        let mut env = BTreeMap::new();
        env.insert("GITHUB_TOKEN".to_string(), "t".to_string());
        let equipped = Settings { env, ..opus("default") };
        assert_ne!(equipped, opus("default"));
        assert!(!arguments(&equipped, "x", false).iter().any(|arg| arg.contains("GITHUB_TOKEN")));
    }

    #[test]
    fn attached_files_are_named_for_claude_to_read() {
        assert_eq!(briefed("hola", &[]), "hola");
        let with = briefed("revisa", &["src/a.rs".into(), "b.md".into()]);
        assert_eq!(with, "revisa\n\nAttached files (read them before answering):\n- src/a.rs\n- b.md");
        let both = briefed("mira", &["src/".into(), "a.rs".into(), "C:\\docs\\".into()]);
        assert_eq!(both, "mira\n\nAttached files (read them before answering):\n- a.rs\n\nAttached folders (explore them as needed):\n- src/\n- C:\\docs\\");
        assert_eq!(briefed("", &["notas.txt".into()]), "Attached files (read them before answering):\n- notas.txt");
    }

    #[test]
    fn huge_text_is_cut_on_a_character_boundary() {
        let cut = capped(&"ñ".repeat(10), 5);
        assert_eq!(cut, "ññ…");
        assert_eq!(capped("corto", 10), "corto");
    }

    #[test]
    fn only_what_happened_is_written_down() {
        assert!(!Event::Delta { thinking: false, text: "a".into() }.lasting());
        assert!(!Event::Limits { status: String::new(), window: String::new(), utilization: None, resets_at: None, threshold: None, overage: None, windows: BTreeMap::new() }.lasting());
        assert!(Event::Said { text: "a".into() }.lasting());
        assert!(Event::Finished { ok: true, stopped: false, millis: 0, turns: 0, tokens_in: 0, tokens_out: 0, context: 0, window: 0, error: String::new() }.lasting());
        assert!(Event::Compacted { before: 1, auto: true }.lasting());
    }

    #[test]
    fn events_travel_to_the_app_in_camel_case() {
        let done = serde_json::to_value(Event::ToolDone { id: "t".into(), output: "o".into(), error: false, detail: Value::Null }).unwrap();
        assert_eq!(done["kind"], "toolDone");
        let finished = serde_json::to_value(Event::Finished { ok: true, stopped: false, millis: 1, turns: 1, tokens_in: 2, tokens_out: 3, context: 4, window: 5, error: String::new() }).unwrap();
        assert_eq!((finished["tokensOut"].as_u64(), finished["context"].as_u64(), finished["window"].as_u64()), (Some(3), Some(4), Some(5)));
        let old: Event = serde_json::from_str(r#"{"kind":"finished","ok":true,"stopped":false,"millis":1,"turns":1,"tokensIn":2,"tokensOut":3,"error":""}"#).unwrap();
        assert!(matches!(old, Event::Finished { context: 0, window: 0, .. }));
    }
}
