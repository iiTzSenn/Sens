use crate::gate::patch::{self, Patch};
use crate::gate::{Gate, Ruling};
use crate::index::SymbolInfo;
use crate::query::Engine;

pub struct Duplication;

impl Gate for Duplication {
    fn id(&self) -> &'static str {
        "G1"
    }

    fn rule(&self) -> &'static str {
        "duplicación"
    }

    fn fingerprint(&self) -> String {
        "exact-name-outside-the-patched-file".into()
    }

    fn judge(&self, patch: &Patch, engine: &Engine) -> Ruling {
        let mut culprit: Option<(String, Vec<&SymbolInfo>)> = None;
        let mut unreadable: Vec<String> = Vec::new();

        for file in &patch.files {
            let Some(names) = file.introduced_symbols() else {
                unreadable.push(file.path.clone());
                continue;
            };
            for name in names {
                let hits: Vec<&SymbolInfo> = engine
                    .find_symbol(&name)
                    .into_iter()
                    .filter(|hit| hit.file != file.path)
                    .collect();
                if hits.is_empty() || culprit.is_some() {
                    continue;
                }
                culprit = Some((name, hits));
            }
        }

        if let Some((name, hits)) = culprit {
            let evidence = hits
                .iter()
                .take(3)
                .map(|hit| describe(engine, hit))
                .collect();
            return Ruling::stop(self, format!("No lo escribo. {name} ya existe."), evidence);
        }

        if !unreadable.is_empty() {
            return Ruling::abstain(
                self,
                "No puedo juzgar estos ficheros: el indexador nativo no lee su lenguaje.",
                unreadable,
            );
        }

        Ruling::pass(self, "Nada equivalente en el índice.")
    }
}

fn describe(engine: &Engine, hit: &SymbolInfo) -> String {
    let uses: usize = engine
        .who_uses(&hit.name)
        .iter()
        .map(|found| found.references.len())
        .sum();
    let shape = if hit.signature.is_empty() {
        hit.name.clone()
    } else {
        hit.signature.clone()
    };
    let counted = if uses == 1 {
        "1 uso".to_string()
    } else {
        format!("{uses} usos")
    };
    format!("{shape} — {}:{} · {counted}", hit.file, hit.line)
}

pub fn unreadable_paths(patch: &Patch) -> Vec<&str> {
    patch
        .files
        .iter()
        .map(|file| file.path.as_str())
        .filter(|path| !patch::readable(path))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gate::fixture;
    use crate::gate::{FilePatch, Verdict};

    fn patch_adding(body: &str) -> Patch {
        Patch {
            files: vec![FilePatch {
                path: "src/boot.rs".into(),
                before: "pub fn boot() {}\n".into(),
                after: format!("pub fn boot() {{}}\n{body}\n"),
            }],
        }
    }

    #[test]
    fn stops_a_symbol_that_already_lives_somewhere_else() {
        let index = fixture::index(&fixture::symbol(
            "parse_config",
            "src/config.rs",
            40,
            "fn parse_config(raw: &str) -> Config",
        ));
        let engine = Engine::new(&index, &[]);
        let patch = patch_adding("pub fn parse_config(raw: &str) {}");

        let ruling = Duplication.judge(&patch, &engine);

        assert_eq!(ruling.verdict, Verdict::Stop);
        assert!(ruling.said.contains("parse_config"));
        assert!(ruling.evidence[0].contains("src/config.rs:40"));
    }

    #[test]
    fn lets_through_a_symbol_the_project_does_not_have() {
        let index = fixture::index(&fixture::symbol(
            "parse_config",
            "src/config.rs",
            40,
            "fn parse_config(raw: &str) -> Config",
        ));
        let engine = Engine::new(&index, &[]);
        let patch = patch_adding("pub fn bin_index_reader() {}");

        assert_eq!(Duplication.judge(&patch, &engine).verdict, Verdict::Pass);
    }

    #[test]
    fn does_not_stop_a_symbol_that_already_sits_in_the_patched_file() {
        let index = fixture::index(&fixture::symbol("boot", "src/boot.rs", 1, "fn boot()"));
        let engine = Engine::new(&index, &[]);
        let patch = Patch {
            files: vec![FilePatch {
                path: "src/boot.rs".into(),
                before: String::new(),
                after: "pub fn boot() {}\n".into(),
            }],
        };

        assert_eq!(Duplication.judge(&patch, &engine).verdict, Verdict::Pass);
    }

    #[test]
    fn abstains_instead_of_pretending_on_an_unreadable_language() {
        let index = fixture::index("");
        let engine = Engine::new(&index, &[]);
        let patch = Patch {
            files: vec![FilePatch {
                path: "docs/notas.txt".into(),
                before: String::new(),
                after: "esto no es código\n".into(),
            }],
        };

        let ruling = Duplication.judge(&patch, &engine);

        assert_eq!(ruling.verdict, Verdict::Abstain);
        assert_eq!(ruling.evidence, vec!["docs/notas.txt"]);
    }

    #[test]
    fn stops_a_typescript_symbol_that_already_lives_somewhere_else() {
        let index = fixture::index(&fixture::symbol(
            "parseConfig",
            "src/config.ts",
            40,
            "export function parseConfig(raw: string): Config",
        ));
        let engine = Engine::new(&index, &[]);
        let patch = Patch {
            files: vec![FilePatch {
                path: "src/boot.ts".into(),
                before: "export function boot() {}\n".into(),
                after: "export function boot() {}\nexport function parseConfig(raw: string) {}\n"
                    .into(),
            }],
        };

        let ruling = Duplication.judge(&patch, &engine);

        assert_eq!(ruling.verdict, Verdict::Stop);
        assert!(ruling.said.contains("parseConfig"));
        assert!(ruling.evidence[0].contains("src/config.ts:40"));
    }
}
