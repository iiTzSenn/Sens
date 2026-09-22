use std::collections::HashSet;

use crate::gate::duplication::unreadable_paths;
use crate::gate::patch::{Patch, Usage};
use crate::gate::{Gate, Ruling};
use crate::query::Engine;
use crate::testfile::is_test_file;

pub struct Orphans;

struct Orphan {
    headline: String,
    evidence: String,
}

impl Gate for Orphans {
    fn id(&self) -> &'static str {
        "G2"
    }

    fn rule(&self) -> &'static str {
        "huérfanos"
    }

    fn fingerprint(&self) -> String {
        "internal-born-dead-and-last-caller-removed".into()
    }

    fn judge(&self, patch: &Patch, engine: &Engine) -> Ruling {
        let touched: HashSet<&str> = patch.files.iter().map(|file| file.path.as_str()).collect();
        let usage = Usage::of(patch);

        let mut orphans = born_dead(patch, &usage, engine, &touched);
        orphans.extend(abandoned(&usage, engine, &touched));

        if let Some(first) = orphans.first() {
            return Ruling::stop(
                self,
                format!("No lo escribo. {}", first.headline),
                orphans.iter().take(3).map(|orphan| orphan.evidence.clone()).collect(),
            );
        }

        let unreadable = unreadable_paths(patch);
        if !unreadable.is_empty() {
            return Ruling::abstain(
                self,
                "No puedo juzgar estos ficheros: el indexador nativo no lee su lenguaje.",
                unreadable.into_iter().map(str::to_string).collect(),
            );
        }

        Ruling::pass(self, "Todo lo que toca sigue teniendo quien lo llame.")
    }
}

fn born_dead(patch: &Patch, usage: &Usage, engine: &Engine, touched: &HashSet<&str>) -> Vec<Orphan> {
    let mut found = Vec::new();
    for file in &patch.files {
        if is_test_file(&file.path) {
            continue;
        }
        let Some(symbols) = file.introduced() else {
            continue;
        };
        for symbol in symbols {
            if symbol.exported
                || symbol.entry
                || usage.uses(&symbol.name)
                || used_elsewhere(engine, &symbol.name, touched)
            {
                continue;
            }
            found.push(Orphan {
                headline: format!("Nadie llama a {}.", symbol.name),
                evidence: format!(
                    "{} — {}:{} · nace sin un solo uso",
                    symbol.name, file.path, symbol.line
                ),
            });
        }
    }
    found
}

fn abandoned(usage: &Usage, engine: &Engine, touched: &HashSet<&str>) -> Vec<Orphan> {
    engine
        .used_only_in(touched)
        .into_iter()
        .filter(|found| {
            let symbol = found.symbol;
            !is_test_file(&symbol.file)
                && !symbol.entry
                && symbol.kind != "method"
                && !(symbol.exported && engine.is_entry_point(&symbol.file))
                && !usage.uses(&symbol.name)
                && (!touched.contains(symbol.file.as_str())
                    || usage.declares(&symbol.file, &symbol.name))
        })
        .map(|found| Orphan {
            headline: format!("{} se queda sin nadie que lo llame.", found.symbol.name),
            evidence: format!(
                "{} — {}:{} · {}",
                found.symbol.name,
                found.symbol.file,
                found.symbol.line,
                where_it_was_used(&found.sites)
            ),
        })
        .collect()
}

fn where_it_was_used(sites: &[(&str, u32)]) -> String {
    let counted = if sites.len() == 1 {
        "su único uso estaba".to_string()
    } else {
        format!("sus {} usos estaban", sites.len())
    };
    let places: Vec<String> = sites
        .iter()
        .take(3)
        .map(|(file, line)| format!("{file}:{line}"))
        .collect();
    format!("{counted} en {}", places.join(", "))
}

fn used_elsewhere(engine: &Engine, name: &str, touched: &HashSet<&str>) -> bool {
    engine.who_uses(name).iter().any(|found| {
        found
            .references
            .iter()
            .any(|reference| !touched.contains(reference.file.as_str()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gate::fixture;
    use crate::gate::{FilePatch, Verdict};

    fn rewriting(before: &str, after: &str) -> Patch {
        Patch {
            files: vec![FilePatch {
                path: "src/boot.rs".into(),
                before: before.into(),
                after: after.into(),
            }],
        }
    }

    #[test]
    fn stops_a_helper_nobody_calls() {
        let index = fixture::index("");
        let engine = Engine::new(&index, &[]);
        let patch = rewriting("pub fn boot() {}\n", "pub fn boot() {}\nfn helper() {}\n");

        let ruling = Orphans.judge(&patch, &engine);

        assert_eq!(ruling.verdict, Verdict::Stop);
        assert!(ruling.said.contains("helper"), "{}", ruling.said);
    }

    #[test]
    fn lets_through_a_helper_the_patch_itself_calls() {
        let index = fixture::index("");
        let engine = Engine::new(&index, &[]);
        let patch = rewriting(
            "pub fn boot() {}\n",
            "pub fn boot() { helper() }\nfn helper() {}\n",
        );

        assert_eq!(Orphans.judge(&patch, &engine).verdict, Verdict::Pass);
    }

    #[test]
    fn says_nothing_about_a_new_exported_symbol() {
        let index = fixture::index("");
        let engine = Engine::new(&index, &[]);
        let patch = rewriting("pub fn boot() {}\n", "pub fn boot() {}\npub fn helper() {}\n");

        assert_eq!(Orphans.judge(&patch, &engine).verdict, Verdict::Pass);
    }

    #[test]
    fn stops_when_the_patch_removes_the_last_use() {
        let index = fixture::index_with(
            &[fixture::file("src/boot.rs"), fixture::file("src/rows.rs")].join(","),
            &fixture::symbol("parse_row", "src/rows.rs", 10, "fn parse_row(raw: &str)"),
            &fixture::used_at(
                &fixture::id("parse_row", "src/rows.rs", 10),
                &[("src/boot.rs", 2)],
            ),
        );
        let engine = Engine::new(&index, &[]);
        let patch = rewriting("pub fn boot() { parse_row(\"\") }\n", "pub fn boot() {}\n");

        let ruling = Orphans.judge(&patch, &engine);

        assert_eq!(ruling.verdict, Verdict::Stop);
        assert!(ruling.said.contains("parse_row"), "{}", ruling.said);
        assert!(ruling.evidence[0].contains("src/boot.rs:2"), "{:?}", ruling.evidence);
    }

    #[test]
    fn lets_through_a_symbol_the_patch_deletes_along_with_its_use() {
        let index = fixture::index_with(
            &fixture::file("src/boot.rs"),
            &fixture::symbol("parse_row", "src/boot.rs", 1, "fn parse_row(raw: &str)"),
            &fixture::used_at(
                &fixture::id("parse_row", "src/boot.rs", 1),
                &[("src/boot.rs", 2)],
            ),
        );
        let engine = Engine::new(&index, &[]);
        let patch = rewriting(
            "fn parse_row(raw: &str) {}\npub fn boot() { parse_row(\"\") }\n",
            "pub fn boot() {}\n",
        );

        assert_eq!(Orphans.judge(&patch, &engine).verdict, Verdict::Pass);
    }

    #[test]
    fn abstains_when_it_cannot_read_the_file() {
        let index = fixture::index("");
        let engine = Engine::new(&index, &[]);
        let patch = Patch {
            files: vec![FilePatch {
                path: "notas.txt".into(),
                before: "hola\n".into(),
                after: "hola\nadiós\n".into(),
            }],
        };

        assert_eq!(Orphans.judge(&patch, &engine).verdict, Verdict::Abstain);
    }
}
