use std::collections::HashSet;

use tree_sitter::Node;

use super::treesitter::{
    declare, descendants, field, first_descendant, named, never_qualified, text, Emitted, Extra,
    Options, Scope,
};

fn item_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "function_item" | "function_signature_item" => Some("function"),
        "struct_item" | "union_item" => Some("class"),
        "enum_item" => Some("enum"),
        "trait_item" => Some("interface"),
        "type_item" => Some("type"),
        "const_item" | "static_item" => Some("const"),
        _ => None,
    }
}

fn named_children_of<'t>(node: &Node<'t>) -> Vec<Node<'t>> {
    let mut cursor = node.walk();
    node.named_children(&mut cursor).collect()
}

fn is_pub(node: &Node) -> bool {
    named(node, "visibility_modifier").is_some()
}

fn dir_of(file: &str) -> &str {
    match file.rfind('/') {
        Some(i) => &file[..i],
        None => "",
    }
}

fn base_of(file: &str) -> &str {
    match file.rfind('/') {
        Some(i) => &file[i + 1..],
        None => file,
    }
}

fn child_mod_dir(file: &str) -> String {
    let dir = dir_of(file);
    let stem = base_of(file).strip_suffix(".rs").unwrap_or(base_of(file));
    if stem == "mod" || stem == "main" || stem == "lib" {
        return dir.to_string();
    }
    if dir.is_empty() {
        stem.to_string()
    } else {
        format!("{dir}/{stem}")
    }
}

fn ancestor_dir(dir: &str, ups: usize) -> String {
    let mut d = dir.to_string();
    for _ in 0..ups {
        d = dir_of(&d).to_string();
    }
    d
}

fn crate_root_dir(rel_set: &HashSet<String>) -> String {
    for candidate in ["src/lib.rs", "src/main.rs", "lib.rs", "main.rs"] {
        if rel_set.contains(candidate) {
            return child_mod_dir(candidate);
        }
    }
    for f in rel_set {
        let b = base_of(f);
        if b == "lib.rs" || b == "main.rs" {
            return child_mod_dir(f);
        }
    }
    String::new()
}

fn mod_file(base: &str, rest: &[String], rel_set: &HashSet<String>) -> Option<String> {
    if rest.is_empty() {
        return None;
    }
    let prefix = if base.is_empty() { String::new() } else { format!("{base}/") };
    let joined = format!("{prefix}{}", rest.join("/"));
    for cand in [format!("{joined}.rs"), format!("{joined}/mod.rs")] {
        if rel_set.contains(&cand) {
            return Some(cand);
        }
    }
    None
}

fn path_segs(node: &Node, source: &str) -> Vec<String> {
    match node.kind() {
        "identifier" | "type_identifier" => vec![text(node, source).to_string()],
        "crate" | "self" | "super" => vec![node.kind().to_string()],
        "scoped_identifier" | "scoped_type_identifier" => {
            let mut out = Vec::new();
            if let Some(path) = field(node, "path") {
                out.extend(path_segs(&path, source));
            }
            if let Some(name) = field(node, "name") {
                out.extend(path_segs(&name, source));
            }
            out
        }
        _ => Vec::new(),
    }
}

fn anchor(segs: &[String], file: &str, rel_set: &HashSet<String>) -> (String, Vec<String>) {
    match segs.first().map(String::as_str) {
        Some("crate") => (crate_root_dir(rel_set), segs[1..].to_vec()),
        Some("self") => (child_mod_dir(file), segs[1..].to_vec()),
        Some("super") => {
            let ups = segs.iter().take_while(|s| *s == "super").count();
            (ancestor_dir(&child_mod_dir(file), ups), segs[ups..].to_vec())
        }
        _ => (crate_root_dir(rel_set), segs.to_vec()),
    }
}

fn imports_for_path(segs: &[String], file: &str, rel_set: &HashSet<String>, out: &mut Emitted) {
    if segs.is_empty() {
        return;
    }
    let (base, rest) = anchor(segs, file, rel_set);
    let as_module = mod_file(&base, &rest, rel_set);
    if let Some(m) = &as_module {
        out.import(file, m.clone(), Vec::new());
    }
    let parent = if rest.is_empty() { Vec::new() } else { rest[..rest.len() - 1].to_vec() };
    if let Some(as_item) = mod_file(&base, &parent, rel_set) {
        if Some(&as_item) != as_module.as_ref() {
            let last = segs.last().cloned().unwrap_or_default();
            out.import(file, as_item, vec![last]);
        }
    }
}

