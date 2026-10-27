//! Behaviour settings of the launcher window, the keyboard and a few builtin plugins.
//!
//! Every value has a default that reproduces the behaviour Volt had before the setting
//! existed, and a `normalize` step that coerces anything out of range (hand-edited files,
//! imports, older builds) back to a valid value so consumers never see garbage.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Accepted `launcher.popToRoot` values, shortest delay first.
pub const POP_TO_ROOT_VALUES: [&str; 5] = ["immediate", "30s", "1m", "5m", "never"];
/// Accepted `keyboard.escapeBehavior` values.
pub const ESCAPE_BEHAVIOR_VALUES: [&str; 3] = ["close", "clearThenClose", "backToRoot"];
/// Accepted `keyboard.listNavigation` values.
pub const LIST_NAVIGATION_VALUES: [&str; 3] = ["arrows", "emacs", "vim"];

pub const SYSTEM_MONITOR_REFRESH_MS_MIN: u32 = 1_000;
pub const SYSTEM_MONITOR_REFRESH_MS_MAX: u32 = 60_000;
pub const SYSTEM_MONITOR_REFRESH_MS_DEFAULT: u32 = 5_000;

pub const TIMER_WORK_MINUTES_RANGE: (u32, u32) = (1, 180);
pub const TIMER_SHORT_BREAK_MINUTES_RANGE: (u32, u32) = (1, 60);
pub const TIMER_LONG_BREAK_MINUTES_RANGE: (u32, u32) = (1, 120);

pub const WINDOW_GAP_PX_MAX: u32 = 64;

pub fn default_pop_to_root() -> String {
    "never".to_string()
}

pub fn default_escape_behavior() -> String {
    "close".to_string()
}

pub fn default_list_navigation() -> String {
    "emacs".to_string()
}

pub fn default_system_monitor_refresh_ms() -> u32 {
    SYSTEM_MONITOR_REFRESH_MS_DEFAULT
}

pub fn default_timer_work_minutes() -> u32 {
    25
}

pub fn default_timer_short_break_minutes() -> u32 {
    5
}

pub fn default_timer_long_break_minutes() -> u32 {
    15
}

fn default_true() -> bool {
    true
}

/// Root search and window lifecycle preferences.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "LauncherSettings.ts")]
pub struct LauncherSettings {
    /// How long the launcher may stay hidden before it reopens on the root view
    /// (`immediate`, `30s`, `1m`, `5m`, `never`). `never` keeps the state forever.
    #[serde(default = "default_pop_to_root")]
    pub pop_to_root: String,
    /// Whether indexed files are searched from the root search bar.
    #[serde(default = "default_true")]
    pub include_files_in_root_search: bool,
    /// Whether installed games are searched from the root search bar.
    #[serde(default = "default_true")]
    pub include_games_in_root_search: bool,
}

impl Default for LauncherSettings {
    fn default() -> Self {
        Self {
            pop_to_root: default_pop_to_root(),
            include_files_in_root_search: true,
            include_games_in_root_search: true,
        }
    }
}

impl LauncherSettings {
    /// Coerces out-of-range values to their defaults. Returns `true` when something changed.
    pub fn normalize(&mut self) -> bool {
        coerce_choice(
            &mut self.pop_to_root,
            &POP_TO_ROOT_VALUES,
            default_pop_to_root,
        )
    }
}

/// Keyboard behaviour of the launcher and its secondary windows.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "KeyboardSettings.ts")]
pub struct KeyboardSettings {
    /// What Escape does in the search bar: `close` (clear and hide), `clearThenClose`
    /// (clear first, hide when already empty) or `backToRoot` (clear, never hide).
    #[serde(default = "default_escape_behavior")]
    pub escape_behavior: String,
    /// Whether Escape closes the Settings and Notes windows.
    #[serde(default = "default_true")]
    pub escape_closes_secondary_windows: bool,
    /// Extra list navigation keys on top of the arrows: `arrows` (none), `emacs`
    /// (Ctrl+N / Ctrl+P) or `vim` (Ctrl+J / Ctrl+K).
    #[serde(default = "default_list_navigation")]
    pub list_navigation: String,
}

impl Default for KeyboardSettings {
    fn default() -> Self {
        Self {
            escape_behavior: default_escape_behavior(),
            escape_closes_secondary_windows: true,
            list_navigation: default_list_navigation(),
        }
    }
}

impl KeyboardSettings {
    /// Coerces out-of-range values to their defaults. Returns `true` when something changed.
    pub fn normalize(&mut self) -> bool {
        let a = coerce_choice(
            &mut self.escape_behavior,
            &ESCAPE_BEHAVIOR_VALUES,
            default_escape_behavior,
        );
        let b = coerce_choice(
            &mut self.list_navigation,
            &LIST_NAVIGATION_VALUES,
            default_list_navigation,
        );
        a || b
    }
}

fn coerce_choice(value: &mut String, allowed: &[&str], default: fn() -> String) -> bool {
    if allowed.contains(&value.as_str()) {
        false
    } else {
        *value = default();
        true
    }
}

/// Clamps `value` into `[min, max]`. Returns `true` when it moved.
pub fn clamp_in_place(value: &mut u32, min: u32, max: u32) -> bool {
    let clamped = (*value).clamp(min, max);
    let changed = clamped != *value;
    *value = clamped;
    changed
}

/// Geometry of one tile of a snapped window, in screen pixels.
pub type TileRect = (i32, i32, i32, i32);

