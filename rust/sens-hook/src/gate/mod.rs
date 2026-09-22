pub mod comments;
pub mod duplication;
pub mod growth;
pub mod patch;
pub mod trial;

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::freshness::{self, Freshness};
use crate::query::Engine;

pub use patch::{FilePatch, Patch};

pub fn judge(root: &Path, patch: &mut Patch) -> Option<Outcome> {
    for file in &mut patch.files {
        file.read_before(root);
    }
    let (index, meta) = crate::engine::load(root)?;
    if freshness::check(root, &index.files, &meta) != Freshness::Fresh {
        return None;
    }
    let queries = Engine::new(&index, &meta.entry_points);
    Some(Gauntlet::over(root).run(patch, &queries))
}

#[derive(Debug, PartialEq, Eq, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Pass,
    Stop,
    Abstain,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Ruling {
    pub gate: String,
    pub rule: String,
    pub verdict: Verdict,
    pub said: String,
    pub evidence: Vec<String>,
}

impl Ruling {
    pub fn pass(gate: &dyn Gate, said: impl Into<String>) -> Self {
        Self::new(gate, Verdict::Pass, said, Vec::new())
    }

    pub fn abstain(gate: &dyn Gate, said: impl Into<String>, evidence: Vec<String>) -> Self {
        Self::new(gate, Verdict::Abstain, said, evidence)
    }

    pub fn stop(gate: &dyn Gate, said: impl Into<String>, evidence: Vec<String>) -> Self {
        Self::new(gate, Verdict::Stop, said, evidence)
    }

    pub fn of(
        gate: &str,
        rule: &str,
        verdict: Verdict,
        said: impl Into<String>,
        evidence: Vec<String>,
    ) -> Self {
        Self {
            gate: gate.to_string(),
            rule: rule.to_string(),
            verdict,
            said: said.into(),
            evidence,
        }
    }

    fn new(gate: &dyn Gate, verdict: Verdict, said: impl Into<String>, evidence: Vec<String>) -> Self {
        Self::of(gate.id(), gate.rule(), verdict, said, evidence)
    }
}

pub trait Gate {
    fn id(&self) -> &'static str;
    fn rule(&self) -> &'static str;
    fn fingerprint(&self) -> String;
    fn judge(&self, patch: &Patch, engine: &Engine) -> Ruling;
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub seal: String,
    pub applies: bool,
    pub net_lines: i64,
    pub rulings: Vec<Ruling>,
}

pub struct Gauntlet {
    gates: Vec<Box<dyn Gate>>,
    trial: trial::Trial,
}

impl Gauntlet {
    pub fn sealed() -> Self {
        Self::over(&std::path::PathBuf::from("."))
    }

    pub fn over(root: &Path) -> Self {
        Self {
            gates: vec![
                Box::new(duplication::Duplication),
                Box::new(growth::Growth::sealed()),
                Box::new(comments::Comments),
            ],
            trial: trial::Trial::detect(root),
        }
    }

    pub fn prove(&self, root: &Path) -> Ruling {
        self.trial.run(root)
    }

    pub fn seal(&self) -> String {
        let mut hash: u64 = 0xcbf29ce484222325;
        let mut stamp = |text: String| {
            for byte in text.bytes() {
                hash ^= u64::from(byte);
                hash = hash.wrapping_mul(0x100000001b3);
            }
        };
        for gate in &self.gates {
            stamp(format!("{}={};", gate.id(), gate.fingerprint()));
        }
        stamp(format!("G4={};", self.trial.fingerprint()));
        format!("{hash:016x}")
    }

    pub fn run(&self, patch: &Patch, engine: &Engine) -> Outcome {
        let rulings: Vec<Ruling> = self
            .gates
            .iter()
            .map(|gate| gate.judge(patch, engine))
            .collect();
        Outcome {
            seal: self.seal(),
            applies: !rulings.iter().any(|ruling| ruling.verdict == Verdict::Stop),
            net_lines: patch.net_lines(),
            rulings,
        }
    }
}

#[cfg(test)]
pub mod fixture {
    use crate::binindex::{self, BinIndex};

    pub fn index(symbols: &str) -> BinIndex {
        let raw = format!(
            "{{\"schemaVersion\":6,\"createdAt\":0,\"files\":[],\"symbols\":[{symbols}],\"imports\":[],\"references\":{{}}}}"
        );
        binindex::from_json(raw.as_bytes()).expect("fixture index")
    }

    pub fn symbol(name: &str, file: &str, line: u32, signature: &str) -> String {
        format!(
            "{{\"id\":\"{file}#{name}#{line}\",\"kind\":\"function\",\"name\":\"{name}\",\"file\":\"{file}\",\"line\":{line},\"signature\":\"{signature}\",\"exported\":true}}"
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_seal_changes_when_a_threshold_changes() {
        let sealed = Gauntlet::sealed();
        let loosened = Gauntlet {
            gates: vec![
                Box::new(duplication::Duplication),
                Box::new(growth::Growth { budget: 4000 }),
                Box::new(comments::Comments),
            ],
            trial: trial::Trial { command: None },
        };
        assert_ne!(sealed.seal(), loosened.seal());
    }

    #[test]
    fn the_seal_is_stable_across_runs() {
        assert_eq!(Gauntlet::sealed().seal(), Gauntlet::sealed().seal());
    }
}
