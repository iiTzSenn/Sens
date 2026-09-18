use std::collections::{HashMap, HashSet};
use std::path::MAIN_SEPARATOR;

use crate::index::{ProjectIndex, Reference, SymbolInfo};
use crate::testfile::is_test_file;

pub struct Engine<'a> {
    index: &'a ProjectIndex<'a>,
    entry_points: HashSet<&'a str>,
    by_id: HashMap<&'a str, usize>,
    by_name_lower: HashMap<String, Vec<usize>>,
    by_name_or_suffix: HashMap<&'a str, Vec<usize>>,
    by_file: Vec<(&'a str, Vec<usize>)>,
    by_file_index: HashMap<&'a str, usize>,
    imports_from: HashMap<&'a str, OrderedSet<'a>>,
    imports_to: HashMap<&'a str, OrderedSet<'a>>,
    callees_of: HashMap<&'a str, OrderedSet<'a>>,
    callers_of: HashMap<&'a str, OrderedSet<'a>>,
}

#[derive(Default)]
pub struct OrderedSet<'a> {
    order: Vec<&'a str>,
    seen: HashSet<&'a str>,
}

impl<'a> OrderedSet<'a> {
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

pub struct WhoUses<'a> {
    pub symbol: &'a SymbolInfo,
    pub references: Vec<Reference>,
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
    pub fn new(index: &'a ProjectIndex<'a>, entry_points: &'a [String]) -> Self {
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

        for (target, raw) in &index.references {
            for reference in index.parse_references(raw) {
                let Some(from) = reference.from else { continue };
                if from == *target {
                    continue;
                }
                let Some(from_key) = engine.by_id.get_key_value(from.as_str()).map(|(k, _)| *k)
                else {
                    continue;
                };
                let Some(target_key) = engine.by_id.get_key_value(*target).map(|(k, _)| *k) else {
                    continue;
                };
                engine.callees_of.entry(from_key).or_default().insert(target_key);
                engine.callers_of.entry(target_key).or_default().insert(from_key);
            }
        }

        engine
    }

