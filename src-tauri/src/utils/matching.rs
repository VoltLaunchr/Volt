use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};

/// Performs fuzzy matching - checks if all characters from pattern appear in text in order
///
/// # Examples
/// ```
/// use volt_lib::utils::matching::fuzzy_match;
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

/// ASCII-case-insensitive equality without allocating.
fn ascii_ieq(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.eq_ignore_ascii_case(b)
}

/// ASCII-case-insensitive prefix match without allocating.
fn ascii_istarts_with(text: &str, prefix: &str) -> bool {
    text.len() >= prefix.len()
        && text.as_bytes()[..prefix.len()].eq_ignore_ascii_case(prefix.as_bytes())
}

/// Optimised hot-path scorer that reuses a caller-supplied `Vec<char>` buffer
/// for the Utf32Str haystack. The full-allocation variant
/// [`calculate_match_score_with_matcher`] wraps this for callers that don't
/// yet thread the buffer through.
///
/// Performance notes:
/// - Pure-ASCII haystacks (the common case for app names and filenames) take
///   the [`Utf32Str::Ascii`] zero-copy branch and avoid the char-collect entirely.
/// - Pure-ASCII query+text pairs use `eq_ignore_ascii_case` /
///   `as_bytes().eq_ignore_ascii_case` for the exact and prefix arms, skipping
///   the previous double `to_lowercase()` allocations.
/// - Non-ASCII haystacks reuse the supplied `char_buf`; the caller pays a
///   single growable allocation amortized over the entire search loop.
pub fn calculate_match_score_with_matcher_buf(
    text: &str,
    query: &str,
    matcher: &mut Matcher,
    char_buf: &mut Vec<char>,
) -> f32 {
    if query.is_empty() {
        return if text.is_empty() { 100.0 } else { 80.0 };
    }

    let text_is_ascii = text.is_ascii();
    let query_is_ascii = query.is_ascii();

    // Exact match (case-insensitive).
    if text_is_ascii && query_is_ascii {
        if ascii_ieq(text, query) {
            return 100.0;
        }
        if ascii_istarts_with(text, query) {
            return 90.0;
        }
    } else {
        // Fallback for non-ASCII: pay the to_lowercase() so we get proper
        // Unicode case folding. These allocations are unavoidable here, but
        // the hot path (almost all app/file names) is ASCII.
        let text_lower = text.to_lowercase();
        let query_lower = query.to_lowercase();
        if text_lower == query_lower {
            return 100.0;
        }
        if text_lower.starts_with(&query_lower) {
            return 90.0;
        }
    }

    // Build the pattern with Smart case-matching — nucleo handles case folding
    // internally, so we pass the raw query instead of a lowercased copy.
    let pattern = Pattern::parse(query, CaseMatching::Smart, Normalization::Smart);

    let raw_score = if text_is_ascii {
        // Zero-copy haystack — `Utf32Str::Ascii` borrows the original bytes.
        pattern.score(Utf32Str::Ascii(text.as_bytes()), matcher)
    } else {
        // Reuse the caller's buffer for non-ASCII text. `Utf32Str::new` will
        // clear and repopulate it, so the allocation amortises across the
        // entire search loop instead of paying once per scored item.
        let haystack = Utf32Str::new(text, char_buf);
        pattern.score(haystack, matcher)
    };

    match raw_score {
        Some(s) if s > 0 => {
            let log_score = (s as f32).ln();
            (50.0 + log_score * (39.0 / 10.0)).clamp(50.0, 89.0)
        }
        _ => 0.0,
    }
}

/// Calculates a match score using a caller-supplied `Matcher` so that the
/// matcher's internal scratch buffers are reused across loop iterations.
/// Prefer this in hot loops over [`calculate_match_score`].
///
/// Returns a score from 0-100:
/// - 100: Exact match
/// - 90: Starts with query
/// - 50-89: nucleo fuzzy/substring score (word-boundary aware, position-sensitive)
/// - 0: No match
///
/// This is a thin wrapper over [`calculate_match_score_with_matcher_buf`] that
/// allocates a fresh char buffer per call. For tight loops, prefer the `_buf`
/// variant to amortise the haystack-conversion allocation.
pub fn calculate_match_score_with_matcher(text: &str, query: &str, matcher: &mut Matcher) -> f32 {
    let mut char_buf = Vec::new();
    calculate_match_score_with_matcher_buf(text, query, matcher, &mut char_buf)
}

/// Calculates a match score for search results using nucleo-matcher for fuzzy scoring.
/// Allocates a fresh `Matcher` per call; use [`calculate_match_score_with_matcher`]
/// in hot loops to reuse the matcher's scratch buffers.
pub fn calculate_match_score(text: &str, query: &str) -> f32 {
    calculate_match_score_with_matcher(text, query, &mut Matcher::new(Config::DEFAULT))
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
        // Both "Visual Studio Code" and "Very Slow Calculator" match "vsc" at word
        // boundaries, so nucleo may score them similarly. We verify both get a fuzzy
        // score in the expected range and that a true word-boundary match beats a
        // non-boundary match.
        let vscode_score = calculate_match_score("Visual Studio Code", "vsc");
        let slow_calc_score = calculate_match_score("Very Slow Calculator", "vsc");
        assert!(vscode_score > 0.0, "vsc should match Visual Studio Code");
        assert!(
            slow_calc_score > 0.0,
            "vsc should match Very Slow Calculator"
        );
        // Both should be in the fuzzy range (50-89)
        assert!(
            (50.0..=89.0).contains(&vscode_score),
            "Visual Studio Code score ({}) should be in fuzzy range",
            vscode_score
        );

        // Word-boundary match should beat a non-boundary match
        let no_boundary = calculate_match_score("avscript handler", "vsc");
        assert!(
            vscode_score > no_boundary,
            "Word-boundary match ({}) should beat non-boundary match ({})",
            vscode_score,
            no_boundary
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
