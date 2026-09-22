use serde::Serialize;

use crate::index::{Reference, SymbolInfo};
use crate::query::{DeadCodeReport, FileDependencies, MapEntry, Neighborhood, Tier, WhoUses};

#[derive(Serialize)]
pub struct WhoUsesJson<'a> {
    pub symbol: &'a SymbolInfo,
    pub references: &'a [Reference],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapEntryJson<'a> {
    pub file: &'a str,
    pub exported: &'a [&'a SymbolInfo],
    pub internal_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDependenciesJson<'a> {
    pub file: &'a str,
    pub imports: &'a [&'a str],
    pub imported_by: &'a [&'a str],
}

#[derive(Serialize)]
pub struct NeighborhoodJson<'a> {
    pub symbol: &'a SymbolInfo,
    pub callers: &'a [&'a SymbolInfo],
    pub callees: &'a [&'a SymbolInfo],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadCandidateJson<'a> {
    pub symbol: &'a SymbolInfo,
    pub tier: &'static str,
    pub reason: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reflective_hit: Option<&'a str>,
}

#[derive(Serialize)]
pub struct DeadCodeReportJson<'a> {
    pub candidates: Vec<DeadCandidateJson<'a>>,
    pub files: &'a [&'a str],
}

fn tier_name(tier: Tier) -> &'static str {
    match tier {
        Tier::High => "high",
        Tier::Medium => "medium",
        Tier::Low => "low",
    }
}

pub fn who_uses(results: &[WhoUses]) -> String {
    let view: Vec<WhoUsesJson> = results
        .iter()
        .map(|r| WhoUsesJson { symbol: r.symbol, references: &r.references })
        .collect();
    encode(&view)
}

pub fn map(entries: &[MapEntry]) -> String {
    let view: Vec<MapEntryJson> = entries
        .iter()
        .map(|e| MapEntryJson {
            file: e.file,
            exported: &e.exported,
            internal_count: e.internal_count,
        })
        .collect();
    encode(&view)
}

pub fn file_dependencies(deps: &FileDependencies) -> String {
    encode(&FileDependenciesJson {
        file: &deps.file,
        imports: &deps.imports,
        imported_by: &deps.imported_by,
    })
}

pub fn explain(results: &[Neighborhood]) -> String {
    let view: Vec<NeighborhoodJson> = results
        .iter()
        .map(|r| NeighborhoodJson {
            symbol: r.symbol,
            callers: &r.callers,
            callees: &r.callees,
        })
        .collect();
    encode(&view)
}

pub fn dead_code(report: &DeadCodeReport) -> String {
    encode(&DeadCodeReportJson {
        candidates: report
            .candidates
            .iter()
            .map(|c| DeadCandidateJson {
                symbol: c.symbol,
                tier: tier_name(c.tier),
                reason: c.reason,
                reflective_hit: c.reflective_hit.as_deref(),
            })
            .collect(),
        files: &report.files,
    })
}

pub fn encode<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}
