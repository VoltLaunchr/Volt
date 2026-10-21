use criterion::{BenchmarkId, Criterion, black_box, criterion_group, criterion_main};
use std::collections::HashMap;
#[cfg(feature = "tantivy-search")]
use volt_lib::benchmark_api::{FileCategory, FileInfo, FulltextIndex, SearchEngine, SearchOptions};
use volt_lib::commands::apps::AppInfo;
use volt_lib::launcher::{LaunchRecord, QueryBindingStore};
use volt_lib::search::search_applications;
use volt_lib::search::search_applications_with_frecency;
use volt_lib::utils::matching::{calculate_match_score, fuzzy_match};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn make_app(name: &str, path: &str) -> AppInfo {
    AppInfo {
        id: format!("id-{}", name.to_lowercase().replace(' ', "-")),
        name: name.to_string(),
        path: path.to_string(),
        icon: None,
        description: None,
        keywords: None,
        last_used: None,
        usage_count: 0,
        category: None,
    }
}

/// Realistic Windows-style app list used across benchmarks.
const APP_NAMES: &[(&str, &str)] = &[
    (
        "Visual Studio Code",
        r"C:\Program Files\Microsoft VS Code\Code.exe",
    ),
    (
        "Google Chrome",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    ),
    (
        "Mozilla Firefox",
        r"C:\Program Files\Mozilla Firefox\firefox.exe",
    ),
    (
        "Microsoft Edge",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ),
    ("Slack", r"C:\Users\user\AppData\Local\slack\slack.exe"),
    ("Discord", r"C:\Users\user\AppData\Local\Discord\Update.exe"),
    (
        "Spotify",
        r"C:\Users\user\AppData\Roaming\Spotify\Spotify.exe",
    ),
    ("Steam", r"C:\Program Files (x86)\Steam\steam.exe"),
    ("Notepad++", r"C:\Program Files\Notepad++\notepad++.exe"),
    (
        "Windows Terminal",
        r"C:\Users\user\AppData\Local\Microsoft\WindowsApps\wt.exe",
    ),
    ("File Explorer", r"C:\Windows\explorer.exe"),
    ("Calculator", r"C:\Windows\System32\calc.exe"),
    ("Paint", r"C:\Windows\System32\mspaint.exe"),
    (
        "PowerShell",
        r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
    ),
    ("Task Manager", r"C:\Windows\System32\Taskmgr.exe"),
    (
        "OBS Studio",
        r"C:\Program Files\obs-studio\bin\64bit\obs64.exe",
    ),
    ("VLC Media Player", r"C:\Program Files\VideoLAN\VLC\vlc.exe"),
    ("7-Zip", r"C:\Program Files\7-Zip\7zFM.exe"),
    ("WinRAR", r"C:\Program Files\WinRAR\WinRAR.exe"),
    (
        "Adobe Photoshop",
        r"C:\Program Files\Adobe\Adobe Photoshop 2024\Photoshop.exe",
    ),
    (
        "Blender",
        r"C:\Program Files\Blender Foundation\Blender 4.0\blender.exe",
    ),
    ("GIMP", r"C:\Program Files\GIMP 2\bin\gimp-2.10.exe"),
    ("Audacity", r"C:\Program Files\Audacity\audacity.exe"),
    (
        "LibreOffice Writer",
        r"C:\Program Files\LibreOffice\program\swriter.exe",
    ),
    ("Figma", r"C:\Users\user\AppData\Local\Figma\Figma.exe"),
    (
        "Postman",
        r"C:\Users\user\AppData\Local\Postman\Postman.exe",
    ),
    (
        "Docker Desktop",
        r"C:\Program Files\Docker\Docker\Docker Desktop.exe",
    ),
    ("Git Bash", r"C:\Program Files\Git\git-bash.exe"),
    ("Node.js", r"C:\Program Files\nodejs\node.exe"),
    (
        "Rust Analyzer",
        r"C:\Users\user\.cargo\bin\rust-analyzer.exe",
    ),
];

fn generate_apps(count: usize) -> Vec<AppInfo> {
    (0..count)
        .map(|i| {
            let idx = i % APP_NAMES.len();
            let (name, path) = APP_NAMES[idx];
            if i < APP_NAMES.len() {
                make_app(name, path)
            } else {
                // Create unique variants for counts beyond the seed list
                make_app(
                    &format!("{} {}", name, i / APP_NAMES.len()),
                    &format!("{}_{}", path, i),
                )
            }
        })
        .collect()
}

fn generate_history(apps: &[AppInfo], count: usize) -> Vec<LaunchRecord> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    apps.iter()
        .take(count)
        .enumerate()
        .map(|(i, app)| LaunchRecord {
            path: app.path.clone(),
            name: app.name.clone(),
            launch_count: (10 - (i % 10)) as u32,
            first_launched: now_ms - 86_400_000 * 30, // 30 days ago
            last_launched: now_ms - (i as i64 * 3_600_000), // staggered
            // Frecency date pushed into the future, more for "more used" entries.
            frecency_date: now_ms + (10 - (i % 10)) as i64 * 86_400_000,
            total_time_ms: None,
            tags: Vec::new(),
            pinned: false,
        })
        .collect()
}

