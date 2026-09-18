use std::collections::HashSet;

use tree_sitter::Node;

use super::treesitter::{
    declare, descendants, field, named, never_qualified, text, Emitted, Extra, Options, Scope,
};


fn type_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "class_declaration" => Some("class"),
        "interface_declaration" => Some("interface"),
        "trait_declaration" => Some("class"),
        "enum_declaration" => Some("enum"),
        _ => None,
    }
}

fn emit_type(node: &Node, source: &str, kind: &'static str, out: &mut Emitted) {
    let Some(name_node) = field(node, "name") else { return };
    let cname = text(&name_node, source).to_string();
    declare(out, source, cname.clone(), kind, node, &name_node, true, Extra::default());

    let Some(body) = named(node, "declaration_list") else { return };
    let mut cursor = body.walk();
    let members: Vec<Node> = body.named_children(&mut cursor).collect();
    for m in members {
        if m.kind() != "method_declaration" {
            continue;
        }
        let Some(m_name) = field(&m, "name") else { continue };
        let simple = text(&m_name, source).to_string();
        declare(
            out,
            source,
            format!("{cname}.{simple}"),
            "method",
            &m,
            &m_name,
            false,
            Extra { simple_name: Some(simple), ..Extra::default() },
        );
    }
}

fn walk(node: &Node, source: &str, file: &str, out: &mut Emitted) {
    let mut cursor = node.walk();
    let children: Vec<Node> = node.named_children(&mut cursor).collect();
    for child in children {
        if let Some(kind) = type_kind(child.kind()) {
            emit_type(&child, source, kind, out);
        } else if child.kind() == "function_definition" {
            if let Some(name_node) = field(&child, "name") {
                let name = text(&name_node, source).to_string();
                declare(out, source, name, "function", &child, &name_node, true, Extra::default());
            }
        } else if child.kind() == "const_declaration" {
            for el in descendants(&child, "const_element") {
                if let Some(name_node) = named(&el, "name") {
                    let name = text(&name_node, source).to_string();
                    let signature = Some(format!("const {name}"));
                    declare(out, source, name, "const", &el, &name_node, true, Extra { signature, ..Extra::default() });
                }
            }
        } else if child.kind() == "namespace_definition" {
            let body = named(&child, "compound_statement").or_else(|| named(&child, "declaration_list"));
            if let Some(body) = body {
                walk(&body, source, file, out);
            }
        } else if child.kind() == "namespace_use_declaration" {
            for clause in descendants(&child, "namespace_use_clause") {
                let q = named(&clause, "qualified_name").or_else(|| named(&clause, "name"));
                if let Some(q) = q {
                    let full = text(&q, source).to_string();
                    let last = full.rsplit(|c: char| c as u32 == 92).next().unwrap_or(&full).to_string();
                    out.import(file, full, vec![last]);
                }
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
