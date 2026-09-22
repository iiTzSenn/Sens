use std::collections::HashMap;

use crate::index::SymbolInfo;
use crate::query::{DeadCandidate, DeadCodeReport, FileDependencies, MapEntry, Neighborhood, Tier, WhoUses};

fn symbol_name(id: &str) -> &str {
    id.split('#').nth(1).unwrap_or(id)
}

const MAX_INLINE_REFS: usize = 30;
const MAX_GROUPED_FILES: usize = 10;

pub fn format_symbols(syms: &[&SymbolInfo]) -> String {
    if syms.is_empty() {
        return "no matches".to_string();
    }
    syms.iter()
        .map(|s| {
            format!(
                "{}:{}  {}{}",
                s.file,
                s.line,
                s.signature,
                if s.exported { "  [exported]" } else { "" }
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn format_who_uses(results: &[WhoUses], full: bool) -> String {
    if results.is_empty() {
        return "symbol not found".to_string();
    }
    let mut lines: Vec<String> = Vec::new();
    for r in results {
        lines.push(format!(
            "{}  ({}:{}) — {} use(s)",
            r.symbol.name,
            r.symbol.file,
            r.symbol.line,
            r.references.len()
        ));

        if full || r.references.len() <= MAX_INLINE_REFS {
            for reference in &r.references {
                let where_ = match &reference.from {
                    Some(from) => format!("  in {}", symbol_name(from)),
                    None => String::new(),
                };
                lines.push(format!("  {}:{}{}", reference.file, reference.line, where_));
            }
            continue;
        }

        let mut counts: HashMap<&str, usize> = HashMap::new();
        let mut order: Vec<&str> = Vec::new();
        for reference in &r.references {
            let file = reference.file.as_str();
            if counts.insert(file, counts.get(file).copied().unwrap_or(0) + 1).is_none() {
                order.push(file);
            }
        }

        let mut sorted: Vec<(&str, usize)> = order.iter().map(|f| (*f, counts[f])).collect();
        sorted.sort_by(|a, b| b.1.cmp(&a.1));

        lines.push(format!(
            "  PARTIAL SUMMARY (not the full list) \u{2014} used in {} file(s), busiest first:",
            counts.len()
        ));
        let shown = sorted.len().min(MAX_GROUPED_FILES);
        for (file, count) in &sorted[..shown] {
            lines.push(format!("  {file}  ({count}x)"));
        }
        if sorted.len() > shown {
            lines.push(format!("  (+{} more file(s) not shown)", sorted.len() - shown));
        }
        lines.push(
            "  Do not treat this as complete \u{2014} call who_uses again with full:true to get every \
call site before renaming/editing all usages."
                .to_string(),
        );
    }
    lines.join("\n")
}

pub fn format_map(entries: &[MapEntry]) -> String {
    let mut lines = vec![format!("project map — {} file(s)", entries.len()), String::new()];
    for e in entries {
        lines.push(e.file.to_string());
        for s in &e.exported {
            lines.push(format!("  {}", s.signature));
        }
        if e.internal_count > 0 {
            lines.push(format!("  (+{} internal)", e.internal_count));
        }
    }
    lines.join("\n")
}

pub fn format_file_dependencies(deps: &FileDependencies) -> String {
    let mut lines = vec![deps.file.clone()];
    if deps.imports.is_empty() {
        lines.push("  imports: (none)".to_string());
    } else {
        lines.push(format!("  imports ({}):", deps.imports.len()));
        for f in &deps.imports {
            lines.push(format!("    {f}"));
        }
    }
    if deps.imported_by.is_empty() {
        lines.push("  imported by: (none)".to_string());
    } else {
        lines.push(format!("  imported by ({}):", deps.imported_by.len()));
        for f in &deps.imported_by {
            lines.push(format!("    {f}"));
        }
    }
    lines.join("\n")
}

pub fn format_explain(results: &[Neighborhood]) -> String {
    if results.is_empty() {
        return "symbol not found".to_string();
    }
    let mut lines: Vec<String> = Vec::new();
    let block = |lines: &mut Vec<String>, title: &str, syms: &[&SymbolInfo]| {
        lines.push(format!("  {title} ({}):", syms.len()));
        if syms.is_empty() {
            lines.push("    (none)".to_string());
        }
        for s in syms {
            lines.push(format!("    {}  {}:{}", s.name, s.file, s.line));
        }
    };
    for r in results {
        lines.push(format!(
            "{}  ({}:{})  {}",
            r.symbol.name, r.symbol.file, r.symbol.line, r.symbol.signature
        ));
        block(&mut lines, "called by", &r.callers);
        block(&mut lines, "calls", &r.callees);
    }
    lines.join("\n")
}

pub fn format_path(path: Option<&[&SymbolInfo]>, from: &str, to: &str) -> String {
    match path {
        None => format!("no path found from {from} to {to}"),
        Some(p) if p.is_empty() => format!("no path found from {from} to {to}"),
        Some(p) => p
            .iter()
            .enumerate()
            .map(|(i, s)| {
                format!(
                    "{}{}  ({}:{})",
                    if i == 0 { "" } else { "  → " },
                    s.name,
                    s.file,
                    s.line
                )
            })
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

const TIER_LABELS: [(Tier, &str); 3] = [
    (Tier::High, "HIGH confidence — internal, unreferenced; safe to remove"),
    (Tier::Medium, "MEDIUM — internal dead island; glance at the reason, then remove"),
    (Tier::Low, "LOW — exported API or method (dynamic dispatch); verify before removing"),
];

pub fn format_dead_code(report: &DeadCodeReport) -> String {
    if report.candidates.is_empty() && report.files.is_empty() {
        return "no dead-code candidates found".to_string();
    }
    let dead_files: std::collections::HashSet<&str> = report.files.iter().copied().collect();
    let mut lines = vec![format!(
        "{} dead-code candidate(s){} — unreachable from any entry point; candidates, not a verdict",
        report.candidates.len(),
        if report.files.is_empty() {
            String::new()
        } else {
            format!(" + {} dead file(s)", report.files.len())
        }
    )];

    if !report.files.is_empty() {
        lines.push(String::new());
        lines.push(format!(
            "WHOLE DEAD FILES — nothing imports them, no live symbol ({}):",
            report.files.len()
        ));
        for f in &report.files {
            lines.push(format!("  {f}  — delete the file"));
        }
    }

    let loose: Vec<&DeadCandidate> = report
        .candidates
        .iter()
        .filter(|c| !dead_files.contains(c.symbol.file.as_str()))
        .collect();
    for (tier, label) in TIER_LABELS {
        let group: Vec<&&DeadCandidate> = loose.iter().filter(|c| c.tier == tier).collect();
        if group.is_empty() {
            continue;
        }
        lines.push(String::new());
        lines.push(format!("{label} ({}):", group.len()));
        for c in group {
            let warn = match &c.reflective_hit {
                Some(where_) => {
                    format!(" — ⚠ also appears in {where_} (possible reflective use)")
                }
                None => String::new(),
            };
            lines.push(format!(
                "  {}:{}  {} {}{}  — {}{}",
                c.symbol.file,
                c.symbol.line,
                c.symbol.kind,
                c.symbol.name,
                if c.symbol.exported { "  [exported]" } else { "" },
                c.reason,
                warn
            ));
        }
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::{Reference, SymbolInfo};

    fn sym(name: &str, file: &str, line: u32, exported: bool) -> SymbolInfo {
        SymbolInfo {
            id: format!("{file}#{name}#{line}"),
            kind: "function".to_string(),
            entry: false,
            name: name.to_string(),
            file: file.to_string(),
            line,
            signature: format!("{name}()"),
            exported,
        }
    }

    fn reference(file: &str, line: u32, from: Option<&str>) -> Reference {
        Reference {
            file: file.to_string(),
            line,
            from: from.map(str::to_string),
        }
    }

    #[test]
    fn empty_results_match_the_typescript_wording() {
        assert_eq!(format_symbols(&[]), "no matches");
        assert_eq!(format_who_uses(&[], false), "symbol not found");
    }

    #[test]
    fn symbols_mark_only_exported_ones() {
        let a = sym("a", "x.ts", 1, true);
        let b = sym("b", "x.ts", 9, false);
        assert_eq!(
            format_symbols(&[&a, &b]),
            "x.ts:1  a()  [exported]\nx.ts:9  b()"
        );
    }

    #[test]
    fn uses_name_the_enclosing_symbol_when_known() {
        let s = sym("target", "t.ts", 3, false);
        let refs = vec![
            reference("u.ts", 7, Some("u.ts#caller#2")),
            reference("u.ts", 8, None),
        ];
        let out = format_who_uses(&[WhoUses { symbol: &s, references: refs }], false);
        assert_eq!(
            out,
            "target  (t.ts:3) — 2 use(s)\n  u.ts:7  in caller\n  u.ts:8"
        );
    }

    #[test]
    fn a_heavily_used_symbol_is_summarised_not_listed() {
        let s = sym("hot", "h.ts", 1, true);
        let mut refs = Vec::new();
        for i in 0..40 {
            refs.push(reference(if i < 30 { "a.ts" } else { "b.ts" }, i, None));
        }
        let out = format_who_uses(&[WhoUses { symbol: &s, references: refs }], false);
        assert!(out.contains("40 use(s)"));
        assert!(out.contains("PARTIAL SUMMARY (not the full list)"));
        assert!(out.contains("a.ts  (30x)"));
        assert!(out.contains("b.ts  (10x)"));

        assert!(out.contains("full:true"));
    }

    #[test]
    fn full_lists_every_site_however_many() {
        let s = sym("hot", "h.ts", 1, true);
        let refs: Vec<Reference> = (0..40).map(|i| reference("a.ts", i, None)).collect();
        let out = format_who_uses(&[WhoUses { symbol: &s, references: refs }], true);
        assert!(!out.contains("PARTIAL SUMMARY"));
        assert_eq!(out.lines().count(), 41);
    }
}
