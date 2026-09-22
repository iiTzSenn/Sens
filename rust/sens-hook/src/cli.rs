use std::collections::HashSet;
use std::path::Path;

use crate::format;
use crate::query::Engine;
use crate::reflective;

pub fn run(engine: &Engine, root: &Path, args: &[String]) -> Option<String> {
    let json = args.iter().any(|a| a == "--json");
    let positional: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let name = positional.first()?.as_str();
    let arg = |i: usize| positional.get(i).map(|s| s.as_str());

    if json {
        return run_json(engine, root, name, &arg);
    }

    Some(match name {
        "project_map" => format::format_map(&engine.map(arg(1))),
        "find_symbol" => format::format_symbols(&engine.find_symbol(arg(1)?)),
        "file_outline" => format::format_symbols(&engine.file_outline(arg(1)?)),
        "already_exists" => format::format_symbols(&engine.already_exists(arg(1)?, 15)),
        "file_dependencies" => {
            format::format_file_dependencies(&engine.file_dependencies(arg(1)?))
        }
        "explain_symbol" => format::format_explain(&engine.explain(arg(1)?)),
        "symbol_path" => {
            let (from, to) = (arg(1)?, arg(2)?);
            let found = engine.path(from, to);
            format::format_path(found.as_deref(), from, to)
        }
        "who_uses" => {
            let full = args.iter().any(|a| a == "--full");
            format::format_who_uses(&engine.who_uses(arg(1)?), full)
        }
        "dead_code" => format::format_dead_code(&resolved_dead_code(engine, root, arg(1))),
        _ => return None,
    })
}

fn resolved_dead_code<'a>(
    engine: &Engine<'a>,
    root: &Path,
    subdir: Option<&str>,
) -> crate::query::DeadCodeReport<'a> {
    let mut report = engine.dead_code_report(subdir);
    let names: HashSet<String> = report
        .candidates
        .iter()
        .map(|c| reflective::simple_name(&c.symbol.name).to_string())
        .filter(|n| n.len() >= 4)
        .collect();
    let hits = reflective::hits(root, &names);
    for c in &mut report.candidates {
        if let Some(where_) = hits.get(reflective::simple_name(&c.symbol.name)) {
            c.reflective_hit = Some(where_.clone());
            c.tier = crate::query::Tier::Low;
        }
    }
    report
}

fn run_json<'a>(
    engine: &Engine<'a>,
    root: &Path,
    name: &str,
    arg: &dyn Fn(usize) -> Option<&'a str>,
) -> Option<String> {
    Some(match name {
        "project_map" => crate::json::map(&engine.map(arg(1))),
        "find_symbol" => crate::json::encode(&engine.find_symbol(arg(1)?)),
        "file_outline" => crate::json::encode(&engine.file_outline(arg(1)?)),
        "already_exists" => crate::json::encode(&engine.already_exists(arg(1)?, 15)),
        "file_dependencies" => crate::json::file_dependencies(&engine.file_dependencies(arg(1)?)),
        "explain_symbol" => crate::json::explain(&engine.explain(arg(1)?)),
        "symbol_path" => crate::json::encode(&engine.path(arg(1)?, arg(2)?)),
        "who_uses" => crate::json::who_uses(&engine.who_uses(arg(1)?)),
        "dead_code" => crate::json::dead_code(&resolved_dead_code(engine, root, arg(1))),
        _ => return None,
    })
}
