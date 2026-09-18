use std::collections::HashSet;

use tree_sitter::Node;

use super::treesitter::{
    declare, field, named, never_qualified, text, Emitted, Extra, Options, Scope,
};

fn type_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "class_declaration" => Some("class"),
        "interface_declaration" => Some("interface"),
        "struct_declaration" => Some("class"),
        "enum_declaration" => Some("enum"),
        "record_declaration" => Some("class"),
        "record_struct_declaration" => Some("class"),
        _ => None,
    }
}

fn children_of<'t>(node: &Node<'t>) -> Vec<Node<'t>> {
    let mut cursor = node.walk();
    node.children(&mut cursor).collect()
}

fn named_children_of<'t>(node: &Node<'t>) -> Vec<Node<'t>> {
    let mut cursor = node.walk();
    node.named_children(&mut cursor).collect()
}

fn has_modifier(node: &Node, source: &str, wanted: &str) -> bool {
    children_of(node)
        .iter()
        .any(|c| c.kind() == "modifier" && text(c, source) == wanted)
}

fn attrs(node: &Node, source: &str) -> Vec<String> {
    let mut out = Vec::new();
    for c in children_of(node) {
        if c.kind() != "attribute_list" {
            continue;
        }
        for a in named_children_of(&c) {
            if a.kind() != "attribute" {
                continue;
            }
            let id = named(&a, "identifier").or_else(|| named(&a, "qualified_name"));
            if let Some(id) = id {
                let full = text(&id, source);
                out.push(full.rsplit('.').next().unwrap_or(full).to_string());
            }
        }
    }
    out
}

fn is_http_attr(a: &str) -> bool {
    a == "Route"
        || a
            .strip_prefix("Http")
            .is_some_and(|rest| {
                matches!(rest, "Get" | "Post" | "Put" | "Delete" | "Patch" | "Head" | "Options")
            })
}

fn is_controller(node: &Node, source: &str, name: &str) -> bool {
    name.ends_with("Controller")
        || attrs(node, source).iter().any(|a| a == "ApiController" || a == "Route")
}

fn is_entry_method(m: &Node, source: &str, name: &str, controller: bool) -> bool {
    if name == "Main" && m.kind() == "method_declaration" && has_modifier(m, source, "static") {
        return true;
    }
    if controller && has_modifier(m, source, "public") {
        return true;
    }
    attrs(m, source).iter().any(|a| is_http_attr(a))
}

fn emit_type(node: &Node, source: &str, kind: &'static str, out: &mut Emitted) {
    let Some(name_node) = field(node, "name") else { return };
    let cname = text(&name_node, source).to_string();
    let controller = kind == "class" && is_controller(node, source, &cname);
    let exported = has_modifier(node, source, "public");
    declare(out, source, cname.clone(), kind, node, &name_node, exported, Extra { entry: controller, ..Extra::default() });

    let members = match field(node, "body") {
        Some(body) => named_children_of(&body),
        None => Vec::new(),
    };
    for m in members {
        if m.kind() == "method_declaration" || m.kind() == "constructor_declaration" {
            let Some(m_name) = field(&m, "name") else { continue };
            let simple = text(&m_name, source).to_string();
            let entry = is_entry_method(&m, source, &simple, controller);
            declare(
                out,
                source,
                format!("{cname}.{simple}"),
                "method",
                &m,
                &m_name,
                false,
                Extra { simple_name: Some(simple), entry, ..Extra::default() },
            );
        } else if let Some(inner) = type_kind(m.kind()) {
            emit_type(&m, source, inner, out);
        }
    }
}

fn walk(node: &Node, source: &str, file: &str, out: &mut Emitted) {
    for child in named_children_of(node) {
        if let Some(kind) = type_kind(child.kind()) {
            emit_type(&child, source, kind, out);
        } else if child.kind() == "namespace_declaration"
            || child.kind() == "file_scoped_namespace_declaration"
        {
            let body = field(&child, "body").unwrap_or(child);
            walk(&body, source, file, out);
        } else if child.kind() == "using_directive" {
            let name = named(&child, "qualified_name").or_else(|| named(&child, "identifier"));
            if let Some(name) = name {
                let full = text(&name, source).to_string();
                let last = full.rsplit('.').next().unwrap_or(&full).to_string();
                out.import(file, full, vec![last]);
            }
        }
    }
}

pub fn extract(root: &Node, source: &str, file: &str, _rel: &HashSet<String>, out: &mut Emitted) {
    walk(root, source, file, out);
}

pub fn options() -> Options {
    Options { scope: Scope::Name, qualified_use: never_qualified }
}
