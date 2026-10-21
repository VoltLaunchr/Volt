//! Manual probe — empirically prove the **unprivileged** USN change-journal
//! reader works on a real NTFS volume, and measure its drain throughput.
//!
//! Run it **without** elevation (a normal terminal, no "Run as administrator"):
//!
//! ```text
//! cargo run --example usn_probe --features usn-incremental [DRIVE_LETTER]
//! ```
//!
//! If it prints records, the no-admin claim is proven on this machine: a standard
//! user opened the volume with `FILE_TRAVERSE` and read the journal via
//! `FSCTL_READ_UNPRIVILEGED_USN_JOURNAL`. This is a diagnostic tool, not a test.

#[cfg(all(windows, feature = "usn-incremental"))]
fn main() {
    use std::time::Instant;
    use volt_lib::usn_api::{RecordChange, UsnJournal};

    let drive = std::env::args()
        .nth(1)
        .and_then(|s| s.chars().next())
        .unwrap_or('C');

    // Drop a uniquely-named marker file that WE own, on the target volume, then
    // churn it (create → write → rename → delete). If the unprivileged journal
    // returns names for files the caller can access, we will find this marker by
    // name among the drained records — proving the no-admin path yields usable
    // names for the user's own files (even if system-file names are stripped).
    let marker_stem = format!("volt_usn_probe_{}", std::process::id());
    let base = std::env::var("USERPROFILE").unwrap_or_else(|_| format!("{drive}:\\"));
    let p1 = std::path::Path::new(&base).join(format!("{marker_stem}.tmp"));
    let p2 = std::path::Path::new(&base).join(format!("{marker_stem}.renamed.tmp"));
    let _ = std::fs::write(&p1, b"usn marker");
    let _ = std::fs::rename(&p1, &p2);
    let _ = std::fs::remove_file(&p2);
    println!("Marker churned: {marker_stem}.tmp (in {base})");

    println!("Opening USN journal for {drive}: (unprivileged, FILE_TRAVERSE)...");
    let mut journal = match UsnJournal::open(drive) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("open failed: {e}");
            std::process::exit(1);
        }
    };
    let cur = journal.cursor();
    println!(
        "OK — journal_id={:#x}  next_usn={}",
        cur.journal_id, cur.next_usn
    );

    // StartUsn must be a valid record boundary: 0 (sentinel = from the start),
    // FirstUsn, or a USN the journal previously returned. An arbitrary offset
    // (e.g. next_usn - N) fails with ERROR_INVALID_PARAMETER. So we drain the
    // WHOLE journal from 0 to the tip (fast: ~1M+ rec/s) and keep a rolling
    // sample of the *most recent* named records — those are this process's own
    // activity in the user profile, whose names an unprivileged caller CAN see.
    // (The oldest records are system-file churn with names stripped → empty.)
    const CAP: usize = 5_000_000;
    let (mut total, mut named, mut up, mut rm, mut ig) = (0usize, 0usize, 0usize, 0usize, 0usize);
    use std::collections::VecDeque;
    let mut recent_named: VecDeque<(i64, bool, String)> = VecDeque::new();
    let mut marker_hits: Vec<(i64, u32, String)> = Vec::new();
    // OpenFileById resolution test: since inline names are stripped, resolve a
    // sample of changed FRNs to full paths. Keep the most recent successes.
    let mut resolved: VecDeque<String> = VecDeque::new();
    let mut resolve_attempts = 0usize;
    let mut resolve_ok = 0usize;
    let mut cursor_usn = 0i64;

    let start = Instant::now();
    'outer: loop {
        let batch = match journal.read_batch(cursor_usn) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("read_batch error at usn {cursor_usn}: {e}");
                break;
            }
        };
        if batch.is_empty() {
            break;
        }
        for rec in &batch {
            match rec.change() {
                RecordChange::Upsert => up += 1,
                RecordChange::Remove => rm += 1,
                RecordChange::Ignore => ig += 1,
            }
            if !rec.file_name.is_empty() {
                named += 1;
                recent_named.push_back((rec.usn, rec.is_directory(), rec.file_name.clone()));
                if recent_named.len() > 20 {
                    recent_named.pop_front();
                }
            }
            if rec.file_name.contains(&marker_stem) {
                marker_hits.push((rec.usn, rec.reason, rec.file_name.clone()));
            }
            // Resolve a sample of upsert FRNs → full path (the no-admin name path).
            if matches!(rec.change(), RecordChange::Upsert) && resolve_attempts < 40_000 {
                resolve_attempts += 1;
                if let Some(path) = journal.resolve_path(rec.frn) {
                    resolve_ok += 1;
                    resolved.push_back(path.display().to_string());
                    if resolved.len() > 15 {
                        resolved.pop_front();
                    }
                }
            }
            total += 1;
            if total >= CAP {
                break 'outer;
            }
        }
        let next = journal.cursor().next_usn;
        if next <= cursor_usn {
            break; // no forward progress → caught up to the tip
        }
        cursor_usn = next;
    }
    let elapsed = start.elapsed();
    let per_sec = total as f64 / elapsed.as_secs_f64().max(1e-9);

    println!(
        "\nDrained {total} records in {elapsed:?}  (~{per_sec:.0} rec/s)\n  \
         named={named}  unnamed={}  (upsert={up} remove={rm} ignore={ig})",
        total - named
    );
    println!(
        "Most-recent {} NAMED records (files the user can see):",
        recent_named.len()
    );
    for (usn, is_dir, name) in &recent_named {
        println!(
            "  usn={usn:<14} {}  {name}",
            if *is_dir { "[dir]" } else { "     " }
        );
    }

    println!("\n--- MARKER TEST (our own file, '{marker_stem}') ---");
    if marker_hits.is_empty() {
        println!(
            "  NOT FOUND with a name → FILE_TRAVERSE does not expose filenames here\n  \
             (the {total} records were all nameless headers)."
        );
    } else {
        println!(
            "  FOUND {} record(s) carrying our marker NAME:",
            marker_hits.len()
        );
        for (usn, reason, name) in &marker_hits {
            println!("  usn={usn:<14} reason={reason:#010x}  {name}");
        }
        println!("  → Unprivileged USN DOES return names for files the user owns.");
    }

    println!(
        "\n--- OpenFileById RESOLUTION ({resolve_ok}/{resolve_attempts} FRNs resolved to a path) ---"
    );
    if resolved.is_empty() {
        println!("  None resolved (all attempts were inaccessible/deleted).");
    } else {
        println!("  Most-recent resolved full paths (no admin):");
        for p in &resolved {
            println!("    {p}");
        }
    }
    println!("\n✅ Unprivileged USN read confirmed — no administrator required.");
}

#[cfg(not(all(windows, feature = "usn-incremental")))]
fn main() {
    eprintln!(
        "usn_probe is Windows-only. Run with:\n  \
         cargo run --example usn_probe --features usn-incremental [DRIVE_LETTER]"
    );
}
