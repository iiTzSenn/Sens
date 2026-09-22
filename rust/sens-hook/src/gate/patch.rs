use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};
use tree_sitter::Parser;

use crate::lang::treesitter::{EmitSymbol, Emitted, Extract};
use crate::lang::{cfamily, csharp, go, java, kotlin, php, python, ruby, rust, typescript};

const LCS_CAP: usize = 1200;

#[derive(Deserialize)]
pub struct Patch {
    pub files: Vec<FilePatch>,
}

#[derive(Deserialize)]
pub struct FilePatch {
    pub path: String,
    #[serde(default)]
    pub before: String,
    pub after: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct LineChange {
    pub line: u32,
    pub text: String,
}

impl Patch {
    pub fn net_lines(&self) -> i64 {
        self.files.iter().map(FilePatch::net_lines).sum()
    }
}

impl FilePatch {
    pub fn read_before(&mut self, root: &Path) {
        if !self.before.is_empty() {
            return;
        }
        self.before = std::fs::read_to_string(root.join(&self.path)).unwrap_or_default();
    }

    pub fn net_lines(&self) -> i64 {
        let (added, removed) = diff_lines(&self.before, &self.after);
        added.len() as i64 - removed.len() as i64
    }

    pub fn added(&self) -> Vec<LineChange> {
        diff_lines(&self.before, &self.after).0
    }

    pub fn introduced(&self) -> Option<Vec<EmitSymbol>> {
        let after = symbols_in(&self.path, &self.after)?;
        let before: HashSet<String> = symbols_in(&self.path, &self.before)
            .unwrap_or_default()
            .into_iter()
            .map(|symbol| symbol.name)
            .collect();
        let mut seen = HashSet::new();
        Some(
            after
                .into_iter()
                .filter(|symbol| {
                    !before.contains(&symbol.name) && seen.insert(symbol.name.clone())
                })
                .collect(),
        )
    }

    pub fn introduced_symbols(&self) -> Option<Vec<String>> {
        Some(
            self.introduced()?
                .into_iter()
                .map(|symbol| symbol.name)
                .collect(),
        )
    }
}

pub struct Usage<'a> {
    patch: &'a Patch,
    declared: Vec<Declared>,
}

struct Declared {
    file: String,
    tail: String,
}

impl<'a> Usage<'a> {
    pub fn of(patch: &'a Patch) -> Self {
        let declared = patch
            .files
            .iter()
            .flat_map(|file| {
                symbols_in(&file.path, &file.after)
                    .unwrap_or_default()
                    .into_iter()
                    .map(move |symbol| Declared {
                        file: file.path.clone(),
                        tail: tail_of(&symbol.name).to_string(),
                    })
            })
            .collect();
        Self { patch, declared }
    }

    pub fn uses(&self, name: &str) -> bool {
        let tail = tail_of(name);
        let mentions: usize = self
            .patch
            .files
            .iter()
            .map(|file| word_hits(&file.after, tail))
            .sum();
        mentions > self.declared.iter().filter(|entry| entry.tail == tail).count()
    }

    pub fn declares(&self, file: &str, name: &str) -> bool {
        let tail = tail_of(name);
        self.declared
            .iter()
            .any(|entry| entry.file == file && entry.tail == tail)
    }
}

fn tail_of(name: &str) -> &str {
    match name.rfind('.') {
        Some(dot) => &name[dot + 1..],
        None => name,
    }
}

fn word_hits(text: &str, needle: &str) -> usize {
    if needle.is_empty() {
        return 0;
    }
    text.match_indices(needle)
        .filter(|(at, _)| {
            let before = text[..*at].chars().next_back();
            let after = text[at + needle.len()..].chars().next();
            !before.is_some_and(is_word) && !after.is_some_and(is_word)
        })
        .count()
}

fn is_word(letter: char) -> bool {
    letter.is_alphanumeric() || letter == '_'
}

