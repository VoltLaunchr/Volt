/** Preserve the score-ranked order established by the search pipeline. */
export function getSectionOrder(grouped: Map<string, unknown[]>): string[] {
  return [...grouped.keys()];
}
