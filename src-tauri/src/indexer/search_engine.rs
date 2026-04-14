//! Professional fuzzy search engine using nucleo-matcher
//!
//! This module provides a high-performance search engine for files, folders,
//! applications, and games. It uses the same fuzzy matching algorithm as
//! fzf and helix editor for optimal results.

use nucleo_matcher::{
    Config, Matcher, Utf32Str,
    pattern::{CaseMatching, Normalization, Pattern},
};
use std::cmp::Ordering;

use super::types::{FileCategory, FileInfo};

/// Search options for customizing search behavior
#[derive(Debug, Clone, Default)]
pub struct SearchOptions {
    /// Maximum number of results to return
    pub limit: Option<usize>,
    /// Filter by specific categories
    pub categories: Option<Vec<FileCategory>>,
    /// Boost score for recent files (multiplier)
    pub recency_boost: Option<f32>,
    /// Boost score for frequently accessed files
    pub frequency_boost: Option<f32>,
    /// Minimum score threshold (0-1000+)
    pub min_score: Option<u32>,
    /// Include hidden files
    pub include_hidden: bool,
    /// Match only filename (not full path)
    pub filename_only: bool,
    // --- Power-user operator filters ---
    /// Filter by file extension (e.g., "pdf")
    pub ext_filter: Option<String>,
    /// Filter by directory prefix (e.g., "/home/user/Documents")
    pub dir_filter: Option<String>,
    /// Minimum file size in bytes
    pub size_min: Option<u64>,
    /// Maximum file size in bytes
    pub size_max: Option<u64>,
    /// Only files modified after this timestamp (seconds)
    pub modified_after: Option<i64>,
    /// Only files modified before this timestamp (seconds)
    pub modified_before: Option<i64>,
}

/// A search result with scoring information
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    #[serde(flatten)]
    pub file: FileInfo,
    pub score: u32,
    pub matched_indices: Vec<u32>,
}

/// Professional fuzzy search engine
pub struct SearchEngine {
    matcher: Matcher,
}

impl Default for SearchEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl SearchEngine {
    /// Create a new search engine with optimal configuration for file paths
    pub fn new() -> Self {
        // Use path-optimized configuration
        // This gives bonuses for path separators and handles Windows/Unix paths
        let config = Config::DEFAULT.match_paths();
        Self {
            matcher: Matcher::new(config),
        }
    }

    /// Search files with advanced fuzzy matching
    pub fn search(
        &mut self,
        query: &str,
        files: &[FileInfo],
        options: &SearchOptions,
    ) -> Vec<SearchResult> {
        if query.trim().is_empty() {
            return Vec::new();
        }

        // Parse the query pattern with smart case matching
        // - If query has uppercase letters, match case-sensitively
        // - Otherwise, ignore case
        let pattern = Pattern::parse(query, CaseMatching::Smart, Normalization::Smart);

        let mut results: Vec<SearchResult> = files
            .iter()
            .filter(|file| {
                // Category filter
                if let Some(ref categories) = options.categories
                    && !categories.contains(&file.category)
                {
                    return false;
                }

                // Hidden file filter
                if !options.include_hidden && file.name.starts_with('.') {
                    return false;
                }

                // Extension filter (e.g., ext:pdf)
                if let Some(ref ext) = options.ext_filter {
                    if !file.extension.eq_ignore_ascii_case(ext) {
                        return false;
                    }
                }

                // Directory filter (e.g., in:~/Documents)
                if let Some(ref dir) = options.dir_filter {
                    if !file.path.starts_with(dir.as_str()) {
                        return false;
                    }
                }

                // Size filters
                if let Some(min) = options.size_min {
                    if file.size < min {
                        return false;
                    }
                }
                if let Some(max) = options.size_max {
                    if file.size > max {
                        return false;
                    }
                }

                // Modified time filters
                if let Some(after) = options.modified_after {
                    if file.modified < after {
                        return false;
                    }
                }
                if let Some(before) = options.modified_before {
                    if file.modified > before {
                        return false;
                    }
                }

                true
            })
            .filter_map(|file| {
                // Decide what to match against
                let haystack = if options.filename_only {
                    &file.name
                } else {
                    &file.path
                };

                // Convert to Utf32Str for nucleo
                let haystack_utf32: Vec<char> = haystack.chars().collect();
                let haystack_str = Utf32Str::Unicode(&haystack_utf32);

                // Get the base score from nucleo matcher
                let base_score = pattern.score(haystack_str, &mut self.matcher)?;

                // Apply category-specific boosts
                let category_boost = self.get_category_boost(&file.category);

                // Apply recency boost if configured
                let recency_multiplier = if let Some(boost) = options.recency_boost {
                    self.calculate_recency_boost(file.modified, boost)
                } else {
                    1.0
                };

                // Apply frequency boost for executables and applications
                let frequency_multiplier = if options.frequency_boost.is_some()
                    && matches!(
                        file.category,
                        FileCategory::Application | FileCategory::Game
                    ) {
                    1.2 // Slight boost for apps and games
                } else {
                    1.0
                };

                // Calculate final score
                let final_score = ((base_score as f32)
                    * category_boost
                    * recency_multiplier
                    * frequency_multiplier) as u32;

                // Apply minimum score threshold
                if let Some(min_score) = options.min_score
                    && final_score < min_score
                {
                    return None;
                }

                Some(SearchResult {
                    file: file.clone(),
                    score: final_score,
                    matched_indices: Vec::new(), // We could compute indices if needed for highlighting
                })
            })
            .collect();

        // Sort by score (descending), then by name (ascending) for ties
        results.sort_by(|a, b| match b.score.cmp(&a.score) {
            Ordering::Equal => a.file.name.cmp(&b.file.name),
            other => other,
        });

        // Apply limit
        if let Some(limit) = options.limit {
            results.truncate(limit);
        }

        results
    }

