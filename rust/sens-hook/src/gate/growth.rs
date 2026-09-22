use crate::gate::{Gate, Patch, Ruling};
use crate::query::Engine;

pub struct Growth {
    pub budget: i64,
}

impl Growth {
    pub fn sealed() -> Self {
        Self { budget: 40 }
    }
}

impl Gate for Growth {
    fn id(&self) -> &'static str {
        "G3"
    }

    fn rule(&self) -> &'static str {
        "crecimiento"
    }

    fn fingerprint(&self) -> String {
        format!("budget:{}", self.budget)
    }

    fn judge(&self, patch: &Patch, _engine: &Engine) -> Ruling {
        let net = patch.net_lines();
        if net <= self.budget {
            return Ruling::pass(self, format!("{net:+} líneas netas."));
        }

        let evidence = patch
            .files
            .iter()
            .map(|file| format!("{} — {:+} líneas", file.path, file.net_lines()))
            .collect();

        Ruling::stop(
            self,
            format!(
                "Demasiado para lo que pediste: {net:+} líneas contra un presupuesto de {}.",
                self.budget
            ),
            evidence,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gate::fixture;
    use crate::gate::{FilePatch, Verdict};

    fn patch_of(lines: usize) -> Patch {
        Patch {
            files: vec![FilePatch {
                path: "src/boot.rs".into(),
                before: String::new(),
                after: "let x = 1;\n".repeat(lines),
            }],
        }
    }

    #[test]
    fn a_patch_inside_the_budget_passes() {
        let index = fixture::index("");
        let engine = Engine::new(&index, &[]);
        assert_eq!(
            Growth::sealed().judge(&patch_of(10), &engine).verdict,
            Verdict::Pass
        );
    }

    #[test]
    fn a_patch_over_the_budget_stops_and_names_the_file() {
        let index = fixture::index("");
        let engine = Engine::new(&index, &[]);
        let ruling = Growth::sealed().judge(&patch_of(94), &engine);

        assert_eq!(ruling.verdict, Verdict::Stop);
        assert!(ruling.said.contains("+94"));
        assert!(ruling.evidence[0].contains("src/boot.rs"));
    }

    #[test]
    fn a_patch_that_shrinks_the_project_always_passes() {
        let index = fixture::index("");
        let engine = Engine::new(&index, &[]);
        let patch = Patch {
            files: vec![FilePatch {
                path: "src/boot.rs".into(),
                before: "a\nb\nc\nd\n".into(),
                after: "a\n".into(),
            }],
        };

        let ruling = Growth::sealed().judge(&patch, &engine);

        assert_eq!(ruling.verdict, Verdict::Pass);
        assert!(ruling.said.contains("-3"));
    }
}
