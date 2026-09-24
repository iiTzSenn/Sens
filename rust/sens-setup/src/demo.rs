use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use crate::progress::{self, CANCELLED, Report, Step};
use crate::system;

pub const SIZE: u64 = 7_329_792;
const TICKS: u32 = 24;

pub fn install(dir: &Path, start_menu: bool, desktop: bool, cancel: &AtomicBool, report: Report) -> Result<(), String> {
    let started = Instant::now();
    report(Step::Check, 0.02, &progress::space(system::free_space(dir)));
    pause(cancel, 300)?;
    report(Step::Extract, 0.1, &progress::extracting(SIZE));
    for tick in 1..=TICKS {
        pause(cancel, 45)?;
        report(Step::Extract, 0.1 + 0.7 * f64::from(tick) / f64::from(TICKS), "");
    }
    report(Step::Swap, 0.82, &progress::placing(dir));
    rest(250);
    report(Step::Register, 0.86, progress::UNINSTALLER);
    rest(200);
    report(Step::Register, 0.9, progress::REGISTERING);
    rest(250);
    for (asked, line, share) in [(start_menu, progress::START_MENU, 0.94), (desktop, progress::DESKTOP, 0.97)] {
        if asked {
            report(Step::Shortcuts, share, line);
            rest(150);
        }
    }
    report(Step::Done, 1.0, &progress::finished(started.elapsed()));
    Ok(())
}

pub fn uninstall(dir: &Path, remove_data: bool, report: Report) -> Result<(), String> {
    let started = Instant::now();
    report(Step::Remove, 0.2, &progress::deleting(dir));
    rest(300);
    report(Step::Remove, 0.45, progress::UNLINKING);
    rest(200);
    report(Step::Remove, 0.65, progress::UNREGISTERING);
    rest(250);
    if remove_data {
        report(Step::Remove, 0.8, progress::FORGETTING);
        rest(300);
    }
    report(Step::Done, 1.0, &progress::finished(started.elapsed()));
    Ok(())
}

fn pause(cancel: &AtomicBool, millis: u64) -> Result<(), String> {
    rest(millis);
    if cancel.load(Ordering::SeqCst) { Err(CANCELLED.into()) } else { Ok(()) }
}

fn rest(millis: u64) {
    thread::sleep(Duration::from_millis(millis));
}