    /// Search with matched indices for highlighting
    pub fn search_with_indices(
        &mut self,
        query: &str,
        files: &[FileInfo],
        options: &SearchOptions,
    ) -> Vec<SearchResult> {
        if query.trim().is_empty() {
            return Vec::new();
        }

        let pattern = Pattern::parse(query, CaseMatching::Smart, Normalization::Smart);

        let mut results: Vec<SearchResult> = files
            .iter()
            .filter(|file| {
                if let Some(ref categories) = options.categories
                    && !categories.contains(&file.category)
                {
                    return false;
                }
                if !options.include_hidden && file.name.starts_with('.') {
                    return false;
                }
                true
            })
            .filter_map(|file| {
                let haystack = if options.filename_only {
                    &file.name
                } else {
                    &file.path
                };

                let haystack_utf32: Vec<char> = haystack.chars().collect();
                let haystack_str = Utf32Str::Unicode(&haystack_utf32);

                // Get score with indices
                let mut indices = Vec::new();
                let base_score = pattern.indices(haystack_str, &mut self.matcher, &mut indices)?;

                let category_boost = self.get_category_boost(&file.category);
                let final_score = ((base_score as f32) * category_boost) as u32;

                if let Some(min_score) = options.min_score
                    && final_score < min_score
                {
                    return None;
                }

                Some(SearchResult {
                    file: file.clone(),
                    score: final_score,
                    matched_indices: indices,
                })
            })
            .collect();

        results.sort_by(|a, b| match b.score.cmp(&a.score) {
            Ordering::Equal => a.file.name.cmp(&b.file.name),
            other => other,
        });

        if let Some(limit) = options.limit {
            results.truncate(limit);
        }

        results
    }

    /// Get category-based score boost
    fn get_category_boost(&self, category: &FileCategory) -> f32 {
        match category {
            // Applications and games get highest boost
            FileCategory::Application => 1.5,
            FileCategory::Game => 1.4,
            // Executables also get a boost
            FileCategory::Executable => 1.3,
            // Folders slightly above regular files
            FileCategory::Folder => 1.1,
            // Regular files
            FileCategory::Document => 1.0,
            FileCategory::Image => 1.0,
            FileCategory::Video => 1.0,
            FileCategory::Audio => 1.0,
            FileCategory::Archive => 0.9,
            FileCategory::Code => 1.0,
            FileCategory::Other => 0.8,
        }
    }

    /// Calculate recency boost based on modification time
    fn calculate_recency_boost(&self, modified: i64, boost_factor: f32) -> f32 {
        let now = chrono::Utc::now().timestamp();
        let age_seconds = (now - modified).max(0);
        let age_days = age_seconds as f32 / 86400.0;

        // Exponential decay: files modified today get full boost,
        // files from a week ago get ~50% boost, files from a month ago get minimal boost
        let decay = (-age_days / 7.0).exp();
        1.0 + (boost_factor - 1.0) * decay
    }
}

