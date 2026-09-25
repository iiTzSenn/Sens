use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use serde::de::DeserializeOwned;

pub fn stored<T: DeserializeOwned + Default>(path: &Path) -> T {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn editable<T: DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Ok(T::default());
    };
    serde_json::from_str(&text).map_err(|error| {
        format!("{} está dañado ({error}); arréglalo o bórralo antes de guardar", path.display())
    })
}

pub fn store<T: Serialize>(base: &Path, name: &str, value: &T) -> Result<(), String> {
    std::fs::create_dir_all(base)
        .map_err(|error| format!("no pude crear {}: {error}", base.display()))?;
    let text = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    let path = base.join(name);
    let staged = base.join(format!(".{name}.{}.tmp", STAGED.fetch_add(1, Ordering::Relaxed)));
    let written = write_through(&staged, text.as_bytes()).and_then(|()| std::fs::rename(&staged, &path));
    if written.is_err() {
        let _ = std::fs::remove_file(&staged);
    }
    written.map_err(|error| format!("no pude escribir {}: {error}", path.display()))
}

pub fn update<T: Serialize + DeserializeOwned + Default>(base: &Path, name: &str, change: impl FnOnce(&mut T) -> Result<(), String>) -> Result<(), String> {
    let _held = HELD.lock().unwrap_or_else(PoisonError::into_inner);
    let mut kept = editable(&base.join(name))?;
    change(&mut kept)?;
    store(base, name, &kept)
}

static STAGED: AtomicU64 = AtomicU64::new(0);
static HELD: Mutex<()> = Mutex::new(());

fn write_through(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = std::fs::File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let here = std::env::temp_dir().join(format!("sens-store-{name}"));
        let _ = std::fs::remove_dir_all(&here);
        std::fs::create_dir_all(&here).expect("scratch");
        here
    }

    fn names(folder: &Path) -> Vec<String> {
        let mut found: Vec<String> = std::fs::read_dir(folder)
            .expect("listing")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        found.sort();
        found
    }

    #[test]
    fn a_value_is_written_whole_and_leaves_nothing_behind() {
        let here = scratch("whole");
        store(&here, "a.json", &BTreeMap::from([("uno", 1)])).expect("first");
        store(&here, "a.json", &BTreeMap::from([("dos", 2)])).expect("second");

        assert_eq!(stored::<BTreeMap<String, u32>>(&here.join("a.json")), BTreeMap::from([("dos".to_string(), 2)]));
        assert_eq!(names(&here), ["a.json"]);
    }

    #[test]
    fn changes_made_at_once_are_all_kept() {
        let here = scratch("together");
        let workers: Vec<_> = (0..8)
            .map(|worker| {
                let here = here.clone();
                std::thread::spawn(move || {
                    for turn in 0..25 {
                        update(&here, "c.json", |kept: &mut BTreeMap<String, u32>| {
                            kept.insert(format!("{worker}-{turn}"), turn);
                            Ok(())
                        })
                        .expect("update");
                    }
                })
            })
            .collect();
        for worker in workers {
            worker.join().expect("worker");
        }

        assert_eq!(stored::<BTreeMap<String, u32>>(&here.join("c.json")).len(), 200);
        assert_eq!(names(&here), ["c.json"]);
    }

    #[test]
    fn a_change_to_a_damaged_file_is_refused_and_leaves_it_as_it_was() {
        let here = scratch("damaged");
        std::fs::write(here.join("d.json"), "{ a medias").expect("damaged");

        let refused = update(&here, "d.json", |kept: &mut BTreeMap<String, u32>| {
            kept.insert("x".into(), 1);
            Ok(())
        });

        assert!(refused.unwrap_err().contains("dañado"));
        assert_eq!(std::fs::read_to_string(here.join("d.json")).expect("read"), "{ a medias");
    }

    #[test]
    fn a_change_that_fails_writes_nothing() {
        let here = scratch("refused");
        store(&here, "e.json", &BTreeMap::from([("uno", 1)])).expect("first");

        let refused = update(&here, "e.json", |kept: &mut BTreeMap<String, u32>| {
            kept.insert("dos".into(), 2);
            Err("no".to_string())
        });

        assert_eq!(refused.unwrap_err(), "no");
        assert_eq!(stored::<BTreeMap<String, u32>>(&here.join("e.json")).len(), 1);
    }
}
