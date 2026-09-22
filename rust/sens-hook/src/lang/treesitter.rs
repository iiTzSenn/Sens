use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use rayon::prelude::*;

use tree_sitter::{Node, Parser, Tree};

use crate::index::{FileInfo, ImportEdge, Reference, SymbolInfo};

pub struct Contribution {
    pub symbols: Vec<SymbolInfo>,
    pub files: Vec<FileInfo>,
    pub imports: Vec<ImportEdge>,
    pub references: HashMap<String, Vec<Reference>>,
}

pub struct EmitSymbol {
    pub name: String,
    pub kind: &'static str,
    pub start: usize,
    pub end: usize,
    pub name_start: usize,
    pub line: u32,
    pub signature: String,
    pub exported: bool,
    pub simple_name: Option<String>,
    pub entry: bool,
}

#[derive(Default)]
pub struct Emitted {
    pub symbols: Vec<EmitSymbol>,
    pub imports: Vec<ImportEdge>,
}

impl Emitted {
    pub fn symbol(&mut self, s: EmitSymbol) {
        self.symbols.push(s);
    }
    pub fn import(&mut self, from: &str, to: String, names: Vec<String>) {
        self.imports.push(ImportEdge { from: from.to_string(), to, names });
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Scope {
    Name,
    Import,
    Package,
}

pub struct Options {
    pub scope: Scope,
    pub qualified_use: fn(&Node, &str) -> bool,
}

pub fn never_qualified(_leaf: &Node, _source: &str) -> bool {
    false
}

pub fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn header_sig(text: &str) -> String {
    let mut end = text.len();
    if let Some(i) = text.find('{') {
        end = end.min(i);
    }
    if let Some(i) = text.find('\n') {
        end = end.min(i);
    }
    let collapsed = collapse(&text[..end]);
    let trimmed = collapsed.trim_end();
    let head = match trimmed.chars().last() {
        Some(c) if c == ';' || c == '{' || c == '=' => &trimmed[..trimmed.len() - c.len_utf8()],
        _ => trimmed,
    };
    head.trim().to_string()
}

pub fn field<'t>(node: &Node<'t>, name: &str) -> Option<Node<'t>> {
    node.child_by_field_name(name)
}

pub fn named<'t>(node: &Node<'t>, kind: &str) -> Option<Node<'t>> {
    let mut cursor = node.walk();
    node.named_children(&mut cursor).find(|c| c.kind() == kind)
}

pub fn all_named<'t>(node: &Node<'t>, kind: &str) -> Vec<Node<'t>> {
    let mut cursor = node.walk();
    node.named_children(&mut cursor).filter(|c| c.kind() == kind).collect()
}

fn walk_descendants<'t>(node: &Node<'t>, kind: &str, out: &mut Vec<Node<'t>>) {
    if node.kind() == kind {
        out.push(*node);
    }
    let mut cursor = node.walk();
    let children: Vec<Node<'t>> = node.named_children(&mut cursor).collect();
    for child in children {
        walk_descendants(&child, kind, out);
    }
}

pub fn descendants<'t>(node: &Node<'t>, kind: &str) -> Vec<Node<'t>> {
    let mut out = Vec::new();
    let mut cursor = node.walk();
    let children: Vec<Node<'t>> = node.named_children(&mut cursor).collect();
    for child in children {
        walk_descendants(&child, kind, &mut out);
    }
    out
}

pub fn first_descendant<'t>(node: &Node<'t>, kind: &str) -> Option<Node<'t>> {
    descendants(node, kind).into_iter().next()
}

pub fn text<'a>(node: &Node, source: &'a str) -> &'a str {
    node.utf8_text(source.as_bytes()).unwrap_or("")
}

fn dequote(s: &str) -> Option<&str> {
    if s.len() < 5 {
        return None;
    }
    let first = s.chars().next()?;
    if matches!(first, '"' | '\'' | '`') && s.ends_with(first) {
        return Some(&s[1..s.len() - 1]);
    }
    None
}

fn dir_of(file: &str) -> &str {
    match file.rfind('/') {
        Some(i) => &file[..i],
        None => "",
    }
}

struct SymbolRange {
    start: usize,
    end: usize,
    index: usize,
}

fn enclosing_range(ranges: &[SymbolRange], pos: usize) -> usize {
    let mut best: Option<&SymbolRange> = None;
    for r in ranges {
        if r.start <= pos && pos < r.end && best.is_none_or(|b| r.start > b.start) {
            best = Some(r);
        }
    }
    best.map(|r| r.index).unwrap_or(usize::MAX)
}

fn collect_leaves<'t>(node: Node<'t>, out: &mut Vec<Node<'t>>) {
    let mut cursor = node.walk();
    if !cursor.goto_first_child() {
        if node.is_named() {
            out.push(node);
        }
        return;
    }
    loop {
        let child = cursor.node();
        if child.is_named() || child.named_child_count() > 0 {
            collect_leaves(child, out);
        }
        if !cursor.goto_next_sibling() {
            break;
        }
    }
}