/// Quick search function for backwards compatibility
pub fn search_files_advanced(
    query: &str,
    files: &[FileInfo],
    limit: Option<usize>,
) -> Vec<FileInfo> {
    let mut engine = SearchEngine::new();
    let options = SearchOptions {
        limit,
        include_hidden: false,
        ..Default::default()
    };

    engine
        .search(query, files, &options)
        .into_iter()
        .map(|r| r.file)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_file(name: &str, path: &str, category: FileCategory) -> FileInfo {
        FileInfo {
            id: crate::utils::hash_id(path),
            name: name.to_string(),
            path: path.to_string(),
            extension: name.rsplit('.').next().unwrap_or("").to_string(),
            size: 1000,
            modified: chrono::Utc::now().timestamp(),
            created: None,
            accessed: None,
            icon: None,
            category,
        }
    }

    #[test]
    fn test_exact_match_scores_highest() {
        let mut engine = SearchEngine::new();
        let files = vec![
            create_test_file(
                "firefox.exe",
                "C:\\Programs\\firefox.exe",
                FileCategory::Application,
            ),
            create_test_file(
                "firefox_backup.exe",
                "C:\\Programs\\firefox_backup.exe",
                FileCategory::Application,
            ),
            create_test_file("firefoxdata", "C:\\Data\\firefoxdata", FileCategory::Folder),
        ];

        let results = engine.search("firefox", &files, &SearchOptions::default());

        assert!(!results.is_empty());
        // Exact match should score highest
        assert!(results[0].file.name.to_lowercase() == "firefox.exe");
    }

    #[test]
    fn test_category_filtering() {
        let mut engine = SearchEngine::new();
        let files = vec![
            create_test_file("game.exe", "C:\\Games\\game.exe", FileCategory::Game),
            create_test_file("game.txt", "C:\\Docs\\game.txt", FileCategory::Document),
        ];

        let options = SearchOptions {
            categories: Some(vec![FileCategory::Game]),
            ..Default::default()
        };

        let results = engine.search("game", &files, &options);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].file.category, FileCategory::Game);
    }

    #[test]
    fn test_fuzzy_matching() {
        let mut engine = SearchEngine::new();
        let files = vec![create_test_file(
            "Battlefield 6.exe",
            "C:\\Games\\Battlefield 6.exe",
            FileCategory::Game,
        )];

        // Should match with typo or partial
        let results = engine.search("btfld", &files, &SearchOptions::default());
        assert!(!results.is_empty());

        let results = engine.search("bf6", &files, &SearchOptions::default());
        assert!(!results.is_empty());
    }

    #[test]
    fn test_empty_query_returns_no_results() {
        let mut engine = SearchEngine::new();
        let files = vec![create_test_file(
            "test.txt",
            "/tmp/test.txt",
            FileCategory::Document,
        )];

        let results = engine.search("", &files, &SearchOptions::default());
        assert!(results.is_empty());

        let results = engine.search("   ", &files, &SearchOptions::default());
        assert!(results.is_empty());
    }

    #[test]
    fn test_empty_files_returns_no_results() {
        let mut engine = SearchEngine::new();
        let results = engine.search("anything", &[], &SearchOptions::default());
        assert!(results.is_empty());
    }

    #[test]
    fn test_special_characters_in_query() {
        let mut engine = SearchEngine::new();
        let files = vec![
            create_test_file(
                "my file (copy).txt",
                "/tmp/my file (copy).txt",
                FileCategory::Document,
            ),
            create_test_file("plain.txt", "/tmp/plain.txt", FileCategory::Document),
        ];

        // Special chars should not panic the engine
        let results = engine.search("(copy)", &files, &SearchOptions::default());
        assert!(!results.is_empty());
    }

    #[test]
    fn test_unicode_query() {
        let mut engine = SearchEngine::new();
        let files = vec![create_test_file(
            "résumé.pdf",
            "/tmp/résumé.pdf",
            FileCategory::Document,
        )];
        let results = engine.search("résumé", &files, &SearchOptions::default());
        assert!(!results.is_empty());
    }

    #[test]
    fn test_limit_truncates_results() {
        let mut engine = SearchEngine::new();
        let files: Vec<FileInfo> = (0..50)
            .map(|i| {
                create_test_file(
                    &format!("test{}.txt", i),
                    &format!("/tmp/test{}.txt", i),
                    FileCategory::Document,
                )
            })
            .collect();

        let options = SearchOptions {
            limit: Some(5),
            ..Default::default()
        };
        let results = engine.search("test", &files, &options);
        assert!(results.len() <= 5);
    }

    #[test]
    fn test_min_score_filtering() {
        let mut engine = SearchEngine::new();
        let files = vec![
            create_test_file("xyz", "/tmp/xyz", FileCategory::Document),
            create_test_file("hello", "/tmp/hello", FileCategory::Document),
        ];

        let options = SearchOptions {
            min_score: Some(u32::MAX),
            ..Default::default()
        };
        let results = engine.search("hello", &files, &options);
        assert!(results.is_empty());
    }

    #[test]
    fn test_hidden_files_excluded_by_default() {
        let mut engine = SearchEngine::new();
        let files = vec![
            create_test_file(".hidden", "/tmp/.hidden", FileCategory::Document),
            create_test_file("visible", "/tmp/visible", FileCategory::Document),
        ];

        let results = engine.search("hidden", &files, &SearchOptions::default());
        assert!(results.iter().all(|r| !r.file.name.starts_with('.')));
    }

    #[test]
    fn test_hidden_files_included_when_flag_set() {
        let mut engine = SearchEngine::new();
        let files = vec![create_test_file(
            ".bashrc",
            "/home/user/.bashrc",
            FileCategory::Document,
        )];

        let options = SearchOptions {
            include_hidden: true,
            ..Default::default()
        };
        let results = engine.search("bashrc", &files, &options);
        assert!(!results.is_empty());
    }

    #[test]
    fn test_filename_only_mode() {
        let mut engine = SearchEngine::new();
        let files = vec![create_test_file(
            "foo.txt",
            "/very/deep/path/foo.txt",
            FileCategory::Document,
        )];

        let options = SearchOptions {
            filename_only: true,
            ..Default::default()
        };
        // Should still find by filename
        let results = engine.search("foo", &files, &options);
        assert!(!results.is_empty());
    }

    #[test]
    fn test_large_dataset_performance() {
        let mut engine = SearchEngine::new();
        let files: Vec<FileInfo> = (0..5000)
            .map(|i| {
                create_test_file(
                    &format!("file_{}.dat", i),
                    &format!("/data/file_{}.dat", i),
                    FileCategory::Document,
                )
            })
            .collect();

        let start = std::time::Instant::now();
        let results = engine.search("file_42", &files, &SearchOptions::default());
        let elapsed = start.elapsed();

        assert!(!results.is_empty());
        // Searching 5k items should be well under 1s
        assert!(elapsed.as_millis() < 1000, "search took {:?}", elapsed);
    }

    #[test]
    fn test_results_sorted_descending() {
        let mut engine = SearchEngine::new();
        let files = vec![
            create_test_file("xyz_test", "/tmp/xyz_test", FileCategory::Document),
            create_test_file("test", "/tmp/test", FileCategory::Document),
            create_test_file("test_xyz", "/tmp/test_xyz", FileCategory::Document),
        ];

        let results = engine.search("test", &files, &SearchOptions::default());
        for window in results.windows(2) {
            assert!(window[0].score >= window[1].score);
        }
    }

    #[test]
    fn test_search_with_indices_returns_match_positions() {
        let mut engine = SearchEngine::new();
        let files = vec![create_test_file(
            "firefox.exe",
            "C:/Programs/firefox.exe",
            FileCategory::Application,
        )];

        let results = engine.search_with_indices("firefox", &files, &SearchOptions::default());
        assert!(!results.is_empty());
        assert!(!results[0].matched_indices.is_empty());
    }

    #[test]
    fn test_search_files_advanced_helper() {
        let files = vec![
            create_test_file("foo", "/tmp/foo", FileCategory::Document),
            create_test_file("bar", "/tmp/bar", FileCategory::Document),
        ];
        let results = search_files_advanced("foo", &files, Some(10));
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "foo");
    }
}
