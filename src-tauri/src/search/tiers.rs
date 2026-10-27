//! The single search tier ladder shared by the Rust rankers and the frontend.
//!
//! Every ranked launcher result (applications, plugin commands, files) gets a
//! [`SearchTier`]. Results are compared **lexicographically**: the tier first,
//! then the match quality inside the tier, then frecency, then the source
//! priority / declared score, then the title. No numeric offsets are added
//! across result types any more, so frecency or a plugin's own score can never
//! lift a result across a tier boundary.
//!
//! The variant order below *is* the ranking (strongest first). The frontend
//! does not duplicate it: `cargo test` regenerates
//! `src/shared/types/generated/SearchTier.ts` (ts-rs) and
//! `src/shared/types/generated/searchTierOrder.ts` (see the test at the bottom
//! of this file), which `src/app/searchRanking.ts` imports.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Tier of a ranked search result, strongest first.
///
/// | Tier            | Meaning                                                              |
/// |-----------------|----------------------------------------------------------------------|
/// | `aliasExact`    | user-defined alias equals the query                                  |
/// | `learnedExact`  | the user typed exactly this query before opening this item (17 days) |
/// | `titleExact`    | title / app name equals the query                                    |
/// | `aliasPrefix`   | alias starts with the query, or a learned query starts with it      |
/// | `titlePrefix`   | title starts with the query                                          |
/// | `activation`    | plugin activated by its prefix / keyword (`>`, `;`, `timer`, …)      |
/// | `fileExact`     | file name or stem equals the query                                   |
/// | `fuzzy`         | fuzzy title match (quality 50-89)                                    |
/// | `filePrefix`    | file name starts with the query                                      |
/// | `secondary`     | subtitle / keywords / install path match                             |
/// | `fileFuzzy`     | fuzzy file-name match                                                |
/// | `filePathOnly`  | file matched outside its name (path, Windows Search content)         |
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "SearchTier.ts")]
pub enum SearchTier {
    AliasExact,
    LearnedExact,
    TitleExact,
    AliasPrefix,
    TitlePrefix,
    Activation,
    FileExact,
    Fuzzy,
    FilePrefix,
    Secondary,
    FileFuzzy,
    FilePathOnly,
}

impl SearchTier {
    /// Every tier, strongest first (same order as the derived `Ord`).
    pub const ALL: [SearchTier; 12] = [
        SearchTier::AliasExact,
        SearchTier::LearnedExact,
        SearchTier::TitleExact,
        SearchTier::AliasPrefix,
        SearchTier::TitlePrefix,
        SearchTier::Activation,
        SearchTier::FileExact,
        SearchTier::Fuzzy,
        SearchTier::FilePrefix,
        SearchTier::Secondary,
        SearchTier::FileFuzzy,
        SearchTier::FilePathOnly,
    ];

    /// The stronger of two tiers.
    pub fn strongest(self, other: SearchTier) -> SearchTier {
        self.min(other)
    }
}

/// A learned query binding surfaced for the current query (see
/// [`crate::launcher::QueryBindingStore::learned_matches`]). Streamed to the
/// frontend so plugin commands get the same learned tiers as applications.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "LearnedMatch.ts")]
pub struct LearnedMatch {
    /// Stable result identity (app path or `pluginId:resultId`).
    pub result_id: String,
    /// Either [`SearchTier::LearnedExact`] or [`SearchTier::AliasPrefix`].
    pub tier: SearchTier,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Position of each variant; the exhaustive match breaks the build when a
    /// variant is added without updating [`SearchTier::ALL`].
    fn expected_position(tier: SearchTier) -> usize {
        match tier {
            SearchTier::AliasExact => 0,
            SearchTier::LearnedExact => 1,
            SearchTier::TitleExact => 2,
            SearchTier::AliasPrefix => 3,
            SearchTier::TitlePrefix => 4,
            SearchTier::Activation => 5,
            SearchTier::FileExact => 6,
            SearchTier::Fuzzy => 7,
            SearchTier::FilePrefix => 8,
            SearchTier::Secondary => 9,
            SearchTier::FileFuzzy => 10,
            SearchTier::FilePathOnly => 11,
        }
    }

    fn wire_name(tier: SearchTier) -> String {
        serde_json::to_value(tier)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default()
    }

    #[test]
    fn all_lists_every_tier_strongest_first() {
        for (index, tier) in SearchTier::ALL.iter().enumerate() {
            assert_eq!(expected_position(*tier), index);
        }
        assert!(SearchTier::ALL.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn ladder_matches_the_documented_ranking() {
        use SearchTier::*;
        // Learned exact beats a title exact; alias exact beats everything.
        assert!(AliasExact < LearnedExact && LearnedExact < TitleExact);
        // An explicit plugin activation beats fuzzy titles but not prefixes.
        assert!(TitlePrefix < Activation && Activation < Fuzzy);
        // Files keep their historical placement around the app tiers:
        // an exact file name beats fuzzy apps, a file prefix beats only
        // secondary (path / keyword) matches, fuzzy files stay below.
        assert!(Activation < FileExact && FileExact < Fuzzy);
        assert!(Fuzzy < FilePrefix && FilePrefix < Secondary);
        assert!(Secondary < FileFuzzy && FileFuzzy < FilePathOnly);
        assert_eq!(Fuzzy.strongest(TitleExact), TitleExact);
    }

    #[test]
    fn tiers_serialise_as_camel_case() {
        assert_eq!(wire_name(SearchTier::AliasExact), "aliasExact");
        assert_eq!(wire_name(SearchTier::FilePathOnly), "filePathOnly");
        let parsed: SearchTier = serde_json::from_str("\"learnedExact\"").unwrap();
        assert_eq!(parsed, SearchTier::LearnedExact);
    }

    /// Regenerates `searchTierOrder.ts` next to the ts-rs bindings so the
    /// frontend ranker reads the ladder order from Rust instead of
    /// duplicating it. Same mechanism as ts-rs: `cargo test` writes it.
    #[test]
    fn export_search_tier_order() {
        let names = SearchTier::ALL
            .iter()
            .map(|tier| format!("  \"{}\",", wire_name(*tier)))
            .collect::<Vec<_>>()
            .join("\n");
        let content = format!(
            "// This file was generated by `cargo test` from src-tauri/src/search/tiers.rs. Do not edit this file manually.\n\
             import type {{ SearchTier }} from \"./SearchTier\";\n\
             \n\
             /**\n * Search tiers, strongest first: index 0 ranks highest.\n */\n\
             export const SEARCH_TIER_ORDER: readonly SearchTier[] = [\n{names}\n];\n"
        );

        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src/shared/types/generated/searchTierOrder.ts");
        let current = std::fs::read_to_string(&path).unwrap_or_default();
        if current != content {
            std::fs::write(&path, content).expect("write searchTierOrder.ts");
        }
    }
}
