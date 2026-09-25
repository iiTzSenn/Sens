use std::io::{BufRead, BufReader};
use std::path::Path;

use serde::Deserialize;
use serde_json::Value;

use crate::chat::{self, Event};
use crate::said;
use crate::session::{self, Entry, Namer};

const IGNORED: [&str; 4] = ["isSidechain", "isMeta", "isCompactSummary", "isVisibleInTranscriptOnly"];
const TITLES: [(&str, &str, Namer); 4] = [
    ("custom-title", "customTitle", Namer::User),
    ("ai-title", "aiTitle", Namer::Ai),
    ("agent-name", "agentName", Namer::Ai),
    ("summary", "summary", Namer::Ai),
];
const UNSPOKEN: [&str; 3] = ["<local-command-", "<task-notification>", "[Request interrupted by user"];
const NOTIFICATION: &str = "task-notification";
const SYNTHETIC: &str = "<synthetic>";
const DETAIL: &str = "toolUseResult";
const TRANSLATED_DETAIL: &str = "tool_use_result";

pub struct Transcript {
    pub id: String,
    pub root: String,
    pub entries: Vec<Entry>,
}

#[derive(Debug, PartialEq)]
pub enum Adopted {
    Written,
    Already,
    Empty,
}

#[derive(Deserialize)]
struct Located {
    cwd: Option<String>,
}

struct Turn {
    from: u64,
    to: u64,
    started: bool,
    answers: u64,
    message: String,
}

#[derive(Default)]
struct Reading {
    root: Option<String>,
    first: Option<u64>,
    last: u64,
    entries: Vec<Entry>,
    turn: Option<Turn>,
    titles: [Option<String>; 4],
}

pub fn id_of(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    session::is_uuid(stem).then(|| stem.to_string())
}

pub fn root_of(path: &Path) -> Option<String> {
    lines(path)?.find_map(|line| {
        serde_json::from_slice::<Located>(&line)
            .ok()?
            .cwd
            .filter(|cwd| !cwd.is_empty())
    })
}

pub fn read(path: &Path) -> Option<Transcript> {
    let id = id_of(path)?;
    let mut reading = Reading::default();
    for line in lines(path)? {
        if let Ok(message) = serde_json::from_slice::<Value>(&line) {
            reading.take(message);
        }
    }
    reading.finish(id)
}

pub fn adopt(path: &Path) -> Result<Adopted, String> {
    let (Some(id), Some(root)) = (id_of(path), root_of(path)) else {
        return Ok(Adopted::Empty);
    };
    let folder = Path::new(&root);
    if session::exists(folder, &id) {
        return Ok(Adopted::Already);
    }
    if !folder.is_dir() {
        return Err(said!(
            en: "the folder {root} no longer exists",
            es: "la carpeta {root} ya no existe",
            fr: "le dossier {root} n’existe plus",
            de: "der Ordner {root} existiert nicht mehr",
            ja: "フォルダー {root} はもう存在しません",
            zh: "文件夹 {root} 已不存在",
        ));
    }
    let Some(found) = read(path).filter(|found| turns(&found.entries) > 0) else {
        return Ok(Adopted::Empty);
    };
    session::create(Path::new(&found.root), &found.id, &found.entries)?;
    Ok(Adopted::Written)
}

fn turns(entries: &[Entry]) -> usize {
    entries.iter().filter(|entry| matches!(entry, Entry::Task { .. })).count()
}

fn lines(path: &Path) -> Option<impl Iterator<Item = Vec<u8>>> {
    let handle = std::fs::File::open(path).ok()?;
    Some(BufReader::new(handle).split(b'\n').map_while(Result::ok))
}

