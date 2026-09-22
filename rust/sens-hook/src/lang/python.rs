use std::collections::HashSet;

use tree_sitter::Node;

use super::treesitter::{
    all_named, collapse, declare, descendants, field, named, never_qualified, text, Emitted, Extra,
    Options, Scope,
};

const LANG_DECORATORS: [&str; 10] = [
    "staticmethod", "classmethod", "property", "abstractmethod", "abstractproperty", "dataclass",
    "functools", "cached_property", "override", "final",
];

fn named_children_of<'t>(node: &Node<'t>) -> Vec<Node<'t>> {
    let mut cursor = node.walk();
    node.named_children(&mut cursor).collect()
}

fn is_public(name: &str) -> bool {
    !name.starts_with('_')
}

fn head_identifier(node: &Node, source: &str) -> Option<String> {
    let mut current = *node;
    while current.kind() == "attribute" {
        current = field(&current, "object")?;
    }
    (current.kind() == "identifier").then(|| text(&current, source).to_string())
}

fn has_registration_decorator(node: &Node, source: &str) -> bool {
    for dec in all_named(node, "decorator") {
        let Some(expr) = named_children_of(&dec).first().copied() else { continue };
        let is_call = expr.kind() == "call";
        let target = if is_call { field(&expr, "function") } else { Some(expr) };
        let Some(target) = target else { continue };
        if !is_call && target.kind() != "attribute" {
            continue;
        }
        if let Some(head) = head_identifier(&target, source) {
            if !LANG_DECORATORS.contains(&head.as_str()) {
                return true;
            }
        }
    }
    false
}

fn collect_dunder_all(root: &Node, source: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    for raw in named_children_of(root) {
        if raw.kind() != "expression_statement" {
            continue;
        }
        let Some(assign) = named(&raw, "assignment") else { continue };
        let Some(left) = field(&assign, "left") else { continue };
        if left.kind() != "identifier" || text(&left, source) != "__all__" {
            continue;
        }
        if let Some(right) = field(&assign, "right") {
            for sc in descendants(&right, "string_content") {
                out.insert(text(&sc, source).to_string());
            }
        }
    }
    out
}

fn func_sig(node: &Node, source: &str, name: &str) -> String {
    let whole = text(node, source);
    let prefix = if whole.starts_with("async") { "async " } else { "" };
    let params = field(node, "parameters")
        .map(|p| collapse(text(&p, source)))
        .unwrap_or_else(|| "()".to_string());
    let ret = field(node, "return_type")
        .map(|r| format!(" -> {}", collapse(text(&r, source))))
        .unwrap_or_default();
    format!("{prefix}def {name}{params}{ret}")
}

fn class_sig(node: &Node, source: &str, name: &str) -> String {
    let bases = field(node, "superclasses")
        .map(|b| collapse(text(&b, source)))
        .unwrap_or_default();
    format!("class {name}{bases}")
}

fn dotted_segments(node: &Node, source: &str) -> Vec<String> {
    if node.kind() == "identifier" {
        return vec![text(node, source).to_string()];
    }
    all_named(node, "identifier").iter().map(|c| text(c, source).to_string()).collect()
}

fn resolve_module(
    from_rel: &str,
    segs: &[String],
    level: usize,
    rel_set: &HashSet<String>,
) -> Option<String> {
    if segs.is_empty() && level == 0 {
        return None;
    }
    let candidates = |base: &[&str]| {
        let mut parts: Vec<&str> = base.to_vec();
        for s in segs {
            parts.push(s);
        }
        let joined = parts.join("/");
        vec![format!("{joined}.py"), format!("{joined}/__init__.py")]
    };

    if level > 0 {
        let all: Vec<&str> = from_rel.split('/').collect();
        let keep = all.len().saturating_sub(level);
        for cand in candidates(&all[..keep]) {
            if rel_set.contains(&cand) {
                return Some(cand);
            }
        }
        return None;
    }

    let cands = candidates(&[]);
    for cand in &cands {
        if rel_set.contains(cand) {
            return Some(cand.clone());
        }
    }
    for r in rel_set {
        for cand in &cands {
            if r == cand || r.ends_with(&format!("/{cand}")) {
                return Some(r.clone());
            }
        }
    }
    None
}

fn def_body<'t>(node: &Node<'t>) -> Node<'t> {
    if node.kind() == "decorated_definition" {
        field(node, "definition").unwrap_or(*node)
    } else {
        *node
    }
}

