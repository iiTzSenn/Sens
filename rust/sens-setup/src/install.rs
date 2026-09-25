use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use serde::Serialize;

use crate::language::{self, Language, said};
use crate::layout::Layout;
use crate::look::{self, Look};
use crate::payload;
use crate::progress::{self, CANCELLED, Report, Step};
use crate::registry;
use crate::running::{self, Closing};
use crate::shortcut;
use crate::system;

pub struct Job<'a> {
    pub layout: &'a Layout,
    pub payload: &'a [u8],
    pub uninstaller: &'a Path,
    pub version: &'a str,
    pub start_menu: bool,
    pub desktop: bool,
    pub update: bool,
    pub placed: bool,
    pub closing: Closing<'a>,
    pub cancel: &'a AtomicBool,
    pub look: Option<&'a Look>,
    pub language: Option<Language>,
}

#[derive(PartialEq, Eq, Debug)]
pub struct Failure {
    pub reason: String,
    pub placed: bool,
}

#[derive(Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub free: Option<u64>,
    pub problem: String,
}

pub fn assess(dir: &Path, needed: u64, probe: bool) -> Place {
    let free = system::free_space(dir);
    Place {
        free,
        problem: fits(dir, needed, free, probe).err().unwrap_or_default(),
    }
}

fn fits(dir: &Path, needed: u64, free: Option<u64>, probe: bool) -> Result<(), String> {
    if !dir.is_absolute() {
        return Err(progress::not_absolute());
    }
    let shown = dir.display();
    if dir.is_file() {
        return Err(said!(
            en: "{shown} is a file, not a folder",
            es: "{shown} es un fichero, no una carpeta",
            fr: "{shown} est un fichier, pas un dossier",
            de: "{shown} ist eine Datei, kein Ordner",
            ja: "{shown} はフォルダーではなくファイルです",
            zh: "{shown} 是文件，不是文件夹",
        ));
    }
    let existing = system::nearest_existing(dir).ok_or_else(|| {
        said!(
            en: "{shown} isn’t on any drive of this computer",
            es: "{shown} no está en ninguna unidad de este equipo",
            fr: "{shown} ne se trouve sur aucun lecteur de cet ordinateur",
            de: "{shown} liegt auf keinem Laufwerk dieses Computers",
            ja: "{shown} はこのコンピューターのどのドライブにもありません",
            zh: "{shown} 不在这台电脑的任何驱动器上",
        )
    })?;
    if probe {
        system::writable(&existing)?;
    }
    match free {
        Some(free) if free < needed => Err(said!(
            en: "not enough room in {shown}: it needs {needed} and {free} is left",
            es: "no cabe en {shown}: hacen falta {needed} y quedan {free}",
            fr: "pas assez de place dans {shown} : il faut {needed} et il reste {free}",
            de: "in {shown} ist nicht genug Platz: {needed} werden gebraucht, {free} sind frei",
            ja: "{shown} の空き容量が足りません。{needed} 必要ですが、残りは {free} です",
            zh: "{shown} 空间不足：需要 {needed}，仅剩 {free}",
            needed = progress::amount(needed),
            free = progress::amount(free),
        )),
        _ => Ok(()),
    }
}

pub fn run(job: &Job, report: Report) -> Result<(), Failure> {
    let started = Instant::now();
    if !job.placed {
        place(job, report).map_err(|reason| Failure { reason, placed: false })?;
    }
    complete(job, report).map_err(|reason| Failure {
        reason: said!(
            en: "sens-app.exe is already in place, but {reason}",
            es: "sens-app.exe ya está en su sitio, pero {reason}",
            fr: "sens-app.exe est déjà en place, mais {reason}",
            de: "sens-app.exe ist schon an seinem Platz, aber {reason}",
            ja: "sens-app.exe は配置済みですが、{reason}",
            zh: "sens-app.exe 已就位，但{reason}",
        ),
        placed: true,
    })?;
    report(Step::Done, 1.0, &progress::finished(started.elapsed()));
    Ok(())
}

fn place(job: &Job, report: Report) -> Result<(), String> {
    let layout = job.layout;
    let created = !layout.dir.exists();
    let placed = check(job, report)
        .and_then(|()| running::settle(&layout.app(), &job.closing, job.cancel, report))
        .and_then(|()| extract(job, report))
        .and_then(|()| stop_if_cancelled(job.cancel))
        .and_then(|()| swap(layout, report));
    if placed.is_err() {
        let _ = fs::remove_file(layout.fresh_app());
        if created {
            let _ = fs::remove_dir(&layout.dir);
        }
    }
    placed
}

