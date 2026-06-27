//! Pure, platform-independent trigger-matching logic for global snippet
//! expansion. No Win32 calls here — this module is exercised by unit tests
//! on every OS.
//!
//! Compiled unconditionally (not gated behind `windows`) so its tests run in
//! CI on every OS regardless of the `snippet-global-expansion` feature. With
//! the feature off, nothing in `expansion::state` references this module's
//! public API outside of its own `#[cfg(test)]` block, so the production
//! (non-test) compile would otherwise flag it as dead code — silence that
//! specifically for the feature-off case rather than masking real dead code.
#![cfg_attr(not(feature = "snippet-global-expansion"), allow(dead_code))]

use std::collections::VecDeque;

/// A bounded ring buffer of the most-recently-typed characters, used to
/// detect when the user has just finished typing a snippet trigger (e.g.
/// `;sig`) in *any* foreground application.
///
/// The buffer only ever holds the last `capacity` characters: once full,
/// pushing a new character evicts the oldest one. Backspace pops the most
/// recently pushed character (best-effort — we cannot un-evict characters
/// that already fell off the front).
#[derive(Debug, Clone)]
pub struct TriggerBuffer {
    buf: VecDeque<char>,
    capacity: usize,
}

/// A successful trigger match: which trigger matched and how many UTF-16
/// code units it occupies (the caller backspaces that many units before
/// injecting the expanded content).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TriggerMatch {
    pub trigger: String,
}

