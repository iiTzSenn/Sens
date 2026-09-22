use std::collections::{HashMap, HashSet};
use std::path::MAIN_SEPARATOR;

use crate::binindex::BinIndex;
use crate::index::{Reference, SymbolInfo};
use crate::testfile::is_test_file;

pub struct Engine<'a> {
    index: &'a BinIndex,
    entry_points: HashSet<&'a str>,
    by_id: HashMap<&'a str, usize>,
    by_name_lower: HashMap<String, Vec<usize>>,
    by_name_or_suffix: HashMap<&'a str, Vec<usize>>,
    by_file: Vec<(&'a str, Vec<usize>)>,
    by_file_index: HashMap<&'a str, usize>,
    imports_from: HashMap<&'a str, OrderedStrings<'a>>,
    imports_to: HashMap<&'a str, OrderedStrings<'a>>,
    callees_of: HashMap<usize, OrderedSet>,
    callers_of: HashMap<usize, OrderedSet>,
}

#[derive(Default)]
pub struct OrderedSet {
    order: Vec<usize>,
    seen: HashSet<usize>,
}

impl OrderedSet {
    fn insert(&mut self, value: usize) {
        if self.seen.insert(value) {
            self.order.push(value);
        }
    }
    fn iter(&self) -> impl Iterator<Item = &usize> {
        self.order.iter()
    }
    fn len(&self) -> usize {
        self.order.len()
    }
}

pub struct WhoUses<'a> {
    pub symbol: &'a SymbolInfo,
    pub references: Vec<Reference>,
}

pub struct OnlyUsedIn<'a> {
    pub symbol: &'a SymbolInfo,
    pub sites: Vec<(&'a str, u32)>,
}

pub struct MapEntry<'a> {
    pub file: &'a str,
    pub exported: Vec<&'a SymbolInfo>,
    pub internal_count: usize,
}

pub struct FileDependencies<'a> {
    pub file: String,
    pub imports: Vec<&'a str>,
    pub imported_by: Vec<&'a str>,
}

pub struct Neighborhood<'a> {
    pub symbol: &'a SymbolInfo,
    pub callers: Vec<&'a SymbolInfo>,
    pub callees: Vec<&'a SymbolInfo>,
}

#[derive(PartialEq, Eq, PartialOrd, Ord, Clone, Copy)]
pub enum Tier {
    High,
    Medium,
    Low,
}

pub struct DeadCandidate<'a> {
    pub symbol: &'a SymbolInfo,
    pub tier: Tier,
    pub reason: &'static str,
    pub reflective_hit: Option<String>,
}

pub struct DeadCodeReport<'a> {
    pub candidates: Vec<DeadCandidate<'a>>,
    pub files: Vec<&'a str>,
}

pub fn compare_paths(a: &str, b: &str) -> std::cmp::Ordering {
    a.cmp(b)
}

fn normalize(path: &str) -> String {
    path.replace(MAIN_SEPARATOR, "/")
}

impl<'a> Engine<'a> {
    pub fn new(index: &'a BinIndex, entry_points: &'a [String]) -> Self {
        let mut engine = Self {
            index,
            entry_points: entry_points.iter().map(String::as_str).collect(),
            by_id: HashMap::new(),
            by_name_lower: HashMap::new(),
            by_name_or_suffix: HashMap::new(),
            by_file: Vec::new(),
            by_file_index: HashMap::new(),
            imports_from: HashMap::new(),
            imports_to: HashMap::new(),
            callees_of: HashMap::new(),
            callers_of: HashMap::new(),
        };

        for (i, s) in index.symbols.iter().enumerate() {
            engine.by_id.insert(s.id.as_str(), i);
            engine.by_name_lower.entry(s.name.to_lowercase()).or_default().push(i);
            engine.by_name_or_suffix.entry(s.name.as_str()).or_default().push(i);
            if let Some(dot) = s.name.rfind('.') {
                engine.by_name_or_suffix.entry(&s.name[dot + 1..]).or_default().push(i);
            }
            match engine.by_file_index.get(s.file.as_str()) {
                Some(&slot) => engine.by_file[slot].1.push(i),
                None => {
                    engine.by_file_index.insert(s.file.as_str(), engine.by_file.len());
                    engine.by_file.push((s.file.as_str(), vec![i]));
                }
            }
        }

        let files: HashSet<&str> = index.files.iter().map(|f| f.path.as_str()).collect();
        for edge in &index.imports {
            if edge.from == edge.to {
                continue;
            }
            if files.contains(edge.to.as_str()) {
                engine.imports_from.entry(&edge.from).or_default().insert(&edge.to);
            }
            engine.imports_to.entry(&edge.to).or_default().insert(&edge.from);
        }

        for si in 0..index.symbols.len() {
            for &(_, _, from) in index.raw_references(si) {
                if from == u32::MAX || from as usize == si {
                    continue;
                }
                engine.callees_of.entry(from as usize).or_default().insert(si);
                engine.callers_of.entry(si).or_default().insert(from as usize);
            }
        }

        engine
    }

