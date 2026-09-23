pub mod account;
pub mod apply;
pub mod catalog;
pub mod chat;
pub mod context;
pub mod model;
pub mod session;
pub mod title;

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use sens_hook::gate::patch::{LineChange, diff_lines};
use sens_hook::gate::{self, FilePatch, Gauntlet, Outcome, Patch, Ruling, Verdict};
use serde::{Deserialize, Serialize};

use apply::{Origin, Transaction};
use context::Briefing;
use model::{Model, Proposal};

pub const MAX_REPAIRS: u8 = 2;

pub const HALTED: &str = "Lo paré antes del siguiente paso.";

#[derive(Default)]
pub struct Halt(AtomicBool);

impl Halt {
    pub fn raise(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    pub fn clear(&self) {
        self.0.store(false, Ordering::Relaxed);
    }

    pub fn raised(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }

    fn checkpoint(&self) -> Result<(), String> {
        if self.raised() {
            return Err(HALTED.into());
        }
        Ok(())
    }
}

const IDENTITY: &str = "Eres el motor de Sens. Tienes una sola idea: el mejor parche es el más pequeño que funciona.

Reutilizas lo que el proyecto ya tiene en vez de escribirlo otra vez. No duplicas nada. No dejas código huérfano. No escribes comentarios: si algo necesita explicación, extraes una función con un nombre que lo diga.

Haces exactamente lo que se te pide, ni más ni menos: un atajo que deja de cumplir la tarea no es un parche corto, es un parche roto.

Tocas los ficheros que hagan falta, y de cada uno devuelves su contenido completo, sin recortes ni elipsis. No listes un fichero que no cambias.

Respondes solo con este JSON, sin texto alrededor:
{\"files\": [{\"path\": \"ruta/relativa\", \"after\": \"contenido completo\"}], \"note\": \"una frase\"}";

const DIET: &str = "Eres el motor de Sens en su segunda pasada. Este parche ya funciona y ya pasó los controles.

Tu único trabajo es dejarlo más corto sin cambiar lo que hace: fusiona, extrae lo repetido, borra lo que sobra. Devuelves los mismos ficheros que te doy, ni uno más ni uno menos. Si no puedes acortarlo sin perder comportamiento, devuelve el mismo contenido.

Respondes solo con este JSON, sin texto alrededor:
{\"files\": [{\"path\": \"ruta/relativa\", \"after\": \"contenido completo\"}], \"note\": \"una frase\"}";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub added: Vec<LineChange>,
    pub removed: Vec<LineChange>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "step", rename_all = "camelCase")]
pub enum Step {
    Oriented {
        symbols: usize,
        files: usize,
    },
    Proposed {
        paths: Vec<String>,
        model: String,
        note: String,
    },
    Judged {
        outcome: Outcome,
    },
    Proven {
        ruling: Ruling,
    },
    Repairing {
        gate: String,
        attempt: u8,
    },
    Dieted {
        from: i64,
        to: i64,
    },
    DietRejected {
        reason: String,
    },
    Applied {
        net: i64,
        files: Vec<FileDiff>,
    },
    Reindexed {
        millis: u64,
        delegated: bool,
    },
    ReindexFailed {
        reason: String,
    },
    GaveUp {
        reason: String,
    },
}

pub struct Crew<'a> {
    pub writer: &'a dyn Model,
    pub dieter: &'a dyn Model,
}

pub struct Landed {
    pub paths: Vec<String>,
    pub net: i64,
}

pub struct Refusal {
    pub gate: String,
    pub said: String,
    pub evidence: String,
}

struct Kept {
    proposal: Proposal,
    net: i64,
    transaction: Transaction,
}

