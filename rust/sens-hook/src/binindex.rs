use std::collections::HashMap;
use std::path::Path;

use crate::index::{FileInfo, ImportEdge, Reference, SymbolInfo};

const MAGIC: &[u8; 8] = b"SENSIDX1";
const FORMAT_VERSION: u32 = 1;

pub struct BinIndex {
    pub schema_version: u32,
    pub created_at: f64,
    pub source_len: u64,
    pub files: Vec<FileInfo>,
    pub symbols: Vec<SymbolInfo>,
    pub imports: Vec<ImportEdge>,
    refs: Vec<(u32, u32, u32)>,
    ranges: Vec<(u32, u32)>,
    by_id: HashMap<String, usize>,
}

impl BinIndex {
    pub fn references_for(&self, id: &str) -> Vec<Reference> {
        let Some(&si) = self.by_id.get(id) else { return Vec::new() };
        self.references_at(si)
    }

    pub fn references_at(&self, si: usize) -> Vec<Reference> {
        let Some(&(start, len)) = self.ranges.get(si) else { return Vec::new() };
        self.refs[start as usize..(start + len) as usize]
            .iter()
            .map(|&(file_idx, line, from)| Reference {
                file: self.files[file_idx as usize].path.clone(),
                line,
                from: (from != u32::MAX).then(|| self.symbols[from as usize].id.clone()),
            })
            .collect()
    }
}

struct Writer {
    arena: Vec<u8>,
    seen: HashMap<String, (u32, u32)>,
    out: Vec<u8>,
}

impl Writer {
    fn new() -> Self {
        Self { arena: Vec::new(), seen: HashMap::new(), out: Vec::new() }
    }

    fn intern(&mut self, s: &str) -> (u32, u32) {
        if let Some(&slot) = self.seen.get(s) {
            return slot;
        }
        let slot = (self.arena.len() as u32, s.len() as u32);
        self.arena.extend_from_slice(s.as_bytes());
        self.seen.insert(s.to_string(), slot);
        slot
    }

    fn u32(&mut self, v: u32) {
        self.out.extend_from_slice(&v.to_le_bytes());
    }

    fn f64(&mut self, v: f64) {
        self.out.extend_from_slice(&v.to_le_bytes());
    }

    fn slot(&mut self, s: &str) {
        let (off, len) = self.intern(s);
        self.u32(off);
        self.u32(len);
    }
}

pub struct Input<'a> {
    pub schema_version: u32,
    pub created_at: f64,
    pub source_len: u64,
    pub files: &'a [FileInfo],
    pub symbols: &'a [SymbolInfo],
    pub imports: &'a [ImportEdge],
    pub references: Vec<Vec<Reference>>,
}

