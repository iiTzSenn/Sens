use regex::Regex;
use std::sync::OnceLock;

fn dir_pattern() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(^|/)(__tests__|__mocks__|__fixtures__|__snapshots__|tests?|specs?|fixtures|mocks|e2e|testdata)/",
        )
        .unwrap()
    })
}

fn file_pattern() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(concat!(
            r"(\.(test|spec)\.[cm]?[jt]sx?",
            r"|_test\.(go|py|rb|exs?)",
            r"|_spec\.rb",
            r"|(^|/)test_[^/]*\.py",
            r"|(^|/)conftest\.py",
            r"|(Test|Tests|Spec)\.(java|kt|kts|cs|scala))$",
        ))
        .unwrap()
    })
}

pub fn is_test_file(file: &str) -> bool {
    let f = file.replace(std::path::MAIN_SEPARATOR, "/");
    file_pattern().is_match(&f) || dir_pattern().is_match(&f)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_same_files_as_the_typescript_rule() {
        for yes in [
            "a.test.ts",
            "src/b.spec.tsx",
            "pkg/thing_test.go",
            "app/test_models.py",
            "conftest.py",
            "com/app/WidgetTest.java",
            "com/app/UserSpec.kt",
            "src/__tests__/a.ts",
            "test/fixtures/sample/app.ts",
            "e2e/flow.ts",
        ] {
            assert!(is_test_file(yes), "{yes} should be a test file");
        }
        for no in [
            "src/app.ts",
            "src/latest.ts",
            "src/contest.py",
            "src/testing.go",
            "lib/protest.rb",
        ] {
            assert!(!is_test_file(no), "{no} should not be a test file");
        }
    }
}
