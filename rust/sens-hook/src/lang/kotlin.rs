use std::collections::HashSet;

use tree_sitter::Node;

use super::treesitter::{
    declare, first_descendant, first_descendant_any, named, named_any, resolve_suffix, text,
    Emitted, Extra, Options, Scope,
};

const ENTRY_ANNOTATIONS: [&str; 33] = [
    "Composable", "Preview", "Component", "Service", "Repository", "Controller", "RestController",
    "Configuration", "SpringBootApplication", "ControllerAdvice", "RestControllerAdvice", "Bean",
    "EventListener", "PostConstruct", "PreDestroy", "Scheduled", "RequestMapping", "GetMapping",
    "PostMapping", "PutMapping", "DeleteMapping", "PatchMapping", "ExceptionHandler", "Entity",
    "Embeddable", "MappedSuperclass", "Table", "Test", "ParameterizedTest", "RepeatedTest",
    "BeforeEach", "AfterEach", "BeforeAll",
];

const ENTRY_EXTRA: [&str; 4] = ["AfterAll", "Before", "After", "TestFactory"];

fn named_children_of<'t>(node: &Node<'t>) -> Vec<Node<'t>> {
    let mut cursor = node.walk();
    node.named_children(&mut cursor).collect()
}

fn is_visible(node: &Node, source: &str) -> bool {
    let visibility = named(node, "modifiers")
        .and_then(|m| first_descendant(&m, "visibility_modifier"))
        .map(|v| text(&v, source).to_string());
    !matches!(visibility.as_deref(), Some("private") | Some("internal") | Some("protected"))
}

fn is_entry(node: &Node, source: &str) -> bool {
    let Some(mods) = named(node, "modifiers") else { return false };
    named_children_of(&mods).iter().any(|c| {
        c.kind() == "annotation"
            && first_descendant_any(c, &["type_identifier", "identifier"]).is_some_and(|ti| {
                let name = text(&ti, source);
                ENTRY_ANNOTATIONS.contains(&name) || ENTRY_EXTRA.contains(&name)
            })
    })
}

fn has_token(node: &Node, kind: &str) -> bool {
    let mut cursor = node.walk();
    node.children(&mut cursor).any(|c| c.kind() == kind)
}

fn emit_class(node: &Node, source: &str, out: &mut Emitted) {
    let Some(name_node) = named_any(node, &["type_identifier", "identifier"]) else { return };
    let cname = text(&name_node, source).to_string();
    let kind = if has_token(node, "interface") { "interface" } else { "class" };
    let exported = is_visible(node, source);
    let entry = is_entry(node, source);
    declare(out, source, cname.clone(), kind, node, &name_node, exported, Extra { entry, ..Extra::default() });

    let body = named(node, "class_body").or_else(|| named(node, "enum_class_body"));
    let members = body.map(|b| named_children_of(&b)).unwrap_or_default();
    for m in members {
        if m.kind() == "function_declaration" {
            let Some(m_name) = named_any(&m, &["simple_identifier", "identifier"]) else { continue };
            let simple = text(&m_name, source).to_string();
            let entry = is_entry(&m, source);
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
        } else if m.kind() == "class_declaration" || m.kind() == "object_declaration" {
            emit_class(&m, source, out);
        }
    }
}

pub fn extract(root: &Node, source: &str, file: &str, rel_set: &HashSet<String>, out: &mut Emitted) {
    for node in named_children_of(root) {
        match node.kind() {
            "function_declaration" => {
                let Some(name_node) = named_any(&node, &["simple_identifier", "identifier"]) else { continue };
                let name = text(&name_node, source).to_string();
                let entry = name == "main" || is_entry(&node, source);
                let exported = is_visible(&node, source);
                declare(out, source, name, "function", &node, &name_node, exported, Extra { entry, ..Extra::default() });
            }
            "class_declaration" | "object_declaration" => emit_class(&node, source, out),
            "property_declaration" => {
                let Some(var_decl) = named(&node, "variable_declaration") else { continue };
                let Some(name_node) = first_descendant_any(&var_decl, &["simple_identifier", "identifier"]) else {
                    continue;
                };
                let name = text(&name_node, source).to_string();
                let whole = text(&node, source);
                let head_end = whole.find(&name).map(|i| i + 1).unwrap_or(whole.len());
                let kind = if whole[..head_end].split(|c: char| !c.is_alphanumeric()).any(|w| w == "var") {
                    "var"
                } else {
                    "const"
                };
                let signature = Some(name.clone());
                declare(out, source, name, kind, &node, &name_node, is_visible(&node, source), Extra { signature, ..Extra::default() });
            }
            "import_list" => {
                for header in named_children_of(&node) {
                    if header.kind() != "import_header" {
                        continue;
                    }
                    if let Some(id) = named(&header, "identifier") {
                        emit_import(&id, source, file, rel_set, out);
                    }
                }
            }
            "import" => {
                if let Some(id) = named_any(&node, &["qualified_identifier", "identifier"]) {
                    emit_import(&id, source, file, rel_set, out);
                }
            }
            _ => {}
        }
    }
}

fn emit_import(
    id: &Node,
    source: &str,
    file: &str,
    rel_set: &HashSet<String>,
    out: &mut Emitted,
) {
    let raw = text(id, source);
    let segs: Vec<String> = raw
        .split('.')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let last = segs.last().cloned().unwrap_or_else(|| raw.to_string());
    let to = resolve_suffix(rel_set, &segs, &[".kt", ".kts"]).unwrap_or_else(|| raw.to_string());
    out.import(file, to, vec![last]);
}

fn is_qualified_use(leaf: &Node, _source: &str) -> bool {
    leaf.parent().is_some_and(|p| p.kind() == "navigation_suffix")
}

pub fn options() -> Options {
    Options { scope: Scope::Package, qualified_use: is_qualified_use }
}
