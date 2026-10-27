pub mod tiers;

pub use tiers::{LearnedMatch, SearchTier};

use crate::commands::apps::AppInfo;
use crate::launcher::QueryBindingStore;
use crate::utils::matching::{calculate_match_score_with_matcher_buf, nucleo_score_to_match_score};
use nucleo_matcher::{Config, Matcher};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Search sensitivity (Settings → General → Search Sensitivity)
// ============================================================================

/// How permissive fuzzy matching is. Mirrors the frontend `SearchSensitivity`
/// (`'low' | 'medium' | 'high'`) and keeps Volt's UI meaning:
///
/// - `Low` (strict): alias tiers + name exact / starts-with only. Fuzzy name
///   matches and secondary (path / keyword) matches are dropped.
/// - `Medium` (balanced, default): fuzzy matches must reach a minimum quality
///   that scales with the query length (see [`MEDIUM_MIN_FUZZY_SCORE_PER_CHAR`]),
///   and secondary matches are only considered for queries of at least
///   [`MEDIUM_SECONDARY_MIN_QUERY_CHARS`] characters.
/// - `High` (permissive): every match is kept.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "SearchSensitivity.ts")]
pub enum SearchSensitivity {
    Low,
    #[default]
    Medium,
    High,
}

/// Minimum *raw nucleo* fuzzy score per (non-whitespace) query character for a
/// fuzzy match to survive at `Medium` sensitivity.
///
/// Inspired by Raycast's length-scaled rule (`score >= 1.5 * (len - 2) + 4` on
/// its own scale). nucleo awards 16 per matched char plus boundary /
/// consecutive bonuses minus gap penalties, so contiguous or word-start matches
/// land around 25-31 per char, acronyms ("vsc", "pwsh", "dscrd") around 20-25,
/// and scattered matches ("code" in "Office Document Imaging", "spot" in
/// "Microsoft Photos", "reg" in "Microsoft Edge") around 14-19. 20/char keeps
/// the first two groups and drops the last.
pub const MEDIUM_MIN_FUZZY_SCORE_PER_CHAR: u32 = 20;

/// Secondary (path / keyword) matches are ignored at `Medium` for shorter
/// queries: one or two letters fuzzy-match almost any install path.
pub const MEDIUM_SECONDARY_MIN_QUERY_CHARS: usize = 3;

/// Query length used by the sensitivity rules (whitespace is not scored by nucleo).
fn query_char_count(query: &str) -> usize {
    query.chars().filter(|c| !c.is_whitespace()).count()
}

/// Minimum mapped (50-89) fuzzy score accepted at `Medium` for this query.
/// The raw threshold is converted with the same monotonic mapping used by the
/// matcher, so `mapped >= min` is equivalent to `raw >= raw_min`.
fn medium_min_fuzzy_match_score(query_chars: usize) -> f32 {
    let chars = u32::try_from(query_chars).unwrap_or(u32::MAX);
    nucleo_score_to_match_score(MEDIUM_MIN_FUZZY_SCORE_PER_CHAR.saturating_mul(chars))
}

/// Pre-computed sensitivity rules for one query.
#[derive(Debug, Clone, Copy)]
struct SensitivityRules {
    sensitivity: SearchSensitivity,
    query_chars: usize,
    medium_min_fuzzy: f32,
}

impl SensitivityRules {
    fn new(sensitivity: SearchSensitivity, query: &str) -> Self {
        let query_chars = query_char_count(query);
        Self {
            sensitivity,
            query_chars,
            medium_min_fuzzy: medium_min_fuzzy_match_score(query_chars),
        }
    }

    /// Whether a fuzzy (50-89 mapped, i.e. not exact / prefix) match is kept.
    fn accepts_fuzzy(&self, mapped: f32) -> bool {
        match self.sensitivity {
            SearchSensitivity::Low => false,
            SearchSensitivity::Medium => mapped >= self.medium_min_fuzzy,
            SearchSensitivity::High => true,
        }
    }

