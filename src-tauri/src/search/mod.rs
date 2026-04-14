use crate::commands::apps::AppInfo;
use crate::launcher::{LaunchRecord, QueryBindingStore};
use crate::utils::matching::calculate_match_score;

/// Calculate frecency score for a launch record.
/// Combines frequency (launch_count) with recency (time decay).
/// Half-life of 1 week (168 hours): recent items score higher.
pub fn calculate_frecency(record: &LaunchRecord) -> f64 {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let age_hours = ((now_ms - record.last_launched) as f64 / 3_600_000.0).max(0.0);
    let recency_weight = (-age_hours / 168.0).exp().max(0.2);
    record.launch_count as f64 * recency_weight
}

/// Search applications with frecency scoring from launch history.
/// Returns apps sorted by (match_score + frecency_bonus + query_binding_boost) descending.
pub fn search_applications_with_frecency(
    query: &str,
    apps: Vec<AppInfo>,
    history: &[LaunchRecord],
    query_bindings: Option<&QueryBindingStore>,
) -> Vec<(AppInfo, f32)> {
    if query.trim().is_empty() {
        return Vec::new();
    }

    // Build path→frecency lookup
    let frecency_map: std::collections::HashMap<&str, f64> = history
        .iter()
        .map(|r| (r.path.as_str(), calculate_frecency(r)))
        .collect();

    let has_history = !frecency_map.is_empty();

    let mut results: Vec<(AppInfo, f32)> = apps
        .into_iter()
        .filter_map(|app| {
            // Match against name first
            let mut match_score = calculate_match_score(&app.name, query);

            // If name doesn't match well, also try matching against path
            // This catches "vscode" matching "...\VS Code\Code.exe"
            if match_score < 50.0 {
                let path_score = calculate_match_score(&app.path, query);
                if path_score > match_score {
                    match_score = path_score * 0.9; // slightly lower than name match
                }
            }

            // Also try matching against keywords if available
            if match_score < 50.0 {
                if let Some(ref keywords) = app.keywords {
                    for kw in keywords {
                        let kw_score = calculate_match_score(kw, query);
                        if kw_score > match_score {
                            match_score = kw_score * 0.85;
                        }
                    }
                }
            }

            if match_score <= 0.0 {
                return None;
            }

            let frecency = frecency_map.get(app.path.as_str()).copied().unwrap_or(0.0);

            let mut final_score = if frecency > 0.0 {
                match_score + (frecency * 10.0).min(50.0) as f32
            } else if has_history {
                match_score * 0.7
            } else {
                match_score
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

    let mut results: Vec<(AppInfo, f32)> = apps
        .into_iter()
        .filter_map(|app| {
            let score = calculate_match_score(&app.name, query);

            // Filter out non-matches (score = 0)
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