fn collect_import(
    node: &Node,
    source: &str,
    file: &str,
    rel_set: &HashSet<String>,
    out: &mut Emitted,
) {
    if node.kind() == "import_statement" {
        for child in named_children_of(node) {
            let target =
                if child.kind() == "aliased_import" { field(&child, "name") } else { Some(child) };
            let Some(target) = target else { continue };
            if target.kind() != "dotted_name" && target.kind() != "identifier" {
                continue;
            }
            let segs = dotted_segments(&target, source);
            let to = resolve_module(file, &segs, 0, rel_set).unwrap_or_else(|| segs.join("."));
            let last = segs.last().cloned().unwrap_or_default();
            out.import(file, to, vec![last]);
        }
        return;
    }

    let module_node = field(node, "module_name");
    let mut segs: Vec<String> = Vec::new();
    let mut level = 0usize;
    if let Some(m) = module_node {
        if m.kind() == "relative_import" {
            level = named(&m, "import_prefix").map(|p| text(&p, source).len()).unwrap_or(1);
            if let Some(dotted) = named(&m, "dotted_name") {
                segs = dotted_segments(&dotted, source);
            }
        } else {
            segs = dotted_segments(&m, source);
        }
    }

    let mut names: Vec<String> = Vec::new();
    for child in named_children_of(node) {
        if module_node.is_some_and(|m| m.id() == child.id()) {
            continue;
        }
        if child.kind() == "wildcard_import" {
            names.push("*".to_string());
        } else if child.kind() == "aliased_import" {
            if let Some(n) = field(&child, "name") {
                if let Some(first) = dotted_segments(&n, source).into_iter().next() {
                    names.push(first);
                }
            }
        } else if child.kind() == "dotted_name" || child.kind() == "identifier" {
            if let Some(first) = dotted_segments(&child, source).into_iter().next() {
                names.push(first);
            }
        }
    }

    let fallback = if segs.is_empty() { ".".to_string() } else { segs.join(".") };
    let to = resolve_module(file, &segs, level, rel_set).unwrap_or(fallback);
    out.import(file, to, names);
}

pub fn extract(root: &Node, source: &str, file: &str, rel_set: &HashSet<String>, out: &mut Emitted) {
    let dunder_all = collect_dunder_all(root, source);
    let is_exported = |name: &str| is_public(name) || dunder_all.contains(name);

    for raw in named_children_of(root) {
        let node = def_body(&raw);
        let entry = raw.kind() == "decorated_definition" && has_registration_decorator(&raw, source);

        if node.kind() == "function_definition" {
            let Some(name_node) = field(&node, "name") else { continue };
            let name = text(&name_node, source).to_string();
            let signature = Some(func_sig(&node, source, &name));
            let exported = is_exported(&name);
            declare(out, source, name, "function", &node, &name_node, exported, Extra { signature, entry, ..Extra::default() });
        } else if node.kind() == "class_definition" {
            let Some(name_node) = field(&node, "name") else { continue };
            let cname = text(&name_node, source).to_string();
            let signature = Some(class_sig(&node, source, &cname));
            let exported = is_exported(&cname);
            declare(out, source, cname.clone(), "class", &node, &name_node, exported, Extra { signature, entry, ..Extra::default() });

            let members = field(&node, "body").map(|b| named_children_of(&b)).unwrap_or_default();
            for mraw in members {
                let m = def_body(&mraw);
                if m.kind() != "function_definition" {
                    continue;
                }
                let Some(m_name_node) = field(&m, "name") else { continue };
                let mname = text(&m_name_node, source).to_string();
                let signature = Some(func_sig(&m, source, &mname));
                declare(
                    out,
                    source,
                    format!("{cname}.{mname}"),
                    "method",
                    &m,
                    &m_name_node,
                    false,
                    Extra { signature, simple_name: Some(mname), ..Extra::default() },
                );
            }
        } else if node.kind() == "expression_statement" {
            let Some(assign) = named(&node, "assignment") else { continue };
            let Some(left) = field(&assign, "left") else { continue };
            if left.kind() != "identifier" {
                continue;
            }
            let name = text(&left, source).to_string();
            let upper = name
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
            let kind = if upper { "const" } else { "var" };
            let signature = Some(name.clone());
            let exported = is_exported(&name);
            declare(out, source, name, kind, &left, &left, exported, Extra { signature, ..Extra::default() });
        } else if node.kind() == "import_statement" || node.kind() == "import_from_statement" {
            collect_import(&node, source, file, rel_set, out);
        }
    }
}

pub fn options() -> Options {
    Options { scope: Scope::Import, qualified_use: never_qualified }
}
