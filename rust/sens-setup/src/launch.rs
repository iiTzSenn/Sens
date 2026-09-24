use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::layout::UNINSTALLER;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Install,
    Update,
    Uninstall,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Launch {
    pub mode: Mode,
    pub silent: bool,
    pub passive: bool,
    pub relaunch: bool,
    pub dir: Option<PathBuf>,
}

pub fn read(exe: &Path, args: impl IntoIterator<Item = OsString>) -> Launch {
    let as_uninstaller = exe
        .file_name()
        .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(UNINSTALLER));
    let mut flags = Vec::new();
    let mut dir = None;
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == "--dir" {
            dir = args.next().map(PathBuf::from);
        } else {
            flags.push(arg.to_string_lossy().to_ascii_uppercase());
        }
    }
    let has = |flag: &str| flags.iter().any(|given| given == flag);
    let mode = if as_uninstaller || has("--UNINSTALL") {
        Mode::Uninstall
    } else if has("/UPDATE") {
        Mode::Update
    } else {
        Mode::Install
    };
    let dir = dir.or_else(|| as_uninstaller.then(|| exe.parent().map(Path::to_path_buf)).flatten());
    Launch {
        mode,
        silent: has("/S"),
        passive: has("/S") || has("/P"),
        relaunch: has("/R"),
        dir,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SETUP: &str = r"C:\Users\Ana\Downloads\Sens_0.17.0_x64-setup.exe";
    const UNINSTALL: &str = r"C:\Users\Ana\AppData\Local\Sens\uninstall.exe";

    fn launched(exe: &str, args: &[&str]) -> Launch {
        read(Path::new(exe), args.iter().map(OsString::from))
    }

    #[test]
    fn a_double_click_installs_and_waits_for_the_person() {
        let launch = launched(SETUP, &[]);

        assert_eq!(
            launch,
            Launch {
                mode: Mode::Install,
                silent: false,
                passive: false,
                relaunch: false,
                dir: None
            }
        );
    }

    #[test]
    fn the_updater_arguments_mean_a_passive_update_that_reopens_sens() {
        let launch = launched(SETUP, &["/P", "/UPDATE", "/R"]);

        assert_eq!(launch.mode, Mode::Update);
        assert!(launch.passive && launch.relaunch && !launch.silent);
    }

    #[test]
    fn slash_s_installs_without_a_window_or_questions() {
        let launch = launched(SETUP, &["/S"]);

        assert_eq!(launch.mode, Mode::Install);
        assert!(launch.silent && launch.passive && !launch.relaunch);
    }

    #[test]
    fn a_copy_named_uninstall_exe_uninstalls_the_folder_it_lives_in() {
        let launch = launched(UNINSTALL, &[]);

        assert_eq!(launch.mode, Mode::Uninstall);
        assert_eq!(launch.dir, Some(PathBuf::from(r"C:\Users\Ana\AppData\Local\Sens")));
        assert!(!launch.silent);
    }

    #[test]
    fn the_file_name_counts_whatever_its_case() {
        assert_eq!(launched(r"C:\Sens\Uninstall.EXE", &[]).mode, Mode::Uninstall);
    }

    #[test]
    fn uninstall_exe_slash_s_uninstalls_silently() {
        let launch = launched(UNINSTALL, &["/S"]);

        assert_eq!(launch.mode, Mode::Uninstall);
        assert!(launch.silent);
    }

    #[test]
    fn the_relocated_uninstaller_is_told_its_mode_and_folder() {
        let launch = launched(r"C:\Users\Ana\AppData\Local\Temp\sens-uninstall-4120.exe", &["--uninstall", "--dir", r"D:\Apps\Sens"]);

        assert_eq!(launch.mode, Mode::Uninstall);
        assert_eq!(launch.dir, Some(PathBuf::from(r"D:\Apps\Sens")));
    }

    #[test]
    fn dir_picks_the_install_folder_even_with_spaces() {
        let launch = launched(SETUP, &["--dir", r"C:\Program Files\Mis apps\Sens", "/S"]);

        assert_eq!(launch.mode, Mode::Install);
        assert_eq!(launch.dir, Some(PathBuf::from(r"C:\Program Files\Mis apps\Sens")));
        assert!(launch.silent);
    }

    #[test]
    fn flags_are_read_whatever_their_case() {
        let launch = launched(SETUP, &["/p", "/update", "/r"]);

        assert_eq!(launch.mode, Mode::Update);
        assert!(launch.passive && launch.relaunch);
    }
}
