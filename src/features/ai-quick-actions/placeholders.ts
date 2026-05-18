/**
 * Dynamic placeholders for AI Quick Action system prompts.
 *
 * Users can embed tokens like `{clipboard}`, `{date}`, `{time}`, `{datetime}`,
 * `{selection}` (alias of `{clipboard}`), and `{lang}` in their system prompts.
 * These are resolved at trigger time using the runtime context.
 *
 * The resolver is pure (no side effects) and case-insensitive on token names.
 * Unknown tokens are left intact so a stray `{foo}` in a prompt does not get
 * silently dropped.
 */

export interface PlaceholderContext {
  clipboard?: string;
  /** BCP 47 language tag, e.g., `navigator.language` ("en-US", "fr-FR"). */
  lang?: string;
  /** Defaults to `new Date()` if omitted. */
  now?: Date;
}

/** Available placeholder tokens, exposed for UI documentation. */
export const PLACEHOLDER_DOCS: { token: string; description: string }[] = [
  { token: '{clipboard}', description: 'Current clipboard contents' },
  { token: '{selection}', description: 'Alias for {clipboard}' },
  { token: '{date}', description: "Today's date (e.g., May 15, 2026)" },
  { token: '{time}', description: 'Current time (e.g., 14:30)' },
  { token: '{datetime}', description: 'Date + time (ISO 8601)' },
  { token: '{lang}', description: 'Current UI language code' },
];

/** Resolve a single token (lower-cased) using the context. Returns `null` for unknown tokens. */
function resolveToken(name: string, ctx: PlaceholderContext): string | null {
  const lang =
    ctx.lang ?? (typeof navigator !== 'undefined' ? navigator.language : undefined) ?? 'en-US';
  const now = ctx.now ?? new Date();

  switch (name) {
    case 'clipboard':
    case 'selection':
      return ctx.clipboard ?? '';
    case 'date':
      return now.toLocaleDateString(lang, { dateStyle: 'long' });
    case 'time':
      return now.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
    case 'datetime':
      return now.toISOString();
    case 'lang':
      return lang;
    default:
      return null;
  }
}

/**
 * Replace all known `{token}` occurrences in `template` using `ctx`.
 * Unknown tokens are left intact (so prompts pass through if a user mistypes one).
 * Match is case-insensitive on the token name (`{Clipboard}` works too).
 */
export function resolvePlaceholders(template: string, ctx: PlaceholderContext): string {
  if (!template) return template;
  return template.replace(/\{(\w+)\}/g, (match, rawName: string) => {
    const resolved = resolveToken(rawName.toLowerCase(), ctx);
    return resolved ?? match;
  });
}

// ---------------------------------------------------------------------------
// Dev-mode sanity checks (no Vitest setup yet — these run once on module load).
// ---------------------------------------------------------------------------
if (import.meta.env.DEV) {
  (() => {
    const fixedNow = new Date('2026-05-15T14:30:00.000Z');
    const ctx: PlaceholderContext = { clipboard: 'HELLO', lang: 'en-US', now: fixedNow };
    const assert = (label: string, cond: boolean, detail?: string) => {
      if (!cond) {
        console.warn(`[placeholders] assertion failed: ${label}${detail ? ` — ${detail}` : ''}`);
      }
    };

    // 1. Known tokens are replaced.
    const r1 = resolvePlaceholders('clip={clipboard} lang={lang}', ctx);
    assert('known tokens replaced', r1 === 'clip=HELLO lang=en-US', r1);

    // 2. Unknown tokens are preserved verbatim.
    const r2 = resolvePlaceholders('keep {unknown} and {also_unknown}', ctx);
    assert('unknown tokens preserved', r2 === 'keep {unknown} and {also_unknown}', r2);

    // 3. Token names are case-insensitive.
    const r3 = resolvePlaceholders('{Clipboard} {LANG}', ctx);
    assert('case-insensitive token names', r3 === 'HELLO en-US', r3);

    // 4. Empty template returns empty.
    const r4 = resolvePlaceholders('', ctx);
    assert('empty template returns empty', r4 === '', r4);

    // 5. Multiple occurrences of the same token are all replaced.
    const r5 = resolvePlaceholders('{clipboard} / {clipboard} / {clipboard}', ctx);
    assert('multiple occurrences replaced', r5 === 'HELLO / HELLO / HELLO', r5);

    // 6. {selection} aliases {clipboard}.
    const r6 = resolvePlaceholders('{selection}', ctx);
    assert('selection aliases clipboard', r6 === 'HELLO', r6);
  })();
}