    fn symbol(&self, i: usize) -> &'a SymbolInfo {
        &self.index.symbols[i]
    }

    fn resolve(&self, name: &str) -> Vec<&'a SymbolInfo> {
        self.by_name_or_suffix
            .get(name)
            .map(|ids| ids.iter().map(|&i| self.symbol(i)).collect())
            .unwrap_or_default()
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
        let sorted = |set: Option<&OrderedSet<'a>>| {
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

    fn neighbors(&self, set: Option<&OrderedSet<'a>>) -> Vec<&'a SymbolInfo> {
        let mut out: Vec<&SymbolInfo> = set
            .map(|s| s.iter().filter_map(|id| self.by_id.get(id).map(|&i| self.symbol(i))).collect())
            .unwrap_or_default();
        out.sort_by(|a, b| {
            compare_paths(a.file.as_str(), b.file.as_str()).then_with(|| a.line.cmp(&b.line))
        });
        out
    }

    pub fn explain(&self, name: &str) -> Vec<Neighborhood<'a>> {
        self.resolve(name)
            .into_iter()
            .map(|symbol| Neighborhood {
                callers: self.neighbors(self.callers_of.get(symbol.id.as_str())),
                callees: self.neighbors(self.callees_of.get(symbol.id.as_str())),
                symbol,
            })
            .collect()
    }

    pub fn path(&self, from: &str, to: &str) -> Option<Vec<&'a SymbolInfo>> {
        let sources = self.resolve(from);
        let targets: HashSet<&str> =
            self.resolve(to).iter().map(|s| s.id.as_str()).collect();
        if sources.is_empty() || targets.is_empty() {
            return None;
        }

        let mut prev: HashMap<&str, Option<&str>> = HashMap::new();
        let mut queue: Vec<&str> = Vec::new();
        for s in &sources {
            let id = s.id.as_str();
            if prev.contains_key(id) {
                continue;
            }
            prev.insert(id, None);
            queue.push(id);
        }

        let mut i = 0;
        while i < queue.len() {
            let id = queue[i];
            i += 1;
            if targets.contains(id) {
                return Some(self.rebuild(&prev, id));
            }
            let neighbors = self
                .callees_of
                .get(id)
                .into_iter()
                .flat_map(|s| s.iter().copied())
                .chain(self.callers_of.get(id).into_iter().flat_map(|s| s.iter().copied()));
            for n in neighbors {
                if prev.contains_key(n) {
                    continue;
                }
                prev.insert(n, Some(id));
                queue.push(n);
            }
        }
        None
    }

    fn rebuild(&self, prev: &HashMap<&str, Option<&'a str>>, end: &'a str) -> Vec<&'a SymbolInfo> {
        let mut ids: Vec<&str> = Vec::new();
        let mut cur = Some(end);
        while let Some(id) = cur {
            ids.push(id);
            cur = prev.get(id).copied().flatten();
        }
        ids.reverse();
        ids.iter().filter_map(|id| self.by_id.get(id).map(|&i| self.symbol(i))).collect()
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
    fn mark(&self, roots: impl Fn(&mut dyn FnMut(&'a str))) -> HashSet<&'a str> {
        let mut live: HashSet<&str> = HashSet::new();
        let mut stack: Vec<&str> = Vec::new();
        {
            let mut seed = |id: &'a str| {
                if let Some((key, _)) = self.by_id.get_key_value(id) {
                    if live.insert(key) {
                        stack.push(key);
                    }
                }
            };
            roots(&mut seed);
        }
        while let Some(id) = stack.pop() {
            let callees: Vec<&str> = self
                .callees_of
                .get(id)
                .map(|s| s.iter().copied().collect())
                .unwrap_or_default();
            for callee in callees {
                if let Some((key, _)) = self.by_id.get_key_value(callee) {
                    if live.insert(key) {
                        stack.push(key);
                    }
                }
            }
        }
        live
    }

    fn reachable(&self) -> (HashSet<&'a str>, HashSet<&'a str>) {
        let real = self.mark(|seed| {
            for s in &self.index.symbols {
                if s.entry {
                    seed(&s.id);
                } else if s.exported && self.entry_points.contains(s.file.as_str()) {
                    seed(&s.id);
                } else if is_test_file(&s.file) {
                    seed(&s.id);
                }
            }
            for (id, raw) in &self.index.references {
                if self.index.parse_references(raw).iter().any(|r| r.from.is_none()) {
                    seed(id);
                }
            }
        });
        let live = self.mark(|seed| {
            for id in &real {
                seed(id);
            }
            for s in &self.index.symbols {
                if s.exported {
                    seed(&s.id);
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
        for s in &self.index.symbols {
            if !in_scope(&s.file) || is_test_file(&s.file) {
                continue;
            }
            if s.exported && self.entry_points.contains(s.file.as_str()) {
                continue;
            }
            let refs = self.index.references_for(&s.id).len();
            let id = s.id.as_str();
            if s.kind == "method" {
                if live.contains(id) {
                    continue;
                }
                candidates.push(DeadCandidate {
                    symbol: s,
                    tier: Tier::Low,
                    reason: "method unreferenced statically — interfaces/dynamic dispatch may still call it; verify",
                    reflective_hit: None,
                });
            } else if s.exported {
                if real.contains(id) {
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
                if live.contains(id) {
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
            if self.imports_to.get(file).map(OrderedSet::len).unwrap_or(0) > 0 {
                continue;
            }
            if !ids.is_empty() && ids.iter().all(|&i| !live.contains(self.symbol(i).id.as_str())) {
                files.push(file);
            }
        }
        files.sort_by(|a, b| compare_paths(a, b));

        DeadCodeReport { candidates, files }
    }
}