fn language_for(path: &str) -> Option<(tree_sitter::Language, Extract)> {
    let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "go" => (tree_sitter_go::LANGUAGE.into(), go::extract as Extract),
        "rb" => (tree_sitter_ruby::LANGUAGE.into(), ruby::extract as Extract),
        "php" => (tree_sitter_php::LANGUAGE_PHP.into(), php::extract as Extract),
        "java" => (tree_sitter_java::LANGUAGE.into(), java::extract as Extract),
        "cs" => (tree_sitter_c_sharp::LANGUAGE.into(), csharp::extract as Extract),
        "kt" | "kts" => (tree_sitter_kotlin_ng::LANGUAGE.into(), kotlin::extract as Extract),
        "py" | "pyi" => (tree_sitter_python::LANGUAGE.into(), python::extract as Extract),
        "rs" => (tree_sitter_rust::LANGUAGE.into(), rust::extract as Extract),
        "c" => (tree_sitter_c::LANGUAGE.into(), cfamily::extract_c as Extract),
        "cpp" | "cxx" | "cc" | "hpp" | "hh" | "hxx" | "h" => {
            (tree_sitter_cpp::LANGUAGE.into(), cfamily::extract_cpp as Extract)
        }
        "ts" | "mts" | "cts" => (
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            typescript::extract as Extract,
        ),
        "tsx" => (
            tree_sitter_typescript::LANGUAGE_TSX.into(),
            typescript::extract as Extract,
        ),
        "js" | "jsx" | "mjs" | "cjs" => (
            tree_sitter_javascript::LANGUAGE.into(),
            typescript::extract as Extract,
        ),
        _ => return None,
    })
}

pub fn readable(path: &str) -> bool {
    language_for(path).is_some()
}

fn symbols_in(path: &str, source: &str) -> Option<Vec<EmitSymbol>> {
    let (language, extract) = language_for(path)?;
    if source.is_empty() {
        return Some(Vec::new());
    }
    let mut parser = Parser::new();
    parser.set_language(&language).ok()?;
    let tree = parser.parse(source, None)?;
    let mut emitted = Emitted::default();
    let mut rel_set = HashSet::new();
    rel_set.insert(path.to_string());
    extract(&tree.root_node(), source, path, &rel_set, &mut emitted);
    Some(emitted.symbols)
}

pub fn diff_lines(before: &str, after: &str) -> (Vec<LineChange>, Vec<LineChange>) {
    let old: Vec<&str> = before.lines().collect();
    let new: Vec<&str> = after.lines().collect();

    let mut head = 0;
    while head < old.len() && head < new.len() && old[head] == new[head] {
        head += 1;
    }

    let mut tail = 0;
    while tail < old.len() - head
        && tail < new.len() - head
        && old[old.len() - 1 - tail] == new[new.len() - 1 - tail]
    {
        tail += 1;
    }

    let old_mid = &old[head..old.len() - tail];
    let new_mid = &new[head..new.len() - tail];

    if old_mid.len() > LCS_CAP || new_mid.len() > LCS_CAP {
        return by_multiset(old_mid, new_mid, head);
    }
    by_lcs(old_mid, new_mid, head)
}

fn change(offset: usize, index: usize, text: &str) -> LineChange {
    LineChange {
        line: (offset + index + 1) as u32,
        text: text.to_string(),
    }
}

fn by_lcs(old: &[&str], new: &[&str], offset: usize) -> (Vec<LineChange>, Vec<LineChange>) {
    let (rows, cols) = (old.len(), new.len());
    let width = cols + 1;
    let mut table = vec![0u32; (rows + 1) * width];
    for i in (0..rows).rev() {
        for j in (0..cols).rev() {
            table[i * width + j] = if old[i] == new[j] {
                table[(i + 1) * width + j + 1] + 1
            } else {
                table[(i + 1) * width + j].max(table[i * width + j + 1])
            };
        }
    }

    let (mut added, mut removed) = (Vec::new(), Vec::new());
    let (mut i, mut j) = (0, 0);
    while i < rows && j < cols {
        if old[i] == new[j] {
            i += 1;
            j += 1;
        } else if table[(i + 1) * width + j] >= table[i * width + j + 1] {
            removed.push(change(offset, i, old[i]));
            i += 1;
        } else {
            added.push(change(offset, j, new[j]));
            j += 1;
        }
    }
    while i < rows {
        removed.push(change(offset, i, old[i]));
        i += 1;
    }
    while j < cols {
        added.push(change(offset, j, new[j]));
        j += 1;
    }
    (added, removed)
}

