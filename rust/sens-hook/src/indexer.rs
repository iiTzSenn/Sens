use std::collections::HashMap;
use std::path::{Path, PathBuf, MAIN_SEPARATOR};

use crate::index::{FileInfo, ImportEdge, Reference, SymbolInfo};
use crate::lang::{cfamily, csharp, go, java, kotlin, php, python, ruby, rust, treesitter};

pub struct Built {
    pub symbols: Vec<SymbolInfo>,
    pub files: Vec<FileInfo>,
    pub imports: Vec<ImportEdge>,
    pub references: HashMap<String, Vec<Reference>>,
}

const SKIP_DIRS: [&str; 8] = [
    "node_modules", "dist", ".sens", ".git", "target", "__pycache__", ".venv", "venv",
];

pub fn supported_extension(ext: &str) -> bool {
    matches!(ext, "go" | "rb" | "php" | "java" | "cs" | "kt" | "kts" | "py" | "pyi" | "rs" | "c" | "cpp" | "cxx" | "cc" | "hpp" | "hh" | "hxx" | "h")
}

fn rel_path(root: &Path, abs: &Path) -> String {
    abs.strip_prefix(root)
        .unwrap_or(abs)
        .to_string_lossy()
        .replace(MAIN_SEPARATOR, "/")
}

pub fn collect(root: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .filter_entry(|e| !SKIP_DIRS.contains(&e.file_name().to_str().unwrap_or("")))
        .build()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
        .map(ignore::DirEntry::into_path)
        .filter(|p| {
            !p.to_string_lossy().ends_with(".d.ts")
                && p.extension().and_then(|e| e.to_str()).is_some()
        })
        .collect();
    out.sort();
    out
}

pub fn stage(t: &mut std::time::Instant, label: &str) {
    if std::env::var_os("SENS_TIMING").is_some() {
        eprintln!("  {:<24} {:>5} ms", label, t.elapsed().as_millis());
    }
    *t = std::time::Instant::now();
}

pub fn build(root: &Path) -> Option<Built> {
    let mut timer = std::time::Instant::now();
    let mut by_language: HashMap<&str, Vec<(String, PathBuf)>> = HashMap::new();
    for abs in collect(root) {
        let ext = abs.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        if !supported_extension(&ext) {
            if is_indexable_elsewhere(&ext) {
                return None;
            }
            continue;
        }
        let language = match ext.as_str() { "go" => "go", "rb" => "ruby", "php" => "php", "java" => "java", "cs" => "csharp", "py" | "pyi" => "python", "rs" => "rust", "c" => "c", "cpp" | "cxx" | "cc" | "hpp" | "hh" | "hxx" | "h" => "cpp", _ => "kotlin" };
        by_language.entry(language).or_default().push((rel_path(root, &abs), abs));
    }

    stage(&mut timer, "recorrer ficheros");
    let mut built = Built {
        symbols: Vec::new(),
        files: Vec::new(),
        imports: Vec::new(),
        references: HashMap::new(),
    };

    let languages: [(&str, tree_sitter::Language, treesitter::Extract, fn() -> treesitter::Options); 10] = [
        ("go", tree_sitter_go::LANGUAGE.into(), go::extract, go::options),
        ("ruby", tree_sitter_ruby::LANGUAGE.into(), ruby::extract, ruby::options),
        ("php", tree_sitter_php::LANGUAGE_PHP.into(), php::extract, php::options),
        ("java", tree_sitter_java::LANGUAGE.into(), java::extract, java::options),
        ("csharp", tree_sitter_c_sharp::LANGUAGE.into(), csharp::extract, csharp::options),
        ("kotlin", tree_sitter_kotlin_ng::LANGUAGE.into(), kotlin::extract, kotlin::options),
        ("python", tree_sitter_python::LANGUAGE.into(), python::extract, python::options),
        ("rust", tree_sitter_rust::LANGUAGE.into(), rust::extract, rust::options),
        ("c", tree_sitter_c::LANGUAGE.into(), cfamily::extract_c, cfamily::options),
        ("cpp", tree_sitter_cpp::LANGUAGE.into(), cfamily::extract_cpp, cfamily::options),
    ];
    for (name, language, extract, options) in languages {
        let Some(files) = by_language.get(name) else { continue };
        let contribution = treesitter::build(files, &language, extract, options());
        built.symbols.extend(contribution.symbols);
        built.files.extend(contribution.files);
        built.imports.extend(contribution.imports);
        built.references.extend(contribution.references);
    }

    stage(&mut timer, "indexar");
    built.files.sort_by(|a, b| a.path.cmp(&b.path));
    Some(built)
}

const ELSEWHERE: [&str; 8] = [
    "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs",
];

fn is_indexable_elsewhere(ext: &str) -> bool {
    ELSEWHERE.contains(&ext)
}
