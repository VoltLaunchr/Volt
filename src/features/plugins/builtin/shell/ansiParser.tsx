/**
 * Lightweight ANSI escape code parser + React component.
 * Converts ANSI SGR sequences to inline CSS styles.
 */

import React, { useMemo } from 'react';

export interface AnsiSegment {
  text: string;
  style?: React.CSSProperties;
}

const ANSI_FG: Record<number, string> = {
  30: '#1e1e1e', 31: '#ef4444', 32: '#22c55e', 33: '#eab308',
  34: '#3b82f6', 35: '#a855f7', 36: '#06b6d4', 37: '#e5e5e5',
  90: '#737373', 91: '#f87171', 92: '#4ade80', 93: '#facc15',
  94: '#60a5fa', 95: '#c084fc', 96: '#22d3ee', 97: '#ffffff',
};

const ANSI_BG: Record<number, string> = {
  40: '#1e1e1e', 41: '#ef4444', 42: '#22c55e', 43: '#eab308',
  44: '#3b82f6', 45: '#a855f7', 46: '#06b6d4', 47: '#e5e5e5',
  100: '#737373', 101: '#f87171', 102: '#4ade80', 103: '#facc15',
  104: '#60a5fa', 105: '#c084fc', 106: '#22d3ee', 107: '#ffffff',
};

interface StyleState {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  fg: string | undefined;
  bg: string | undefined;
}

function emptyState(): StyleState {
  return { bold: false, dim: false, italic: false, underline: false, fg: undefined, bg: undefined };
}

function stateToCSS(s: StyleState): React.CSSProperties | undefined {
  const css: React.CSSProperties = {};
  let hasStyle = false;
  if (s.bold) { css.fontWeight = 'bold'; hasStyle = true; }
  if (s.dim) { css.opacity = 0.7; hasStyle = true; }
  if (s.italic) { css.fontStyle = 'italic'; hasStyle = true; }
  if (s.underline) { css.textDecoration = 'underline'; hasStyle = true; }
  if (s.fg) { css.color = s.fg; hasStyle = true; }
  if (s.bg) { css.backgroundColor = s.bg; hasStyle = true; }
  return hasStyle ? css : undefined;
}

function applyCodes(state: StyleState, codes: number[]): StyleState {
  const s = { ...state };
  for (const code of codes) {
    if (code === 0) { Object.assign(s, emptyState()); }
    else if (code === 1) { s.bold = true; }
    else if (code === 2) { s.dim = true; }
    else if (code === 3) { s.italic = true; }
    else if (code === 4) { s.underline = true; }
    else if (code === 22) { s.bold = false; s.dim = false; }
    else if (code === 23) { s.italic = false; }
    else if (code === 24) { s.underline = false; }
    else if (code === 39) { s.fg = undefined; }
    else if (code === 49) { s.bg = undefined; }
    else if (ANSI_FG[code]) { s.fg = ANSI_FG[code]; }
    else if (ANSI_BG[code]) { s.bg = ANSI_BG[code]; }
  }
  return s;
}

export function parseAnsi(input: string): AnsiSegment[] {
  if (!input) return [];

  const segments: AnsiSegment[] = [];
  let state = emptyState();
  // eslint-disable-next-line no-control-regex
  const regex = /\x1b\[([0-9;]*)([a-zA-Z])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      const text = input.slice(lastIndex, match.index);
      if (text) segments.push({ text, style: stateToCSS(state) });
    }

    if (match[2] === 'm') {
      const codesStr = match[1] || '0';
      const codes = codesStr.split(';').map(Number);
      state = applyCodes(state, codes);
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < input.length) {
    const text = input.slice(lastIndex);
    if (text) segments.push({ text, style: stateToCSS(state) });
  }

  if (segments.length === 0 && input) {
    return [{ text: input }];
  }

  return segments;
}

/** Renders ANSI-escaped text with CSS-styled spans */
export const AnsiText: React.FC<{ text: string }> = ({ text }) => {
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
};