    /// Whether secondary matches (app path / keywords, file path-only) are considered at all.
    fn allows_secondary(&self) -> bool {
        match self.sensitivity {
            SearchSensitivity::Low => false,
            SearchSensitivity::Medium => self.query_chars >= MEDIUM_SECONDARY_MIN_QUERY_CHARS,
            SearchSensitivity::High => true,
        }
    }

    /// Whether a raw `calculate_match_score` value (0 / 50-89 / 90 / 100) is kept.
    fn accepts_raw(&self, raw: f32) -> bool {
        if raw >= 90.0 {
            true
        } else if raw > 0.0 {
            self.accepts_fuzzy(raw)
        } else {
            false
        }
    }
}

// ============================================================================
// Application ranking — strict tier cascade, Raycast-style
// ============================================================================
//
// Each application gets a [`SearchTier`] plus a match quality (the raw
// `calculate_match_score` value, 0-100). Results are ordered by
//
//   tier (strongest first) > quality > frecency_date > name
//
// so frecency only ever breaks ties *within* a tier and a quality level, and
// learned query bindings are tiers of their own (`learnedExact`,
// `aliasPrefix`) instead of additive boosts. The frontend applies the same
// comparator to every command-like result (`src/app/searchRanking.ts`).

/// Ranking signals of one application match, sent to the frontend as-is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AppRank {
    pub tier: SearchTier,
    /// Raw match quality: 100 exact, 90 prefix, 50-89 fuzzy (alias tiers: 100).
    pub quality: u8,
    /// `LaunchRecord::frecency_date` (ms), `0` when never launched.
    pub frecency: i64,
}

/// Total order shared with the frontend comparator (minus the cross-source
/// keys): strongest tier, then quality, then frecency, then name.
fn compare_ranked_apps(a: &(AppInfo, AppRank), b: &(AppInfo, AppRank)) -> std::cmp::Ordering {
    a.1.tier
        .cmp(&b.1.tier)
        .then_with(|| b.1.quality.cmp(&a.1.quality))
        .then_with(|| b.1.frecency.cmp(&a.1.frecency))
        .then_with(|| a.0.name.to_lowercase().cmp(&b.0.name.to_lowercase()))
}

/// Quantise a raw 0-100 match score. Rounding to whole points makes equally
/// good fuzzy matches tie, so frecency can break the tie.
fn quality_of(raw: f32) -> u8 {
    raw.round().clamp(0.0, 100.0) as u8
}

/// Name tier for a raw `calculate_match_score` value (0 / 50-89 / 90 / 100).
fn name_tier(raw: f32) -> Option<SearchTier> {
    if raw >= 100.0 {
        Some(SearchTier::TitleExact)
    } else if raw >= 90.0 {
        Some(SearchTier::TitlePrefix)
    } else if raw >= 50.0 {
        Some(SearchTier::Fuzzy)
    } else {
        None
    }
}

