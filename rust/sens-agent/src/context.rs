use std::collections::HashSet;
use std::path::Path;

use sens_hook::engine;
use sens_hook::format::{format_map, format_symbols};
use sens_hook::query::Engine;

const MAP_LIMIT: usize = 120;
const CANDIDATE_LIMIT: usize = 8;
const STOP_WORDS: [&str; 24] = [
    "para", "como", "pero", "este", "esta", "esto", "cuando", "donde", "hace", "hacer", "que",
    "con", "del", "los", "las", "una", "uno", "por", "sin", "the", "and", "for", "with", "into",
];

pub struct Briefing {
    pub map: String,
    pub candidates: String,
    pub outline: String,
    pub symbols: usize,
    pub files: usize,
}

impl Briefing {
    pub fn render(&self) -> String {
        let mut out = String::new();
        out.push_str("MAPA DEL PROYECTO\n");
        out.push_str(&self.map);
        if !self.candidates.is_empty() {
            out.push_str("\n\nYA EXISTE EN EL PROYECTO (reutiliza antes de escribir)\n");
            out.push_str(&self.candidates);
        }
        if !self.outline.is_empty() {
            out.push_str("\n\nESQUEMA DEL FICHERO MENCIONADO\n");
            out.push_str(&self.outline);
        }
        out
    }
}

pub fn brief(root: &Path, task: &str) -> Option<Briefing> {
    let (index, meta) = engine::load(root)?;
    let queries = Engine::new(&index, &meta.entry_points);

    let mut map = format_map(&queries.map(None));
    truncate_lines(&mut map, MAP_LIMIT);

    let candidates = candidates_for(&queries, task);
    let outline = outline_for(&queries, &index.files, task);

    Some(Briefing {
        map,
        candidates,
        outline,
        symbols: index.symbols.len(),
        files: index.files.len(),
    })
}

fn candidates_for(queries: &Engine, task: &str) -> String {
    let mut seen = HashSet::new();
    let mut hits = Vec::new();
    for keyword in keywords(task) {
        for symbol in queries.already_exists(&keyword, CANDIDATE_LIMIT) {
            if seen.insert(symbol.id.as_str()) {
                hits.push(symbol);
            }
        }
    }
    hits.truncate(CANDIDATE_LIMIT);
    if hits.is_empty() {
        return String::new();
    }
    format_symbols(&hits)
}

fn outline_for(queries: &Engine, files: &[sens_hook::index::FileInfo], task: &str) -> String {
    let Some(path) = files
        .iter()
        .map(|file| file.path.as_str())
        .find(|path| task.contains(path))
    else {
        return String::new();
    };
    format_symbols(&queries.file_outline(path))
}

pub fn keywords(task: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    task.split(|c: char| !c.is_alphanumeric() && c != '_')
        .map(str::to_lowercase)
        .filter(|word| word.len() > 3 && !STOP_WORDS.contains(&word.as_str()))
        .filter(|word| seen.insert(word.clone()))
        .take(6)
        .collect()
}

fn truncate_lines(text: &mut String, limit: usize) {
    if text.lines().count() <= limit {
        return;
    }
    let kept: Vec<&str> = text.lines().take(limit).collect();
    *text = format!("{}\n… (mapa recortado)", kept.join("\n"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keywords_drop_filler_and_keep_the_nouns() {
        let found = keywords("Añade validación de la configuración para el arranque");
        assert!(found.contains(&"validación".to_string()));
        assert!(found.contains(&"configuración".to_string()));
        assert!(!found.contains(&"para".to_string()));
    }

    #[test]
    fn keywords_never_repeat_and_stay_capped() {
        let found = keywords("cache cache cache index index parser loader writer reader binder");
        assert_eq!(found.len(), 6);
        assert_eq!(found.iter().filter(|word| *word == "cache").count(), 1);
    }

    #[test]
    fn a_long_map_is_cut_with_a_visible_mark() {
        let mut map = (0..200).map(|n| n.to_string()).collect::<Vec<_>>().join("\n");
        truncate_lines(&mut map, 10);
        assert!(map.ends_with("… (mapa recortado)"));
        assert_eq!(map.lines().count(), 11);
    }
}