fn check(job: &Job, report: Report) -> Result<(), String> {
    let dir = &job.layout.dir;
    let needed = payload::size(job.payload)? + system::file_size(job.uninstaller);
    report(Step::Check, 0.02, &progress::space(system::free_space(dir)));
    stop_if_cancelled(job.cancel)?;
    fs::create_dir_all(dir).map_err(|error| progress::cannot_create(dir, &error))?;
    fits(dir, needed, system::free_space(dir), true)
}

fn extract(job: &Job, report: Report) -> Result<(), String> {
    report(Step::Extract, 0.1, &progress::extracting(payload::size(job.payload)?));
    let mut shown = 0.1;
    payload::extract(job.payload, &job.layout.fresh_app(), job.cancel, |done, total| {
        let share = 0.1 + 0.7 * done as f64 / total.max(1) as f64;
        if share - shown >= 0.01 {
            shown = share;
            report(Step::Extract, share, "");
        }
    })
}

fn swap(layout: &Layout, report: Report) -> Result<(), String> {
    report(Step::Swap, 0.82, &progress::placing(&layout.dir));
    let (app, fresh, old) = (layout.app(), layout.fresh_app(), layout.old_app());
    let _ = fs::remove_file(&old);
    let replacing = app.exists();
    if replacing {
        fs::rename(&app, &old).map_err(|error| {
            said!(
                en: "couldn’t move the previous sens-app.exe aside: {error}",
                es: "no pude apartar la sens-app.exe anterior: {error}",
                fr: "impossible de mettre de côté l’ancien sens-app.exe : {error}",
                de: "die bisherige sens-app.exe konnte nicht beiseitegelegt werden: {error}",
                ja: "以前の sens-app.exe を退避できませんでした: {error}",
                zh: "无法移开旧的 sens-app.exe：{error}",
            )
        })?;
    }
    if let Err(error) = fs::rename(&fresh, &app) {
        if replacing {
            let _ = fs::rename(&old, &app);
        }
        return Err(said!(
            en: "couldn’t put sens-app.exe in place: {error}",
            es: "no pude colocar sens-app.exe: {error}",
            fr: "impossible de mettre sens-app.exe en place : {error}",
            de: "sens-app.exe konnte nicht abgelegt werden: {error}",
            ja: "sens-app.exe を配置できませんでした: {error}",
            zh: "无法放置 sens-app.exe：{error}",
        ));
    }
    let _ = fs::remove_file(&old);
    Ok(())
}

fn complete(job: &Job, report: Report) -> Result<(), String> {
    let layout = job.layout;
    report(Step::Register, 0.86, &progress::uninstaller());
    if !system::same_path(job.uninstaller, &layout.uninstaller()) {
        fs::copy(job.uninstaller, layout.uninstaller()).map_err(|error| {
            said!(
                en: "couldn’t copy the uninstaller: {error}",
                es: "no pude copiar el desinstalador: {error}",
                fr: "impossible de copier le programme de désinstallation : {error}",
                de: "das Deinstallationsprogramm konnte nicht kopiert werden: {error}",
                ja: "アンインストーラーをコピーできませんでした: {error}",
                zh: "无法复制卸载程序：{error}",
            )
        })?;
    }
    report(Step::Register, 0.9, &progress::registering());
    registry::write(layout, job.version, footprint(layout))?;
    keep_look(job, report);
    keep_language(job, report);
    link(job, report)
}

fn keep_look(job: &Job, report: Report) {
    let Some(chosen) = job.look else {
        return;
    };
    report(Step::Register, 0.92, &progress::saving_look());
    if let Err(reason) = look::write(&job.layout.settings, chosen) {
        report(Step::Register, 0.92, &progress::unsaved_look(&reason));
    }
}

fn keep_language(job: &Job, report: Report) {
    let Some(chosen) = job.language else {
        return;
    };
    report(Step::Register, 0.93, &progress::saving_language());
    if let Err(reason) = language::write(&job.layout.settings, chosen) {
        report(Step::Register, 0.93, &progress::unsaved_language(&reason));
    }
}

fn footprint(layout: &Layout) -> u32 {
    let bytes = system::file_size(&layout.app()) + system::file_size(&layout.uninstaller());
    u32::try_from(bytes / 1024).unwrap_or(u32::MAX)
}

