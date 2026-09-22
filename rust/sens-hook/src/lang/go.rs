use std::collections::HashSet;

use tree_sitter::Node;

use super::treesitter::{
    all_named, declare, descendants, field, first_descendant, named, text, Emitted, Extra, Options,
    Scope,
};

fn is_exported(name: &str) -> bool {
    name.chars().next().is_some_and(|c| c.is_uppercase())
}

fn unquote(s: &str) -> String {
    s.trim_matches(|c| c == '`' || c == '"').to_string()
}

fn package_name(root: &Node, source: &str) -> Option<String> {
    let clause = named(root, "package_clause")?;
    first_descendant(&clause, "package_identifier").map(|n| text(&n, source).to_string())
}

pub fn extract(root: &Node, source: &str, file: &str, _rel: &HashSet<String>, out: &mut Emitted) {
    let pkg = package_name(root, source);
    let mut cursor = root.walk();
    let children: Vec<Node> = root.named_children(&mut cursor).collect();

    for node in children {
        match node.kind() {
            "function_declaration" => {
                let Some(name_node) = field(&node, "name") else { continue };
                let fname = text(&name_node, source).to_string();
                let entry = fname == "init" || (fname == "main" && pkg.as_deref() == Some("main"));
                let exported = is_exported(&fname);
                declare(out, source, fname, "function", &node, &name_node, exported, Extra { entry, ..Extra::default() });
            }
            "method_declaration" => {
                let Some(name_node) = field(&node, "name") else { continue };
                let simple = text(&name_node, source).to_string();
                let recv_type = field(&node, "receiver")
                    .and_then(|r| first_descendant(&r, "type_identifier"))
                    .map(|n| text(&n, source).to_string());
                let name = match &recv_type {
                    Some(t) => format!("{t}.{simple}"),
                    None => simple.clone(),
                };
                declare(out, source, name, "method", &node, &name_node, false, Extra { simple_name: Some(simple), ..Extra::default() });
            }
            "type_declaration" => {
                for spec in descendants(&node, "type_spec") {
                    let Some(name_node) = field(&spec, "name") else { continue };
                    let kind = match field(&spec, "type").map(|t| t.kind()) {
                        Some("interface_type") => "interface",
                        Some("struct_type") => "class",
                        _ => "type",
                    };
                    let name = text(&name_node, source).to_string();
                    let exported = is_exported(&name);
                    declare(out, source, name, kind, &spec, &name_node, exported, Extra::default());
                }
            }
            "const_declaration" | "var_declaration" => {
                let is_const = node.kind() == "const_declaration";
                let spec_type = if is_const { "const_spec" } else { "var_spec" };
                let kind = if is_const { "const" } else { "var" };
                for spec in descendants(&node, spec_type) {
                    for name_node in all_named(&spec, "identifier") {
                        let name = text(&name_node, source).to_string();
                        let exported = is_exported(&name);
                        let signature = Some(format!("{kind} {name}"));
                        declare(out, source, name, kind, &spec, &name_node, exported, Extra { signature, ..Extra::default() });
                    }
                }
            }
            "import_declaration" => {
                for spec in descendants(&node, "import_spec") {
                    if let Some(path) = field(&spec, "path") {
                        out.import(file, unquote(text(&path, source)), Vec::new());
                    }
                }
            }
            _ => {}
        }
    }
}

fn is_qualified_use(leaf: &Node, _source: &str) -> bool {
    leaf.parent().is_some_and(|parent| {
        parent.kind() == "selector_expression"
            && field(&parent, "field").is_some_and(|f| f.start_byte() == leaf.start_byte())
    })
}

pub fn options() -> Options {
    Options { scope: Scope::Package, qualified_use: is_qualified_use }
}
