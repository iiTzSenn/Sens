use std::collections::{HashMap, HashSet};
use std::path::{Path, MAIN_SEPARATOR};

use rayon::prelude::*;

const MIN_NAME: usize = 4;
const MAX_FILE: u64 = 512 * 1024;

const EXTENSIONS: [&str; 28] = [
    "json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "env", "md", "mdx", "html", "htm",
    "xml", "txt", "graphql", "gql", "vue", "svelte", "astro", "hbs", "handlebars", "ejs", "pug",
    "liquid", "css", "scss", "sass", "less",
];

const SKIP_DIRS: [&str; 7] = ["node_modules", "dist", "build", ".sens", ".git", "coverage", "target"];

pub fn simple_name(name: &str) -> &str {
    match name.rfind('.') {
        Some(dot) => &name[dot + 1..],
        None => name,
    }
}

fn is_candidate_file(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.contains(".min.") {
        return false;
    }
    if name.ends_with("rc") {
        return true;
    }
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

pub fn hits(root: &Path, names: &HashSet<String>) -> HashMap<String, String> {
    if names.is_empty() {
        return HashMap::new();
    }

    let files: Vec<_> = ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .filter_entry(|e| !SKIP_DIRS.contains(&e.file_name().to_str().unwrap_or("")))
        .build()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
        .map(ignore::DirEntry::into_path)
        .filter(|p| is_candidate_file(p))
        .collect();

    let found: Vec<(String, String)> = files
        .par_iter()
        .filter_map(|abs| {
            if std::fs::metadata(abs).map(|m| m.len()).unwrap_or(u64::MAX) > MAX_FILE {
                return None;
            }
            let text = std::fs::read_to_string(abs).ok()?;
            let rel = abs
                .strip_prefix(root)
                .unwrap_or(abs)
                .to_string_lossy()
                .replace(MAIN_SEPARATOR, "/");
            let mut local = Vec::new();
            for token in text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '$')) {
                if token.len() >= MIN_NAME && names.contains(token) {
                    local.push((token.to_string(), rel.clone()));
                }
            }
            (!local.is_empty()).then_some(local)
        })
        .flatten()
        .collect();

    let mut out: HashMap<String, String> = HashMap::new();
    for (name, file) in found {
        out.entry(name).or_insert(file);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_last_segment_of_a_qualified_name() {
        assert_eq!(simple_name("Widget.render"), "render");
        assert_eq!(simple_name("plain"), "plain");
    }

    #[test]
    fn looks_only_at_files_that_could_name_a_symbol() {
        assert!(is_candidate_file(Path::new("a/config.json")));
        assert!(is_candidate_file(Path::new("a/page.html")));
        assert!(is_candidate_file(Path::new("a/.babelrc")));
        assert!(!is_candidate_file(Path::new("a/photo.png")));
        assert!(!is_candidate_file(Path::new("a/bundle.min.js")));
    }
}