pub fn encode(input: &Input) -> Vec<u8> {
    let mut w = Writer::new();
    let file_index: HashMap<&str, u32> =
        input.files.iter().enumerate().map(|(i, f)| (f.path.as_str(), i as u32)).collect();
    let symbol_index: HashMap<&str, u32> =
        input.symbols.iter().enumerate().map(|(i, s)| (s.id.as_str(), i as u32)).collect();

    for f in input.files {
        w.slot(&f.path);
        w.f64(f.mtime_ms);
        w.u32(f.exports.len() as u32);
        let exports: Vec<String> = f.exports.clone();
        for e in &exports {
            w.slot(e);
        }
    }
    let files_section = std::mem::take(&mut w.out);

    for s in input.symbols {
        w.slot(&s.id);
        w.slot(&s.name);
        w.slot(&s.kind);
        w.slot(&s.signature);
        w.u32(file_index.get(s.file.as_str()).copied().unwrap_or(u32::MAX));
        w.u32(s.line);
        w.u32(u32::from(s.exported) | (u32::from(s.entry) << 1));
    }
    let symbols_section = std::mem::take(&mut w.out);

    for e in input.imports {
        w.slot(&e.from);
        w.slot(&e.to);
        w.u32(e.names.len() as u32);
        let names: Vec<String> = e.names.clone();
        for n in &names {
            w.slot(n);
        }
    }
    let imports_section = std::mem::take(&mut w.out);

    let mut total_refs = 0u32;
    for (si, refs) in input.references.iter().enumerate() {
        let _ = si;
        total_refs += refs.len() as u32;
    }
    let mut ranges_out: Vec<u8> = Vec::new();
    let mut cursor = 0u32;
    for refs in &input.references {
        ranges_out.extend_from_slice(&cursor.to_le_bytes());
        ranges_out.extend_from_slice(&(refs.len() as u32).to_le_bytes());
        cursor += refs.len() as u32;
    }
    for refs in &input.references {
        for r in refs {
            w.u32(file_index.get(r.file.as_str()).copied().unwrap_or(u32::MAX));
            w.u32(r.line);
            w.u32(
                r.from
                    .as_deref()
                    .and_then(|f| symbol_index.get(f).copied())
                    .unwrap_or(u32::MAX),
            );
        }
    }
    let refs_section = std::mem::take(&mut w.out);

    let mut out = Vec::with_capacity(w.arena.len() + refs_section.len() + 4096);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
    out.extend_from_slice(&input.schema_version.to_le_bytes());
    out.extend_from_slice(&input.created_at.to_le_bytes());
    out.extend_from_slice(&input.source_len.to_le_bytes());
    out.extend_from_slice(&(input.files.len() as u32).to_le_bytes());
    out.extend_from_slice(&(input.symbols.len() as u32).to_le_bytes());
    out.extend_from_slice(&(input.imports.len() as u32).to_le_bytes());
    out.extend_from_slice(&total_refs.to_le_bytes());
    out.extend_from_slice(&(w.arena.len() as u64).to_le_bytes());
    out.extend_from_slice(&w.arena);
    out.extend_from_slice(&files_section);
    out.extend_from_slice(&symbols_section);
    out.extend_from_slice(&imports_section);
    out.extend_from_slice(&ranges_out);
    out.extend_from_slice(&refs_section);
    out
}

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
    arena: &'a [u8],
}

impl<'a> Reader<'a> {
    fn u32(&mut self) -> Option<u32> {
        let end = self.pos + 4;
        let v = u32::from_le_bytes(self.bytes.get(self.pos..end)?.try_into().ok()?);
        self.pos = end;
        Some(v)
    }

    fn f64(&mut self) -> Option<f64> {
        let end = self.pos + 8;
        let v = f64::from_le_bytes(self.bytes.get(self.pos..end)?.try_into().ok()?);
        self.pos = end;
        Some(v)
    }

    fn text(&mut self) -> Option<String> {
        let off = self.u32()? as usize;
        let len = self.u32()? as usize;
        let slice = self.arena.get(off..off + len)?;
        Some(String::from_utf8_lossy(slice).into_owned())
    }
}

pub fn decode(bytes: &[u8]) -> Option<BinIndex> {
    if bytes.len() < 48 || &bytes[..8] != MAGIC {
        return None;
    }
    let read_u32 = |at: usize| -> Option<u32> {
        Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
    };
    let read_f64 = |at: usize| -> Option<f64> {
        Some(f64::from_le_bytes(bytes.get(at..at + 8)?.try_into().ok()?))
    };
    let read_u64 = |at: usize| -> Option<u64> {
        Some(u64::from_le_bytes(bytes.get(at..at + 8)?.try_into().ok()?))
    };

    if read_u32(8)? != FORMAT_VERSION {
        return None;
    }
    let schema_version = read_u32(12)?;
    let created_at = read_f64(16)?;
    let source_len = read_u64(24)?;
    let n_files = read_u32(32)? as usize;
    let n_symbols = read_u32(36)? as usize;
    let n_imports = read_u32(40)? as usize;
    let n_refs = read_u32(44)? as usize;
    let arena_len = read_u64(48)? as usize;

    let arena_start = 56;
    let arena = bytes.get(arena_start..arena_start + arena_len)?;
    let mut r = Reader { bytes, pos: arena_start + arena_len, arena };

    let mut files = Vec::with_capacity(n_files);
    for _ in 0..n_files {
        let path = r.text()?;
        let mtime_ms = r.f64()?;
        let count = r.u32()? as usize;
        let mut exports = Vec::with_capacity(count);
        for _ in 0..count {
            exports.push(r.text()?);
        }
        files.push(FileInfo { path, mtime_ms, exports });
    }

    let mut symbols = Vec::with_capacity(n_symbols);
    for _ in 0..n_symbols {
        let id = r.text()?;
        let name = r.text()?;
        let kind = r.text()?;
        let signature = r.text()?;
        let file_idx = r.u32()? as usize;
        let line = r.u32()?;
        let flags = r.u32()?;
        symbols.push(SymbolInfo {
            id,
            kind,
            entry: flags & 2 != 0,
            name,
            file: files.get(file_idx).map(|f| f.path.clone()).unwrap_or_default(),
            line,
            signature,
            exported: flags & 1 != 0,
        });
    }

    let mut imports = Vec::with_capacity(n_imports);
    for _ in 0..n_imports {
        let from = r.text()?;
        let to = r.text()?;
        let count = r.u32()? as usize;
        let mut names = Vec::with_capacity(count);
        for _ in 0..count {
            names.push(r.text()?);
        }
        imports.push(ImportEdge { from, to, names });
    }

    let mut ranges = Vec::with_capacity(n_symbols);
    for _ in 0..n_symbols {
        let start = r.u32()?;
        let len = r.u32()?;
        ranges.push((start, len));
    }

    let mut refs = Vec::with_capacity(n_refs);
    for _ in 0..n_refs {
        let file_idx = r.u32()?;
        let line = r.u32()?;
        let from = r.u32()?;
        refs.push((file_idx, line, from));
    }

    let by_id = symbols.iter().enumerate().map(|(i, s)| (s.id.clone(), i)).collect();
    Some(BinIndex {
        schema_version,
        created_at,
        source_len,
        files,
        symbols,
        imports,
        refs,
        ranges,
        by_id,
    })
}

