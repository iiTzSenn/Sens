use std::collections::HashMap;

use crate::index::SymbolInfo;
use crate::query::WhoUses;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::{Reference, SymbolInfo};

    fn sym(name: &str, file: &str, line: u32, exported: bool) -> SymbolInfo {
        SymbolInfo {
            id: format!("{file}#{name}#{line}"),
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