impl Reading {
    fn take(&mut self, message: Value) {
        if self.root.is_none() {
            self.root = message["cwd"].as_str().filter(|cwd| !cwd.is_empty()).map(str::to_string);
        }
        let kind = message["type"].as_str().unwrap_or_default();
        if let Some(at) = TITLES.iter().position(|(title, ..)| *title == kind) {
            self.entitle(at, &message);
            return;
        }
        let stamped = message["timestamp"].as_str().and_then(instant);
        if let Some(at) = stamped {
            self.first.get_or_insert(at);
            self.last = self.last.max(at);
        }
        if IGNORED.iter().any(|flag| message[flag] == true) {
            return;
        }
        let at = stamped.unwrap_or(self.last);
        match kind {
            "user" if answers_a_tool(&message) => self.hear(at, message),
            "user" => self.ask(at, &message),
            "assistant" => self.answer(at, message),
            _ => {}
        }
    }

    fn entitle(&mut self, at: usize, message: &Value) {
        let (_, key, _) = TITLES[at];
        if let Some(title) = message[key].as_str().map(str::trim).filter(|title| !title.is_empty()) {
            self.titles[at] = Some(title.to_string());
        }
    }

    fn ask(&mut self, at: u64, message: &Value) {
        let Some((text, files)) = prompt(message) else {
            return;
        };
        self.close();
        self.entries.push(Entry::Task {
            at,
            text,
            files,
            images: Vec::new(),
        });
        self.turn = Some(Turn {
            from: at,
            to: at,
            started: false,
            answers: 0,
            message: String::new(),
        });
    }

    fn answer(&mut self, at: u64, message: Value) {
        let Some(turn) = self.turn.as_mut() else {
            return;
        };
        if !turn.started {
            turn.started = true;
            let model = message["message"]["model"].as_str().filter(|model| *model != SYNTHETIC);
            self.entries.push(Entry::Agent {
                at,
                event: Event::Started {
                    model: model.unwrap_or_default().to_string(),
                },
            });
        }
        let id = message["message"]["id"].as_str().unwrap_or_default();
        if id != turn.message {
            turn.answers += 1;
            turn.message = id.to_string();
        }
        self.hear(at, message);
    }

    fn hear(&mut self, at: u64, mut message: Value) {
        let Some(turn) = self.turn.as_mut() else {
            return;
        };
        turn.to = turn.to.max(at);
        if let Some(detail) = message.as_object_mut().and_then(|fields| fields.remove(DETAIL)) {
            message[TRANSLATED_DETAIL] = detail;
        }
        let events = chat::interpret(&message).into_iter().filter(Event::lasting);
        self.entries.extend(events.map(|event| Entry::Agent { at, event }));
    }

    fn close(&mut self) {
        let Some(turn) = self.turn.take() else {
            return;
        };
        self.entries.push(Entry::Agent {
            at: turn.to,
            event: Event::Finished {
                ok: true,
                stopped: false,
                millis: turn.to.saturating_sub(turn.from),
                turns: turn.answers,
                tokens_in: 0,
                tokens_out: 0,
                context: 0,
                window: 0,
                error: String::new(),
            },
        });
    }

    fn title(&self) -> Option<(String, Namer)> {
        TITLES
            .iter()
            .zip(&self.titles)
            .find_map(|((_, _, by), title)| Some((session::shorten(title.as_deref()?), *by)))
    }

    fn finish(mut self, id: String) -> Option<Transcript> {
        self.close();
        let root = self.root.clone()?;
        let opened = self.first.unwrap_or(self.last);
        let mut entries = vec![Entry::Opened { at: opened, root: root.clone() }];
        entries.append(&mut self.entries);
        resumable(&mut entries);
        if let Some((title, by)) = self.title() {
            entries.push(Entry::Titled { at: self.last, title, by });
        }
        Some(Transcript { id, root, entries })
    }
}

fn resumable(entries: &mut Vec<Entry>) {
    let begun = entries.iter().any(|entry| matches!(entry, Entry::Agent { event: Event::Started { .. }, .. }));
    let first = entries.iter().enumerate().find_map(|(place, entry)| match entry {
        Entry::Task { at, .. } => Some((place, *at)),
        _ => None,
    });
    if let (false, Some((place, at))) = (begun, first) {
        let event = Event::Started { model: String::new() };
        entries.insert(place + 1, Entry::Agent { at, event });
    }
}