fn mtime_ms(path: &Path) -> f64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

struct Parsed {
    file: String,
    source: String,
    tree: Tree,
    skip: HashSet<usize>,
}

pub type Extract = fn(&Node, &str, &str, &HashSet<String>, &mut Emitted);

fn stage(t: &mut std::time::Instant, label: &str) {
    if std::env::var_os("SENS_TIMING").is_some() {
        eprintln!("    {:<26} {:>5} ms", label, t.elapsed().as_millis());
    }
    *t = std::time::Instant::now();
}

pub fn build(
    files: &[(String, PathBuf)],
    language: &tree_sitter::Language,
    extract: Extract,
    opts: Options,
) -> Contribution {
    let rel_set: HashSet<String> = files.iter().map(|(rel, _)| rel.clone()).collect();
    let mut timer = std::time::Instant::now();

    let per_file: Vec<(String, PathBuf, String, Tree, Emitted)> = files
        .par_iter()
        .map_init(
            || {
                let mut parser = Parser::new();
                let _ = parser.set_language(language);
                parser
            },
            |parser, (rel, abs)| {
                let source = std::fs::read_to_string(abs).ok()?;
                let tree = parser.parse(&source, None)?;
                let mut emitted = Emitted::default();
                extract(&tree.root_node(), &source, rel, &rel_set, &mut emitted);
                Some((rel.clone(), abs.clone(), source, tree, emitted))
            },
        )
        .flatten()
        .collect();

    let mut contribution = Contribution {
        symbols: Vec::new(),
        files: Vec::new(),
        imports: Vec::new(),
        references: HashMap::new(),
    };
    let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
    let mut ranges_by_file: HashMap<String, Vec<SymbolRange>> = HashMap::new();
    let mut parsed: Vec<Parsed> = Vec::new();

    for (rel, abs, source, tree, emitted) in per_file {
        let mut skip: HashSet<usize> = HashSet::new();
        let mut exports: Vec<String> = Vec::new();
        let mut ranges: Vec<SymbolRange> = Vec::new();
        for s in emitted.symbols {
            let index = contribution.symbols.len();
            let id = format!("{}#{}#{}", rel, s.name, s.line);
            let simple = s.simple_name.clone().unwrap_or_else(|| match s.name.rfind('.') {
                Some(dot) => s.name[dot + 1..].to_string(),
                None => s.name.clone(),
            });
            if s.exported && s.kind != "method" {
                exports.push(s.name.clone());
            }
            by_name.entry(simple).or_default().push(index);
            ranges.push(SymbolRange { start: s.start, end: s.end, index });
            skip.insert(s.name_start);
            contribution.symbols.push(SymbolInfo {
                id,
                kind: s.kind.to_string(),
                entry: s.entry,
                name: s.name,
                file: rel.clone(),
                line: s.line,
                signature: s.signature,
                exported: s.exported,
            });
        }
        contribution.imports.extend(emitted.imports);
        ranges_by_file.insert(rel.clone(), ranges);
        contribution.files.push(FileInfo {
            path: rel.clone(),
            mtime_ms: mtime_ms(&abs),
            exports,
        });
        parsed.push(Parsed { file: rel, source, tree, skip });
    }

    stage(&mut timer, "parse + extract");
    stage(&mut timer, "parse + extract");

    let narrowing = matches!(opts.scope, Scope::Import | Scope::Package);
    let use_package = opts.scope == Scope::Package;

    let file_index: HashMap<&str, usize> =
        parsed.iter().enumerate().map(|(i, p)| (p.file.as_str(), i)).collect();
    let symbol_file: Vec<usize> = contribution
        .symbols
        .iter()
        .map(|s| file_index.get(s.file.as_str()).copied().unwrap_or(usize::MAX))
        .collect();

    let mut imported_files: Vec<HashSet<usize>> = vec![HashSet::new(); parsed.len()];
    if narrowing {
        for edge in &contribution.imports {
            let (Some(&from), Some(&to)) =
                (file_index.get(edge.from.as_str()), file_index.get(edge.to.as_str()))
            else {
                continue;
            };
            imported_files[from].insert(to);
        }
    }

    let mut hits: Vec<Vec<(usize, u32, usize)>> = vec![Vec::new(); contribution.symbols.len()];
    for (fi, p) in parsed.iter().enumerate() {
        let empty: Vec<SymbolRange> = Vec::new();
        let ranges = ranges_by_file.get(&p.file).unwrap_or(&empty);
        let file_dir = if use_package { dir_of(&p.file) } else { "" };

        let mut leaves = Vec::new();
        collect_leaves(p.tree.root_node(), &mut leaves);
        for leaf in leaves {
            if p.skip.contains(&leaf.start_byte()) {
                continue;
            }
            let raw = text(&leaf, &p.source);
            let mut targets = by_name.get(raw);
            if targets.is_none() {
                if let Some(inner) = dequote(raw) {
                    targets = by_name.get(inner);
                }
            }
            let Some(targets) = targets else { continue };

            let qualified = use_package && (opts.qualified_use)(&leaf, &p.source);
            let narrowed: Option<Vec<usize>> = if narrowing && !qualified {
                let visible: Vec<usize> = targets
                    .iter()
                    .copied()
                    .filter(|&si| {
                        let f = symbol_file[si];
                        f == fi
                            || imported_files[fi].contains(&f)
                            || (use_package && dir_of(&parsed[f].file) == file_dir)
                    })
                    .collect();
                (!visible.is_empty()).then_some(visible)
            } else {
                None
            };

            let line = leaf.start_position().row as u32 + 1;
            let from = enclosing_range(ranges, leaf.start_byte());
            let chosen: &[usize] = narrowed.as_deref().unwrap_or(targets);
            for &si in chosen {
                hits[si].push((fi, line, from));
            }
        }
    }

    for (si, sites) in hits.into_iter().enumerate() {
        let id = contribution.symbols[si].id.clone();
        let entry = contribution.references.entry(id).or_default();
        for (fi, line, from) in sites {
            let from = (from != usize::MAX && from != si)
                .then(|| contribution.symbols[from].id.clone());
            entry.push(Reference { file: parsed[fi].file.clone(), line, from });
        }
    }

    stage(&mut timer, "referencias");
    contribution
}