fn mod_decl(name: &str, file: &str, rel_set: &HashSet<String>, out: &mut Emitted) {
    if let Some(to) = mod_file(&child_mod_dir(file), &[name.to_string()], rel_set) {
        out.import(file, to, vec![name.to_string()]);
    }
}

fn word_in(haystack: &str, word: &str) -> bool {
    haystack
        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .any(|w| w == word)
}

fn is_entry_attr(attr: &str) -> bool {
    word_in(attr, "test") || word_in(attr, "bench") || word_in(attr, "no_mangle")
}

fn is_cfg_test(attr: &str) -> bool {
    let compact: String = attr.chars().filter(|c| !c.is_whitespace()).collect();
    compact.contains("cfg(test)")
}

fn has_extern_modifier(node: &Node) -> bool {
    named(node, "function_modifiers").is_some_and(|mods| {
        let mut cursor = mods.walk();
        mods.children(&mut cursor).any(|c| c.kind() == "extern_modifier")
    })
}

fn is_entry_fn(node: &Node, name: &str, attrs: &[String], container: Option<&str>) -> bool {
    if container.is_none() && name == "main" {
        return true;
    }
    if attrs.iter().any(|a| is_entry_attr(a)) {
        return true;
    }
    has_extern_modifier(node)
}

fn process_item(
    node: &Node,
    source: &str,
    file: &str,
    rel_set: &HashSet<String>,
    container: Option<&str>,
    attrs: &[String],
    force_entry: bool,
    out: &mut Emitted,
) {
    if let Some(kind) = item_kind(node.kind()) {
        let Some(name_node) = field(node, "name") else { return };
        let is_fn = node.kind() == "function_item" || node.kind() == "function_signature_item";
        let is_method = container.is_some() && is_fn;
        let simple = text(&name_node, source).to_string();
        let name = match container {
            Some(c) if is_method => format!("{c}.{simple}"),
            _ => simple.clone(),
        };
        let entry = is_fn && (force_entry || is_entry_fn(node, &simple, attrs, container));
        declare(
            out,
            source,
            name,
            if is_method { "method" } else { kind },
            node,
            &name_node,
            if is_method { false } else { is_pub(node) },
            Extra {
                simple_name: if is_method { Some(simple) } else { None },
                entry,
                ..Extra::default()
            },
        );
        return;
    }

    if node.kind() == "impl_item" {
        let type_node = field(node, "type");
        let type_name = match type_node {
            Some(t) if t.kind() == "type_identifier" => Some(text(&t, source).to_string()),
            Some(t) => first_descendant(&t, "type_identifier").map(|n| text(&n, source).to_string()),
            None => first_descendant(node, "type_identifier").map(|n| text(&n, source).to_string()),
        };
        let body = field(node, "body");
        let children = body.map(|b| named_children_of(&b)).unwrap_or_default();
        let container = type_name.unwrap_or_else(|| "impl".to_string());
        process_children(&children, source, file, rel_set, Some(&container), force_entry, out);
        return;
    }

    if node.kind() == "mod_item" {
        let Some(body) = field(node, "body") else {
            if let Some(nn) = field(node, "name") {
                mod_decl(text(&nn, source), file, rel_set, out);
            }
            return;
        };
        let test_mod = force_entry || attrs.iter().any(|a| is_cfg_test(a));
        let children = named_children_of(&body);
        process_children(&children, source, file, rel_set, container, test_mod, out);
    }
}

fn process_children(
    children: &[Node],
    source: &str,
    file: &str,
    rel_set: &HashSet<String>,
    container: Option<&str>,
    force_entry: bool,
    out: &mut Emitted,
) {
    let mut attrs: Vec<String> = Vec::new();
    for node in children {
        if node.kind() == "attribute_item" {
            attrs.push(text(node, source).to_string());
            continue;
        }
        if node.kind() == "line_comment" || node.kind() == "block_comment" {
            continue;
        }
        process_item(node, source, file, rel_set, container, &attrs, force_entry, out);
        attrs.clear();
    }
}

pub fn extract(root: &Node, source: &str, file: &str, rel_set: &HashSet<String>, out: &mut Emitted) {
    for kind in ["scoped_identifier", "scoped_type_identifier"] {
        for sid in descendants(root, kind) {
            imports_for_path(&path_segs(&sid, source), file, rel_set, out);
        }
    }
    let children = named_children_of(root);
    process_children(&children, source, file, rel_set, None, false, out);
}

pub fn options() -> Options {
    Options { scope: Scope::Import, qualified_use: never_qualified }
}
