use std::collections::HashSet;

use tree_sitter::Node;

use super::treesitter::{
    declare, field, named, never_qualified, text, Emitted, Extra, Options, Scope,
};

fn emit_method(node: &Node, source: &str, container: Option<&str>, out: &mut Emitted) {
    let Some(name_node) = field(node, "name") else { return };
    let simple = text(&name_node, source).to_string();
    match container {
        Some(c) => declare(out, source, format!("{c}.{simple}"), "method", node, &name_node, false, Extra { simple_name: Some(simple), ..Extra::default() }),
        None => declare(out, source, simple, "function", node, &name_node, true, Extra::default()),
    }
}

fn find_suffix(rel_set: &HashSet<String>, rel: &str) -> Option<String> {
    if rel_set.contains(rel) {
        return Some(rel.to_string());
    }
    rel_set.iter().find(|r| r.ends_with(&format!("/{rel}"))).cloned()
}

fn process_body(
    body: &Node,
    source: &str,
    file: &str,
    rel_set: &HashSet<String>,
    container: Option<&str>,
    out: &mut Emitted,
) {
    let mut cursor = body.walk();
    let children: Vec<Node> = body.named_children(&mut cursor).collect();
    for node in children {
        match node.kind() {
            "method" | "singleton_method" => emit_method(&node, source, container, out),
            "class" | "module" => {
                let Some(name_node) = field(&node, "name") else { continue };
                let cname = text(&name_node, source).to_string();
                declare(out, source, cname.clone(), "class", &node, &name_node, true, Extra::default());
                if let Some(inner) = field(&node, "body") {
                    process_body(&inner, source, file, rel_set, Some(&cname), out);
                }
            }
            "assignment" => {
                if let Some(left) = field(&node, "left") {
                    if left.kind() == "constant" {
                        let name = text(&left, source).to_string();
                        let sig = Some(name.clone());
                        declare(out, source, name, "const", &left, &left, true, Extra { signature: sig, ..Extra::default() });
                    }
                }
            }
            "call" => {
                let Some(method) = field(&node, "method") else { continue };
                let method_name = text(&method, source);
                if method_name != "require" && method_name != "require_relative" {
                    continue;
                }
                let raw = field(&node, "arguments")
                    .and_then(|args| named(&args, "string"))
                    .map(|s| text(&s, source).trim_matches(|c| c == '\'' || c == '"').to_string())
                    .unwrap_or_default();
                if raw.is_empty() {
                    continue;
                }
                let to = if method_name == "require_relative" {
                    let candidate = format!("{raw}.rb");
                    find_suffix(rel_set, &candidate).unwrap_or(candidate)
                } else {
                    raw
                };
                out.import(file, to, Vec::new());
            }
            _ => {}
        }
    }
}

pub fn extract(root: &Node, source: &str, file: &str, rel_set: &HashSet<String>, out: &mut Emitted) {
    process_body(root, source, file, rel_set, None, out);
}

pub fn options() -> Options {
    Options { scope: Scope::Name, qualified_use: never_qualified }
}
