use std::collections::HashSet;

use tree_sitter::Node;

use super::treesitter::{
    declare, field, named, never_qualified, resolve_suffix, text, Emitted, Extra, Options, Scope,
};

fn type_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "class_declaration" => Some("class"),
        "interface_declaration" => Some("interface"),
        "enum_declaration" => Some("enum"),
        "record_declaration" => Some("class"),
        "annotation_type_declaration" => Some("interface"),
        _ => None,
    }
}

const TYPE_ENTRY: [&str; 13] = [
    "Component", "Service", "Repository", "Controller", "RestController", "Configuration",
    "SpringBootApplication", "ControllerAdvice", "RestControllerAdvice", "Entity", "Embeddable",
    "MappedSuperclass", "Table",
];

const METHOD_ENTRY: [&str; 12] = [
    "Bean", "EventListener", "PostConstruct", "PreDestroy", "Scheduled", "RequestMapping",
    "GetMapping", "PostMapping", "PutMapping", "DeleteMapping", "PatchMapping", "ExceptionHandler",
];

fn modifiers_contain(node: &Node, source: &str, needle: &str) -> bool {
    named(node, "modifiers").is_some_and(|m| text(&m, source).contains(needle))
}

fn annotation_names(node: &Node, source: &str) -> Vec<String> {
    let Some(mods) = named(node, "modifiers") else { return Vec::new() };
    let mut cursor = mods.walk();
    let children: Vec<Node> = mods.named_children(&mut cursor).collect();
    let mut out = Vec::new();
    for c in children {
        if c.kind() != "marker_annotation" && c.kind() != "annotation" {
            continue;
        }
        if let Some(n) = field(&c, "name") {
            let full = text(&n, source);
            out.push(full.rsplit('.').next().unwrap_or(full).to_string());
        }
    }
    out
}

fn has_any(names: &[String], set: &[&str]) -> bool {
    names.iter().any(|n| set.contains(&n.as_str()))
}

fn is_main_method(m: &Node, source: &str) -> bool {
    field(m, "name").is_some_and(|n| text(&n, source) == "main")
        && modifiers_contain(m, source, "static")
}

fn emit_type(node: &Node, source: &str, kind: &'static str, out: &mut Emitted) {
    let Some(name_node) = field(node, "name") else { return };
    let cname = text(&name_node, source).to_string();
    let members: Vec<Node> = match field(node, "body") {
        Some(body) => {
            let mut cursor = body.walk();
            body.named_children(&mut cursor).collect()
        }
        None => Vec::new(),
    };

    let type_entry = has_any(&annotation_names(node, source), &TYPE_ENTRY)
        || members
            .iter()
            .any(|m| m.kind() == "method_declaration" && is_main_method(m, source));
    let exported = modifiers_contain(node, source, "public");
    declare(out, source, cname.clone(), kind, node, &name_node, exported, Extra { entry: type_entry, ..Extra::default() });

    for m in members {
        if m.kind() == "method_declaration" || m.kind() == "constructor_declaration" {
            let Some(m_name) = field(&m, "name") else { continue };
            let simple = text(&m_name, source).to_string();
            let method_entry = is_main_method(&m, source)
                || has_any(&annotation_names(&m, source), &METHOD_ENTRY);
            declare(
                out,
                source,
                format!("{cname}.{simple}"),
                "method",
                &m,
                &m_name,
                false,
                Extra { simple_name: Some(simple), entry: method_entry, ..Extra::default() },
            );
        } else if let Some(inner) = type_kind(m.kind()) {
            emit_type(&m, source, inner, out);
        }
    }
}

pub fn extract(root: &Node, source: &str, file: &str, rel_set: &HashSet<String>, out: &mut Emitted) {
    let mut cursor = root.walk();
    let children: Vec<Node> = root.named_children(&mut cursor).collect();
    for node in children {
        if let Some(kind) = type_kind(node.kind()) {
            emit_type(&node, source, kind, out);
        } else if node.kind() == "import_declaration" {
            let scoped = named(&node, "scoped_identifier").or_else(|| named(&node, "identifier"));
            let Some(scoped) = scoped else { continue };
            let raw = text(&scoped, source);
            let segs: Vec<String> = raw
                .split('.')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            let to = resolve_suffix(rel_set, &segs, &[".java"]).unwrap_or_else(|| raw.to_string());
            let last = segs.last().cloned().unwrap_or_default();
            out.import(file, to, vec![last]);
        }
    }
}

pub fn options() -> Options {
    Options { scope: Scope::Name, qualified_use: never_qualified }
}
