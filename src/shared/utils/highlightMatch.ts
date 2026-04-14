/**
 * Character-level match highlighting for search results.
 *
 * Uses a greedy approach: for each query character, finds the next occurrence
 * in the text (case-insensitive), preferring word-start positions.
 */

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

/**
 * Split `text` into segments with `highlighted: true` for characters that
 * match the `query` string. Returns a single unhighlighted segment when
 * there is no query or no matches.
 */
export function highlightMatch(text: string, query: string): HighlightSegment[] {
  if (!query || !text) {
    return [{ text: text || '', highlighted: false }];
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();

  if (!lowerQuery) {
    return [{ text, highlighted: false }];
  }

  // Find matching character indices using a greedy approach
  const matchedIndices: Set<number> = new Set();
  let textPos = 0;

  for (let qi = 0; qi < lowerQuery.length; qi++) {
    const qChar = lowerQuery[qi];

    // First pass: try to find a word-start match from current position
    let wordStartIdx = -1;
    for (let ti = textPos; ti < lowerText.length; ti++) {
      if (lowerText[ti] === qChar) {
        // Check if this is a word start (first char or preceded by space/separator)
        if (ti === 0 || /[\s\-_./\\]/.test(text[ti - 1])) {
          wordStartIdx = ti;
          break;
        }
      }
    }

    if (wordStartIdx !== -1) {
      matchedIndices.add(wordStartIdx);
      textPos = wordStartIdx + 1;
    } else {
      // Fallback: find next occurrence of the character
      const idx = lowerText.indexOf(qChar, textPos);
      if (idx === -1) {
        break; // No more matches possible
      }
      matchedIndices.add(idx);
      textPos = idx + 1;
    }
  }

  if (matchedIndices.size === 0) {
    return [{ text, highlighted: false }];
  }

  // Build segments from matched indices
  const segments: HighlightSegment[] = [];
  let currentStart = 0;
  let currentHighlighted = matchedIndices.has(0);

  for (let i = 1; i <= text.length; i++) {
    const isHighlighted = matchedIndices.has(i);
    if (i === text.length || isHighlighted !== currentHighlighted) {
      segments.push({
        text: text.slice(currentStart, i),
        highlighted: currentHighlighted,
      });
      currentStart = i;
      currentHighlighted = isHighlighted;
    }
  }

  return segments;
}