fn answers_a_tool(message: &Value) -> bool {
    message["message"]["content"]
        .as_array()
        .is_some_and(|blocks| blocks.iter().any(|block| block["type"] == "tool_result"))
}

fn prompt(message: &Value) -> Option<(String, Vec<String>)> {
    if message["origin"]["kind"] == NOTIFICATION {
        return None;
    }
    let content = &message["message"]["content"];
    let blocks = content.as_array().map(Vec::as_slice).unwrap_or_default();
    let text = match content {
        Value::String(text) => text.clone(),
        _ => blocks
            .iter()
            .filter(|block| block["type"] == "text")
            .filter_map(|block| block["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
    };
    let pictured = blocks.iter().any(|block| block["type"] == "image");
    let (said, files) = unbriefed(&text);
    match spoken(&said, pictured) {
        Some(said) => Some((said, files)),
        None if !files.is_empty() => Some((String::new(), files)),
        None => None,
    }
}

fn unbriefed(text: &str) -> (String, Vec<String>) {
    let starts = [0].into_iter().chain(text.match_indices('\n').map(|(at, _)| at + 1));
    starts
        .filter(|at| chat::BRIEFS.iter().any(|head| text[*at..].starts_with(head)))
        .find_map(|at| Some((text[..at].trim_end().to_string(), listed(&text[at..])?)))
        .unwrap_or_else(|| (text.to_string(), Vec::new()))
}

fn listed(brief: &str) -> Option<Vec<String>> {
    let mut files = Vec::new();
    let mut folders = false;
    for line in brief.lines().map(str::trim_end) {
        if let Some(head) = chat::BRIEFS.iter().find(|head| line == **head) {
            folders = *head == chat::FOLDERS_BRIEF;
        } else if let Some(file) = line.strip_prefix("- ").filter(|file| !file.trim().is_empty()) {
            files.push(if folders && !file.ends_with(['/', '\\']) { format!("{file}/") } else { file.to_string() });
        } else if !line.is_empty() {
            return None;
        }
    }
    Some(files)
}

fn spoken(text: &str, pictured: bool) -> Option<String> {
    let text = text.trim();
    if UNSPOKEN.iter().any(|mark| text.starts_with(mark)) {
        return None;
    }
    if let Some(name) = text.starts_with('<').then(|| tagged(text, "command-name")).flatten() {
        let command = format!("/{}", name.trim().trim_start_matches('/'));
        let args = tagged(text, "command-args").unwrap_or_default().trim();
        return Some(if args.is_empty() { command } else { format!("{command} {args}") });
    }
    match (text.is_empty(), pictured) {
        (false, _) => Some(text.to_string()),
        (true, true) => Some(chat::picture()),
        (true, false) => None,
    }
}

fn tagged<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let start = text.find(&open)? + open.len();
    let end = start + text[start..].find(&format!("</{tag}>"))?;
    Some(&text[start..end])
}

fn instant(text: &str) -> Option<u64> {
    let bytes = text.as_bytes();
    let shaped = bytes.len() >= 19
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && matches!(bytes[10], b'T' | b't' | b' ')
        && bytes[13] == b':'
        && bytes[16] == b':';
    if !shaped {
        return None;
    }
    let number = |from: usize, to: usize| -> Option<i64> {
        let digits = text.get(from..to)?;
        digits.bytes().all(|byte| byte.is_ascii_digit()).then(|| digits.parse().ok())?
    };
    let (year, month, day) = (number(0, 4)?, number(5, 7)?, number(8, 10)?);
    let (hour, minute, second) = (number(11, 13)?, number(14, 16)?, number(17, 19)?);
    let rest = &text[19..];
    let fraction: String = rest
        .strip_prefix('.')
        .map(|digits| digits.chars().take_while(char::is_ascii_digit).collect())
        .unwrap_or_default();
    let millis: i64 = format!("{fraction:0<3}")[..3].parse().ok()?;
    let zone = &rest[if fraction.is_empty() { 0 } else { fraction.len() + 1 }..];
    let offset = match zone {
        "" | "Z" | "z" => 0,
        _ => {
            let sign = match zone.as_bytes()[0] {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            let (hours, minutes) = zone[1..].split_once(':')?;
            sign * (hours.parse::<i64>().ok()? * 60 + minutes.parse::<i64>().ok()?)
        }
    };
    let seconds = days(year, month, day) * 86_400 + hour * 3_600 + (minute - offset) * 60 + second;
    u64::try_from(seconds * 1_000 + millis).ok()
}

fn days(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let within = year - era * 400;
    let into_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let into_era = within * 365 + within / 4 - within / 100 + into_year;
    era * 146_097 + into_era - 719_468
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::*;
    use crate::language::{Language, speaking};

    const ID: &str = "4f1d2c3b-5a69-4e7f-8a1b-2c3d4e5f6a7b";

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sens-transcript-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(path.join("proyecto")).unwrap();
        std::fs::create_dir_all(path.join("claude")).unwrap();
        path
    }

    fn fixture(place: &Path) -> PathBuf {
        let text = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join("transcript.jsonl")).unwrap();
        let root = serde_json::to_string(&place.join("proyecto").to_string_lossy()).unwrap();
        let file = place.join("claude").join(format!("{ID}.jsonl"));
        std::fs::write(&file, text.replace("\"ROOT\"", &root)).unwrap();
        file
    }

    fn written(place: &Path, lines: &[Value]) -> PathBuf {
        let root = place.join("proyecto").to_string_lossy().into_owned();
        let text: String = lines
            .iter()
            .map(|line| {
                let mut line = line.clone();
                if line["type"] == "user" || line["type"] == "assistant" {
                    line["cwd"] = json!(root);
                }
                format!("{line}\n")
            })
            .collect();
        let file = place.join("claude").join(format!("{ID}.jsonl"));
        std::fs::write(&file, text).unwrap();
        file
    }

    fn user(text: &str, at: &str) -> Value {
        json!({ "type": "user", "message": { "role": "user", "content": text }, "timestamp": at })
    }

    fn assistant(id: &str, model: &str, text: &str, at: &str) -> Value {
        json!({ "type": "assistant", "message": { "id": id, "model": model, "role": "assistant", "content": [{ "type": "text", "text": text }] }, "timestamp": at })
    }

    fn events(entries: &[Entry]) -> Vec<&Event> {
        entries
            .iter()
            .filter_map(|entry| match entry {
                Entry::Agent { event, .. } => Some(event),
                _ => None,
            })
            .collect()
    }

    fn tasks(entries: &[Entry]) -> Vec<&str> {
        entries
            .iter()
            .filter_map(|entry| match entry {
                Entry::Task { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn each_prompt_opens_a_turn_that_ends_with_a_finish() {
        let place = temp_root("turns");
        let found = read(&fixture(&place)).unwrap();

        assert_eq!(found.id, ID);
        assert_eq!(found.root, place.join("proyecto").to_string_lossy());
        assert!(matches!(&found.entries[0], Entry::Opened { at: 1_789_898_400_000, root } if *root == found.root));
        assert!(matches!(&found.entries[1], Entry::Task { at: 1_789_898_400_100, text, files, images } if text == "Revisa el README" && files.is_empty() && images.is_empty()));
        assert_eq!(tasks(&found.entries), vec!["Revisa el README", "/review 42", "¿Qué ves?"]);

        let finishes: Vec<(u64, u64)> = events(&found.entries)
            .into_iter()
            .filter_map(|event| match event {
                Event::Finished { ok: true, stopped: false, millis, turns, tokens_in: 0, tokens_out: 0, context: 0, window: 0, error } if error.is_empty() => Some((*millis, *turns)),
                _ => None,
            })
            .collect();
        assert_eq!(finishes, vec![(3_900, 2), (3_000, 1), (2_000, 1)]);
        assert!(matches!(found.entries.last(), Some(Entry::Titled { .. })));
    }

    #[test]
    fn tools_and_their_results_come_back_with_the_detail_claude_code_kept() {
        let place = temp_root("tools");
        let found = read(&fixture(&place)).unwrap();
        let heard = events(&found.entries);

        assert_eq!(heard[1], &Event::Thought { text: "Leo el README primero.".into() });
        assert_eq!(heard[2], &Event::Tool { id: "toolu_1".into(), name: "Read".into(), input: json!({ "file_path": "README.md" }) });
        let Event::ToolDone { id, output, error, detail } = heard[3] else { panic!("{:?}", heard[3]) };
        assert_eq!(id, "toolu_1");
        assert_eq!(output, "# Proyecto\nUna prueba.");
        assert!(!error);
        assert_eq!(detail["file"]["filePath"], "README.md");
        assert_eq!(heard[4], &Event::Said { text: "El README está bien.".into() });
    }

    #[test]
    fn every_turn_starts_by_naming_its_model() {
        let place = temp_root("started");
        let found = read(&fixture(&place)).unwrap();

        let mut turn = Vec::new();
        let mut first = Vec::new();
        for entry in &found.entries {
            match entry {
                Entry::Task { .. } => turn.clear(),
                Entry::Agent { event, .. } => {
                    if turn.is_empty() {
                        first.push(event.clone());
                    }
                    turn.push(event.clone());
                }
                _ => {}
            }
        }
        assert_eq!(
            first,
            vec![
                Event::Started { model: "claude-opus-5-5".into() },
                Event::Started { model: "claude-sonnet-5".into() },
                Event::Started { model: "claude-opus-5-5".into() },
            ]
        );
    }

    #[test]
    fn notifications_subagents_summaries_and_meta_lines_stay_out() {
        let place = temp_root("ignored");
        let found = read(&fixture(&place)).unwrap();
        let said: Vec<&Event> = events(&found.entries).into_iter().filter(|event| matches!(event, Event::Said { .. })).collect();

        assert_eq!(said.len(), 3);
        assert!(!said.contains(&&Event::Said { text: "Esto lo dice un subagente.".into() }));
        assert!(tasks(&found.entries).iter().all(|text| !text.contains("task-notification") && !text.contains("continued") && !text.contains("Image:")));
    }

    #[test]
    fn commands_read_as_typed_and_their_output_is_left_out() {
        assert_eq!(spoken("<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>", false).as_deref(), Some("/compact"));
        assert_eq!(spoken("<command-message>review</command-message>\n<command-name>review</command-name>\n<command-args> 42 </command-args>", false).as_deref(), Some("/review 42"));
        assert_eq!(spoken("<local-command-stdout>Compacted</local-command-stdout>", false), None);
        assert_eq!(spoken("[Request interrupted by user for tool use]", false), None);
        assert_eq!(spoken("explica <command-name>x</command-name>", false).as_deref(), Some("explica <command-name>x</command-name>"));
    }

    #[test]
    fn a_picture_without_words_still_opens_a_turn_but_the_picture_stays_behind() {
        assert_eq!(speaking(Language::Es, || spoken("", true)).as_deref(), Some("[imagen]"));
        assert_eq!(speaking(Language::De, || spoken("", true)).as_deref(), Some("[Bild]"));
        assert_eq!(spoken("  ", false), None);

        let place = temp_root("pictures");
        let found = read(&fixture(&place)).unwrap();
        assert!(found.entries.iter().all(|entry| !matches!(entry, Entry::Task { images, .. } if !images.is_empty())));
    }

    #[test]
    fn attached_files_come_back_from_the_brief_in_either_language() {
        let english = "revisa\n\nAttached files (read them before answering):\n- src/a.rs\n- .sens/artifacts/s1/pasted-text.txt\n\nAttached folders (explore them as needed):\n- docs/\n- C:\\otros";
        assert_eq!(
            unbriefed(english),
            ("revisa".into(), vec!["src/a.rs".into(), ".sens/artifacts/s1/pasted-text.txt".into(), "docs/".into(), "C:\\otros/".into()])
        );
        let spanish = "mira esto\n\nFicheros adjuntos (léelos antes de responder):\n- b.md";
        assert_eq!(unbriefed(spanish), ("mira esto".into(), vec!["b.md".into()]));
        assert_eq!(unbriefed("Attached files (read them before answering):\n- solo.pdf"), (String::new(), vec!["solo.pdf".into()]));
    }

    #[test]
    fn words_that_only_look_like_a_brief_stay_as_written() {
        let quoted = "¿Qué hace esta línea?\nAttached files (read them before answering):\ny sigue el texto";
        assert_eq!(unbriefed(quoted), (quoted.into(), Vec::new()));
        let later = "Attached files (read them before answering): es lo que escribe Sens\n\nAttached files (read them before answering):\n- a.rs";
        assert_eq!(unbriefed(later), ("Attached files (read them before answering): es lo que escribe Sens".into(), vec!["a.rs".into()]));
    }

    #[test]
    fn a_message_of_only_files_still_opens_a_turn_with_them() {
        let place = temp_root("briefed");
        let only_files = json!({ "type": "user", "message": { "role": "user", "content": "Attached files (read them before answering):\n- informe.pdf" }, "timestamp": "2026-09-20T10:00:00Z" });
        let found = read(&written(&place, &[only_files, assistant("m", "claude-opus-5-5", "Leído.", "2026-09-20T10:00:01Z")])).unwrap();

        assert!(matches!(&found.entries[1], Entry::Task { text, files, .. } if text.is_empty() && files == &["informe.pdf".to_string()]));
    }

    #[test]
    fn the_title_follows_the_name_the_user_gave_then_the_one_claude_gave() {
        let place = temp_root("titles");
        let found = read(&fixture(&place)).unwrap();
        assert!(matches!(found.entries.last(), Some(Entry::Titled { title, by: Namer::User, .. }) if title == "Mi revisión"));

        let base = [user("hola", "2026-09-20T10:00:00Z"), assistant("m", "claude-opus-5-5", "hola", "2026-09-20T10:00:01Z")];
        let titled = |extra: &[Value]| {
            let lines: Vec<Value> = base.iter().chain(extra).cloned().collect();
            let found = read(&written(&place, &lines)).unwrap();
            match found.entries.last() {
                Some(Entry::Titled { title, by, .. }) => Some((title.clone(), *by)),
                _ => None,
            }
        };
        let ai = json!({ "type": "ai-title", "aiTitle": "Saludo" });
        let agent = json!({ "type": "agent-name", "agentName": "saludador" });
        let summary = json!({ "type": "summary", "summary": "Un saludo antiguo" });
        let later_ai = json!({ "type": "ai-title", "aiTitle": "Saludo final" });

        assert_eq!(titled(&[]), None);
        assert_eq!(titled(std::slice::from_ref(&summary)), Some(("Un saludo antiguo".into(), Namer::Ai)));
        assert_eq!(titled(&[summary.clone(), agent.clone()]), Some(("saludador".into(), Namer::Ai)));
        assert_eq!(titled(&[agent.clone(), ai.clone(), summary.clone()]), Some(("Saludo".into(), Namer::Ai)));
        assert_eq!(titled(&[ai, agent, later_ai]), Some(("Saludo final".into(), Namer::Ai)));
    }

    #[test]
    fn an_adopted_transcript_is_a_session_that_resumes_in_claude_code() {
        let place = temp_root("adopt");
        let path = fixture(&place);
        let root = place.join("proyecto");

        assert_eq!(adopt(&path).unwrap(), Adopted::Written);

        assert!(session::has_begun(&root, ID));
        let listed = session::list(&root);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, ID);
        assert_eq!(listed[0].title, "Mi revisión");
        assert_eq!(listed[0].tasks, 3);
        assert_eq!(listed[0].started_at, 1_789_898_400_000);
        assert_eq!(session::named_by(&session::read(&root, ID)), Some(Namer::User));
        let kept = serde_json::to_value(session::read(&root, ID)).unwrap();
        assert_eq!(kept, serde_json::to_value(read(&path).unwrap().entries).unwrap());
        assert_eq!(chat::claude_id(ID), ID);
    }

    #[test]
    fn a_session_already_in_sens_is_left_alone_even_when_archived() {
        let place = temp_root("already");
        let path = fixture(&place);
        let root = place.join("proyecto");
        adopt(&path).unwrap();
        session::append(&root, ID, &Entry::Task { at: 9, text: "sigo".into(), files: Vec::new(), images: Vec::new() }).unwrap();

        assert_eq!(adopt(&path).unwrap(), Adopted::Already);
        session::archive(&root, ID, true).unwrap();
        assert_eq!(adopt(&path).unwrap(), Adopted::Already);
        assert_eq!(session::list(&root)[0].tasks, 4);
    }

    #[test]
    fn a_turn_stopped_before_any_answer_still_resumes_in_claude_code() {
        let place = temp_root("unanswered");
        let interrupted = json!({ "type": "user", "message": { "role": "user", "content": [{ "type": "text", "text": "[Request interrupted by user]" }] }, "timestamp": "2026-09-20T10:00:05Z" });
        let path = written(&place, &[user("hola", "2026-09-20T10:00:00Z"), interrupted]);

        assert_eq!(adopt(&path).unwrap(), Adopted::Written);

        let root = place.join("proyecto");
        assert!(session::has_begun(&root, ID));
        let entries = session::read(&root, ID);
        assert!(matches!(&entries[2], Entry::Agent { event: Event::Started { model }, .. } if model.is_empty()));
        assert!(matches!(&entries[3], Entry::Agent { event: Event::Finished { millis: 0, turns: 0, .. }, .. }));
        assert_eq!(entries.len(), 4);
    }

    #[test]
    fn a_transcript_without_turns_is_not_adopted() {
        let place = temp_root("empty");
        let path = written(&place, &[json!({ "type": "ai-title", "aiTitle": "Nada" }), json!({ "type": "user", "message": { "content": "<task-notification>x</task-notification>" }, "origin": { "kind": "task-notification" } })]);

        assert_eq!(adopt(&path).unwrap(), Adopted::Empty);
        assert!(!session::dir(&place.join("proyecto")).exists());
    }

    #[test]
    fn a_transcript_whose_folder_is_gone_creates_nothing() {
        let place = temp_root("gone");
        let path = fixture(&place);
        std::fs::remove_dir_all(place.join("proyecto")).unwrap();

        assert!(speaking(Language::Es, || adopt(&path)).unwrap_err().contains("ya no existe"));
        assert!(!place.join("proyecto").exists());
    }

    #[test]
    fn only_files_named_by_a_session_id_are_transcripts() {
        let place = temp_root("names");
        let other = place.join("claude").join("agent-a15f308bfea77ec63.jsonl");
        std::fs::write(&other, format!("{}\n", user("hola", "2026-09-20T10:00:00Z"))).unwrap();

        assert!(read(&other).is_none());
        assert_eq!(adopt(&other).unwrap(), Adopted::Empty);
        assert_eq!(root_of(&fixture(&place)).unwrap(), place.join("proyecto").to_string_lossy());
    }

    #[test]
    fn timestamps_read_as_milliseconds_since_the_epoch() {
        assert_eq!(instant("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(instant("2026-08-22T02:12:18.036Z"), Some(1_787_364_738_036));
        assert_eq!(instant("2026-09-20T12:00:00.5+02:00"), Some(1_789_898_400_500));
        assert_eq!(instant("2000-02-29T23:59:59Z"), Some(951_868_799_000));
        assert_eq!(instant("2026-09-20T10:00:00.123456Z"), Some(1_789_898_400_123));
        assert_eq!(instant("ayer"), None);
        assert_eq!(instant("2026-09-20T1a:00:00Z"), None);
    }
}
