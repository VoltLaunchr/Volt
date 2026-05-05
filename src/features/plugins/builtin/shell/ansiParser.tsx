/**
 * React component that renders ANSI-escaped text.
 * The actual parser lives in `./ansiParser.utils.ts`.
 */

import React, { useMemo } from 'react';
import { parseAnsi } from './ansiParser.utils';

/** Renders ANSI-escaped text with CSS-styled spans */
export function AnsiText({ text }: { text: string }): React.JSX.Element {
  const segments = useMemo(() => parseAnsi(text), [text]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.style ? (
          <span key={i} style={seg.style}>{seg.text}</span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
