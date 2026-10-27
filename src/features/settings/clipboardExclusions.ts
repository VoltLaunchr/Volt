/** Foreground application detection uses the executable stem, without Windows' .exe suffix. */
export function normalizeClipboardAppName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, '')
    .trim();
}

/** Preserve existing exclusions verbatim; canonicalize only the entry being added. */
export function addClipboardAppExclusion(existing: readonly string[], input: string): string[] {
  const name = normalizeClipboardAppName(input);
  if (!name || existing.some((app) => app.toLowerCase() === name)) return [...existing];
  return [...existing, name];
}