/// Search applications with tier cascade ranking.
///
/// - `frecency`: `path → frecency_date` of application records
///   ([`crate::launcher::LaunchHistory::app_frecency`]).
/// - `query_bindings`: learned query → result selections; promote an app that
///   already matched to `learnedExact` / `aliasPrefix` (see
///   [`QueryBindingStore::learned_tier`]).
/// - `aliases`: `path → alias` (`AppShortcut.alias` from settings).
/// - `sensitivity`: filters which tiers survive (see [`SearchSensitivity`]);
///   alias and name exact / prefix tiers are always kept.
pub fn search_applications_with_frecency(
    query: &str,
    apps: Vec<AppInfo>,
    frecency: &std::collections::HashMap<String, i64>,
    query_bindings: Option<&QueryBindingStore>,
    aliases: &std::collections::HashMap<String, String>,
    sensitivity: SearchSensitivity,
) -> Vec<(AppInfo, AppRank)> {
    if query.trim().is_empty() {
        return Vec::new();
    }
    let query_trim = query.trim();
    let query_lc = query_trim.to_lowercase();
    let rules = SensitivityRules::new(sensitivity, query_trim);

    let now_ms = chrono::Utc::now().timestamp_millis();

    let mut matcher = Matcher::new(Config::DEFAULT);
    // Shared scratch buffer for non-ASCII haystacks. Reusing this across every
    // scoring call inside the loop turns N allocations into one amortised buffer.
    let mut char_buf: Vec<char> = Vec::new();
    let mut results: Vec<(AppInfo, AppRank)> = apps
        .into_iter()
        .filter_map(|app| {
            // ----- Tier resolution (strict cascade) -----

            // 1. Alias tier — only if the app has an alias configured.
            let alias_match = aliases.get(app.path.as_str()).and_then(|alias| {
                let alias_lc = alias.trim().to_lowercase();
                if alias_lc.is_empty() {
                    None
                } else if alias_lc == query_lc {
                    Some((SearchTier::AliasExact, 100))
                } else if alias_lc.starts_with(&query_lc) {
                    Some((SearchTier::AliasPrefix, 100))
                } else {
                    None
                }
            });

            // 2. Name tier — exact / prefix / fuzzy on `app.name`.
            let name_match = if alias_match.is_some() {
                None
            } else {
                let raw = calculate_match_score_with_matcher_buf(
                    &app.name,
                    query_trim,
                    &mut matcher,
                    &mut char_buf,
                );
                // A name match below the sensitivity floor is discarded, which
                // lets the app still qualify through the secondary tier below.
                if rules.accepts_raw(raw) {
                    name_tier(raw).map(|tier| (tier, quality_of(raw)))
                } else {
                    None
                }
            };

            // 3. Secondary tier — short path (parent + filename) or keywords.
            //    Only consulted if no name-tier match and the sensitivity allows it.
            let secondary_match =
                if alias_match.is_some() || name_match.is_some() || !rules.allows_secondary() {
                    None
                } else {
                    // Short path = "<parent> <filename>". Using the full path causes
                    // false positives because common prefixes like
                    // "...\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\"
                    // contain enough letters in order to fuzzy-match almost any query.
                    let path = std::path::Path::new(&app.path);
                    let filename = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                    let parent_name = path
                        .parent()
                        .and_then(|p| p.file_name())
                        .and_then(|s| s.to_str())
                        .unwrap_or("");
                    let short_path = if parent_name.is_empty() {
                        filename.to_string()
                    } else {
                        format!("{} {}", parent_name, filename)
                    };
                    let mut best = calculate_match_score_with_matcher_buf(
                        &short_path,
                        query_trim,
                        &mut matcher,
                        &mut char_buf,
                    );

                    if let Some(ref keywords) = app.keywords {
                        for kw in keywords {
                            let kw_score = calculate_match_score_with_matcher_buf(
                                kw,
                                query_trim,
                                &mut matcher,
                                &mut char_buf,
                            );
                            if kw_score > best {
                                best = kw_score;
                            }
                        }
                    }
                    if rules.accepts_raw(best) {
                        Some((SearchTier::Secondary, quality_of(best)))
                    } else {
                        None
                    }
                };

            let (matched_tier, quality) = alias_match.or(name_match).or(secondary_match)?;

            // ----- Learned query binding: a tier of its own, never a boost -----
            let tier = query_bindings
                .and_then(|b| b.learned_tier(query_trim, &app.path, now_ms))
                .map_or(matched_tier, |learned| learned.strongest(matched_tier));

            let frecency = frecency.get(app.path.as_str()).copied().unwrap_or(0);

            Some((
                app,
                AppRank {
                    tier,
                    quality,
                    frecency,
                },
            ))
        })
        .collect();

    results.sort_by(compare_ranked_apps);

    results
}

