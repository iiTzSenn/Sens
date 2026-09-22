use std::collections::HashSet;
use std::path::Path;

use crate::gate::{Gate, Patch, Ruling};
use crate::query::Engine;

pub struct Comments;

enum Style {
    Slash,
    Hash,
    None,
}

impl Gate for Comments {
    fn id(&self) -> &'static str {
        "G5"
    }

    fn rule(&self) -> &'static str {
        "comentarios"
    }

    fn fingerprint(&self) -> String {
        "leading-line-and-block-comments".into()
    }

    fn judge(&self, patch: &Patch, _engine: &Engine) -> Ruling {
        let mut evidence = Vec::new();
        let mut judged = 0;

        for file in &patch.files {
            let style = style_for(&file.path);
            if matches!(style, Style::None) {
                continue;
            }
            judged += 1;
            let commented = comment_lines(&file.after, &style);
            for change in file.added() {
                if commented.contains(&change.line) {
                    evidence.push(format!(
                        "{}:{} — {}",
                        file.path,
                        change.line,
                        change.text.trim()
                    ));
                }
            }
        }

        if !evidence.is_empty() {
            let count = evidence.len();
            evidence.truncate(5);
            let counted = if count == 1 {
                "Un comentario".to_string()
            } else {
                format!("{count} comentarios")
            };
            return Ruling::stop(
                self,
                format!("{counted}. Si necesita explicación, extrae una función con nombre."),
                evidence,
            );
        }

        if judged == 0 {
            return Ruling::abstain(self, "Ningún fichero con sintaxis conocida.", Vec::new());
        }

        Ruling::pass(self, "Sin comentarios añadidos.")
    }
}

fn style_for(path: &str) -> Style {
    let Some(ext) = Path::new(path).extension().and_then(|ext| ext.to_str()) else {
        return Style::None;
    };
    match ext.to_ascii_lowercase().as_str() {
        "rs" | "go" | "java" | "cs" | "kt" | "kts" | "c" | "cpp" | "cxx" | "cc" | "h" | "hpp"
        | "hh" | "hxx" | "ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs" | "php" => {
            Style::Slash
        }
        "py" | "pyi" | "rb" | "sh" | "bash" | "toml" | "yml" | "yaml" => Style::Hash,
        _ => Style::None,
    }
}

fn comment_lines(source: &str, style: &Style) -> HashSet<u32> {
    let mut lines = HashSet::new();
    let mut in_block = false;

    for (index, raw) in source.lines().enumerate() {
        let number = (index + 1) as u32;
        let trimmed = raw.trim();

        if in_block {
            lines.insert(number);
            if trimmed.contains("*/") {
                in_block = false;
            }
            continue;
        }

        if number == 1 && trimmed.starts_with("#!") {
            continue;
        }

        let commented = match style {
            Style::Slash => trimmed.starts_with("//") || trimmed.starts_with("/*"),
            Style::Hash => trimmed.starts_with('#'),
            Style::None => false,
        };

        if commented {
            lines.insert(number);
        }

        if matches!(style, Style::Slash) && trimmed.starts_with("/*") && !trimmed.contains("*/") {
            in_block = true;
        }
    }

    lines
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gate::fixture;
    use crate::gate::{FilePatch, Verdict};

    fn judge(path: &str, before: &str, after: &str) -> Ruling {
        let index = fixture::index("");
        let engine = Engine::new(&index, &[]);
        let patch = Patch {
            files: vec![FilePatch {
                path: path.into(),
                before: before.into(),
                after: after.into(),
            }],
        };
        Comments.judge(&patch, &engine)
    }

    #[test]
    fn stops_a_line_comment_the_patch_adds() {
        let ruling = judge(
            "src/boot.rs",
            "fn boot() {}\n",
            "fn boot() {}\n// arranca el motor\nfn start() {}\n",
        );

        assert_eq!(ruling.verdict, Verdict::Stop);
        assert!(ruling.evidence[0].contains("arranca el motor"));
    }

    #[test]
    fn stops_every_line_of_an_added_block_comment() {
        let ruling = judge(
            "src/boot.rs",
            "fn boot() {}\n",
            "fn boot() {}\n/*\n * documenta\n */\nfn start() {}\n",
        );

        assert_eq!(ruling.verdict, Verdict::Stop);
        assert!(ruling.said.starts_with("3 comentarios"));
    }

    #[test]
    fn leaves_a_comment_that_was_already_there_alone() {
        let ruling = judge(
            "src/boot.rs",
            "// viejo\nfn boot() {}\n",
            "// viejo\nfn boot() {}\nfn start() {}\n",
        );

        assert_eq!(ruling.verdict, Verdict::Pass);
    }

    #[test]
    fn keeps_the_shebang_that_a_binary_needs_to_run() {
        let ruling = judge("bin/sens.sh", "", "#!/usr/bin/env node\necho hola\n");

        assert_eq!(ruling.verdict, Verdict::Pass);
    }

    #[test]
    fn does_not_mistake_a_rust_attribute_for_a_comment() {
        let ruling = judge(
            "src/boot.rs",
            "fn boot() {}\n",
            "fn boot() {}\n#[derive(Debug)]\nstruct Config;\n",
        );

        assert_eq!(ruling.verdict, Verdict::Pass);
    }
}
