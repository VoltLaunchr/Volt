//! Cold filesystem-enumeration benchmark — **Pilier D, Track 2** GO/NO-GO gate.
//!
//! Measures, on the SAME target, two ways to enumerate the filesystem so the
//! cost of each can be compared apples-to-apples:
//!
//! - **Strategy 1 — directory walk** (`scan_files`): the no-admin baseline full
//!   point-in-time enumeration the index relies on today.
//! - **Strategy 2 — USN drain + resolve**: open the volume's change journal
//!   unprivileged, drain it to the tip, then resolve a bounded sample of changed
//!   FRNs to full paths via `OpenFileById` (the honest per-file price of the USN
//!   path, since the unprivileged read strips inline names).
//!
//! Run it **without** elevation:
//!
//! ```text
//! cargo run --release --example enum_bench --features usn-incremental -- <DRIVE> <ROOT> [more roots...]
//! ```
//!
//! If no root is given, the walk root defaults to `%USERPROFILE%` and the drive
//! to that root's drive letter. The output is a copy-pasteable comparison table
//! for a markdown decision record. This is a diagnostic harness, not a test.

#[cfg(all(windows, feature = "usn-incremental"))]
fn main() {
    use std::time::Instant;
    use volt_lib::usn_api::{IndexConfig, RecordChange, UsnJournal, scan_files};

    // --- CLI parsing ------------------------------------------------------
    // arg1 = drive letter, arg2.. = walk roots. With no roots, default the walk
    // to %USERPROFILE% and derive the drive from it.
    let mut args = std::env::args().skip(1);
    let first = args.next();
    let roots: Vec<String> = args.collect();

    let (drive, roots): (char, Vec<String>) = match (first, roots.is_empty()) {
        // <DRIVE> <ROOT...>
        (Some(d), false) => {
            let drive = d.chars().next().unwrap_or('C').to_ascii_uppercase();
            let roots = std::env::args().skip(2).collect();
            (drive, roots)
        }
        // Only one arg: treat it as the drive, default the walk root to %USERPROFILE%.
        (Some(d), true) => {
            let drive = d.chars().next().unwrap_or('C').to_ascii_uppercase();
            let home = std::env::var("USERPROFILE").unwrap_or_else(|_| format!("{drive}:\\"));
            (drive, vec![home])
        }
        // No args at all: default everything off %USERPROFILE%.
        (None, _) => {
            let home = std::env::var("USERPROFILE").unwrap_or_else(|_| r"C:\".to_string());
            let drive = home
                .chars()
                .next()
                .unwrap_or('C')
                .to_ascii_uppercase();
            (drive, vec![home])
        }
    };

    println!("=== Cold enumeration benchmark (Pilier D, Track 2) ===");
    println!("Drive : {drive}:");
    println!("Roots : {}", roots.join("  |  "));
    println!();

    // --- Strategy 1: directory walk --------------------------------------
    // Full-depth (max_depth high), no extension filter (= all files), no size
    // cap — the genuine cold full enumeration the index relies on.
    let config = IndexConfig {
        folders: roots.clone(),
        excluded_paths: vec![],
        file_extensions: vec![],
        max_depth: 40,
        max_file_size: 0,
    };

    println!("[1/2] Directory walk (scan_files) ...");
    let walk_start = Instant::now();
    let walk_result = scan_files(&config);
    let walk_elapsed = walk_start.elapsed();
    let (walk_count, walk_per_sec) = match &walk_result {
        Ok(files) => {
            let n = files.len();
            let per_sec = n as f64 / walk_elapsed.as_secs_f64().max(1e-9);
            println!(
                "      {n} entries in {walk_elapsed:?}  (~{per_sec:.0} files/s)"
            );
            (n, per_sec)
        }
        Err(e) => {
            eprintln!("      scan_files failed: {e}");
            (0, 0.0)
        }
    };

    // --- Strategy 2: USN drain + resolve ---------------------------------
    println!("\n[2/2] USN drain + resolve (drive {drive}:) ...");
    let mut journal = match UsnJournal::open(drive) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("      USN journal open failed: {e}");
            eprintln!(
                "      → Strategy 2 unavailable on {drive}: (no active journal or access denied)."
            );
            print_caveat();
            return;
        }
    };
    let cur = journal.cursor();
    println!(
        "      journal_id={:#x}  next_usn={}",
        cur.journal_id, cur.next_usn
    );

    // Drain the WHOLE journal from 0 to the tip. We collect upsert FRNs into a
    // bounded sample to time the per-file resolve cost separately from the drain
    // (resolution is the real per-file price of the USN path).
    const RESOLVE_SAMPLE_CAP: usize = 40_000;
    let (mut total, mut named, mut up, mut rm, mut ig) =
        (0usize, 0usize, 0usize, 0usize, 0usize);
    let mut sample_frns: Vec<u128> = Vec::new();
    let mut cursor_usn = 0i64;

    let drain_start = Instant::now();
    loop {
        let batch = match journal.read_batch(cursor_usn) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("      read_batch error at usn {cursor_usn}: {e}");
                break;
            }
        };
        if batch.is_empty() {
            break;
        }
        for rec in &batch {
            match rec.change() {
                RecordChange::Upsert => {
                    up += 1;
                    if sample_frns.len() < RESOLVE_SAMPLE_CAP {
                        sample_frns.push(rec.frn);
                    }
                }
                RecordChange::Remove => rm += 1,
                RecordChange::Ignore => ig += 1,
            }
            if !rec.file_name.is_empty() {
                named += 1;
            }
            total += 1;
        }
        let next = journal.cursor().next_usn;
        if next <= cursor_usn {
            break; // no forward progress → caught up to the tip
        }
        cursor_usn = next;
    }
    let drain_elapsed = drain_start.elapsed();
    let drain_per_sec = total as f64 / drain_elapsed.as_secs_f64().max(1e-9);
    println!(
        "      drained {total} records in {drain_elapsed:?}  (~{drain_per_sec:.0} rec/s)"
    );
    println!(
        "      named={named}  nameless={}  (upsert={up} remove={rm} ignore={ig})",
        total - named
    );

    // Time a bounded sample of upsert FRN → full-path resolutions. This is the
    // honest per-file cost of a USN-based enumeration: names are stripped, so
    // every indexed change pays one OpenFileById + GetFinalPathNameByHandleW.
    println!(
        "      resolving {} sampled upsert FRNs (cap {RESOLVE_SAMPLE_CAP}) ...",
        sample_frns.len()
    );
    let mut resolve_ok = 0usize;
    let resolve_start = Instant::now();
    for &frn in &sample_frns {
        if journal.resolve_path(frn).is_some() {
            resolve_ok += 1;
        }
    }
    let resolve_elapsed = resolve_start.elapsed();
    let resolve_attempts = sample_frns.len();
    let resolve_rate = if resolve_attempts > 0 {
        resolve_ok as f64 / resolve_attempts as f64 * 100.0
    } else {
        0.0
    };
    let mean_resolve_us = if resolve_attempts > 0 {
        resolve_elapsed.as_secs_f64() * 1e6 / resolve_attempts as f64
    } else {
        0.0
    };
    println!(
        "      resolved {resolve_ok}/{resolve_attempts} ({resolve_rate:.1}%) in {resolve_elapsed:?}  \
         (mean {mean_resolve_us:.1} µs/resolve)"
    );

    // --- Comparison table (copy-pasteable into a decision record) --------
    println!("\n## Cold enumeration benchmark — {drive}:");
    println!("| Strategy | Items | Wall time | Throughput |");
    println!("|---|---:|---:|---:|");
    println!(
        "| Directory walk (`scan_files`) | {walk_count} | {walk_elapsed:.2?} | {walk_per_sec:.0} files/s |"
    );
    println!(
        "| USN drain (records 0→tip) | {total} | {drain_elapsed:.2?} | {drain_per_sec:.0} rec/s |"
    );
    println!(
        "| USN resolve sample (FRN→path) | {resolve_ok}/{resolve_attempts} | {resolve_elapsed:.2?} | {mean_resolve_us:.1} µs/file |"
    );
    println!();
    println!(
        "- USN named/nameless: {named} / {} (unprivileged read strips inline names → resolve via `OpenFileById`).",
        total - named
    );
    println!("- USN change split: upsert={up}  remove={rm}  ignore={ig}.");
    println!(
        "- Projected USN full-enum resolve cost: {total} records × {mean_resolve_us:.1} µs ≈ {:.1} s (resolve-only, upserts).",
        up as f64 * mean_resolve_us / 1e6
    );

    print_caveat();
}

/// One-line honest caveat about what each strategy actually measures.
#[cfg(all(windows, feature = "usn-incremental"))]
fn print_caveat() {
    println!(
        "\n> CAVEAT: The USN journal yields *deltas* (changes since the journal was created), \
         NOT a full point-in-time enumeration — it is a maintenance / incremental feed. \
         The directory walk is the full cold enumeration. They are not interchangeable; \
         the resolve cost above is the honest per-file price of turning a USN change into an indexed path."
    );
}

#[cfg(not(all(windows, feature = "usn-incremental")))]
fn main() {
    eprintln!(
        "enum_bench is Windows-only and requires the usn-incremental feature. Run with:\n  \
         cargo run --release --example enum_bench --features usn-incremental -- <DRIVE> <ROOT> [more roots...]"
    );
}