pub fn path(root: &Path) -> std::path::PathBuf {
    crate::index::sens_dir(root).join("index.bin")
}

pub fn from_json(bytes: &[u8]) -> Option<BinIndex> {
    let parsed = crate::index::parse_index(bytes)?;
    let files: Vec<FileInfo> = parsed
        .files
        .iter()
        .map(|f| FileInfo {
            path: f.path.clone(),
            mtime_ms: f.mtime_ms,
            exports: f.exports.clone(),
        })
        .collect();
    let symbols: Vec<SymbolInfo> = parsed
        .symbols
        .iter()
        .map(|s| SymbolInfo {
            id: s.id.clone(),
            kind: s.kind.clone(),
            entry: s.entry,
            name: s.name.clone(),
            file: s.file.clone(),
            line: s.line,
            signature: s.signature.clone(),
            exported: s.exported,
        })
        .collect();
    let imports: Vec<ImportEdge> = parsed
        .imports
        .iter()
        .map(|e| ImportEdge { from: e.from.clone(), to: e.to.clone(), names: e.names.clone() })
        .collect();

    let by_id: HashMap<String, usize> =
        symbols.iter().enumerate().map(|(i, s)| (s.id.clone(), i)).collect();
    let file_index: HashMap<&str, u32> =
        files.iter().enumerate().map(|(i, f)| (f.path.as_str(), i as u32)).collect();

    let mut refs: Vec<(u32, u32, u32)> = Vec::new();
    let mut ranges: Vec<(u32, u32)> = vec![(0, 0); symbols.len()];
    for (id, raw) in &parsed.references {
        let Some(&si) = by_id.get(*id) else { continue };
        let start = refs.len() as u32;
        for r in parsed.parse_references(raw) {
            refs.push((
                file_index.get(r.file.as_str()).copied().unwrap_or(u32::MAX),
                r.line,
                r.from.as_deref().and_then(|f| by_id.get(f)).map(|&i| i as u32).unwrap_or(u32::MAX),
            ));
        }
        ranges[si] = (start, refs.len() as u32 - start);
    }

    Some(BinIndex {
        schema_version: parsed.schema_version,
        created_at: parsed.created_at,
        source_len: bytes.len() as u64,
        files,
        symbols,
        imports,
        refs,
        ranges,
        by_id,
    })
}

impl BinIndex {
    pub fn to_bytes(&self) -> Vec<u8> {
        let references: Vec<Vec<Reference>> =
            (0..self.symbols.len()).map(|i| self.references_at(i)).collect();
        encode(&Input {
            schema_version: self.schema_version,
            created_at: self.created_at,
            source_len: self.source_len,
            files: &self.files,
            symbols: &self.symbols,
            imports: &self.imports,
            references,
        })
    }
}