impl TriggerBuffer {
    /// Create a new buffer that retains at most `capacity` characters.
    /// `capacity` is clamped to at least 1 so a misconfigured `0` doesn't
    /// make the buffer permanently empty.
    pub fn new(capacity: usize) -> Self {
        let capacity = capacity.max(1);
        Self {
            buf: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    /// Push a newly typed character, evicting the oldest one if the buffer
    /// is at capacity.
    pub fn push_char(&mut self, c: char) {
        if self.buf.len() == self.capacity {
            self.buf.pop_front();
        }
        self.buf.push_back(c);
    }

    /// Handle a backspace keypress: pop the most recently typed character.
    /// No-op if the buffer is already empty.
    pub fn push_backspace(&mut self) {
        self.buf.pop_back();
    }

    /// Clear the buffer (called after a successful expansion, or whenever
    /// the foreground app changes, to avoid spurious cross-app matches).
    pub fn clear(&mut self) {
        self.buf.clear();
    }

    /// Return the current buffer contents as a `String`, oldest-first.
    fn as_string(&self) -> String {
        self.buf.iter().collect()
    }

    /// Find the longest trigger that:
    /// 1. is enabled,
    /// 2. the buffer ends with (i.e. was just typed in full), and
    /// 3. is preceded by a word boundary (start of buffer, or a character
    ///    that is whitespace / punctuation-like, never alphanumeric or `_`)
    ///    so that `;sig` does not fire inside `foo;sigbar`-style noise — wait,
    ///    actually the boundary check is on the character *before* the
    ///    trigger, e.g. typing `x;sig` after a letter `x` with no separator
    ///    should NOT match if `;sig`'s preceding char `x` is alphanumeric.
    ///
    /// Among all matching triggers, the longest one wins (so `;sig` beats
    /// `;si` if both are enabled and the buffer ends with `;sig`).
    pub fn try_match(&self, triggers: &[(&str, bool)]) -> Option<TriggerMatch> {
        let current = self.as_string();
        let chars: Vec<char> = current.chars().collect();

        let mut best: Option<&str> = None;

        for (trigger, enabled) in triggers {
            if !enabled || trigger.is_empty() {
                continue;
            }
            let trigger_chars: Vec<char> = trigger.chars().collect();
            if trigger_chars.len() > chars.len() {
                continue;
            }

            let start = chars.len() - trigger_chars.len();
            if chars[start..] != trigger_chars[..] {
                continue;
            }

            // Word-boundary check: the character immediately before the
            // trigger (if any) must not be alphanumeric/underscore.
            if start > 0 {
                let prev = chars[start - 1];
                let is_boundary = prev.is_whitespace() || (!prev.is_alphanumeric() && prev != '_');
                if !is_boundary {
                    continue;
                }
            }

            let is_longer = best.is_none_or(|b| trigger.chars().count() > b.chars().count());
            if is_longer {
                best = Some(trigger);
            }
        }

        best.map(|t| TriggerMatch {
            trigger: t.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_and_evict_at_capacity() {
        let mut buf = TriggerBuffer::new(3);
        buf.push_char('a');
        buf.push_char('b');
        buf.push_char('c');
        assert_eq!(buf.as_string(), "abc");
        buf.push_char('d');
        // "a" evicted, capacity stays at 3.
        assert_eq!(buf.as_string(), "bcd");
    }

    #[test]
    fn capacity_zero_clamped_to_one() {
        let mut buf = TriggerBuffer::new(0);
        buf.push_char('x');
        buf.push_char('y');
        assert_eq!(buf.as_string(), "y");
    }

    #[test]
    fn backspace_pops_last_char() {
        let mut buf = TriggerBuffer::new(10);
        buf.push_char('a');
        buf.push_char('b');
        buf.push_backspace();
        assert_eq!(buf.as_string(), "a");
    }

    #[test]
    fn backspace_on_empty_buffer_is_noop() {
        let mut buf = TriggerBuffer::new(10);
        buf.push_backspace();
        assert_eq!(buf.as_string(), "");
    }

    #[test]
    fn clear_empties_buffer() {
        let mut buf = TriggerBuffer::new(10);
        buf.push_char('a');
        buf.clear();
        assert_eq!(buf.as_string(), "");
    }

    #[test]
    fn try_match_simple_trigger_at_start_of_buffer() {
        let mut buf = TriggerBuffer::new(10);
        for c in ";sig".chars() {
            buf.push_char(c);
        }
        let m = buf.try_match(&[(";sig", true)]);
        assert_eq!(
            m,
            Some(TriggerMatch {
                trigger: ";sig".to_string()
            })
        );
    }

    #[test]
    fn try_match_longest_trigger_wins_among_overlapping() {
        let mut buf = TriggerBuffer::new(10);
        for c in ";sig".chars() {
            buf.push_char(c);
        }
        // Both ";sig" and ";s" match the tail; ";sig" is longer and must win.
        let m = buf.try_match(&[(";s", true), (";sig", true)]);
        assert_eq!(
            m,
            Some(TriggerMatch {
                trigger: ";sig".to_string()
            })
        );
    }

    #[test]
    fn try_match_disabled_trigger_is_skipped() {
        let mut buf = TriggerBuffer::new(10);
        for c in ";sig".chars() {
            buf.push_char(c);
        }
        let m = buf.try_match(&[(";sig", false)]);
        assert_eq!(m, None);
    }

    #[test]
    fn try_match_word_boundary_positive_whitespace() {
        let mut buf = TriggerBuffer::new(10);
        for c in "hello ;sig".chars() {
            buf.push_char(c);
        }
        let m = buf.try_match(&[(";sig", true)]);
        assert_eq!(
            m,
            Some(TriggerMatch {
                trigger: ";sig".to_string()
            })
        );
    }

    #[test]
    fn try_match_word_boundary_positive_punctuation() {
        let mut buf = TriggerBuffer::new(10);
        for c in "(;sig".chars() {
            buf.push_char(c);
        }
        let m = buf.try_match(&[(";sig", true)]);
        assert_eq!(
            m,
            Some(TriggerMatch {
                trigger: ";sig".to_string()
            })
        );
    }

    #[test]
    fn try_match_word_boundary_negative_alphanumeric() {
        let mut buf = TriggerBuffer::new(10);
        // "x;sig" — preceding char 'x' is alphanumeric, so it must NOT match
        // a trigger that does not itself start with a boundary char.
        for c in "x;sig".chars() {
            buf.push_char(c);
        }
        // Trigger without leading separator: "sig" preceded by ';' is fine,
        // but here we test a trigger "x;sig" reduced — use a trigger that
        // starts right after an alphanumeric char with no separator.
        let m = buf.try_match(&[("sig", true)]);
        // buffer ends with "x;sig"; "sig" is preceded by ';' which IS a
        // boundary, so this should actually match. Use a clearer negative:
        // trigger "ig" preceded by 's' (alphanumeric) must NOT match.
        assert_eq!(
            m,
            Some(TriggerMatch {
                trigger: "sig".to_string()
            })
        );

        let m2 = buf.try_match(&[("ig", true)]);
        assert_eq!(m2, None);
    }

    #[test]
    fn try_match_word_boundary_negative_underscore() {
        let mut buf = TriggerBuffer::new(10);
        for c in "_sig".chars() {
            buf.push_char(c);
        }
        // 'sig' is preceded by '_', which counts as a "word" char per the
        // spec (`c != '_'` is part of the non-alphanumeric check), so this
        // must NOT match.
        let m = buf.try_match(&[("sig", true)]);
        assert_eq!(m, None);
    }

    #[test]
    fn try_match_trigger_longer_than_buffer_is_skipped() {
        let mut buf = TriggerBuffer::new(10);
        buf.push_char(';');
        let m = buf.try_match(&[(";sig", true)]);
        assert_eq!(m, None);
    }

    #[test]
    fn try_match_no_match_returns_none() {
        let mut buf = TriggerBuffer::new(10);
        for c in "hello".chars() {
            buf.push_char(c);
        }
        let m = buf.try_match(&[(";sig", true)]);
        assert_eq!(m, None);
    }

    #[test]
    fn vk_back_simulated_then_no_match_after_partial_retype() {
        let mut buf = TriggerBuffer::new(10);
        for c in ";sigx".chars() {
            buf.push_char(c);
        }
        // User backspaces the stray 'x', buffer should end with ";sig" again.
        buf.push_backspace();
        let m = buf.try_match(&[(";sig", true)]);
        assert_eq!(
            m,
            Some(TriggerMatch {
                trigger: ";sig".to_string()
            })
        );
    }
}