fn by_multiset(old: &[&str], new: &[&str], offset: usize) -> (Vec<LineChange>, Vec<LineChange>) {
    let mut pool: HashMap<&str, usize> = HashMap::new();
    for line in old {
        *pool.entry(line).or_default() += 1;
    }
    let mut added = Vec::new();
    for (index, line) in new.iter().enumerate() {
        match pool.get_mut(line) {
            Some(count) if *count > 0 => *count -= 1,
            _ => added.push(change(offset, index, line)),
        }
    }

    let mut pool: HashMap<&str, usize> = HashMap::new();
    for line in new {
        *pool.entry(line).or_default() += 1;
    }
    let mut removed = Vec::new();
    for (index, line) in old.iter().enumerate() {
        match pool.get_mut(line) {
            Some(count) if *count > 0 => *count -= 1,
            _ => removed.push(change(offset, index, line)),
        }
    }
    (added, removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_reports_inserted_lines_with_their_new_numbers() {
        let (added, removed) = diff_lines("a\nb\nc\n", "a\nb\nX\nc\n");
        assert_eq!(removed.len(), 0);
        assert_eq!(added.len(), 1);
        assert_eq!(added[0].text, "X");
        assert_eq!(added[0].line, 3);
    }

    #[test]
    fn diff_reports_a_replacement_as_one_add_and_one_removal() {
        let (added, removed) = diff_lines("keep\nold\ntail\n", "keep\nnew\ntail\n");
        assert_eq!(added.len(), 1);
        assert_eq!(removed.len(), 1);
        assert_eq!(added[0].text, "new");
        assert_eq!(removed[0].text, "old");
    }

    #[test]
    fn net_lines_counts_growth_and_shrink() {
        let grow = FilePatch {
            path: "a.rs".into(),
            before: "one\n".into(),
            after: "one\ntwo\nthree\n".into(),
        };
        assert_eq!(grow.net_lines(), 2);

        let shrink = FilePatch {
            path: "a.rs".into(),
            before: "one\ntwo\nthree\n".into(),
            after: "one\n".into(),
        };
        assert_eq!(shrink.net_lines(), -2);
    }

    #[test]
    fn introduced_symbols_lists_only_what_the_patch_adds() {
        let file = FilePatch {
            path: "src/boot.rs".into(),
            before: "pub fn boot() {}\n".into(),
            after: "pub fn boot() {}\npub fn validate_config(raw: &str) {}\n".into(),
        };
        assert_eq!(file.introduced_symbols().unwrap(), vec!["validate_config"]);
    }

    #[test]
    fn introduced_symbols_reads_typescript_too() {
        let file = FilePatch {
            path: "src/boot.ts".into(),
            before: "export function boot() {}\n".into(),
            after: "export function boot() {}\nexport function parseConfig(raw: string) {}\n".into(),
        };
        assert_eq!(file.introduced_symbols().unwrap(), vec!["parseConfig"]);
    }

    #[test]
    fn introduced_symbols_reads_tsx_and_plain_javascript() {
        let tsx = FilePatch {
            path: "src/Panel.tsx".into(),
            before: String::new(),
            after: "export function Panel() {\n  return <div />;\n}\n".into(),
        };
        assert_eq!(tsx.introduced_symbols().unwrap(), vec!["Panel"]);

        let js = FilePatch {
            path: "scripts/build.mjs".into(),
            before: String::new(),
            after: "export const build = () => 1;\n".into(),
        };
        assert_eq!(js.introduced_symbols().unwrap(), vec!["build"]);
    }

    #[test]
    fn introduced_symbols_still_abstains_on_a_language_nobody_parses() {
        let file = FilePatch {
            path: "notas.txt".into(),
            before: String::new(),
            after: "esto no es código\n".into(),
        };
        assert!(file.introduced_symbols().is_none());
    }
}
