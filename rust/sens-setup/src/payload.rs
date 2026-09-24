use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use brotli_decompressor::Decompressor;

use crate::progress::CANCELLED;

const HEADER: usize = 8;
const CHUNK: usize = 64 * 1024;
const DAMAGED: &str = "el paquete de sens-app.exe está dañado";

#[cfg(payload)]
pub fn embedded() -> Option<&'static [u8]> {
    Some(include_bytes!(env!("SENS_PAYLOAD_FILE")))
}

#[cfg(not(payload))]
pub fn embedded() -> Option<&'static [u8]> {
    None
}

pub fn size(payload: &[u8]) -> Result<u64, String> {
    let header: [u8; HEADER] = payload
        .get(..HEADER)
        .and_then(|header| header.try_into().ok())
        .ok_or(DAMAGED)?;
    Ok(u64::from_le_bytes(header))
}

pub fn extract(payload: &[u8], into: &Path, cancel: &AtomicBool, mut progress: impl FnMut(u64, u64)) -> Result<(), String> {
    let expected = size(payload)?;
    let mut stream = Decompressor::new(&payload[HEADER..], CHUNK);
    let mut file = File::create(into).map_err(|error| format!("no pude crear {}: {error}", into.display()))?;
    let unwritten = |error: std::io::Error| format!("no pude escribir {}: {error}", into.display());
    let mut buffer = vec![0; CHUNK];
    let mut written = 0u64;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(CANCELLED.into());
        }
        let read = stream.read(&mut buffer).map_err(|_| DAMAGED.to_string())?;
        if read == 0 {
            break;
        }
        written += read as u64;
        if written > expected {
            return Err(DAMAGED.into());
        }
        file.write_all(&buffer[..read]).map_err(unwritten)?;
        progress(written, expected);
    }
    if written != expected {
        return Err(DAMAGED.into());
    }
    file.sync_all().map_err(unwritten)
}

#[cfg(test)]
pub fn packed(app: &[u8]) -> Vec<u8> {
    let mut packed = (app.len() as u64).to_le_bytes().to_vec();
    let mut compressor = brotli::CompressorWriter::new(&mut packed, 4096, 9, 22);
    compressor.write_all(app).unwrap();
    drop(compressor);
    packed
}

#[cfg(test)]
pub fn sample_app(size: usize) -> Vec<u8> {
    (0..size).map(|index| ((index * 31 + index / 7) % 251) as u8).collect()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("sens-setup-payload-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_header_carries_the_original_size_little_endian() {
        let mut payload = 7_329_792u64.to_le_bytes().to_vec();
        payload.extend_from_slice(b"brotli");

        assert_eq!(size(&payload), Ok(7_329_792));
    }

    #[test]
    fn a_payload_shorter_than_its_header_is_damaged() {
        assert_eq!(size(&[1, 2, 3]), Err(DAMAGED.to_string()));
    }

    #[test]
    fn what_is_packed_comes_back_byte_for_byte_with_its_progress() {
        let dir = scratch("round-trip");
        let app = sample_app(300_000);
        let into = dir.join("sens-app.exe.new");
        let mut seen = Vec::new();

        extract(&packed(&app), &into, &AtomicBool::new(false), |done, total| seen.push((done, total))).unwrap();

        assert_eq!(fs::read(&into).unwrap(), app);
        assert_eq!(seen.last(), Some(&(300_000, 300_000)));
        assert!(seen.len() > 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_header_that_promises_more_than_the_stream_holds_is_refused() {
        let dir = scratch("short");
        let mut payload = packed(&sample_app(1_000));
        payload[..HEADER].copy_from_slice(&2_000u64.to_le_bytes());

        let refused = extract(&payload, &dir.join("sens-app.exe.new"), &AtomicBool::new(false), |_, _| {});

        assert_eq!(refused, Err(DAMAGED.to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_stream_that_is_not_brotli_is_refused() {
        let dir = scratch("garbage");
        let mut payload = 1_000u64.to_le_bytes().to_vec();
        payload.extend_from_slice(&[0xff; 64]);

        let refused = extract(&payload, &dir.join("sens-app.exe.new"), &AtomicBool::new(false), |_, _| {});

        assert_eq!(refused, Err(DAMAGED.to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore]
    fn the_built_payload_unpacks_to_the_built_app() {
        let dir = scratch("built");
        let payload = fs::read("target/payload/sens-app.br").unwrap();
        let app = fs::read("../sens-app/target/release/sens-app.exe").unwrap();
        let into = dir.join("sens-app.exe.new");

        extract(&payload, &into, &AtomicBool::new(false), |_, _| {}).unwrap();

        assert_eq!(size(&payload), Ok(app.len() as u64));
        assert!(fs::read(&into).unwrap() == app);
        println!("{} bytes de brotli, {} de sens-app.exe", payload.len(), app.len());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cancelled_extraction_stops_between_chunks() {
        let dir = scratch("cancelled");

        let refused = extract(&packed(&sample_app(1_000)), &dir.join("sens-app.exe.new"), &AtomicBool::new(true), |_, _| {});

        assert_eq!(refused, Err(CANCELLED.to_string()));
        let _ = fs::remove_dir_all(&dir);
    }
}