pub fn load(root: &Path, json_len: u64) -> Option<BinIndex> {
    let cached = std::fs::read(path(root)).ok()?;
    let index = decode(&cached)?;
    (index.schema_version == crate::index::INDEX_SCHEMA_VERSION && index.source_len == json_len)
        .then_some(index)
}

pub fn save(root: &Path, index: &BinIndex) {
    let bytes = index.to_bytes();
    let _ = std::fs::write(path(root), bytes);
}

impl BinIndex {
    pub fn raw_references(&self, si: usize) -> &[(u32, u32, u32)] {
        match self.ranges.get(si) {
            Some(&(start, len)) => &self.refs[start as usize..(start + len) as usize],
            None => &[],
        }
    }

    pub fn index_of(&self, id: &str) -> Option<usize> {
        self.by_id.get(id).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Input<'static> {
        static FILES: std::sync::OnceLock<Vec<FileInfo>> = std::sync::OnceLock::new();
        static SYMBOLS: std::sync::OnceLock<Vec<SymbolInfo>> = std::sync::OnceLock::new();
        static IMPORTS: std::sync::OnceLock<Vec<ImportEdge>> = std::sync::OnceLock::new();

        let files = FILES.get_or_init(|| {
            vec![
                FileInfo { path: "a.ts".into(), mtime_ms: 1.5, exports: vec!["alpha".into()] },
                FileInfo { path: "b.ts".into(), mtime_ms: 2.0, exports: Vec::new() },
            ]
        });
        let symbols = SYMBOLS.get_or_init(|| {
            vec![
                SymbolInfo {
                    id: "a.ts#alpha#1".into(),
                    kind: "function".into(),
                    entry: false,
                    name: "alpha".into(),
                    file: "a.ts".into(),
                    line: 1,
                    signature: "alpha()".into(),
                    exported: true,
                },
                SymbolInfo {
                    id: "b.ts#beta#7".into(),
                    kind: "method".into(),
                    entry: true,
                    name: "Widget.beta".into(),
                    file: "b.ts".into(),
                    line: 7,
                    signature: "beta()".into(),
                    exported: false,
                },
            ]
        });
        let imports = IMPORTS.get_or_init(|| {
            vec![ImportEdge { from: "b.ts".into(), to: "a.ts".into(), names: vec!["alpha".into()] }]
        });

        Input {
            schema_version: 6,
            created_at: 1234.5,
            source_len: 999,
            files,
            symbols,
            imports,
            references: vec![
                vec![
                    Reference { file: "b.ts".into(), line: 3, from: Some("b.ts#beta#7".into()) },
                    Reference { file: "b.ts".into(), line: 9, from: None },
                ],
                Vec::new(),
            ],
        }
    }

    #[test]
    fn survives_a_round_trip_unchanged() {
        let decoded = decode(&encode(&sample())).expect("should decode");

        assert_eq!(decoded.schema_version, 6);
        assert_eq!(decoded.created_at, 1234.5);
        assert_eq!(decoded.source_len, 999);
        assert_eq!(decoded.files.len(), 2);
        assert_eq!(decoded.files[0].exports, vec!["alpha".to_string()]);
        assert_eq!(decoded.symbols.len(), 2);

        let beta = &decoded.symbols[1];
        assert_eq!(beta.name, "Widget.beta");
        assert_eq!(beta.file, "b.ts");
        assert_eq!(beta.line, 7);
        assert!(beta.entry);
        assert!(!beta.exported);

        assert_eq!(decoded.imports[0].names, vec!["alpha".to_string()]);
    }

    #[test]
    fn keeps_references_with_their_callers() {
        let decoded = decode(&encode(&sample())).expect("should decode");
        let refs = decoded.references_for("a.ts#alpha#1");
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].file, "b.ts");
        assert_eq!(refs[0].line, 3);
        assert_eq!(refs[0].from.as_deref(), Some("b.ts#beta#7"));
        // A use at module scope has no enclosing symbol, and must stay that way.
        assert_eq!(refs[1].from, None);
        assert!(decoded.references_for("b.ts#beta#7").is_empty());
    }

    #[test]
    fn refuses_anything_that_is_not_one_of_ours() {
        assert!(decode(b"").is_none());
        assert!(decode(b"not an index at all, just some bytes here").is_none());
        let mut corrupt = encode(&sample());
        corrupt[9] = 0xff;
        assert!(decode(&corrupt).is_none());
    }
}
