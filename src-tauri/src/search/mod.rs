use crate::commands::apps::AppInfo;
use crate::launcher::{LaunchRecord, QueryBindingStore};
use crate::utils::matching::calculate_match_score_with_matcher_buf;
use nucleo_matcher::{Config, Matcher};

// ============================================================================
// Score tiers — strict cascade, Raycast-style
// ============================================================================
//
// Each tier owns a distinct numeric range so that no amount of frecency or
// query-binding boost can lift a result from a lower tier above the floor of a
// higher tier. The gap between adjacent tiers is exactly 50, and the two
// available tie-breaker boosts (frecency +20, binding +15) sum to 35 — well
// under the 50-pt safety margin.
//
//   alias-exact   : 1000          — alias is the exact query (case-insensitive)
//   name-exact    :  950          — name is the exact query
//   alias-prefix  :  900          — alias starts with query
//   name-prefix   :  850          — name starts with query
//   name-fuzzy    :  500..=849    — nucleo fuzzy on name
//   secondary     :  200..=499    — fuzzy on keywords or short path
//   no match      :    0          — filtered out
//
// Frecency and binding boosts are added on top as intra-tier tie-breakers.

pub const TIER_ALIAS_EXACT: f32 = 1000.0;
pub const TIER_NAME_EXACT: f32 = 950.0;
pub const TIER_ALIAS_PREFIX: f32 = 900.0;
pub const TIER_NAME_PREFIX: f32 = 850.0;
pub const TIER_FUZZY_MIN: f32 = 500.0;
pub const TIER_FUZZY_MAX: f32 = 849.0;
pub const TIER_SECONDARY_MIN: f32 = 200.0;
pub const TIER_SECONDARY_MAX: f32 = 499.0;

const MAX_FRECENCY_BOOST: f32 = 20.0;
const MAX_BINDING_BOOST: f32 = 15.0;

/// Map a raw `calculate_match_score` value (0/50-89/90/100) onto the cascade tier ranges.
/// Returns `None` if the raw score is below the fuzzy floor (no usable match).
fn map_to_name_tier(raw: f32) -> Option<f32> {
    if raw <= 0.0 {
        return None;
    }
    if (raw - 100.0).abs() < f32::EPSILON {
        return Some(TIER_NAME_EXACT);
    }
    if (raw - 90.0).abs() < f32::EPSILON {
        return Some(TIER_NAME_PREFIX);
    }
    if (50.0..=89.0).contains(&raw) {
        // raw ∈ [50, 89] → [TIER_FUZZY_MIN, TIER_FUZZY_MAX] (linear remap)
        let t = (raw - 50.0) / (89.0 - 50.0);
        return Some(TIER_FUZZY_MIN + t * (TIER_FUZZY_MAX - TIER_FUZZY_MIN));
    }
    None
}

/// Map a raw match score on a *secondary* field (keyword, short path) to the
/// secondary tier range. We collapse exact/prefix/fuzzy on secondary fields
/// into one tier because a perfect keyword match should still rank below a
/// fuzzy name match.
fn map_to_secondary_tier(raw: f32) -> Option<f32> {
    if raw <= 0.0 {
        return None;
    }
    // Re-clamp into a 0-100 effective range, then linearly remap to secondary tier.
    let clamped = raw.clamp(50.0, 100.0);
    let t = (clamped - 50.0) / (100.0 - 50.0);
    Some(TIER_SECONDARY_MIN + t * (TIER_SECONDARY_MAX - TIER_SECONDARY_MIN))
}

/// Calculate frecency score for a launch record.
/// Combines frequency (launch_count) with recency (time decay).
/// Half-life of 1 week (168 hours): recent items score higher.
pub fn calculate_frecency(record: &LaunchRecord) -> f64 {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let age_hours = ((now_ms - record.last_launched) as f64 / 3_600_000.0).max(0.0);
    let recency_weight = (-age_hours / 168.0).exp().max(0.2);
    record.launch_count as f64 * recency_weight
}

/// Search applications with cascade-tier scoring + per-(query, item) frecency tie-breaker.
///
/// Ranking is a strict cascade — no amount of frecency or binding boost can lift a
/// result across a tier boundary. See the tier constants at the top of this file.
///
/// `aliases` is a path → alias map (`AppShortcut.alias` from settings). Pass an empty
/// map if no aliases are configured.
pub fn search_applications_with_frecency(
    query: &str,
    apps: Vec<AppInfo>,
    history: &[LaunchRecord],
    query_bindings: Option<&QueryBindingStore>,
    aliases: &std::collections::HashMap<String, String>,
) -> Vec<(AppInfo, f32)> {
    if query.trim().is_empty() {
        return Vec::new();
    }
    let query_trim = query.trim();

    // Build path→frecency lookup
    let frecency_map: std::collections::HashMap<&str, f64> = history
        .iter()
        .map(|r| (r.path.as_str(), calculate_frecency(r)))
        .collect();

    let mut matcher = Matcher::new(Config::DEFAULT);
    // Shared scratch buffer for non-ASCII haystacks. Reusing this across every
    // scoring call inside the loop turns N allocations into one amortised buffer.
    let mut char_buf: Vec<char> = Vec::new();
    let mut results: Vec<(AppInfo, f32)> = apps
        .into_iter()
        .filter_map(|app| {
            // ----- Tier resolution (strict cascade) -----

            // 1. Alias tier — only if the app has an alias configured.
            let alias_tier = aliases.get(app.path.as_str()).and_then(|alias| {
                let alias_lc = alias.trim().to_lowercase();
                let q_lc = query_trim.to_lowercase();
                if alias_lc.is_empty() {
                    None
                } else if alias_lc == q_lc {
                    Some(TIER_ALIAS_EXACT)
                } else if alias_lc.starts_with(&q_lc) {
                    Some(TIER_ALIAS_PREFIX)
                } else {
                    None
                }
            });

            // 2. Name tier — exact / prefix / fuzzy on `app.name`.
            let name_tier = if alias_tier.is_some() {
                None
            } else {
                let raw = calculate_match_score_with_matcher_buf(
                    &app.name,
                    query_trim,
                    &mut matcher,
                    &mut char_buf,
                );
                map_to_name_tier(raw)
            };

            // 3. Secondary tier — short path (parent + filename) or keywords.
            //    Only consulted if no name-tier match.
            let secondary_tier = if alias_tier.is_some() || name_tier.is_some() {
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
                map_to_secondary_tier(best)
            };

            let base = alias_tier.or(name_tier).or(secondary_tier)?;

            // ----- Tie-breakers (cannot cross tier boundary; max +35) -----
            let frecency = frecency_map.get(app.path.as_str()).copied().unwrap_or(0.0);
            let frecency_bonus = ((frecency * 2.0) as f32).min(MAX_FRECENCY_BOOST);

            let binding_bonus = query_bindings
                .map(|b| b.get_boost(query_trim, &app.path).min(MAX_BINDING_BOOST))
                .unwrap_or(0.0);

            Some((app, base + frecency_bonus + binding_bonus))
        })
        .collect();

    results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    results
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
}