pub fn run(
    root: &Path,
    task: &str,
    crew: &Crew,
    halt: &Halt,
    emit: &mut dyn FnMut(Step),
) -> Result<Landed, String> {
    halt.checkpoint()?;
    let briefing = context::brief(root, task)
        .ok_or("El proyecto no está indexado. Reconstruye el índice antes de pedirme nada.")?;
    emit(Step::Oriented {
        symbols: briefing.symbols,
        files: briefing.files,
    });

    let mut proposal = crew.writer.propose(IDENTITY, &opening(task, &briefing))?;
    halt.checkpoint()?;
    let mut kept: Option<Kept> = None;

    for attempt in 0..=MAX_REPAIRS {
        halt.checkpoint()?;
        emit(Step::Proposed {
            paths: proposal.paths().into_iter().map(str::to_string).collect(),
            model: crew.writer.name().to_string(),
            note: proposal.note.clone(),
        });

        let mut transaction = Transaction::prepare(root, &as_patch(&proposal))?;
        let gauntlet = Gauntlet::over(root);
        let outcome = weigh(root, &proposal, emit)?;
        let (applies, net) = (outcome.applies, outcome.net_lines);
        let mut refusal = first_stop(&outcome);
        emit(Step::Judged { outcome });

        if applies {
            halt.checkpoint()?;
            transaction.apply()?;

            let proof = gauntlet.prove(root);
            let unverified = proof.verdict == Verdict::Abstain;
            let broke = proof.verdict != Verdict::Pass;
            refusal = broke.then(|| refusal_of(&proof));
            emit(Step::Proven { ruling: proof });

            if halt.raised() {
                transaction.rollback()?;
                return Err(HALTED.into());
            }

            if !broke {
                kept = Some(Kept {
                    proposal,
                    net,
                    transaction,
                });
                break;
            }
            transaction.rollback()?;
            if unverified {
                let refusal = refusal.as_ref().unwrap();
                let reason = format!(
                    "Cambio no verificado: {} {}",
                    refusal.said, refusal.evidence
                );
                emit(Step::GaveUp {
                    reason: reason.clone(),
                });
                return Err(reason);
            }
        }

        let Some(refusal) = refusal else {
            return Err("el motor se detuvo sin decir por qué".into());
        };
        if attempt == MAX_REPAIRS {
            emit(Step::GaveUp {
                reason: refusal.said.clone(),
            });
            return Err(refusal.said);
        }

        emit(Step::Repairing {
            gate: refusal.gate.clone(),
            attempt: attempt + 1,
        });
        halt.checkpoint()?;
        proposal = crew
            .writer
            .propose(IDENTITY, &repair(task, &proposal, &refusal))?;
        halt.checkpoint()?;
    }

    let Some(mut kept) = kept else {
        return Err("ningún parche pasó los controles".into());
    };

    if halt.raised() {
        kept.transaction.rollback()?;
        return Err(HALTED.into());
    }
    let mut landed = slim(root, crew, kept, halt, emit)?;
    if halt.raised() {
        landed.transaction.rollback()?;
        return Err(HALTED.into());
    }
    let files = diffs_of(&landed);
    let net = total_net(&files);
    landed.transaction.commit()?;

    emit(Step::Applied {
        net,
        files: files.clone(),
    });
    let paths: Vec<String> = files.into_iter().map(|file| file.path).collect();
    emit(reindex(root, &paths));

    Ok(Landed { paths, net })
}

fn slim(
    root: &Path,
    crew: &Crew,
    mut kept: Kept,
    halt: &Halt,
    emit: &mut dyn FnMut(Step),
) -> Result<Kept, String> {
    let slimmer = match crew.dieter.propose(DIET, &diet(&kept.proposal)) {
        Ok(slimmer) => slimmer,
        Err(reason) => return declined(reason, kept, emit),
    };

    if halt.raised() {
        kept.transaction.rollback()?;
        return Err(HALTED.into());
    }
    kept.transaction.verify_applied()?;

    if slimmer.paths() != kept.proposal.paths() {
        return declined(
            "la segunda pasada cambió de ficheros: no me fío".into(),
            kept,
            emit,
        );
    }
    if slimmer.files == kept.proposal.files {
        return declined(
            "la segunda pasada no encontró nada que quitar".into(),
            kept,
            emit,
        );
    }

    let outcome = match weigh(root, &slimmer, emit) {
        Ok(outcome) => outcome,
        Err(reason) => return declined(reason, kept, emit),
    };

    let net = net_against(&kept.transaction.origins, &slimmer);
    if !outcome.applies || net >= kept.net {
        let reason = format!(
            "la versión corta no mejora: {net:+} líneas contra {:+}",
            kept.net
        );
        return declined(reason, kept, emit);
    }

    let mut transaction = Transaction::prepare(root, &as_patch(&slimmer))?;
    let gauntlet = Gauntlet::over(root);
    emit(Step::Judged { outcome });
    if halt.raised() {
        kept.transaction.rollback()?;
        return Err(HALTED.into());
    }
    transaction.apply()?;

    let proof = gauntlet.prove(root);
    let broke = proof.verdict != Verdict::Pass;
    emit(Step::Proven { ruling: proof });

    if broke || halt.raised() {
        transaction.rollback()?;
        if halt.raised() {
            kept.transaction.rollback()?;
            return Err(HALTED.into());
        }
        return declined("la versión corta no superó las pruebas".into(), kept, emit);
    }

    transaction.commit()?;
    kept.transaction.expect(&as_patch(&slimmer))?;

    emit(Step::Dieted {
        from: kept.net,
        to: net,
    });
    Ok(Kept {
        proposal: slimmer,
        net,
        transaction: kept.transaction,
    })
}