fn link(job: &Job, report: Report) -> Result<(), String> {
    let layout = job.layout;
    let wanted = [
        (job.start_menu, &layout.start_menu, progress::start_menu(), 0.94),
        (job.desktop, &layout.desktop, progress::desktop(), 0.97),
    ];
    for (asked, at, line, share) in wanted {
        if asked && (!job.update || at.exists()) {
            report(Step::Shortcuts, share, &line);
            shortcut::create(at, &layout.app(), &layout.dir)?;
        }
    }
    Ok(())
}

fn stop_if_cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) { Err(CANCELLED.into()) } else { Ok(()) }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use winreg::RegValue;
    use winreg::enums::REG_DWORD;

    use super::*;
    use crate::language::speaking;
    use crate::layout::sandbox::Sandbox;
    use crate::payload::{packed, sample_app};

    const VERSION: &str = "0.17.0";

    struct Lines(Mutex<Vec<(Step, String)>>);

    impl Lines {
        fn new() -> Lines {
            Lines(Mutex::new(Vec::new()))
        }

        fn report(&self) -> impl Fn(Step, f64, &str) + '_ {
            |step, _, line| self.0.lock().unwrap().push((step, line.to_string()))
        }

        fn said(&self, wanted: &str) -> bool {
            self.0.lock().unwrap().iter().any(|(_, line)| line == wanted)
        }

        fn steps(&self) -> Vec<Step> {
            let mut steps: Vec<Step> = self.0.lock().unwrap().iter().map(|(step, _)| *step).collect();
            steps.dedup();
            steps
        }
    }

    fn job<'a>(sandbox: &'a Sandbox, payload: &'a [u8], uninstaller: &'a Path, cancel: &'a AtomicBool) -> Job<'a> {
        Job {
            layout: &sandbox.layout,
            payload,
            uninstaller,
            version: VERSION,
            start_menu: true,
            desktop: true,
            update: false,
            placed: false,
            closing: Closing::Force,
            cancel,
            look: None,
            language: None,
        }
    }

    fn text(sandbox: &Sandbox, key: &str, name: &str) -> String {
        sandbox.key(key).unwrap().get_value(name).unwrap()
    }

    #[test]
    fn an_install_leaves_the_app_its_uninstaller_its_keys_and_its_shortcuts() {
        let sandbox = Sandbox::new("install");
        let app = sample_app(400_000);
        let payload = packed(&app);
        let setup = sandbox.file("Sens_0.17.0_x64-setup.exe", b"the installer itself");
        let cancel = AtomicBool::new(false);
        let lines = Lines::new();
        let layout = &sandbox.layout;
        let dir = layout.dir.display().to_string();

        run(&job(&sandbox, &payload, &setup, &cancel), &lines.report()).unwrap();

        assert_eq!(fs::read(layout.app()).unwrap(), app);
        assert_eq!(fs::read(layout.uninstaller()).unwrap(), b"the installer itself");
        assert!(!layout.fresh_app().exists() && !layout.old_app().exists());
        let uninstall = &layout.uninstall_key;
        assert_eq!(text(&sandbox, uninstall, "DisplayName"), "Sens");
        assert_eq!(text(&sandbox, uninstall, "DisplayIcon"), format!("\"{dir}\\sens-app.exe\""));
        assert_eq!(text(&sandbox, uninstall, "DisplayVersion"), VERSION);
        assert_eq!(text(&sandbox, uninstall, "Publisher"), "sens");
        assert_eq!(text(&sandbox, uninstall, "InstallLocation"), format!("\"{dir}\""));
        assert_eq!(text(&sandbox, uninstall, "UninstallString"), format!("\"{dir}\\uninstall.exe\""));
        assert_eq!(text(&sandbox, uninstall, "QuietUninstallString"), format!("\"{dir}\\uninstall.exe\" /S"));
        assert_eq!(text(&sandbox, uninstall, "MainBinaryName"), "sens-app.exe");
        let flags = sandbox.key(uninstall).unwrap();
        assert_eq!(flags.get_value::<u32, _>("NoModify").unwrap(), 1);
        assert_eq!(flags.get_value::<u32, _>("NoRepair").unwrap(), 1);
        assert_eq!(text(&sandbox, &layout.remembered_key, ""), dir);
        let resolved = |path: &Path| fs::canonicalize(path).unwrap();
        for link in [&layout.start_menu, &layout.desktop] {
            let (target, working, app_id) = shortcut::read(link);
            assert_eq!(resolved(&target), resolved(&layout.app()));
            assert_eq!(resolved(&working), resolved(&layout.dir));
            assert_eq!(app_id, "dev.sens.desktop");
        }
        assert_eq!(
            lines.steps(),
            [Step::Check, Step::Extract, Step::Swap, Step::Register, Step::Shortcuts, Step::Done]
        );
        assert!(lines.said(&progress::extracting(400_000)));
        assert!(lines.said(&progress::start_menu()) && lines.said(&progress::desktop()));
    }

    #[test]
    fn the_estimated_size_is_a_dword_of_kilobytes_for_the_app_and_its_uninstaller() {
        let sandbox = Sandbox::new("estimated-size");
        let payload = packed(&sample_app(300_000));
        let setup = sandbox.file("setup.exe", &vec![7; 120_000]);
        let cancel = AtomicBool::new(false);

        run(&job(&sandbox, &payload, &setup, &cancel), &|_, _, _| {}).unwrap();

        let raw: RegValue = sandbox.key(&sandbox.layout.uninstall_key).unwrap().get_raw_value("EstimatedSize").unwrap();
        assert_eq!(raw.vtype, REG_DWORD);
        assert_eq!(u32::from_le_bytes(raw.bytes[..4].try_into().unwrap()), (300_000 + 120_000) / 1024);
    }

    #[test]
    fn a_failed_extraction_leaves_the_old_app_in_place() {
        let sandbox = Sandbox::new("failed-extraction");
        let layout = &sandbox.layout;
        fs::create_dir_all(&layout.dir).unwrap();
        fs::write(layout.app(), b"sens 0.16.0").unwrap();
        let mut payload = packed(&sample_app(50_000));
        payload[..8].copy_from_slice(&90_000u64.to_le_bytes());
        let setup = sandbox.file("setup.exe", b"setup");
        let cancel = AtomicBool::new(false);

        let failure = run(&job(&sandbox, &payload, &setup, &cancel), &|_, _, _| {}).unwrap_err();

        assert!(!failure.placed);
        assert!(failure.reason.contains("damaged"), "{}", failure.reason);
        assert_eq!(fs::read(layout.app()).unwrap(), b"sens 0.16.0");
        assert!(!layout.fresh_app().exists());
        assert!(!layout.uninstaller().exists());
        assert!(sandbox.key(&layout.uninstall_key).is_none());
        assert!(!layout.start_menu.exists());
    }

    #[test]
    fn a_cancelled_install_rejects_as_cancelled_and_touches_nothing() {
        let sandbox = Sandbox::new("cancelled");
        let layout = &sandbox.layout;
        fs::create_dir_all(&layout.dir).unwrap();
        fs::write(layout.app(), b"sens 0.16.0").unwrap();
        let payload = packed(&sample_app(50_000));
        let setup = sandbox.file("setup.exe", b"setup");
        let cancel = AtomicBool::new(true);

        let failure = run(&job(&sandbox, &payload, &setup, &cancel), &|_, _, _| {}).unwrap_err();

        assert_eq!(failure, Failure { reason: CANCELLED.into(), placed: false });
        assert_eq!(fs::read(layout.app()).unwrap(), b"sens 0.16.0");
        assert!(!layout.fresh_app().exists());
        assert!(sandbox.key(&layout.uninstall_key).is_none());
    }

    #[test]
    fn a_folder_the_install_created_goes_away_when_it_fails_before_the_swap() {
        let sandbox = Sandbox::new("fresh-folder");
        let payload = 1_000u64.to_le_bytes().to_vec();
        let setup = sandbox.file("setup.exe", b"setup");
        let cancel = AtomicBool::new(false);

        run(&job(&sandbox, &payload, &setup, &cancel), &|_, _, _| {}).unwrap_err();

        assert!(!sandbox.layout.dir.exists());
    }

    #[test]
    fn a_failed_install_keeps_a_folder_that_was_already_there_with_its_files() {
        let sandbox = Sandbox::new("kept-folder");
        let layout = &sandbox.layout;
        fs::create_dir_all(&layout.dir).unwrap();
        fs::write(layout.dir.join("notas.txt"), b"mis notas").unwrap();
        let payload = 1_000u64.to_le_bytes().to_vec();
        let setup = sandbox.file("setup.exe", b"setup");
        let cancel = AtomicBool::new(false);

        run(&job(&sandbox, &payload, &setup, &cancel), &|_, _, _| {}).unwrap_err();

        assert_eq!(fs::read(layout.dir.join("notas.txt")).unwrap(), b"mis notas");
    }

    #[test]
    fn an_update_only_remakes_the_shortcuts_that_were_still_there() {
        let sandbox = Sandbox::new("update-shortcuts");
        let layout = &sandbox.layout;
        let payload = packed(&sample_app(10_000));
        let setup = sandbox.file("setup.exe", b"setup");
        let cancel = AtomicBool::new(false);
        let first = Job {
            desktop: false,
            ..job(&sandbox, &payload, &setup, &cancel)
        };
        run(&first, &|_, _, _| {}).unwrap();
        assert!(layout.start_menu.exists() && !layout.desktop.exists());

        let update = Job {
            update: true,
            ..job(&sandbox, &payload, &setup, &cancel)
        };
        run(&update, &|_, _, _| {}).unwrap();

        assert!(layout.start_menu.exists());
        assert!(!layout.desktop.exists());
    }

    #[test]
    fn an_update_leaves_a_removed_start_menu_shortcut_removed() {
        let sandbox = Sandbox::new("update-removed");
        let layout = &sandbox.layout;
        let payload = packed(&sample_app(10_000));
        let setup = sandbox.file("setup.exe", b"setup");
        let cancel = AtomicBool::new(false);
        run(&job(&sandbox, &payload, &setup, &cancel), &|_, _, _| {}).unwrap();
        fs::remove_file(&layout.start_menu).unwrap();

        let update = Job {
            update: true,
            ..job(&sandbox, &payload, &setup, &cancel)
        };
        run(&update, &|_, _, _| {}).unwrap();

        assert!(!layout.start_menu.exists());
        assert!(layout.desktop.exists());
    }

    #[test]
    fn an_install_over_an_older_one_replaces_the_app_and_its_version() {
        let sandbox = Sandbox::new("over-older");
        let layout = &sandbox.layout;
        fs::create_dir_all(&layout.dir).unwrap();
        fs::write(layout.app(), b"sens 0.16.0").unwrap();
        fs::write(layout.uninstaller(), b"nsis uninstaller").unwrap();
        let app = sample_app(20_000);
        let payload = packed(&app);
        let setup = sandbox.file("setup.exe", b"new setup");
        let cancel = AtomicBool::new(false);

        run(&job(&sandbox, &payload, &setup, &cancel), &|_, _, _| {}).unwrap();

        assert_eq!(fs::read(layout.app()).unwrap(), app);
        assert_eq!(fs::read(layout.uninstaller()).unwrap(), b"new setup");
        assert!(!layout.old_app().exists());
        assert_eq!(registry::installed(layout).unwrap().version, VERSION);
    }

    #[test]
    fn a_retry_after_the_swap_repeats_only_what_was_missing() {
        let sandbox = Sandbox::new("retry");
        let layout = &sandbox.layout;
        fs::create_dir_all(&layout.dir).unwrap();
        fs::write(layout.app(), b"already swapped").unwrap();
        let setup = sandbox.file("setup.exe", b"setup");
        let cancel = AtomicBool::new(false);
        let lines = Lines::new();
        let retry = Job {
            placed: true,
            ..job(&sandbox, &[], &setup, &cancel)
        };

        run(&retry, &lines.report()).unwrap();

        assert_eq!(fs::read(layout.app()).unwrap(), b"already swapped");
        assert_eq!(lines.steps(), [Step::Register, Step::Shortcuts, Step::Done]);
        assert!(registry::installed(layout).is_some());
    }

    #[test]
    fn an_installer_run_from_the_folder_keeps_its_own_file_as_the_uninstaller() {
        let sandbox = Sandbox::new("from-folder");
        let layout = &sandbox.layout;
        fs::create_dir_all(&layout.dir).unwrap();
        fs::write(layout.uninstaller(), b"me").unwrap();
        let payload = packed(&sample_app(5_000));
        let own = layout.uninstaller();
        let cancel = AtomicBool::new(false);

        run(&job(&sandbox, &payload, &own, &cancel), &|_, _, _| {}).unwrap();

        assert_eq!(fs::read(layout.uninstaller()).unwrap(), b"me");
    }

    #[test]
    fn a_folder_is_judged_by_its_path_its_space_and_whether_it_takes_files() {
        let sandbox = Sandbox::new("assess");

        assert_eq!(assess(Path::new(r"Sens"), 1, true).problem, "choose a folder with its full path");
        let fine = assess(&sandbox.root.join("Nueva").join("Sens"), 1, true);
        assert_eq!(fine.problem, "");
        assert!(fine.free.is_some_and(|free| free > 0));
        assert!(!sandbox.root.join("Nueva").exists());
        let file = sandbox.file("fichero", b"x");
        assert!(assess(&file, 1, true).problem.ends_with("is a file, not a folder"));
        assert!(assess(&sandbox.root, u64::MAX, true).problem.starts_with("not enough room in"));
        let spanish = speaking(Language::Es, || assess(&sandbox.root, u64::MAX, true).problem);
        assert!(spanish.starts_with("no cabe en") && spanish.contains(" y quedan "), "{spanish}");
    }

    #[test]
    fn an_install_keeps_the_chosen_look_where_the_app_reads_it() {
        let sandbox = Sandbox::new("look");
        let payload = packed(&sample_app(10_000));
        let setup = sandbox.file("setup.exe", b"setup");
        let cancel = AtomicBool::new(false);
        let lines = Lines::new();
        let chosen = Look {
            mode: look::Mode::Light,
            accent: "iris".into(),
        };
        let choosing = Job {
            look: Some(&chosen),
            ..job(&sandbox, &payload, &setup, &cancel)
        };

        run(&choosing, &lines.report()).unwrap();

        assert_eq!(look::read(&sandbox.layout.settings), Some(chosen));
        assert!(lines.said(&progress::saving_look()));
    }

    #[test]
    fn an_install_that_asked_nothing_leaves_the_saved_look_alone() {
        let sandbox = Sandbox::new("kept-look");
        let saved = Look {
            mode: look::Mode::System,
            accent: "rose".into(),
        };
        look::write(&sandbox.layout.settings, &saved).unwrap();
        let payload = packed(&sample_app(10_000));
        let setup = sandbox.file("setup.exe", b"setup");
        let cancel = AtomicBool::new(false);
        let lines = Lines::new();

        run(&job(&sandbox, &payload, &setup, &cancel), &lines.report()).unwrap();

        assert_eq!(look::read(&sandbox.layout.settings), Some(saved));
        assert!(!lines.said(&progress::saving_look()));
    }

    #[test]
    fn a_fresh_install_keeps_the_chosen_language_where_the_app_reads_it() {
        let sandbox = Sandbox::new("language");
        let payload = packed(&sample_app(10_000));
        let setup = sandbox.file("setup.exe", b"setup");
        let cancel = AtomicBool::new(false);
        let lines = Lines::new();
        let choosing = Job {
            language: Some(Language::Fr),
            ..job(&sandbox, &payload, &setup, &cancel)
        };

        run(&choosing, &lines.report()).unwrap();

        assert_eq!(language::read(&sandbox.layout.settings), Some(Language::Fr));
        assert!(lines.said(&progress::saving_language()));
    }

    #[test]
    fn an_update_that_asked_nothing_leaves_the_saved_language_alone() {
        let sandbox = Sandbox::new("kept-language");
        language::write(&sandbox.layout.settings, Language::Ja).unwrap();
        let payload = packed(&sample_app(10_000));
        let setup = sandbox.file("setup.exe", b"setup");
        let cancel = AtomicBool::new(false);
        let lines = Lines::new();
        let update = Job {
            update: true,
            ..job(&sandbox, &payload, &setup, &cancel)
        };

        run(&update, &lines.report()).unwrap();

        assert_eq!(language::read(&sandbox.layout.settings), Some(Language::Ja));
        assert!(!lines.said(&progress::saving_language()));
    }

    #[test]
    fn the_install_reports_its_steps_in_the_language_spoken() {
        let sandbox = Sandbox::new("spoken");
        let payload = packed(&sample_app(10_000));
        let setup = sandbox.file("setup.exe", b"setup");
        let cancel = AtomicBool::new(false);
        let lines = Lines::new();

        speaking(Language::De, || run(&job(&sandbox, &payload, &setup, &cancel), &lines.report())).unwrap();

        assert!(lines.said("Sens wird in Windows registriert"));
        assert!(lines.said("Verknüpfung im Startmenü"));
        assert!(!lines.said(&progress::registering()));
    }
}