    fn symbol(&self, i: usize) -> &'a SymbolInfo {
        &self.index.symbols[i]
    }

    fn resolve_indices(&self, name: &str) -> Vec<usize> {
        self.by_name_or_suffix.get(name).cloned().unwrap_or_default()
    }

    fn resolve(&self, name: &str) -> Vec<&'a SymbolInfo> {
        self.resolve_indices(name).into_iter().map(|i| self.symbol(i)).collect()
    }

    pub fn find_symbol(&self, name: &str) -> Vec<&'a SymbolInfo> {
        self.by_name_lower
            .get(&name.to_lowercase())
            .map(|ids| ids.iter().map(|&i| self.symbol(i)).collect())
            .unwrap_or_default()
    }

    pub fn who_uses(&self, name: &str) -> Vec<WhoUses<'a>> {
        self.resolve(name)
            .into_iter()
            .map(|symbol| WhoUses {
                references: self.index.references_for(&symbol.id),
                symbol,
            })
            .collect()
    }

    pub fn used_only_in(&self, files: &HashSet<&str>) -> Vec<OnlyUsedIn<'a>> {
        let path_of = |slot: u32| self.index.files.get(slot as usize).map(|file| file.path.as_str());
        let mut found = Vec::new();
        for si in 0..self.index.symbols.len() {
            let refs = self.index.raw_references(si);
            let inside = !refs.is_empty()
                && refs
                    .iter()
                    .all(|&(slot, _, _)| path_of(slot).is_some_and(|path| files.contains(path)));
            if !inside {
                continue;
            }
            found.push(OnlyUsedIn {
                symbol: self.symbol(si),
                sites: refs
                    .iter()
                    .filter_map(|&(slot, line, _)| Some((path_of(slot)?, line)))
                    .collect(),
            });
        }
        found
    }

    pub fn is_entry_point(&self, file: &str) -> bool {
        self.entry_points.contains(file)
    }

    pub fn file_outline(&self, file: &str) -> Vec<&'a SymbolInfo> {
        let norm = normalize(file);
        let mut syms: Vec<&SymbolInfo> = match self.by_file_index.get(norm.as_str()) {
            Some(&slot) => self.by_file[slot].1.iter().map(|&i| self.symbol(i)).collect(),
            None => self.index.symbols.iter().filter(|s| s.file.ends_with(&norm)).collect(),
        };
        syms.sort_by_key(|s| s.line);
        syms
    }
}