// ============================================================================
// File relevance — absolute, query-relative file tiers on the shared ladder
// ============================================================================
//
// File scores used to be normalised against the best file of each batch in the
// frontend, so a weak best match always looked perfect and an exact filename
// could never beat an app matched only on its install path. Files are scored
// here, from the filename alone, on the shared tier ladder:
//
//   fileExact    — name or stem equals the query  (above fuzzy apps)
//   filePrefix   — name starts with the query     (above path / keyword apps)
//   fileFuzzy    — fuzzy name match               (below every app match)
//   filePathOnly — matched outside the name       (lowest)
//
// Within a tier the match quality orders fuzzy files; the engine order is kept
// otherwise (stable sort).

/// Tier and quality of one file match.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileRank {
    pub tier: SearchTier,
    /// Raw filename match quality (100 exact, 90 prefix, 50-89 fuzzy, 0 path-only).
    pub quality: u8,
}

/// Scores file results on the shared tier ladder for one query, applying the
/// same [`SearchSensitivity`] rules as the app ranker.
pub struct FileRelevanceScorer {
    query: String,
    query_lc: String,
    /// `"<query>."` — a filename starting with it has the query as its stem.
    stem_prefix_lc: String,
    rules: SensitivityRules,
    matcher: Matcher,
    char_buf: Vec<char>,
}

impl FileRelevanceScorer {
    pub fn new(query: &str, sensitivity: SearchSensitivity) -> Self {
        let query = query.trim().to_string();
        let query_lc = query.to_lowercase();
        Self {
            stem_prefix_lc: format!("{query_lc}."),
            rules: SensitivityRules::new(sensitivity, &query),
            query,
            query_lc,
            matcher: Matcher::new(Config::DEFAULT),
            char_buf: Vec::new(),
        }
    }

    /// Rank of a file named `file_name`, or `None` when the sensitivity
    /// rejects it. An empty query keeps every file at the path-only tier
    /// (operator-only searches such as `ext:pdf`).
    pub fn score(&mut self, file_name: &str) -> Option<FileRank> {
        let path_only = FileRank {
            tier: SearchTier::FilePathOnly,
            quality: 0,
        };
        if self.query.is_empty() {
            return Some(path_only);
        }

        let name_lc = file_name.to_lowercase();
        if name_lc == self.query_lc || name_lc.starts_with(&self.stem_prefix_lc) {
            return Some(FileRank {
                tier: SearchTier::FileExact,
                quality: 100,
            });
        }

        let raw = calculate_match_score_with_matcher_buf(
            file_name,
            &self.query,
            &mut self.matcher,
            &mut self.char_buf,
        );
        let tier = if raw >= 100.0 {
            SearchTier::FileExact
        } else if raw >= 90.0 {
            SearchTier::FilePrefix
        } else if raw > 0.0 && self.rules.accepts_fuzzy(raw) {
            SearchTier::FileFuzzy
        } else if self.rules.allows_secondary() {
            // No usable filename match: the engine (path / Windows Search)
            // matched somewhere else. Lowest tier.
            return Some(path_only);
        } else {
            return None;
        };
        Some(FileRank {
            tier,
            quality: quality_of(raw),
        })
    }
}

