use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use crate::layout::Layout;
use crate::progress::{self, Report, Step};
use crate::registry;
use crate::running::{self, Closing};
use crate::system;

const RELOCATED: &str = "sens-uninstall-";

pub struct Removal<'a> {
    pub layout: &'a Layout,
    pub remove_data: bool,
    pub closing: Closing<'a>,
    pub cancel: &'a AtomicBool,
}

pub fn runs_inside(exe: &Path, dir: &Path) -> bool {
    exe.parent().is_some_and(|parent| system::same_path(parent, dir))
}

pub fn is_relocated(exe: &Path) -> bool {
    exe.file_name().is_some_and(|name| name.to_string_lossy().starts_with(RELOCATED))
}

pub fn relocate(exe: &Path, dir: &Path, silent: bool) -> Result<(), String> {
    let temp = std::env::temp_dir();
    let copy = temp.join(format!("{RELOCATED}{}.exe", std::process::id()));
    fs::copy(exe, &copy).map_err(|error| format!("no pude preparar el desinstalador: {error}"))?;
    let mut command = Command::new(&copy);
    command.arg("--uninstall").arg("--dir").arg(dir).current_dir(&temp);
    if silent {
        command.arg("/S");
    }
    command.spawn().map(drop).map_err(|error| format!("no pude abrir el desinstalador: {error}"))
}

pub fn run(removal: &Removal, report: Report) -> Result<(), String> {
    let started = Instant::now();
    let layout = removal.layout;
    running::settle(&layout.app(), &removal.closing, removal.cancel, report)?;
    report(Step::Remove, 0.2, &progress::deleting(&layout.dir));
    clear(layout)?;
    report(Step::Remove, 0.45, progress::UNLINKING);
    for link in [&layout.start_menu, &layout.desktop] {
        forget(link, fs::remove_file(link))?;
    }
    report(Step::Remove, 0.65, progress::UNREGISTERING);
    registry::erase(layout)?;
    if removal.remove_data {
        report(Step::Remove, 0.8, progress::FORGETTING);
        for folder in &layout.data {
            forget(folder, fs::remove_dir_all(folder))?;
        }
    }
    report(Step::Done, 1.0, &progress::finished(started.elapsed()));
    Ok(())
}

pub fn clear(layout: &Layout) -> Result<(), String> {
    for file in layout.placed_files() {
        system::remove_patiently(&file)?;
    }
    let _ = fs::remove_dir(&layout.dir);
    Ok(())
}

fn forget(path: &Path, removed: std::io::Result<()>) -> Result<(), String> {
    match removed {
        Err(error) if error.kind() != ErrorKind::NotFound => Err(format!("no pude borrar {}: {error}", path.display())),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install::{self, Job};
    use crate::layout::sandbox::Sandbox;
    use crate::payload::{packed, sample_app};

    fn installed(sandbox: &Sandbox) {
        let payload = packed(&sample_app(20_000));
        let setup = sandbox.file("setup.exe", b"setup");
        let cancel = AtomicBool::new(false);
        let job = Job {
            layout: &sandbox.layout,
            payload: &payload,
            uninstaller: &setup,
            version: "0.17.0",
            start_menu: true,
            desktop: true,
            update: false,
            placed: false,
            closing: Closing::Force,
            cancel: &cancel,
        };
        install::run(&job, &|_, _, _| {}).unwrap();
    }

    fn removal(sandbox: &Sandbox, remove_data: bool, cancel: &AtomicBool) -> Result<(), String> {
        let removal = Removal {
            layout: &sandbox.layout,
            remove_data,
            closing: Closing::Force,
            cancel,
        };
        run(&removal, &|_, _, _| {})
    }

    fn data_folders(sandbox: &Sandbox) {
        for folder in &sandbox.layout.data {
            fs::create_dir_all(folder.join("skills")).unwrap();
            fs::write(folder.join("profile.json"), b"{}").unwrap();
        }
    }

    #[test]
    fn an_uninstall_removes_everything_the_install_left() {
        let sandbox = Sandbox::new("uninstall");
        installed(&sandbox);
        let layout = &sandbox.layout;
        let parent = layout.remembered_key.rsplit_once('\\').unwrap().0.to_string();

        removal(&sandbox, false, &AtomicBool::new(false)).unwrap();

        assert!(!layout.dir.exists());
        assert!(!layout.start_menu.exists() && !layout.desktop.exists());
        assert!(sandbox.key(&layout.uninstall_key).is_none());
        assert!(sandbox.key(&layout.remembered_key).is_none());
        assert!(sandbox.key(&parent).is_none());
        assert!(registry::installed(layout).is_none());
    }

    #[test]
    fn an_uninstall_leaves_unrelated_files_and_their_folder_in_place() {
        let sandbox = Sandbox::new("unrelated");
        installed(&sandbox);
        let layout = &sandbox.layout;
        fs::write(layout.dir.join("notas.txt"), b"mis notas").unwrap();
        fs::create_dir_all(layout.dir.join("proyecto")).unwrap();

        removal(&sandbox, false, &AtomicBool::new(false)).unwrap();

        assert_eq!(fs::read(layout.dir.join("notas.txt")).unwrap(), b"mis notas");
        assert!(layout.dir.join("proyecto").is_dir());
        assert!(!layout.app().exists() && !layout.uninstaller().exists());
    }

    #[test]
    fn an_uninstall_keeps_the_settings_unless_asked_to_remove_them() {
        let sandbox = Sandbox::new("keeps-data");
        installed(&sandbox);
        data_folders(&sandbox);

        removal(&sandbox, false, &AtomicBool::new(false)).unwrap();

        assert!(sandbox.layout.data.iter().all(|folder| folder.join("profile.json").exists()));
    }

    #[test]
    fn removing_data_takes_both_settings_folders_too() {
        let sandbox = Sandbox::new("removes-data");
        installed(&sandbox);
        data_folders(&sandbox);

        removal(&sandbox, true, &AtomicBool::new(false)).unwrap();

        assert!(sandbox.layout.data.iter().all(|folder| !folder.exists()));
    }

    #[test]
    fn an_uninstall_of_leftovers_from_a_half_install_still_finishes() {
        let sandbox = Sandbox::new("leftovers");
        let layout = &sandbox.layout;
        fs::create_dir_all(&layout.dir).unwrap();
        fs::write(layout.fresh_app(), b"half").unwrap();
        fs::write(layout.old_app(), b"old").unwrap();

        removal(&sandbox, false, &AtomicBool::new(false)).unwrap();

        assert!(!layout.dir.exists());
    }

    #[test]
    fn an_uninstaller_knows_when_it_runs_from_the_folder_it_removes() {
        let sandbox = Sandbox::new("inside");
        let layout = &sandbox.layout;
        fs::create_dir_all(&layout.dir).unwrap();
        fs::write(layout.uninstaller(), b"me").unwrap();

        assert!(runs_inside(&layout.uninstaller(), &layout.dir));
        assert!(!runs_inside(&sandbox.root.join("setup.exe"), &layout.dir));
        assert!(is_relocated(Path::new(r"C:\Temp\sens-uninstall-4120.exe")));
        assert!(!is_relocated(&layout.uninstaller()));
    }
}
