/**
 * Unified launcher ranking — one lexicographic comparator for every result.
 *
 * Results are no longer ordered by adding per-type offsets to unrelated
 * scores. Each result carries a `ResultRank` and is compared on, in order:
 *
 *   band > tier > quality > frecency > source > declared score > title
 *
 * - `band`: special intents placed outside the ladder (explicit web search,
 *   game browsing, direct answers such as calculator results or a typed URL,
 *   fallbacks). Everything else is `ranked`.
 * - `tier`: the shared ladder generated from Rust (`SearchTier`,
 *   `SEARCH_TIER_ORDER`, see `src-tauri/src/search/tiers.rs`). Apps and files
 *   get their tier from the Rust rankers; plugin commands get theirs here
 *   with the same rules (title exact / prefix / fuzzy, learned bindings).
 * - `quality`: match quality inside the tier (Rust nucleo score for apps and
 *   files, the nucleo approximation below for plugin titles).
 * - `frecency`: universal frecency date (`LaunchRecord.frecencyDate`), so it
 *   only ever breaks ties.
 * - `source`: command-type priority (apps, then commands, then files).
 * - `declared`: the plugin's own score, fallback order, web hit position.
 * - `title`: `Intl.Collator` with numeric collation.
 */
import type { PluginResult } from '../features/plugins/types';
import { PluginResultType } from '../features/plugins/types';
import { SEARCH_TIER_ORDER } from '../shared/types/generated/searchTierOrder';
import type {
  RankSource,
  ResultBand,
  ResultRank,
  SearchResult,
  SearchTier,
} from '../shared/types/common.types';

/** Bands, strongest first. Only special intents live outside `ranked`. */
const RESULT_BAND_ORDER: readonly ResultBand[] = [
  'explicitWeb',
  'liveWeb',
  'browse',
  'answer',
  'ranked',
  'fallback',
];

/** Command-type priority for full ties (Raycast's "command type" key). */
const RANK_SOURCE_ORDER: readonly RankSource[] = ['app', 'command', 'file'];

function positionMap<T>(order: readonly T[]): Map<T, number> {
  return new Map(order.map((value, index) => [value, index]));
}

const TIER_POSITION = positionMap(SEARCH_TIER_ORDER);
const BAND_POSITION = positionMap(RESULT_BAND_ORDER);
const SOURCE_POSITION = positionMap(RANK_SOURCE_ORDER);

/** Weakest tier on the ladder — used for results built without a rank. */
const WEAKEST_TIER = SEARCH_TIER_ORDER[SEARCH_TIER_ORDER.length - 1];

const titleCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function position<T>(positions: Map<T, number>, value: T): number {
  return positions.get(value) ?? positions.size;
}

/** The stronger of two tiers. */
export function strongestTier(a: SearchTier, b: SearchTier): SearchTier {
  return position(TIER_POSITION, a) <= position(TIER_POSITION, b) ? a : b;
}

/** Whether `tier` ranks at least as high as `floor`. */
export function isTierAtLeast(tier: SearchTier, floor: SearchTier): boolean {
  return position(TIER_POSITION, tier) <= position(TIER_POSITION, floor);
}

/**
 * Rank of a result built outside the pipeline converters (defensive): the
 * bottom of the `ranked` band, ordered by its own score.
 */
function rankOf(result: SearchResult): ResultRank {
  return (
    result.rank ?? {
      band: 'ranked',
      tier: WEAKEST_TIER,
      quality: 0,
      frecency: 0,
      source: 'command',
      declared: result.score,
    }
  );
}

/** Total order over launcher results (negative = `a` ranks first). */
export function compareResults(a: SearchResult, b: SearchResult): number {
  const ra = rankOf(a);
  const rb = rankOf(b);
  return (
    position(BAND_POSITION, ra.band) - position(BAND_POSITION, rb.band) ||
    position(TIER_POSITION, ra.tier) - position(TIER_POSITION, rb.tier) ||
    rb.quality - ra.quality ||
    rb.frecency - ra.frecency ||
    position(SOURCE_POSITION, ra.source) - position(SOURCE_POSITION, rb.source) ||
    rb.declared - ra.declared ||
    titleCollator.compare(a.title, b.title)
  );
}

/** Rank for a result placed by a special-intent band (web, answers, fallbacks). */
export function bandRank(band: ResultBand, declared: number): ResultRank {
  return { band, tier: 'activation', quality: 0, frecency: 0, source: 'command', declared };
}

// ---------------------------------------------------------------------------
// Title matching — TS mirror of `calculate_match_score` (utils/matching.rs)
// ---------------------------------------------------------------------------

/**
 * nucleo-matcher scoring constants used to approximate its raw score for the
 * common match shapes (contiguous at a word start, contiguous mid-word,
 * scattered), so plugin titles land on the same 50-89 fuzzy quality scale as
 * the Rust app ranker. Values from nucleo-matcher's `score.rs`.
 */
const NUCLEO = {
  scoreMatch: 16,
  bonusBoundary: 10,
  bonusConsecutive: 4,
  firstCharMultiplier: 2,
} as const;

/** Same monotonic log mapping as Rust `nucleo_score_to_match_score`. */
function nucleoScoreToQuality(raw: number): number {
  if (raw <= 0) return 0;
  return Math.round(Math.min(89, Math.max(50, 50 + Math.log(raw) * (39 / 10))));
}

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  return !/[\p{L}\p{N}]/u.test(text.charAt(index - 1));
}