impl<'a> Engine<'a> {
    pub fn already_exists(&self, query: &str, limit: usize) -> Vec<&'a SymbolInfo> {
        let keywords: Vec<String> = query
            .to_lowercase()
            .split_whitespace()
            .map(str::to_string)
            .collect();
        if keywords.is_empty() {
            return Vec::new();
        }
        let mut scored: Vec<(usize, f64)> = self
            .index
            .symbols
            .iter()
            .enumerate()
            .map(|(i, s)| (i, score(s, &keywords)))
            .filter(|(_, score)| *score > 0.0)
            .collect();
        scored.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    let exported = |i: usize| u8::from(self.symbol(i).exported);
                    exported(b.0).cmp(&exported(a.0))
                })
        });
        scored.into_iter().take(limit).map(|(i, _)| self.symbol(i)).collect()
    }

    pub fn map(&self, subdir: Option<&str>) -> Vec<MapEntry<'a>> {
        let sub = subdir.map(normalize);
        let mut entries: Vec<MapEntry> = Vec::new();
        for (file, ids) in &self.by_file {
            if let Some(sub) = &sub {
                if !file.starts_with(sub.as_str()) {
                    continue;
                }
            }
            let mut exported: Vec<&SymbolInfo> = ids
                .iter()
                .map(|&i| self.symbol(i))
                .filter(|s| s.exported && s.kind != "method")
                .collect();
            exported.sort_by_key(|s| s.line);
            entries.push(MapEntry {
                file,
                internal_count: ids.len() - exported.len(),
                exported,
            });
        }
        entries.sort_by(|a, b| compare_paths(a.file, b.file));
        entries
    }

    pub fn file_dependencies(&self, file: &str) -> FileDependencies<'a> {
        let norm = normalize(file);
        let target = self
            .index
            .files
            .iter()
            .find(|f| f.path == norm || f.path.ends_with(&norm))
            .map(|f| f.path.clone())
            .unwrap_or(norm);
        let sorted = |set: Option<&OrderedStrings<'a>>| {
            let mut v: Vec<&str> = set.map(|s| s.iter().copied().collect()).unwrap_or_default();
            v.sort_by(|a, b| compare_paths(a, b));
            v
        };
        FileDependencies {
            imports: sorted(self.imports_from.get(target.as_str())),
            imported_by: sorted(self.imports_to.get(target.as_str())),
            file: target,
        }
    }

    fn neighbors(&self, set: Option<&OrderedSet>) -> Vec<&'a SymbolInfo> {
        let mut out: Vec<&SymbolInfo> = set
            .map(|s| s.iter().map(|&i| self.symbol(i)).collect())
            .unwrap_or_default();
        out.sort_by(|a, b| {
            compare_paths(a.file.as_str(), b.file.as_str()).then_with(|| a.line.cmp(&b.line))
        });
        out
    }

    pub fn explain(&self, name: &str) -> Vec<Neighborhood<'a>> {
        self.resolve_indices(name)
            .into_iter()
            .map(|si| Neighborhood {
                symbol: self.symbol(si),
                callers: self.neighbors(self.callers_of.get(&si)),
                callees: self.neighbors(self.callees_of.get(&si)),
            })
            .collect()
    }

    pub fn path(&self, from: &str, to: &str) -> Option<Vec<&'a SymbolInfo>> {
        let sources = self.resolve_indices(from);
        let targets: HashSet<usize> = self.resolve_indices(to).into_iter().collect();
        if sources.is_empty() || targets.is_empty() {
            return None;
        }

        let mut prev: HashMap<usize, Option<usize>> = HashMap::new();
        let mut queue: Vec<usize> = Vec::new();
        for si in sources {
            if prev.contains_key(&si) {
                continue;
            }
            prev.insert(si, None);
            queue.push(si);
        }

        let mut i = 0;
        while i < queue.len() {
            let si = queue[i];
            i += 1;
            if targets.contains(&si) {
                return Some(self.rebuild(&prev, si));
            }
            let neighbors = self
                .callees_of
                .get(&si)
                .into_iter()
                .flat_map(|s| s.iter().copied())
                .chain(self.callers_of.get(&si).into_iter().flat_map(|s| s.iter().copied()));
            for n in neighbors {
                if prev.contains_key(&n) {
                    continue;
                }
                prev.insert(n, Some(si));
                queue.push(n);
            }
        }
        None
    }

    fn rebuild(&self, prev: &HashMap<usize, Option<usize>>, end: usize) -> Vec<&'a SymbolInfo> {
        let mut ids: Vec<usize> = Vec::new();
        let mut cur = Some(end);
        while let Some(si) = cur {
            ids.push(si);
            cur = prev.get(&si).copied().flatten();
        }
        ids.reverse();
        ids.into_iter().map(|i| self.symbol(i)).collect()
    }
}

fn score(s: &SymbolInfo, keywords: &[String]) -> f64 {
    let name = s.name.to_lowercase();
    let hay = format!("{} {}", s.name, s.signature).to_lowercase();
    let mut score = 0.0;
    for k in keywords {
        if name == *k {
            score += 10.0;
        } else if name.contains(k.as_str()) {
            score += 4.0;
        } else if hay.contains(k.as_str()) {
            score += 1.0;
        }
    }
    if score > 0.0 && s.exported {
        score += 0.5;
    }
    score
}

