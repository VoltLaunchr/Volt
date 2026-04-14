use nucleo_matcher::{Config, Matcher, Utf32Str};
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};

/// Performs fuzzy matching - checks if all characters from pattern appear in text in order
///
/// # Examples
/// ```
/// assert!(fuzzy_match("hello world", "hlo"));
/// assert!(fuzzy_match("visual studio code", "vsc"));
/// assert!(!fuzzy_match("hello", "world"));
/// ```
pub fn fuzzy_match(text: &str, pattern: &str) -> bool {
    let mut pattern_chars = pattern.chars();
    let mut current_pattern_char = pattern_chars.next();

    for text_char in text.chars() {
        if let Some(pattern_char) = current_pattern_char {
            if text_char == pattern_char {
                current_pattern_char = pattern_chars.next();
            }
        } else {
            return true;
        }
    }

    current_pattern_char.is_none()
}

/// Calculates a match score for search results using nucleo-matcher for fuzzy scoring.
///
/// Returns a score from 0-100:
/// - 100: Exact match
/// - 90: Starts with query
/// - 50-89: nucleo fuzzy/substring score (word-boundary aware, position-sensitive)
/// - 0: No match
pub fn calculate_match_score(text: &str, query: &str) -> f32 {
    if query.is_empty() {
        // Empty query: exact match for empty text, contains-at-0 otherwise
        return if text.is_empty() { 100.0 } else { 80.0 };
    }

    let text_lower = text.to_lowercase();
    let query_lower = query.to_lowercase();

    // Fast path: exact match
    if text_lower == query_lower {
        return 100.0;
    }

    // Fast path: starts with query
    if text_lower.starts_with(&query_lower) {
        return 90.0;
    }

    // Use nucleo for everything else (contains, fuzzy, word-boundary matches)
    let pattern = Pattern::parse(&query_lower, CaseMatching::Smart, Normalization::Smart);
    let mut matcher = Matcher::new(Config::DEFAULT);

    let text_chars: Vec<char> = text.chars().collect();
    let haystack = Utf32Str::Unicode(&text_chars);

    match pattern.score(haystack, &mut matcher) {
        Some(raw_score) => {
            // Normalize nucleo scores to the 50-89 range.
            // nucleo scores vary widely; typical range for short app names is ~40-200+.
            // We use a logarithmic mapping to compress the range smoothly.
            let normalized = if raw_score == 0 {
                50.0
            } else {
                // log2-based normalization: score 1->50, ~64->56, ~200->58, ~1000->60
                // Then scale to fill 50-89 range
                let log_score = (raw_score as f32).ln();
                // ln(1)=0, ln(100)=4.6, ln(1000)=6.9, ln(10000)=9.2
                // Map ln range [0, 10] to [50, 89]
                (50.0 + log_score * (39.0 / 10.0)).min(89.0).max(50.0)
            };
            normalized
        }
        None => 0.0, // No match at all
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fuzzy_match() {
        assert!(fuzzy_match("hello world", "hlo"));
        assert!(fuzzy_match("visual studio code", "vsc"));
        assert!(!fuzzy_match("hello", "world"));
    }

    #[test]
    fn test_fuzzy_match_empty_pattern() {
        assert!(fuzzy_match("hello", ""));
        assert!(fuzzy_match("", ""));
    }

    #[test]
    fn test_fuzzy_match_pattern_longer_than_text() {
        assert!(!fuzzy_match("ab", "abc"));
    }

    #[test]
    fn test_fuzzy_match_unicode() {
        assert!(fuzzy_match("café au lait", "cal"));
        assert!(fuzzy_match("ÉLÈVE", "ÉLÈ"));
    }

    #[test]
    fn test_fuzzy_match_order_matters() {
        // pattern characters must appear in order
        assert!(!fuzzy_match("abc", "cba"));
    }

    #[test]
    fn test_calculate_match_score() {
        assert_eq!(calculate_match_score("test", "test"), 100.0);
        assert_eq!(calculate_match_score("testing", "test"), 90.0);
        assert!(calculate_match_score("my test", "test") >= 50.0);
        assert!(calculate_match_score("my test", "test") <= 89.0);
        assert_eq!(calculate_match_score("vscode", "rust"), 0.0);
    }

    #[test]
    fn test_calculate_match_score_case_insensitive() {
        assert_eq!(calculate_match_score("FIREFOX", "firefox"), 100.0);
        assert_eq!(calculate_match_score("Firefox", "FIRE"), 90.0);
    }

    #[test]
    fn test_calculate_match_score_contains_position_decay() {
        // earlier substring positions score higher (nucleo gives word-boundary bonuses)
        let early = calculate_match_score("xtest", "test");
        let later = calculate_match_score("xxxxxxxxxxxxxxxxxxxxxxxxxxtest", "test");
        assert!(early >= later);
        assert!(early >= 50.0);
    }

    #[test]
    fn test_calculate_match_score_fuzzy_above_zero() {
        // fuzzy match should score in the 50-89 range
        let score = calculate_match_score("hello world", "hwd");
        assert!(score >= 50.0, "fuzzy score was {}, expected >= 50", score);
        assert!(score <= 89.0, "fuzzy score was {}, expected <= 89", score);
    }

    #[test]
    fn test_calculate_match_score_nucleo_word_boundary_bonus() {
        // "vsc" matching "Visual Studio Code" should score higher than
        // "vsc" matching "Very Slow Calculator" because of word-boundary alignment
        let vscode_score = calculate_match_score("Visual Studio Code", "vsc");
        let slow_calc_score = calculate_match_score("Very Slow Calculator", "vsc");
        assert!(vscode_score > 0.0, "vsc should match Visual Studio Code");
        assert!(slow_calc_score > 0.0, "vsc should match Very Slow Calculator");
        // nucleo gives word-boundary bonuses, so V-S-C at word starts should score higher
        assert!(
            vscode_score >= slow_calc_score,
            "Visual Studio Code ({}) should score >= Very Slow Calculator ({})",
            vscode_score,
            slow_calc_score
        );
    }

    #[test]
    fn test_calculate_match_score_no_match() {
        assert_eq!(calculate_match_score("hello", "xyz"), 0.0);
    }

    #[test]
    fn test_calculate_match_score_empty_query() {
        // Empty query matches as exact for empty text, contains-at-position-0 otherwise
        assert_eq!(calculate_match_score("", ""), 100.0);
        assert!(calculate_match_score("anything", "") > 0.0);
    }
}
