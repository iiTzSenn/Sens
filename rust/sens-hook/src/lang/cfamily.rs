use std::collections::HashSet;

use tree_sitter::Node;

use super::treesitter::{
    declare, field, first_descendant, never_qualified, text, Emitted, Extra, Options, Scope,
};

const NAME_TYPES: [&str; 3] = ["identifier", "field_identifier", "type_identifier"];
const RECORD_SPECS: [&str; 3] = ["struct_specifier", "union_specifier", "enum_specifier"];

fn named_children_of<'t>(node: &Node<'t>) -> Vec<Node<'t>> {
    let mut cursor = node.walk();
    node.named_children(&mut cursor).collect()
}

fn children_of<'t>(node: &Node<'t>) -> Vec<Node<'t>> {
    let mut cursor = node.walk();
    node.children(&mut cursor).collect()
}

fn fn_name_node<'t>(declarator: Option<Node<'t>>) -> Option<Node<'t>> {
    let declarator = declarator?;
    let fd = if declarator.kind() == "function_declarator" {
        declarator
    } else {
        first_descendant(&declarator, "function_declarator")?
    };
    let mut d = field(&fd, "declarator");
    while let Some(current) = d {
        if NAME_TYPES.contains(&current.kind()) {
            return Some(current);
        }
        if current.kind() == "qualified_identifier" {
            return first_descendant(&current, "field_identifier")
                .or_else(|| first_descendant(&current, "identifier"))
                .or(Some(current));
        }
        match field(&current, "declarator") {
            Some(n) if n.id() != current.id() => d = Some(n),
            _ => break,
        }
    }
    d.filter(|n| NAME_TYPES.contains(&n.kind()))
}

fn emit_record(spec: &Node, source: &str, out: &mut Emitted) -> Option<String> {
    let name_node = field(spec, "name")?;
    field(spec, "body")?;
    let kind = if spec.kind() == "enum_specifier" { "enum" } else { "class" };
    let name = text(&name_node, source).to_string();
    declare(out, source, name.clone(), kind, spec, &name_node, true, Extra::default());
    Some(name)
}

fn emit_members(body: &Node, cname: &str, source: &str, out: &mut Emitted) {
    for m in named_children_of(body) {
        let is_member = m.kind() == "function_definition"
            || m.kind() == "declaration"
            || m.kind() == "field_declaration";
        if !is_member {
            continue;
        }
        let Some(name_node) = fn_name_node(field(&m, "declarator")) else { continue };
        let simple = text(&name_node, source).to_string();
        declare(
            out,
            source,
            format!("{cname}.{simple}"),
            "method",
            &m,
            &name_node,
            false,
            Extra { simple_name: Some(simple), ..Extra::default() },
        );
    }
}

fn is_static(node: &Node, source: &str) -> bool {
    children_of(node)
        .iter()
        .any(|c| c.kind() == "storage_class_specifier" && text(c, source) == "static")
}

fn in_anonymous_namespace(node: &Node) -> bool {
    let mut p = node.parent();
    while let Some(current) = p {
        if current.kind() == "namespace_definition" && field(&current, "name").is_none() {
            return true;
        }
        p = current.parent();
    }
    false
}

fn find_suffix(rel_set: &HashSet<String>, rel: &str) -> Option<String> {
    let suffix = format!("/{rel}");
    rel_set.iter().find(|r| **r == rel || r.ends_with(&suffix)).cloned()
}

fn handle(
    node: &Node,
    source: &str,
    file: &str,
    rel_set: &HashSet<String>,
    cpp: bool,
    out: &mut Emitted,
) {
    match node.kind() {
        "function_definition" | "declaration" => {
            if let Some(name_node) = fn_name_node(field(node, "declarator")) {
                let name = text(&name_node, source).to_string();
                let is_definition = node.kind() == "function_definition";
                let mut exported = if cpp { true } else { !is_static(node, source) };
                let mut entry = !cpp && is_definition && name == "main";
                if cpp {
                    if name == "main" {
                        entry = true;
                    } else if is_static(node, source) || in_anonymous_namespace(node) {
                        exported = false;
                    }
                }
                declare(out, source, name, "function", node, &name_node, exported, Extra { entry, ..Extra::default() });
                return;
            }
            for spec in RECORD_SPECS {
                if let Some(s) = first_descendant(node, spec) {
                    emit_record(&s, source, out);
                }
            }
        }
        "struct_specifier" | "union_specifier" | "enum_specifier" => {
            emit_record(node, source, out);
        }
        "type_definition" => {
            if let Some(name_node) = field(node, "declarator") {
                if name_node.kind() == "type_identifier" {
                    let name = text(&name_node, source).to_string();
                    declare(out, source, name, "type", node, &name_node, true, Extra::default());
                }
            }
            for spec in RECORD_SPECS {
                if let Some(s) = first_descendant(node, spec) {
                    if field(&s, "body").is_some() && field(&s, "name").is_some() {
                        emit_record(&s, source, out);
                    }
                }
            }
        }
        "preproc_def" => {
            if let Some(name_node) = field(node, "name") {
                let name = text(&name_node, source).to_string();
                let signature = Some(format!("#define {name}"));
                declare(out, source, name, "const", node, &name_node, true, Extra { signature, ..Extra::default() });
            }
        }
        "preproc_function_def" => {
            if let Some(name_node) = field(node, "name") {
                let name = text(&name_node, source).to_string();
                let signature = Some(format!("#define {name}()"));
                declare(out, source, name, "function", node, &name_node, true, Extra { signature, ..Extra::default() });
            }
        }
        "preproc_include" => {
            let Some(path) = field(node, "path") else { return };
            if path.kind() != "string_literal" {
                return;
            }
            let rel = text(&path, source).trim_matches('"').to_string();
            let has_segment = rel.split('/').any(|s| !s.is_empty());
            let to = if has_segment && !rel_set.contains(&rel) {
                find_suffix(rel_set, &rel).unwrap_or_else(|| rel.clone())
            } else {
                rel.clone()
            };
            out.import(file, to, Vec::new());
        }
        "class_specifier" if cpp => {
            let cname = emit_record(node, source, out);
            if let (Some(cname), Some(body)) = (cname, field(node, "body")) {
                emit_members(&body, &cname, source, out);
            }
        }
        "namespace_definition" if cpp => {
            if let Some(body) = field(node, "body") {
                for c in named_children_of(&body) {
                    handle(&c, source, file, rel_set, cpp, out);
                }
            }
        }
        _ => {}
    }
}

pub fn extract_c(root: &Node, source: &str, file: &str, rel_set: &HashSet<String>, out: &mut Emitted) {
    for node in named_children_of(root) {
        handle(&node, source, file, rel_set, false, out);
    }
}

pub fn extract_cpp(root: &Node, source: &str, file: &str, rel_set: &HashSet<String>, out: &mut Emitted) {
    for node in named_children_of(root) {
        handle(&node, source, file, rel_set, true, out);
    }
}

pub fn options() -> Options {
    Options { scope: Scope::Name, qualified_use: never_qualified }
}