/// Project a history slice into the `path → frecency_date` map that
/// `search_applications_with_frecency` consumes.
fn frecency_map(history: &[LaunchRecord]) -> HashMap<String, i64> {
    history
        .iter()
        .map(|r| (r.path.clone(), r.frecency_date))
        .collect()
}

#[cfg(feature = "tantivy-search")]
fn generate_files(count: usize) -> Vec<FileInfo> {
    const NAMES: &[(&str, &str)] = &[
        ("Visual Studio Code.exe", "exe"),
        ("Mozilla Firefox.exe", "exe"),
        ("project roadmap 2026.pdf", "pdf"),
        ("meeting notes.txt", "txt"),
        ("R\u{e9}sum\u{e9} de r\u{e9}union.docx", "docx"),
        ("vacation photo.jpg", "jpg"),
        ("quarterly report.xlsx", "xlsx"),
        ("rust search engine.rs", "rs"),
        ("Docker Desktop.exe", "exe"),
        ("customer database.sql", "sql"),
    ];

    (0..count)
        .map(|i| {
            let (base, extension) = NAMES[i % NAMES.len()];
            let name = if i < NAMES.len() {
                base.to_string()
            } else {
                format!("{base} archive-{}", i / NAMES.len())
            };
            let path = format!(r"C:\Users\bench\Documents\folder-{}\{name}", i % 100);
            FileInfo {
                id: format!("bench-{i}"),
                name,
                path,
                extension: extension.to_string(),
                size: 4_096 + i as u64 * 37,
                modified: 1_700_000_000 + i as i64,
                created: None,
                accessed: None,
                icon: None,
                category: FileCategory::from_path("", extension, false),
            }
        })
        .collect()
}

#[cfg(feature = "tantivy-search")]
fn directory_size(path: &std::path::Path) -> u64 {
    std::fs::read_dir(path)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| {
            entry
                .metadata()
                .map(|metadata| {
                    if metadata.is_dir() {
                        directory_size(&entry.path())
                    } else {
                        metadata.len()
                    }
                })
                .unwrap_or(0)
        })
        .sum()
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

fn bench_fuzzy_match(c: &mut Criterion) {
    let mut group = c.benchmark_group("fuzzy_match");

    // Short pattern against short text
    group.bench_function("short_exact", |b| {
        b.iter(|| fuzzy_match(black_box("Firefox"), black_box("fire")))
    });

    // Acronym-style match against long text
    group.bench_function("acronym_long_text", |b| {
        b.iter(|| fuzzy_match(black_box("Visual Studio Code"), black_box("vsc")))
    });

    // Worst-case: long pattern that does NOT match
    group.bench_function("no_match_long", |b| {
        b.iter(|| {
            fuzzy_match(
                black_box("Adobe Photoshop Creative Cloud 2024 Extended Edition"),
                black_box("zzzqqqxxx"),
            )
        })
    });

    // Long text with scattered matching chars
    group.bench_function("scattered_chars", |b| {
        b.iter(|| {
            fuzzy_match(
                black_box("Microsoft Visual Studio Professional 2022"),
                black_box("mvsp"),
            )
        })
    });

    group.finish();
}

fn bench_calculate_match_score(c: &mut Criterion) {
    let mut group = c.benchmark_group("calculate_match_score");

    // Exact match (fast path)
    group.bench_function("exact_match", |b| {
        b.iter(|| calculate_match_score(black_box("Firefox"), black_box("firefox")))
    });

    // Starts-with (fast path)
    group.bench_function("starts_with", |b| {
        b.iter(|| calculate_match_score(black_box("Visual Studio Code"), black_box("visual")))
    });

    // Nucleo fuzzy path - substring
    group.bench_function("substring_contains", |b| {
        b.iter(|| calculate_match_score(black_box("Google Chrome"), black_box("chrome")))
    });

    // Nucleo fuzzy path - acronym
    group.bench_function("fuzzy_acronym", |b| {
        b.iter(|| calculate_match_score(black_box("Visual Studio Code"), black_box("vsc")))
    });

    // No match
    group.bench_function("no_match", |b| {
        b.iter(|| calculate_match_score(black_box("Firefox"), black_box("zzzxxx")))
    });

    // Long app name with partial match
    group.bench_function("long_name_partial", |b| {
        b.iter(|| {
            calculate_match_score(
                black_box("Adobe Photoshop Creative Cloud 2024 Extended Edition"),
                black_box("photo"),
            )
        })
    });

    group.finish();
}