fn declined(reason: String, kept: Kept, emit: &mut dyn FnMut(Step)) -> Result<Kept, String> {
    emit(Step::DietRejected { reason });
    Ok(kept)
}

fn reindex(root: &Path, touched: &[String]) -> Step {
    match sens_hook::refresh::update(root, touched) {
        Ok(refreshed) => Step::Reindexed {
            millis: refreshed.millis() as u64,
            delegated: matches!(refreshed, sens_hook::refresh::Refreshed::Delegated { .. }),
        },
        Err(reason) => Step::ReindexFailed { reason },
    }
}

fn weigh(root: &Path, proposal: &Proposal, emit: &mut dyn FnMut(Step)) -> Result<Outcome, String> {
    if let Err(reason) = sens_hook::refresh::update(root, &proposal.paths()) {
        emit(Step::ReindexFailed { reason });
    }
    let mut patch = as_patch(proposal);
    gate::judge(root, &mut patch)
        .ok_or_else(|| "el índice está obsoleto: no juzgo con datos viejos".into())
}

fn diffs_of(kept: &Kept) -> Vec<FileDiff> {
    kept.transaction
        .origins
        .iter()
        .filter_map(|origin| {
            let edit = kept.proposal.touches(&origin.path)?;
            let (added, removed) =
                diff_lines(origin.text.as_deref().unwrap_or_default(), &edit.after);
            Some(FileDiff {
                path: origin.path.clone(),
                added,
                removed,
            })
        })
        .collect()
}

fn total_net(files: &[FileDiff]) -> i64 {
    files
        .iter()
        .map(|file| file.added.len() as i64 - file.removed.len() as i64)
        .sum()
}

fn net_against(origins: &[Origin], proposal: &Proposal) -> i64 {
    origins
        .iter()
        .filter_map(|origin| {
            let edit = proposal.touches(&origin.path)?;
            let (added, removed) =
                diff_lines(origin.text.as_deref().unwrap_or_default(), &edit.after);
            Some(added.len() as i64 - removed.len() as i64)
        })
        .sum()
}

fn as_patch(proposal: &Proposal) -> Patch {
    Patch {
        files: proposal
            .files
            .iter()
            .map(|edit| FilePatch {
                path: edit.path.clone(),
                before: String::new(),
                after: edit.after.clone(),
            })
            .collect(),
    }
}

fn refusal_of(ruling: &Ruling) -> Refusal {
    Refusal {
        gate: ruling.gate.clone(),
        said: ruling.said.clone(),
        evidence: ruling.evidence.join("\n"),
    }
}

fn first_stop(outcome: &Outcome) -> Option<Refusal> {
    outcome
        .rulings
        .iter()
        .find(|ruling| ruling.verdict == Verdict::Stop)
        .map(refusal_of)
}

fn opening(task: &str, briefing: &Briefing) -> String {
    format!(
        "TAREA\n{task}\n\n{}\n\nDevuelve el contenido completo de cada fichero que haga falta tocar.",
        briefing.render()
    )
}

fn repair(task: &str, proposal: &Proposal, refusal: &Refusal) -> String {
    format!(
        "TAREA\n{task}\n\nEl motor rechazó tu parche sobre {}.\n\n{} dijo: {}\n\n{}\n\nNo discutas con el motor: no escucha. Rehaz el parche para que no incurra en eso.",
        proposal.paths().join(", "),
        refusal.gate,
        refusal.said,
        refusal.evidence
    )
}

