/**
 * Plugin activation matching — the single source of truth for *when* a built-in
 * plugin surfaces results. Used by the registry (gating + scoring annotation)
 * and by each plugin's `canHandle`/`match` (via `resolveActivation`).
 *
 * Matching rules (all case-insensitive, operating on the trimmed query):
 *   - PREFIX: query starts with one of `prefixes` (e.g. `:`, `>`, `;`, `ql:`).
 *     The matched prefix is stripped from `stripped`.
 *   - KEYWORD: query equals a keyword, or starts with `<keyword><separator>`
 *     where separator ∈ { space, tab, `:` }. The keyword + separator is
 *     stripped. The plugin's own `name` is auto-added as a keyword so every
 *     built-in is discoverable by typing its name.
 *   - ALWAYS: `mode: 'always'` activates for any query of length >= minLength.
 *
 * Prefixes are checked before keywords (symbolic triggers are more explicit).
 */

import type { ActivationMatch, Plugin, PluginActivation, PluginContext } from '../types';

const KEYWORD_SEPARATORS = new Set([' ', '\t', ':']);

const NO_MATCH: ActivationMatch = { matched: false, kind: 'none', stripped: '' };

/** Strip leading separator characters (space/tab/colon) from a string. */
function stripLeadingSeparators(value: string): string {
  let i = 0;
  while (i < value.length && KEYWORD_SEPARATORS.has(value.charAt(i))) {
    i += 1;
  }
  return value.slice(i);
}

/**
 * Derive the keyword set for a plugin: the explicitly declared keywords plus
 * the plugin name (lowercased). De-duplicated, empty entries dropped.
 */
function keywordSet(keywords: string[] | undefined, pluginName: string): string[] {
  const set = new Set<string>();
  for (const kw of keywords ?? []) {
    const normalized = kw.trim().toLowerCase();
    if (normalized) set.add(normalized);
  }
  const name = pluginName.trim().toLowerCase();
  if (name) set.add(name);
  return [...set];
}

/**
 * Compute how `query` matches the given activation manifest.
 *
 * Returns `{ matched, kind, stripped, token }`. `stripped` is the residual
 * query after removing the matched prefix/keyword (empty for a bare trigger),
 * which the plugin uses as its actual search term.
 */
export function matchActivation(
  query: string,
  activation: PluginActivation | undefined,
  pluginName: string,
): ActivationMatch {
  if (!activation) return NO_MATCH;

  const trimmed = query.trim();
  if (!trimmed) return NO_MATCH;

  const lower = trimmed.toLowerCase();

  // 1. Prefixes — most explicit, checked first. Longest prefix wins so e.g.
  //    `ql:` is preferred over a hypothetical `q` prefix.
  const prefixes = [...(activation.prefixes ?? [])].sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    const p = prefix.toLowerCase();
    if (p && lower.startsWith(p)) {
      return {
        matched: true,
        kind: 'prefix',
        stripped: stripLeadingSeparators(trimmed.slice(prefix.length)).trim(),
        token: prefix,
      };
    }
  }

  // 2. Keywords — query equals keyword, or `keyword` + separator + rest.
  //    Longest keyword first so `notes` is preferred over `note`/`n`.
  const keywords = keywordSet(activation.keywords, pluginName).sort((a, b) => b.length - a.length);
  for (const kw of keywords) {
    if (lower === kw) {
      return { matched: true, kind: 'keyword', stripped: '', token: kw };
    }
    if (lower.startsWith(kw) && KEYWORD_SEPARATORS.has(lower.charAt(kw.length))) {
      return {
        matched: true,
        kind: 'keyword',
        stripped: stripLeadingSeparators(trimmed.slice(kw.length)).trim(),
        token: kw,
      };
    }
  }

  // 3. Always-on plugins (name-matching, e.g. games) activate on any query of
  //    sufficient length. Keyword/prefix matches above take precedence so their
  //    `matchKind` (and scoring boost) still apply.
  if (activation.mode === 'always') {
    const minLength = activation.minLength ?? 2;
    if (trimmed.length >= minLength) {
      return { matched: true, kind: 'always', stripped: trimmed };
    }
  }

  return NO_MATCH;
}

/**
 * Resolve the activation match for a plugin against a context. Reuses the
 * registry-computed `context.activation` when present (the hot path), otherwise
 * recomputes from `plugin.activation` — this keeps direct unit tests, which
 * pass a bare `{ query }` context, working without the registry.
 */
export function resolveActivation(plugin: Plugin, context: PluginContext): ActivationMatch {
  return context.activation ?? matchActivation(context.query, plugin.activation, plugin.name);
}