/// Searches applications based on a query string
///
/// Returns apps sorted by relevance score (highest first)
pub fn search_applications(query: &str, apps: Vec<AppInfo>) -> Vec<AppInfo> {
    if query.trim().is_empty() {
        return Vec::new();
    }

    let mut matcher = Matcher::new(Config::DEFAULT);
    let mut char_buf: Vec<char> = Vec::new();
    let mut results: Vec<(AppInfo, f32)> = apps
        .into_iter()
        .filter_map(|app| {
            let score = calculate_match_score_with_matcher_buf(
                &app.name,
                query,
                &mut matcher,
                &mut char_buf,
            );

            if score > 0.0 {
                Some((app, score))
            } else {
                None
            }
        })
        .collect();

    // Sort by score (highest first)
    // Explicitly handle NaN values: treat them as smallest score (sort to end)
    results.sort_by(|a, b| {
        let a_score = a.1;
        let b_score = b.1;

        if a_score.is_nan() && b_score.is_nan() {
            std::cmp::Ordering::Equal
        } else if a_score.is_nan() {
            std::cmp::Ordering::Greater // a sorts after b (lower priority)
        } else if b_score.is_nan() {
            std::cmp::Ordering::Less // b sorts after a (lower priority)
        } else {
            b_score
                .partial_cmp(&a_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        }
    });

    results.into_iter().map(|(app, _)| app).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_app(name: &str, path: &str) -> AppInfo {
        AppInfo {
            id: crate::utils::hash_id(path),
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

    #[test]
    fn test_search_exact_match() {
        let apps = vec![
            create_test_app("Visual Studio Code", "/path/to/vscode"),
            create_test_app("Visual Studio", "/path/to/vs"),
            create_test_app("Code", "/path/to/code"),
        ];

        let results = search_applications("Code", apps);
        assert!(
            !results.is_empty(),
            "Expected at least one result, got none. Results: {:?}",
            results
        );
        assert_eq!(
            results[0].name, "Code",
            "Expected first result to be 'Code', got '{}'",
            results[0].name
        ); // Exact match should be first
    }

    #[test]
    fn test_search_empty_query() {
        let apps = vec![create_test_app("Test App", "/path/to/app")];
        let results = search_applications("", apps);
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_search_whitespace_query() {
        let apps = vec![create_test_app("Firefox", "/usr/bin/firefox")];
        let results = search_applications("   ", apps);
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_search_filters_zero_scores() {
        let apps = vec![
            create_test_app("Firefox", "/usr/bin/firefox"),
            create_test_app("Chrome", "/usr/bin/chrome"),
        ];
        let results = search_applications("zzznoexist", apps);
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_search_case_insensitive() {
        let apps = vec![create_test_app("Firefox", "/usr/bin/firefox")];
        let results = search_applications("FIREFOX", apps);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_search_results_sorted_descending() {
        let apps = vec![
            create_test_app("xtest", "/x"),
            create_test_app("test", "/t"),
            create_test_app("testing", "/ti"),
        ];
        let results = search_applications("test", apps);
        // exact "test" must be first
        assert_eq!(results[0].name, "test");
    }

    #[test]
    fn test_search_no_apps() {
        let results = search_applications("anything", vec![]);
        assert!(results.is_empty());
    }

    // ---- Sensitivity ----

    fn ranked_names(
        query: &str,
        apps: Vec<AppInfo>,
        aliases: &std::collections::HashMap<String, String>,
        sensitivity: SearchSensitivity,
    ) -> Vec<(String, AppRank)> {
        search_applications_with_frecency(
            query,
            apps,
            &std::collections::HashMap::new(),
            None,
            aliases,
            sensitivity,
        )
        .into_iter()
        .map(|(app, score)| (app.name, score))
        .collect()
    }

    fn names(results: &[(String, AppRank)]) -> Vec<&str> {
        results.iter().map(|(name, _)| name.as_str()).collect()
    }

    fn sensitivity_fixture() -> Vec<AppInfo> {
        let mut keyword_app = create_test_app("Microsoft Photos", "C:/Apps/Photos/photos.exe");
        keyword_app.keywords = Some(vec!["spotlight".to_string()]);
        vec![
            create_test_app("Code", "C:/Apps/Code/code.exe"),
            create_test_app("Codex CLI", "C:/Apps/Codex/codex.exe"),
            create_test_app("Visual Studio Code", "C:/Apps/VSCode/vscode.exe"),
            create_test_app(
                "Microsoft Office Document Imaging",
                "C:/Apps/Office/modi.exe",
            ),
            create_test_app("Spotify", "C:/Apps/Spotify/spotify.exe"),
            keyword_app,
            // Name never matches "code"; only the install path does.
            create_test_app("Editor", "C:/Apps/code/editor.exe"),
            create_test_app("Git Bash", "C:/Apps/Git/git-bash.exe"),
        ]
    }

    #[test]
    fn sensitivity_deserializes_from_frontend_strings() {
        let parsed: Vec<SearchSensitivity> =
            serde_json::from_str(r#"["low","medium","high"]"#).unwrap();
        assert_eq!(
            parsed,
            vec![
                SearchSensitivity::Low,
                SearchSensitivity::Medium,
                SearchSensitivity::High
            ]
        );
        assert_eq!(SearchSensitivity::default(), SearchSensitivity::Medium);
    }

    #[test]
    fn low_sensitivity_keeps_only_alias_exact_and_prefix_tiers() {
        let mut aliases = std::collections::HashMap::new();
        aliases.insert(
            "C:/Apps/Git/git-bash.exe".to_string(),
            "codegit".to_string(),
        );

        let results = ranked_names(
            "code",
            sensitivity_fixture(),
            &aliases,
            SearchSensitivity::Low,
        );

        assert_eq!(names(&results), vec!["Code", "Git Bash", "Codex CLI"]);
        assert!(
            results
                .iter()
                .all(|(_, rank)| rank.tier <= SearchTier::TitlePrefix)
        );
    }

    #[test]
    fn medium_sensitivity_drops_weak_fuzzy_but_keeps_strong_fuzzy() {
        let results = ranked_names(
            "code",
            sensitivity_fixture(),
            &std::collections::HashMap::new(),
            SearchSensitivity::Medium,
        );
        let got = names(&results);

        assert_eq!(&got[..2], &["Code", "Codex CLI"]);
        // Word-boundary substring: strong fuzzy, kept.
        assert!(got.contains(&"Visual Studio Code"));
        // Scattered c..o..d..e across words: weak fuzzy, dropped.
        assert!(!got.contains(&"Microsoft Office Document Imaging"));
        // Secondary (path) match on a 4-char query: kept, below every name match.
        let editor = results.iter().find(|(name, _)| name == "Editor").unwrap();
        assert_eq!(editor.1.tier, SearchTier::Secondary);
    }

    #[test]
    fn medium_sensitivity_skips_secondary_for_short_queries() {
        let apps = vec![
            create_test_app("Editor", "C:/Apps/qz/editor.exe"),
            create_test_app("Other", "C:/Apps/Other/other.exe"),
        ];
        let empty = std::collections::HashMap::new();

        assert!(ranked_names("qz", apps.clone(), &empty, SearchSensitivity::Medium).is_empty());
        assert_eq!(
            names(&ranked_names("qz", apps, &empty, SearchSensitivity::High)),
            vec!["Editor"]
        );
    }

    #[test]
    fn medium_weak_name_match_falls_through_to_secondary_tier() {
        let results = ranked_names(
            "spot",
            sensitivity_fixture(),
            &std::collections::HashMap::new(),
            SearchSensitivity::Medium,
        );
        assert_eq!(results[0].0, "Spotify");
        // "spot" is a weak fuzzy match on "Microsoft Photos", but its
        // "spotlight" keyword is a prefix match → secondary tier.
        let photos = results
            .iter()
            .find(|(name, _)| name == "Microsoft Photos")
            .unwrap();
        assert_eq!(photos.1.tier, SearchTier::Secondary);
    }

    #[test]
    fn high_sensitivity_keeps_every_match() {
        let empty = std::collections::HashMap::new();
        let high = ranked_names(
            "code",
            sensitivity_fixture(),
            &empty,
            SearchSensitivity::High,
        );
        let medium = ranked_names(
            "code",
            sensitivity_fixture(),
            &empty,
            SearchSensitivity::Medium,
        );

        assert!(names(&high).contains(&"Microsoft Office Document Imaging"));
        assert!(high.len() > medium.len());
        // Ordering of the shared results is unchanged — sensitivity only filters.
        let high_shared: Vec<&str> = names(&high)
            .into_iter()
            .filter(|name| names(&medium).contains(name))
            .collect();
        assert_eq!(high_shared, names(&medium));
    }

    #[test]
    fn medium_fuzzy_floor_scales_with_query_length() {
        let two = medium_min_fuzzy_match_score(2);
        let four = medium_min_fuzzy_match_score(4);
        let eight = medium_min_fuzzy_match_score(8);
        assert!(two < four && four < eight);
        assert_eq!(
            four,
            nucleo_score_to_match_score(4 * MEDIUM_MIN_FUZZY_SCORE_PER_CHAR)
        );
        // Whitespace is not scored by nucleo and does not raise the bar.
        assert_eq!(query_char_count(" vs  code "), 6);
    }

    // ---- Tier cascade, learned bindings, frecency ----

    fn rank_with(
        query: &str,
        apps: Vec<AppInfo>,
        frecency: &std::collections::HashMap<String, i64>,
        bindings: Option<&QueryBindingStore>,
    ) -> Vec<(String, AppRank)> {
        search_applications_with_frecency(
            query,
            apps,
            frecency,
            bindings,
            &std::collections::HashMap::new(),
            SearchSensitivity::Medium,
        )
        .into_iter()
        .map(|(app, rank)| (app.name, rank))
        .collect()
    }

    #[test]
    fn alias_exact_beats_name_exact() {
        let mut aliases = std::collections::HashMap::new();
        aliases.insert("C:/Apps/gh.exe".to_string(), "code".to_string());
        let results = ranked_names(
            "code",
            vec![
                create_test_app("Code", "C:/Apps/code.exe"),
                create_test_app("GitHub Desktop", "C:/Apps/gh.exe"),
            ],
            &aliases,
            SearchSensitivity::Medium,
        );
        assert_eq!(names(&results), vec!["GitHub Desktop", "Code"]);
        assert_eq!(results[0].1.tier, SearchTier::AliasExact);
        assert_eq!(results[1].1.tier, SearchTier::TitleExact);
    }

    #[test]
    fn frecency_breaks_ties_but_never_crosses_a_tier() {
        let apps = vec![
            create_test_app("Chrome", "C:/Apps/chrome.exe"),
            create_test_app("Chromium Beta", "C:/Apps/chromium.exe"),
            create_test_app("Chromium Dev", "C:/Apps/chromium-dev.exe"),
        ];
        let now = chrono::Utc::now().timestamp_millis();
        let mut frecency = std::collections::HashMap::new();
        // Heavily used, but only a prefix match for "chrome".
        frecency.insert(
            "C:/Apps/chromium-dev.exe".to_string(),
            now + 365 * 86_400_000,
        );

        let exact = rank_with("chrome", apps.clone(), &frecency, None);
        assert_eq!(exact[0].0, "Chrome");

        // "chromium" is a prefix of both Chromium apps (same tier, same
        // quality): frecency decides.
        let tie = rank_with("chromium", apps, &frecency, None);
        assert_eq!(names(&tie), vec!["Chromium Dev", "Chromium Beta"]);
        assert_eq!(tie[0].1.tier, tie[1].1.tier);
        assert!(tie[0].1.frecency > tie[1].1.frecency);
    }

    #[test]
    fn learned_exact_binding_beats_name_exact() {
        let apps = vec![
            create_test_app("Code", "C:/Apps/code.exe"),
            create_test_app("Visual Studio Code", "C:/Apps/vscode.exe"),
        ];
        let mut bindings = QueryBindingStore::default();
        bindings.record_binding("code", "C:/Apps/vscode.exe");

        let results = rank_with(
            "code",
            apps,
            &std::collections::HashMap::new(),
            Some(&bindings),
        );
        assert_eq!(names(&results), vec!["Visual Studio Code", "Code"]);
        assert_eq!(results[0].1.tier, SearchTier::LearnedExact);
    }

    #[test]
    fn learned_prefix_binding_ranks_with_alias_prefixes() {
        let apps = vec![
            create_test_app("Calendar", "C:/Apps/calendar.exe"),
            create_test_app("Calculator", "C:/Apps/calc.exe"),
        ];
        let mut bindings = QueryBindingStore::default();
        // Typed "calc" → only "ca" / "cal" are learned prefixes of it.
        bindings.record_binding("calc", "C:/Apps/calc.exe");

        let results = rank_with(
            "cal",
            apps,
            &std::collections::HashMap::new(),
            Some(&bindings),
        );
        assert_eq!(names(&results), vec!["Calculator", "Calendar"]);
        assert_eq!(results[0].1.tier, SearchTier::AliasPrefix);
        assert_eq!(results[1].1.tier, SearchTier::TitlePrefix);
    }

    #[test]
    fn learned_binding_never_surfaces_an_unmatched_app() {
        let mut bindings = QueryBindingStore::default();
        bindings.record_binding("zz", "C:/Apps/notepad.exe");
        let results = rank_with(
            "zz",
            vec![create_test_app("Notepad", "C:/Apps/notepad.exe")],
            &std::collections::HashMap::new(),
            Some(&bindings),
        );
        assert!(results.is_empty());
    }

    // ---- File relevance tiers ----

    fn file_tier(query: &str, name: &str, sensitivity: SearchSensitivity) -> Option<SearchTier> {
        FileRelevanceScorer::new(query, sensitivity)
            .score(name)
            .map(|rank| rank.tier)
    }

    #[test]
    fn file_tiers_classify_exact_stem_prefix_fuzzy_and_path_only() {
        let s = SearchSensitivity::Medium;
        assert_eq!(
            file_tier("report", "report", s),
            Some(SearchTier::FileExact)
        );
        assert_eq!(
            file_tier("Report", "report.pdf", s),
            Some(SearchTier::FileExact)
        );
        assert_eq!(
            file_tier("archive", "archive.tar.gz", s),
            Some(SearchTier::FileExact)
        );
        assert_eq!(
            file_tier("report", "report-2024.pdf", s),
            Some(SearchTier::FilePrefix)
        );
        assert_eq!(
            file_tier("report", "annual report.pdf", s),
            Some(SearchTier::FileFuzzy)
        );
        // Engine matched the path, not the filename.
        assert_eq!(
            file_tier("report", "q3.xlsx", s),
            Some(SearchTier::FilePathOnly)
        );
    }

    #[test]
    fn file_scores_are_absolute_not_batch_relative() {
        // The same weak match gets the same rank regardless of its neighbours.
        let mut scorer = FileRelevanceScorer::new("report", SearchSensitivity::High);
        let alone = scorer.score("my_reports_old.txt");
        let _ = scorer.score("report.pdf");
        assert_eq!(scorer.score("my_reports_old.txt"), alone);
        assert!(alone.unwrap().tier > SearchTier::FilePrefix);
    }

    #[test]
    fn file_sensitivity_matches_app_rules() {
        assert_eq!(
            file_tier("report", "annual report.pdf", SearchSensitivity::Low),
            None
        );
        assert_eq!(file_tier("report", "q3.xlsx", SearchSensitivity::Low), None);
        assert_eq!(
            file_tier("report", "report.pdf", SearchSensitivity::Low),
            Some(SearchTier::FileExact)
        );
        // Path-only matches need >= 3 chars at medium.
        assert_eq!(file_tier("qz", "q3.xlsx", SearchSensitivity::Medium), None);
        assert_eq!(
            file_tier("qz", "q3.xlsx", SearchSensitivity::High),
            Some(SearchTier::FilePathOnly)
        );
    }
}