fn diet(proposal: &Proposal) -> String {
    let body: Vec<String> = proposal
        .files
        .iter()
        .map(|edit| format!("FICHERO {}\n\n{}", edit.path, edit.after))
        .collect();
    format!(
        "{}\n\nDéjalo más corto sin cambiar lo que hace.",
        body.join("\n\n---\n\n")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use model::{Edit, Scripted};

    fn proposal(path: &str, after: &str) -> Proposal {
        Proposal {
            files: vec![Edit {
                path: path.into(),
                after: after.into(),
            }],
            note: "listo".into(),
        }
    }

    fn names(steps: &[Step]) -> Vec<String> {
        steps
            .iter()
            .map(|step| {
                serde_json::to_value(step).unwrap()["step"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect()
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("sens-agent-{name}"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn a_project_without_an_index_is_refused_before_any_model_is_called() {
        let writer = Scripted::new(vec![proposal("a.rs", "fn a() {}\n")]);
        let dieter = Scripted::new(vec![]);
        let crew = Crew {
            writer: &writer,
            dieter: &dieter,
        };
        let mut steps = Vec::new();

        let outcome = run(
            &scratch("unindexed"),
            "haz algo",
            &crew,
            &Halt::default(),
            &mut |step| steps.push(step),
        );

        assert!(outcome.is_err());
        assert!(steps.is_empty());
        assert_eq!(writer.replies.borrow().len(), 1);
    }

    #[test]
    fn restoring_puts_every_file_back_as_it_was() {
        let root = scratch("restore-many");
        std::fs::write(root.join("a.rs"), "bueno\n").unwrap();
        let patch = Patch {
            files: vec![
                FilePatch {
                    path: "a.rs".into(),
                    before: String::new(),
                    after: "roto\n".into(),
                },
                FilePatch {
                    path: "b.rs".into(),
                    before: String::new(),
                    after: "nuevo\n".into(),
                },
            ],
        };
        let mut transaction = Transaction::prepare(&root, &patch).unwrap();
        transaction.apply().unwrap();
        transaction.rollback().unwrap();

        assert_eq!(
            std::fs::read_to_string(root.join("a.rs")).unwrap(),
            "bueno\n"
        );
        assert!(!root.join("b.rs").exists());
    }

    #[test]
    fn restoring_leaves_the_file_looking_untouched() {
        let root = scratch("restore-stamp");
        let target = root.join("a.rs");
        std::fs::write(&target, "bueno\n").unwrap();
        let stamp = std::fs::metadata(&target).unwrap().modified().unwrap();

        let mut transaction =
            Transaction::prepare(&root, &as_patch(&proposal("a.rs", "roto\n"))).unwrap();
        transaction.apply().unwrap();
        transaction.rollback().unwrap();

        assert_eq!(
            std::fs::metadata(&target).unwrap().modified().unwrap(),
            stamp
        );
    }

    #[test]
    fn the_net_of_a_patch_adds_up_across_its_files() {
        let root = scratch("net-many");
        std::fs::write(root.join("a.rs"), "uno\ndos\ntres\n").unwrap();
        let proposal = Proposal {
            files: vec![
                Edit {
                    path: "a.rs".into(),
                    after: "uno\n".into(),
                },
                Edit {
                    path: "b.rs".into(),
                    after: "nuevo\n".into(),
                },
            ],
            note: String::new(),
        };

        let transaction = Transaction::prepare(&root, &as_patch(&proposal)).unwrap();
        assert_eq!(net_against(&transaction.origins, &proposal), -1);
    }

    #[test]
    fn a_patch_of_two_files_becomes_a_patch_of_two_files() {
        let proposal = Proposal {
            files: vec![
                Edit {
                    path: "a.rs".into(),
                    after: "x".into(),
                },
                Edit {
                    path: "b.rs".into(),
                    after: "y".into(),
                },
            ],
            note: String::new(),
        };
        let patch = as_patch(&proposal);

        assert_eq!(patch.files.len(), 2);
        assert_eq!(patch.files[1].path, "b.rs");
    }

    #[test]
    fn the_opening_prompt_carries_the_map_instead_of_the_files() {
        let briefing = Briefing {
            map: "src/config.rs  parse_config".into(),
            candidates: "parse_config(raw: &str) -> Config".into(),
            outline: String::new(),
            symbols: 1177,
            files: 204,
        };
        let text = opening("añade validación", &briefing);

        assert!(text.contains("MAPA DEL PROYECTO"));
        assert!(text.contains("YA EXISTE EN EL PROYECTO"));
        assert!(text.contains("parse_config"));
    }

    #[test]
    fn a_repair_prompt_names_every_file_it_rejected() {
        let refusal = Refusal {
            gate: "G4".into(),
            said: "Un parche que rompe no es un parche.".into(),
            evidence: "test boot::arranca ... FAILED".into(),
        };
        let proposal = Proposal {
            files: vec![
                Edit {
                    path: "src/boot.rs".into(),
                    after: String::new(),
                },
                Edit {
                    path: "src/lib.rs".into(),
                    after: String::new(),
                },
            ],
            note: String::new(),
        };
        let text = repair("añade validación", &proposal, &refusal);

        assert!(text.contains("src/boot.rs, src/lib.rs"));
        assert!(text.contains("FAILED"));
        assert!(text.contains("no escucha"));
    }

    #[test]
    fn step_names_travel_as_plain_tags() {
        let steps = vec![
            Step::Oriented {
                symbols: 10,
                files: 2,
            },
            Step::Proven {
                ruling: Ruling::of("G4", "tests", Verdict::Pass, "en verde", Vec::new()),
            },
            Step::Repairing {
                gate: "G4".into(),
                attempt: 1,
            },
        ];
        assert_eq!(names(&steps), vec!["oriented", "proven", "repairing"]);
    }
}