fn bench_search_applications(c: &mut Criterion) {
    let mut group = c.benchmark_group("search_applications");
    group.sample_size(50);

    for &count in &[100, 1000, 5000] {
        let apps = generate_apps(count);

        // Broad query matching many results
        group.bench_with_input(BenchmarkId::new("broad_query", count), &apps, |b, apps| {
            b.iter(|| search_applications(black_box("code"), black_box(apps.clone())))
        });

        // Narrow query matching few results
        group.bench_with_input(BenchmarkId::new("narrow_query", count), &apps, |b, apps| {
            b.iter(|| search_applications(black_box("discord"), black_box(apps.clone())))
        });

        // No-match query (worst case: scans everything, returns nothing)
        group.bench_with_input(
            BenchmarkId::new("no_match_query", count),
            &apps,
            |b, apps| {
                b.iter(|| search_applications(black_box("zzznoexist"), black_box(apps.clone())))
            },
        );
    }

    group.finish();
}

fn bench_search_with_frecency(c: &mut Criterion) {
    let mut group = c.benchmark_group("search_applications_with_frecency");
    group.sample_size(50);

    for &count in &[100, 1000, 5000] {
        let apps = generate_apps(count);
        let history = generate_history(&apps, count.min(50)); // realistic: 50 history entries
        let frecency = frecency_map(&history);
        let empty_frecency: HashMap<String, i64> = HashMap::new();
        let bindings = QueryBindingStore::default();
        let empty_aliases: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();

        group.bench_with_input(
            BenchmarkId::new("with_history", count),
            &(apps.clone(), frecency.clone()),
            |b, (apps, frecency)| {
                b.iter(|| {
                    search_applications_with_frecency(
                        black_box("code"),
                        black_box(apps.clone()),
                        black_box(frecency),
                        black_box(Some(&bindings)),
                        black_box(&empty_aliases),
                    )
                })
            },
        );

        group.bench_with_input(BenchmarkId::new("no_history", count), &apps, |b, apps| {
            b.iter(|| {
                search_applications_with_frecency(
                    black_box("chrome"),
                    black_box(apps.clone()),
                    black_box(&empty_frecency),
                    black_box(None),
                    black_box(&empty_aliases),
                )
            })
        });
    }

    group.finish();
}

#[cfg(feature = "tantivy-search")]
fn bench_file_search_backends(c: &mut Criterion) {
    const QUERIES: &[&str] = &["visual code", "firefx", "resume reunion", "quarter report"];
    let options = SearchOptions {
        limit: Some(20),
        filename_only: true,
        ..SearchOptions::default()
    };

    let mut group = c.benchmark_group("file_search_nucleo_vs_tantivy");
    group.sample_size(30);
    for count in [1_000, 10_000] {
        let files = generate_files(count);
        let index_dir = tempfile::tempdir().expect("create benchmark index directory");
        let tantivy =
            FulltextIndex::open_or_create(index_dir.path()).expect("create Tantivy index");
        tantivy
            .build_from_files(&files)
            .expect("build Tantivy benchmark index");

        let disk_bytes = directory_size(index_dir.path());
        eprintln!(
            "search-bench metadata: documents={count}, tantivy_disk_bytes={disk_bytes}, bytes_per_document={:.1}",
            disk_bytes as f64 / count as f64
        );

        // Deterministic relevance checks are deliberately outside Criterion timing.
        let mut nucleo = SearchEngine::new();
        let nucleo_exact = nucleo.search("Visual Studio Code", &files, &options);
        let tantivy_exact = tantivy
            .query("Visual Studio Code", 20, false)
            .expect("query Tantivy index");
        assert_eq!(
            nucleo_exact.first().map(|hit| hit.file.name.as_str()),
            Some("Visual Studio Code.exe")
        );
        assert_eq!(
            tantivy_exact.first().map(|hit| hit.name.as_str()),
            Some("Visual Studio Code.exe")
        );
        assert!(
            tantivy
                .query("resume reunion", 20, false)
                .expect("query folded accents")
                .iter()
                .any(|hit| hit.name.starts_with("R\u{e9}sum\u{e9}"))
        );

        for query in QUERIES {
            group.bench_with_input(
                BenchmarkId::new(format!("nucleo/{query}"), count),
                &files,
                |b, files| {
                    let mut engine = SearchEngine::new();
                    b.iter(|| {
                        engine.search(black_box(query), black_box(files), black_box(&options))
                    })
                },
            );
            group.bench_with_input(
                BenchmarkId::new(format!("tantivy/{query}"), count),
                &tantivy,
                |b, index| {
                    b.iter(|| {
                        index
                            .query(black_box(query), black_box(20), false)
                            .expect("Tantivy query")
                    })
                },
            );
        }
    }
    group.finish();
}

#[cfg(not(feature = "tantivy-search"))]
fn bench_file_search_backends(_c: &mut Criterion) {}

criterion_group!(
    benches,
    bench_fuzzy_match,
    bench_calculate_match_score,
    bench_search_applications,
    bench_search_with_frecency,
    bench_file_search_backends,
);
criterion_main!(benches);
