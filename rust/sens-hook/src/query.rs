use std::collections::HashMap;
use std::path::MAIN_SEPARATOR;

use crate::index::{ProjectIndex, Reference, SymbolInfo};

pub struct Engine<'a> {
    index: &'a ProjectIndex<'a>,

    by_name_or_suffix: HashMap<&'a str, Vec<usize>>,
    by_file: HashMap<&'a str, Vec<usize>>,
}

pub struct WhoUses<'a> {
    pub symbol: &'a SymbolInfo,
    pub references: Vec<Reference>,
}

impl<'a> Engine<'a> {
    pub fn new(index: &'a ProjectIndex<'a>) -> Self {
        let mut by_name_or_suffix: HashMap<&str, Vec<usize>> = HashMap::new();
        let mut by_file: HashMap<&str, Vec<usize>> = HashMap::new();

        for (i, s) in index.symbols.iter().enumerate() {
            by_name_or_suffix.entry(s.name.as_str()).or_default().push(i);
            if let Some(dot) = s.name.rfind('.') {
                by_name_or_suffix.entry(&s.name[dot + 1..]).or_default().push(i);
            }
            by_file.entry(s.file.as_str()).or_default().push(i);
        }

        Self { index, by_name_or_suffix, by_file }
    }

    pub fn who_uses(&self, name: &str) -> Vec<WhoUses<'a>> {
        self.by_name_or_suffix
            .get(name)
            .map(|ids| {
                ids.iter()
                    .map(|&i| {
                        let symbol = &self.index.symbols[i];
                        WhoUses {
                            symbol,
                            references: self.index.references_for(&symbol.id),
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn file_outline(&self, file: &str) -> Vec<&'a SymbolInfo> {
        let norm = file.replace(MAIN_SEPARATOR, "/");
        let mut syms: Vec<&SymbolInfo> = match self.by_file.get(norm.as_str()) {
            Some(ids) => ids.iter().map(|&i| &self.index.symbols[i]).collect(),
            None => self
                .index
                .symbols
                .iter()
                .filter(|s| s.file.ends_with(&norm))
                .collect(),
        };
        syms.sort_by_key(|s| s.line);
        syms
    }
}