#[derive(Default)]
pub struct Extra {
    pub signature: Option<String>,
    pub simple_name: Option<String>,
    pub entry: bool,
}

pub fn declare(
    out: &mut Emitted,
    source: &str,
    name: impl Into<String>,
    kind: &'static str,
    node: &Node,
    name_node: &Node,
    exported: bool,
    extra: Extra,
) {
    out.symbol(EmitSymbol {
        name: name.into(),
        kind,
        start: node.start_byte(),
        end: node.end_byte(),
        name_start: name_node.start_byte(),
        line: name_node.start_position().row as u32 + 1,
        signature: extra.signature.unwrap_or_else(|| header_sig(text(node, source))),
        exported,
        simple_name: extra.simple_name,
        entry: extra.entry,
    });
}

pub fn resolve_suffix(rel_set: &HashSet<String>, segs: &[String], exts: &[&str]) -> Option<String> {
    if segs.is_empty() {
        return None;
    }
    let joined = segs.join("/");
    for ext in exts {
        let candidate = format!("{joined}{ext}");
        if rel_set.contains(&candidate) {
            return Some(candidate);
        }
        let suffix = format!("/{candidate}");
        if let Some(found) = rel_set.iter().find(|r| **r == candidate || r.ends_with(&suffix)) {
            return Some(found.clone());
        }
    }
    None
}

pub fn named_any<'t>(node: &Node<'t>, kinds: &[&str]) -> Option<Node<'t>> {
    kinds.iter().find_map(|k| named(node, k))
}

pub fn first_descendant_any<'t>(node: &Node<'t>, kinds: &[&str]) -> Option<Node<'t>> {
    kinds.iter().find_map(|k| first_descendant(node, k))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collapses_runs_of_whitespace() {
        assert_eq!(collapse("a   b\n\tc"), "a b c");
        assert_eq!(collapse("   "), "");
    }

    #[test]
    fn cuts_a_signature_at_the_body_or_the_line_end() {
        assert_eq!(header_sig("func Run() int {\n return 1\n}"), "func Run() int");
        assert_eq!(header_sig("public function getName(): string;"), "public function getName(): string");
        assert_eq!(header_sig("const X ="), "const X");
        assert_eq!(header_sig("type Thing struct {"), "type Thing struct");
    }

    #[test]
    fn resolves_a_dotted_name_against_the_project() {
        let files: HashSet<String> =
            ["com/app/Greeter.java", "other/Thing.java"].iter().map(|s| s.to_string()).collect();
        let segs = ["com".to_string(), "app".to_string(), "Greeter".to_string()];
        assert_eq!(resolve_suffix(&files, &segs, &[".java"]), Some("com/app/Greeter.java".into()));

        let suffix_only = ["Thing".to_string()];
        assert_eq!(resolve_suffix(&files, &suffix_only, &[".java"]), Some("other/Thing.java".into()));
        assert_eq!(resolve_suffix(&files, &[], &[".java"]), None);
    }

    #[test]
    fn picks_the_innermost_enclosing_symbol() {
        let ranges = vec![
            SymbolRange { start: 0, end: 100, index: 0 },
            SymbolRange { start: 10, end: 50, index: 1 },
        ];
        assert_eq!(enclosing_range(&ranges, 20), 1);
        assert_eq!(enclosing_range(&ranges, 60), 0);
        assert_eq!(enclosing_range(&ranges, 200), usize::MAX);
    }
}