/// Rectangle a snapped window gets inside `work_area` (x, y, width, height).
///
/// `gap` is the margin kept around the work area and between two tiles, so two windows snapped
/// side by side are exactly `gap` pixels apart. Returns `None` for positions that are not a tile
/// (`center`, `maximize`, ...). With `gap == 0` the result is the plain half/quarter split.
pub fn tile_rect(position: &str, work_area: TileRect, gap: i32) -> Option<TileRect> {
    let gap = gap.max(0);
    let (x, y, w, h) = work_area;
    // Never inset so far that a tile would vanish on a tiny work area.
    let gap = gap.min((w.min(h) / 8).max(0));
    let (x, y, w, h) = (x + gap, y + gap, w - 2 * gap, h - 2 * gap);

    let left_w = (w - gap) / 2;
    let right_w = w - gap - left_w;
    let top_h = (h - gap) / 2;
    let bottom_h = h - gap - top_h;
    let right_x = x + left_w + gap;
    let bottom_y = y + top_h + gap;

    match position {
        "left_half" => Some((x, y, left_w, h)),
        "right_half" => Some((right_x, y, right_w, h)),
        "top_half" => Some((x, y, w, top_h)),
        "bottom_half" => Some((x, bottom_y, w, bottom_h)),
        "top_left" => Some((x, y, left_w, top_h)),
        "top_right" => Some((right_x, y, right_w, top_h)),
        "bottom_left" => Some((x, bottom_y, left_w, bottom_h)),
        "bottom_right" => Some((right_x, bottom_y, right_w, bottom_h)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_preserve_previous_behaviour() {
        let launcher = LauncherSettings::default();
        assert_eq!(launcher.pop_to_root, "never");
        assert!(launcher.include_files_in_root_search);
        assert!(launcher.include_games_in_root_search);
        let keyboard = KeyboardSettings::default();
        assert_eq!(keyboard.escape_behavior, "close");
        assert!(keyboard.escape_closes_secondary_windows);
        assert_eq!(keyboard.list_navigation, "emacs");
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let launcher: LauncherSettings = serde_json::from_value(serde_json::json!({})).unwrap();
        assert_eq!(launcher.pop_to_root, "never");
        assert!(launcher.include_files_in_root_search);
        let keyboard: KeyboardSettings =
            serde_json::from_value(serde_json::json!({ "escapeBehavior": "backToRoot" })).unwrap();
        assert_eq!(keyboard.escape_behavior, "backToRoot");
        assert!(keyboard.escape_closes_secondary_windows);
    }

    #[test]
    fn normalize_rejects_unknown_choices() {
        let mut launcher = LauncherSettings {
            pop_to_root: "yesterday".into(),
            ..Default::default()
        };
        assert!(launcher.normalize());
        assert_eq!(launcher.pop_to_root, "never");
        assert!(!launcher.normalize());

        let mut keyboard = KeyboardSettings {
            escape_behavior: "explode".into(),
            list_navigation: "dvorak".into(),
            ..Default::default()
        };
        assert!(keyboard.normalize());
        assert_eq!(keyboard.escape_behavior, "close");
        assert_eq!(keyboard.list_navigation, "emacs");
    }

    #[test]
    fn clamp_reports_changes() {
        let mut v = 0;
        assert!(clamp_in_place(&mut v, 1, 10));
        assert_eq!(v, 1);
        let mut v = 99;
        assert!(clamp_in_place(&mut v, 1, 10));
        assert_eq!(v, 10);
        let mut v = 5;
        assert!(!clamp_in_place(&mut v, 1, 10));
    }

    #[test]
    fn tiles_without_gap_are_plain_splits() {
        let wa = (0, 0, 1920, 1040);
        assert_eq!(tile_rect("left_half", wa, 0), Some((0, 0, 960, 1040)));
        assert_eq!(tile_rect("right_half", wa, 0), Some((960, 0, 960, 1040)));
        assert_eq!(tile_rect("top_half", wa, 0), Some((0, 0, 1920, 520)));
        assert_eq!(tile_rect("bottom_right", wa, 0), Some((960, 520, 960, 520)));
        assert_eq!(tile_rect("center", wa, 0), None);
        assert_eq!(tile_rect("maximize", wa, 0), None);
    }

    #[test]
    fn tiles_keep_the_gap_around_and_between() {
        let wa = (100, 50, 1000, 800);
        let (lx, ly, lw, lh) = tile_rect("left_half", wa, 10).unwrap();
        let (rx, ry, rw, rh) = tile_rect("right_half", wa, 10).unwrap();
        assert_eq!((lx, ly, lh), (110, 60, 780));
        assert_eq!((ry, rh), (60, 780));
        // `gap` pixels between the tiles, `gap` pixels to both outer edges.
        assert_eq!(rx - (lx + lw), 10);
        assert_eq!(lx - wa.0, 10);
        assert_eq!((wa.0 + wa.2) - (rx + rw), 10);

        let (_, ty, _, th) = tile_rect("top_left", wa, 10).unwrap();
        let (_, by, _, bh) = tile_rect("bottom_left", wa, 10).unwrap();
        assert_eq!(by - (ty + th), 10);
        assert_eq!((wa.1 + wa.3) - (by + bh), 10);
    }

    #[test]
    fn oversized_gap_is_bounded() {
        let (_, _, w, h) = tile_rect("top_left", (0, 0, 200, 100), 5_000).unwrap();
        assert!(w > 0 && h > 0);
        assert_eq!(
            tile_rect("left_half", (0, 0, 800, 600), -4),
            Some((0, 0, 400, 600))
        );
    }
}