function isSubsequence(text: string, query: readonly string[]): boolean {
  let next = 0;
  for (const char of text) {
    if (next < query.length && char === query[next]) next += 1;
  }
  return next === query.length;
}

export type TextMatchKind = 'exact' | 'prefix' | 'fuzzy';

export interface TextMatch {
  kind: TextMatchKind;
  /** 100 exact, 90 prefix, 50-89 fuzzy — the Rust `calculate_match_score` scale. */
  quality: number;
}

/** Case-insensitive match of `query` against `text`, or `null`. */
export function matchText(text: string, query: string): TextMatch | null {
  const haystack = text.trim().toLocaleLowerCase();
  const needle = query.trim().toLocaleLowerCase();
  if (!haystack || !needle) return null;
  if (haystack === needle) return { kind: 'exact', quality: 100 };
  if (haystack.startsWith(needle)) return { kind: 'prefix', quality: 90 };

  const needleChars = [...needle];
  const length = needleChars.length;
  const contiguousRaw = (bonus: number) =>
    NUCLEO.scoreMatch * length + bonus * NUCLEO.firstCharMultiplier + bonus * (length - 1);

  let index = haystack.indexOf(needle);
  let raw = 0;
  while (index !== -1) {
    const candidate = isWordStart(haystack, index)
      ? contiguousRaw(NUCLEO.bonusBoundary)
      : NUCLEO.scoreMatch * length + NUCLEO.bonusConsecutive * (length - 1);
    raw = Math.max(raw, candidate);
    index = haystack.indexOf(needle, index + 1);
  }
  if (raw === 0 && isSubsequence(haystack, needleChars)) {
    raw = NUCLEO.scoreMatch * length;
  }
  return raw > 0 ? { kind: 'fuzzy', quality: nucleoScoreToQuality(raw) } : null;
}

// ---------------------------------------------------------------------------
// Plugin command ranking
// ---------------------------------------------------------------------------

export interface CommandRankInput {
  title: string;
  subtitle?: string;
  /** The (operator-stripped) query the user typed. */
  query: string;
  /** The query matched the plugin's activation prefix / keyword. */
  activated: boolean;
  /** Learned tier streamed by Rust for this result's stable identity. */
  learned?: SearchTier;
  frecency: number;
  declared: number;
}

/**
 * Place a plugin command on the shared ladder with the app cascade's rules:
 * title exact > title prefix > activation keyword / prefix > fuzzy title >
 * subtitle / plugin-side match, promoted by a learned binding. Plugins only
 * return results they consider relevant, so a result whose title and
 * subtitle do not match lands in `secondary` instead of being dropped.
 */
export function rankCommand(input: CommandRankInput): ResultRank {
  const title = matchText(input.title, input.query);
  let tier: SearchTier;
  let quality: number;

  if (title?.kind === 'exact') {
    tier = 'titleExact';
    quality = title.quality;
  } else if (title?.kind === 'prefix') {
    tier = 'titlePrefix';
    quality = title.quality;
  } else if (input.activated) {
    tier = 'activation';
    quality = title?.quality ?? 0;
  } else if (title) {
    tier = 'fuzzy';
    quality = title.quality;
  } else {
    tier = 'secondary';
    quality = input.subtitle ? (matchText(input.subtitle, input.query)?.quality ?? 0) : 0;
  }

  return {
    band: 'ranked',
    tier: input.learned ? strongestTier(tier, input.learned) : tier,
    quality,
    frecency: input.frecency,
    source: 'command',
    declared: input.declared,
  };
}

/** Whether the registry matched the plugin's activation prefix / keyword. */
export function isExplicitActivation(result: Pick<PluginResult, 'matchKind'>): boolean {
  return result.matchKind === 'prefix' || result.matchKind === 'keyword';
}

/** Computed calculator answers (math, units, dates, time zones) carry a `queryType`. */
function isCalculatorAnswer(result: PluginResult): boolean {
  return result.type === PluginResultType.Calculator && typeof result.data?.queryType === 'string';
}

export interface PluginRankContext {
  query: string;
  /** Stable identity (`getStableResultIdentity`), or `null` for ephemeral results. */
  identity: string | null;
  learned: ReadonlyMap<string, SearchTier>;
  frecency: number;
  /** The query is a game browse query (`games`, `jeux`, …). */
  gameBrowse: boolean;
}

/**
 * Rank a plugin result: special intents get their band (explicit web search
 * on top, game browsing, calculator answers), everything else is ranked as a
 * command on the shared ladder.
 */
export function rankPluginResult(result: PluginResult, context: PluginRankContext): ResultRank {
  const activated = isExplicitActivation(result);
  const ranked = rankCommand({
    title: result.title,
    subtitle: result.subtitle,
    query: context.query,
    activated,
    learned: context.identity ? context.learned.get(context.identity) : undefined,
    frecency: context.frecency,
    declared: result.score,
  });

  if (result.type === PluginResultType.WebSearch && activated) {
    return { ...ranked, band: 'explicitWeb' };
  }
  if (result.type === PluginResultType.Game && context.gameBrowse) {
    return { ...ranked, band: 'browse' };
  }
  if (isCalculatorAnswer(result)) {
    return { ...ranked, band: 'answer' };
  }
  return ranked;
}
