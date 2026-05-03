/**
 * URL auto-detection for the search bar.
 *
 * Returns a normalized URL string (always with https:// prefix) when the query
 * looks like a URL, or null when it does not.
 *
 * Rules that trigger detection:
 *   - Starts with http:// or https://
 *   - Matches domain.tld (e.g. github.com, sub.example.co.uk)
 *   - Matches localhost:<PORT> or 127.0.0.1[:<PORT>]
 *
 * Rules that suppress detection:
 *   - Query contains spaces
 *   - Query contains power-user operators (ext:, in:, size:, modified:)
 *   - Single word without dots (e.g. "calc", "notion")
 */

// A representative subset of common TLDs used for domain validation.
// Kept intentionally broad — adds gTLDs (app, dev, io, …) and ccTLDs
// that appear often in developer tooling.
const KNOWN_TLDS = new Set([
  // Generic
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int',
  // New gTLDs (common)
  'io', 'app', 'dev', 'ai', 'co', 'me', 'info', 'biz', 'tech', 'cloud',
  'online', 'site', 'web', 'store', 'shop', 'media', 'blog', 'news',
  'digital', 'pro', 'studio',
  // ccTLDs (common)
  'uk', 'us', 'ca', 'au', 'de', 'fr', 'jp', 'cn', 'br', 'in', 'ru',
  'nl', 'es', 'it', 'se', 'no', 'dk', 'fi', 'ch', 'at', 'be', 'pl',
  'nz', 'mx', 'ar', 'za', 'kr', 'tw', 'sg', 'hk', 'ie', 'il', 'pt',
]);

// Operator prefixes used by queryParser.ts — skip URL detection when present
const OPERATOR_RE = /\b(ext|in|size|modified):/;

/**
 * Detect whether `query` looks like a URL.
 *
 * @returns A normalised URL string with an explicit scheme, or `null`.
 */
export function detectUrl(query: string): string | null {
  const q = query.trim();

  // No spaces allowed in a URL query
  if (!q || q.includes(' ')) return null;

  // Skip if query contains power-user operators
  if (OPERATOR_RE.test(q)) return null;

  // Explicit scheme: http(s)://...
  if (/^https?:\/\/.+/i.test(q)) {
    // Validate it parses as a URL
    try {
      const url = new URL(q);
      if (url.hostname) return q;
    } catch {
      // fall through
    }
    return null;
  }

  // localhost[:port]
  if (/^localhost(:\d+)?(\/.*)?$/i.test(q)) {
    return `http://${q}`;
  }

  // 127.0.0.1[:port]
  if (/^127\.0\.0\.1(:\d+)?(\/.*)?$/.test(q)) {
    return `http://${q}`;
  }

  // domain.tld pattern — at least two dot-separated parts, ending in a known TLD
  // Allow an optional path/query after the host (e.g. github.com/user/repo)
  const domainMatch = q.match(/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(:\d+)?(\/.*)?$/i);
  if (domainMatch) {
    const host = domainMatch[1].toLowerCase();
    const parts = host.split('.');
    const tld = parts[parts.length - 1].toLowerCase();
    if (KNOWN_TLDS.has(tld)) {
      return `https://${q}`;
    }
  }

  return null;
}