impl<'a> Engine<'a> {
    fn mark(&self, roots: impl Fn(&mut dyn FnMut(usize))) -> HashSet<usize> {
        let mut live: HashSet<usize> = HashSet::new();
        let mut stack: Vec<usize> = Vec::new();
        {
            let mut seed = |si: usize| {
                if si < self.index.symbols.len() && live.insert(si) {
                    stack.push(si);
                }
            };
            roots(&mut seed);
        }
        while let Some(si) = stack.pop() {
            let callees: Vec<usize> = self
                .callees_of
                .get(&si)
                .map(|s| s.iter().copied().collect())
                .unwrap_or_default();
            for callee in callees {
                if live.insert(callee) {
                    stack.push(callee);
                }
            }
        }
        live
    }

    fn reachable(&self) -> (HashSet<usize>, HashSet<usize>) {
        let real = self.mark(|seed| {
            for (si, s) in self.index.symbols.iter().enumerate() {
                if s.entry
                    || (s.exported && self.entry_points.contains(s.file.as_str()))
                    || is_test_file(&s.file)
                {
                    seed(si);
                }
            }
            for si in 0..self.index.symbols.len() {
                if self.index.raw_references(si).iter().any(|&(_, _, from)| from == u32::MAX) {
                    seed(si);
                }
            }
        });
        let live = self.mark(|seed| {
            for &si in &real {
                seed(si);
            }
            for (si, s) in self.index.symbols.iter().enumerate() {
                if s.exported {
                    seed(si);
                }
            }
        });
        (real, live)
    }

    pub fn dead_code_report(&self, subdir: Option<&str>) -> DeadCodeReport<'a> {
        let sub = subdir.map(normalize);
        let in_scope = |file: &str| sub.as_ref().is_none_or(|s| file.starts_with(s.as_str()));
        let (real, live) = self.reachable();

        let mut candidates: Vec<DeadCandidate> = Vec::new();
        for (si, s) in self.index.symbols.iter().enumerate() {
            if !in_scope(&s.file) || is_test_file(&s.file) {
                continue;
            }
            if s.exported && self.entry_points.contains(s.file.as_str()) {
                continue;
            }
            let refs = self.index.raw_references(si).len();
            if s.kind == "method" {
                if live.contains(&si) {
                    continue;
                }
                candidates.push(DeadCandidate {
                    symbol: s,
                    tier: Tier::Low,
                    reason: "method unreferenced statically — interfaces/dynamic dispatch may still call it; verify",
                    reflective_hit: None,
                });
            } else if s.exported {
                if real.contains(&si) {
                    continue;
                }
                candidates.push(DeadCandidate {
                    symbol: s,
                    tier: Tier::Low,
                    reason: if refs == 0 {
                        "exported but never referenced in-project — safe only if it isn't public API"
                    } else {
                        "exported and reached only from other dead code — verify it isn't public API"
                    },
                    reflective_hit: None,
                });
            } else {
                if live.contains(&si) {
                    continue;
                }
                candidates.push(DeadCandidate {
                    symbol: s,
                    tier: if refs == 0 { Tier::High } else { Tier::Medium },
                    reason: if refs == 0 {
                        "internal symbol with no references anywhere"
                    } else {
                        "internal, reached only from other unreachable code (dead island)"
                    },
                    reflective_hit: None,
                });
            }
        }
        candidates.sort_by(|a, b| {
            a.tier.cmp(&b.tier).then_with(|| {
                compare_paths(a.symbol.file.as_str(), b.symbol.file.as_str())
                    .then_with(|| a.symbol.line.cmp(&b.symbol.line))
            })
        });

        let mut files: Vec<&str> = Vec::new();
        for (file, ids) in &self.by_file {
            if !in_scope(file) || is_test_file(file) || self.entry_points.contains(file) {
                continue;
            }
            if self.imports_to.get(file).map(OrderedStrings::len).unwrap_or(0) > 0 {
                continue;
            }
            if !ids.is_empty() && ids.iter().all(|i| !live.contains(i)) {
                files.push(file);
            }
        }
        files.sort_by(|a, b| compare_paths(a, b));

        DeadCodeReport { candidates, files }
    }
}

#[derive(Default)]
pub struct OrderedStrings<'a> {
    order: Vec<&'a str>,
    seen: HashSet<&'a str>,
}

impl<'a> OrderedStrings<'a> {
    fn insert(&mut self, value: &'a str) {
        if self.seen.insert(value) {
            self.order.push(value);
        }
    }
    fn iter(&self) -> impl Iterator<Item = &&'a str> {
        self.order.iter()
    }
    fn len(&self) -> usize {
        self.order.len()
    }
}
