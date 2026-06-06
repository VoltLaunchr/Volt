use crate::commands::apps::AppInfo;
use crate::launcher::QueryBindingStore;
use crate::utils::matching::calculate_match_score_with_matcher_buf;
use nucleo_matcher::{Config, Matcher};

/// Convert a stored `frecency_date` into a bounded search bonus relative to
/// `now_ms`.
///
/// `frecency_date` is pushed into the future on each launch (see
/// [`crate::launcher::LaunchRecord`]), so `frecency_date - now` is the item's
/// remaining "credit": large for recently/frequently used apps, shrinking as
/// real time advances (natural recency decay). A `ln` curve gives diminishing
/// returns and the result is capped at `+50` to keep match relevance dominant
/// — the same ceiling the previous frequency×decay formula used.
///
/// Unlike the old per-record `chrono::Utc::now()` + `exp()`, the timestamp is
/// captured **once per query** and this is a pure O(1) arithmetic transform.
fn frecency_bonus(frecency_date: i64, now_ms: i64) -> f32 {
    let credit_days = ((frecency_date - now_ms) as f64 / 86_400_000.0).max(0.0);
    ((credit_days + 1.0).ln() * 12.0).min(50.0) as f32
}

/// Search applications with frecency scoring from launch history.
/// Returns apps sorted by (match_score + frecency_bonus + query_binding_boost) descending.
///
/// `frecency` is a pre-computed `path → frecency_date` map (see
/// [`LaunchHistory::with_records`]). Taking the map instead of a
/// `&[LaunchRecord]` slice lets callers avoid cloning the entire launch
/// history on every keystroke — only the dates we actually read are
/// materialised, and presence in the map distinguishes "in history" from
/// "never launched".
pub fn search_applications_with_frecency(
    query: &str,
    apps: Vec<AppInfo>,
    frecency: &std::collections::HashMap<String, i64>,
    query_bindings: Option<&QueryBindingStore>,
) -> Vec<(AppInfo, f32)> {
    if query.trim().is_empty() {
        return Vec::new();
    }

    let has_history = !frecency.is_empty();
    // Captured once per query, not once per record (the old hot-path cost).
    let now_ms = chrono::Utc::now().timestamp_millis();

    let mut matcher = Matcher::new(Config::DEFAULT);
    // Shared scratch buffer for non-ASCII haystacks. Reusing this across every
    // scoring call inside the loop turns N allocations (one per app name +
    // each fallback haystack) into one amortised growable buffer.
    let mut char_buf: Vec<char> = Vec::new();
    let mut results: Vec<(AppInfo, f32)> = apps
        .into_iter()
        .filter_map(|app| {
            // Match against name first
            let mut match_score = calculate_match_score_with_matcher_buf(
                &app.name,
                query,
                &mut matcher,
                &mut char_buf,
            );

            // If name doesn't match well, try matching against the last two path components
            // (parent dir + filename). Using the full path causes false positives because
            // common prefixes like "...\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\"
            // contain the letters r-o-a-d-m-a-p in order, making every Start Menu app
            // fuzzy-match the query "roadmap".
            if match_score < 50.0 {
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
                let path_score = calculate_match_score_with_matcher_buf(
                    &short_path,
                    query,
                    &mut matcher,
                    &mut char_buf,
                );
                if path_score > match_score {
                    match_score = path_score * 0.9; // slightly lower than name match
                }
            }

            // Also try matching against keywords if available
            if match_score < 50.0
                && let Some(ref keywords) = app.keywords
            {
                for kw in keywords {
                    let kw_score = calculate_match_score_with_matcher_buf(
                        kw,
                        query,
                        &mut matcher,
                        &mut char_buf,
                    );
                    if kw_score > match_score {
                        match_score = kw_score * 0.85;
                    }
                }
            }

            if match_score <= 0.0 {
                return None;
            }

            // Presence in the map means the app is in launch history. Used apps
            // get a bounded recency/frequency boost; apps the user has never
            // launched are slightly penalised once any history exists so used
            // apps float up.
            let mut final_score = match frecency.get(app.path.as_str()) {
                Some(&frecency_date) => match_score + frecency_bonus(frecency_date, now_ms),
                None if has_history => match_score * 0.7,
                None => match_score,
            };

            // Apply query-result binding boost (up to +30 pts)
            if let Some(bindings) = query_bindings {
                final_score += bindings.get_boost(query, &app.path);
            }

            Some((app, final_score))
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

    #[test]
    fn test_frecency_bonus_is_bounded_and_monotonic() {
        let now = 1_000_000_000_000;
        let day = 86_400_000;
        // Stale (date in the past) → no bonus.
        assert_eq!(frecency_bonus(now - day, now), 0.0);
        assert_eq!(frecency_bonus(now, now), 0.0);
        // More credit (further future) → larger bonus.
        let one = frecency_bonus(now + day, now);
        let five = frecency_bonus(now + 5 * day, now);
        assert!(one > 0.0);
        assert!(five > one);
        // Saturates at the +50 ceiling for very large credit.
        assert!(frecency_bonus(now + 10_000 * day, now) <= 50.0);
        assert!(frecency_bonus(now + 10_000 * day, now) > 45.0);
    }

    #[test]
    fn test_used_app_outranks_never_launched_app() {
        let apps = vec![
            create_test_app("Chrome", "/c/chrome"),
            create_test_app("Chrome Canary", "/c/canary"),
        ];
        let now = chrono::Utc::now().timestamp_millis();
        // Only Chrome is in history, credited well into the future.
        let mut frecency = std::collections::HashMap::new();
        frecency.insert("/c/chrome".to_string(), now + 30 * 86_400_000);

        let results = search_applications_with_frecency("chrome", apps, &frecency, None);
        assert_eq!(results[0].0.path, "/c/chrome", "used app should rank first");
    }

    #[test]
    fn test_empty_query_returns_nothing() {
        let frecency = std::collections::HashMap::new();
        let results = search_applications_with_frecency(
            "",
            vec![create_test_app("A", "/a")],
            &frecency,
            None,
        );
        assert!(results.is_empty());
    }
}
