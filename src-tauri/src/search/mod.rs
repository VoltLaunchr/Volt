use crate::commands::apps::AppInfo;
use crate::utils::matching::calculate_match_score;

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
            id: format!("{:x}", md5::compute(path.as_bytes())),
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
