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

/// Calculates a match score for search results
///
/// Returns a score from 0-100:
/// - 100: Exact match
/// - 90: Starts with query
/// - 80: Contains query (earlier positions score higher)
/// - 50: Fuzzy match (all chars present in order)
/// - 0: No match
pub fn calculate_match_score(text: &str, query: &str) -> f32 {
    let text_lower = text.to_lowercase();
    let query_lower = query.to_lowercase();

    if text_lower == query_lower {
        100.0 // Exact match
    } else if text_lower.starts_with(&query_lower) {
        90.0 // Starts with query
    } else if text_lower.contains(&query_lower) {
        let position = text_lower.find(&query_lower).unwrap_or(usize::MAX);
        // Contains query, earlier is better, but always score above fuzzy match
        (80.0 - (position as f32 * 0.1)).max(55.0)
    } else if fuzzy_match(&text_lower, &query_lower) {
        50.0 // Fuzzy match
    } else {
        // Multi-word matching: check if ALL query words appear somewhere in the text
        let query_words: Vec<&str> = query_lower.split_whitespace().collect();
        if query_words.len() > 1 && query_words.iter().all(|w| text_lower.contains(*w)) {
            65.0 // All words present
        } else if query_words.len() > 1
            && query_words.iter().filter(|w| text_lower.contains(*w)).count() >= query_words.len() - 1
        {
            40.0 // Most words present (one missing)
        } else {
            0.0 // No match
        }
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
        assert!(calculate_match_score("my test", "test") > 50.0);
        assert_eq!(calculate_match_score("vscode", "rust"), 0.0);
    }

    #[test]
    fn test_calculate_match_score_case_insensitive() {
        assert_eq!(calculate_match_score("FIREFOX", "firefox"), 100.0);
        assert_eq!(calculate_match_score("Firefox", "FIRE"), 90.0);
    }

    #[test]
    fn test_calculate_match_score_contains_position_decay() {
        // earlier substring positions score higher
        let early = calculate_match_score("xtest", "test");
        let later = calculate_match_score("xxxxxxxxxxxxxxxxxxxxxxxxxxtest", "test");
        assert!(early >= later);
        assert!(early > 50.0);
    }

    #[test]
    fn test_calculate_match_score_fuzzy_above_zero() {
        // fuzzy match always 50, never 0 if all chars in order
        assert_eq!(calculate_match_score("hello world", "hwd"), 50.0);
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
