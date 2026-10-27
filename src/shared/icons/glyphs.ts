/**
 * Volt glyph registry: original 16x16 line glyphs (stroke 1.5, round caps/joins, currentColor).
 * Each glyph is a list of SVG path strings. Paths flagged `fill` get a soft tint in the
 * `filled` variant; the rest stay pure outline.
 */

export interface GlyphPath {
  d: string;
  fill?: boolean;
}

export interface Glyph {
  paths: readonly GlyphPath[];
}

const n = (value: number): string => String(Math.round(value * 100) / 100);

/** Closed circle path centred on (cx, cy). */
function circle(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0z`;
}

/** Closed rounded rectangle path. */
function rrect(x: number, y: number, w: number, h: number, r: number): string {
  const iw = n(w - 2 * r);
  const ih = n(h - 2 * r);
  const arc = (dx: number, dy: number) => `a${n(r)} ${n(r)} 0 0 1 ${n(dx)} ${n(dy)}`;
  return (
    `M${n(x + r)} ${n(y)}h${iw}${arc(r, r)}v${ih}${arc(-r, r)}h-${iw}` +
    `${arc(-r, -r)}v-${ih}${arc(r, -r)}z`
  );
}

export const VOLT_GLYPHS = {
  sliders: {
    paths: [
      { d: 'M2 5h4.5M11.5 5H14M2 11h1.5M8.5 11H14' },
      { d: circle(9, 5, 2.25), fill: true },
      { d: circle(6, 11, 2.25), fill: true },
    ],
  },
  user: {
    paths: [
      { d: circle(8, 5.25, 2.75), fill: true },
      { d: 'M2.75 13.75c0-2.7 2.35-4.5 5.25-4.5s5.25 1.8 5.25 4.5' },
    ],
  },
  sync: {
    paths: [
      { d: 'M13.25 7A5.25 5.25 0 0 0 4 4.9M4 2.25V5h2.75' },
      { d: 'M2.75 9A5.25 5.25 0 0 0 12 11.1M12 13.75V11H9.25' },
    ],
  },
  keyboard: {
    paths: [
      { d: rrect(1.5, 3.25, 13, 9.5, 2.25), fill: true },
      { d: 'M4.5 6.5h.01M7 6.5h.01M9.5 6.5h.01M12 6.5h.01M5 9.75h6' },
    ],
  },
  gauge: {
    paths: [
      { d: 'M3.1 12.75a6.25 6.25 0 1 1 9.8 0' },
      { d: 'M8 9.5l2.5-3.25' },
      { d: circle(8, 9.75, 1.25), fill: true },
    ],
  },
  info: {
    paths: [{ d: circle(8, 8, 6.25), fill: true }, { d: 'M8 7.5v3.25M8 5.25h.01' }],
  },
  cube: {
    paths: [
      { d: 'M8 1.75l5.5 3.1v6.3L8 14.25l-5.5-3.1v-6.3z', fill: true },
      { d: 'M2.5 4.85L8 8l5.5-3.15M8 8v6.25' },
    ],
  },
  nodes: {
    paths: [
      { d: circle(4, 8, 2), fill: true },
      { d: circle(12, 4, 2), fill: true },
      { d: circle(12, 12, 2), fill: true },
      { d: 'M5.9 7.1L10.1 4.9M5.9 8.9L10.1 11.1' },
    ],
  },
  'app-grid': {
    paths: [
      { d: rrect(2, 2, 5, 5, 1.5), fill: true },
      { d: rrect(9, 2, 5, 5, 1.5), fill: true },
      { d: rrect(2, 9, 5, 5, 1.5), fill: true },
      { d: rrect(9, 9, 5, 5, 1.5), fill: true },
    ],
  },
  puzzle: {
    paths: [
      {
        d: 'M2.5 5.5h3.2a1.6 1.6 0 1 1 3.2 0h2.6v2.8a1.6 1.6 0 1 1 0 3.2v2h-9z',
        fill: true,
      },
    ],
  },
  'file-search': {
    paths: [
      { d: 'M7 14.25H4.5A1.5 1.5 0 0 1 3 12.75v-9.5a1.5 1.5 0 0 1 1.5-1.5H9l3.5 3.5V6' },
      { d: 'M9 1.75v3.5h3.5' },
      { d: circle(10.5, 10.5, 2.5), fill: true },
      { d: 'M12.4 12.4l2.1 2.1' },
    ],
  },
  globe: {
    paths: [
      { d: circle(8, 8, 6.25), fill: true },
      { d: 'M1.75 8h12.5' },
      {
        d: 'M8 1.75c1.8 1.7 2.7 3.8 2.7 6.25S9.8 12.55 8 14.25C6.2 12.55 5.3 10.45 5.3 8S6.2 3.45 8 1.75z',
      },
    ],
  },
  clipboard: {
    paths: [
      { d: rrect(2.75, 2.75, 10.5, 11.5, 2), fill: true },
      { d: rrect(5.5, 1.5, 5, 2.5, 1) },
      { d: 'M5.5 8h5M5.5 10.75h3' },
    ],
  },
  terminal: {
    paths: [
      { d: rrect(1.5, 2.5, 13, 11, 2.5), fill: true },
      { d: 'M5 6.25L7.25 8 5 9.75M8.75 10h2.5' },
    ],
  },
  smile: {
    paths: [
      { d: circle(8, 8, 6.25), fill: true },
      { d: 'M5.8 6.6h.01M10.2 6.6h.01M5.4 9.7c.7 1.15 1.6 1.7 2.6 1.7s1.9-.55 2.6-1.7' },
    ],
  },
  sparkle: {
    paths: [
      {
        d: 'M8 1.5c.6 4 2.5 5.9 6.5 6.5-4 .6-5.9 2.5-6.5 6.5-.6-4-2.5-5.9-6.5-6.5 4-.6 5.9-2.5 6.5-6.5z',
        fill: true,
      },
    ],
  },
  note: {
    paths: [
      {
        d: 'M2.5 4A1.5 1.5 0 0 1 4 2.5h8A1.5 1.5 0 0 1 13.5 4v5.5l-4 4H4A1.5 1.5 0 0 1 2.5 12z',
        fill: true,
      },
      { d: 'M13.5 9.5h-3a1 1 0 0 0-1 1v3M5.5 6h5M5.5 8.5h2.5' },
    ],
  },
  braces: {
    paths: [
      {
        d: 'M6.25 2.5c-1.5 0-2.25.7-2.25 2.1v1.4c0 1-.7 2-1.9 2 1.2 0 1.9 1 1.9 2v1.4c0 1.4.75 2.1 2.25 2.1',
      },
      {
        d: 'M9.75 2.5c1.5 0 2.25.7 2.25 2.1v1.4c0 1 .7 2 1.9 2-1.2 0-1.9 1-1.9 2v1.4c0 1.4-.75 2.1-2.25 2.1',
      },
      { d: circle(8, 8, 0.75), fill: true },
    ],
  },
  bolt: {
    paths: [{ d: 'M8.75 1.5L3.5 9h4l-.75 5.5L12.5 7h-4z', fill: true }],
  },
  calculator: {
    paths: [
      { d: rrect(3, 1.75, 10, 12.5, 2), fill: true },
      { d: rrect(5.25, 4, 5.5, 2.25, 0.6) },
      { d: 'M5.75 9h.01M8 9h.01M10.25 9h.01M5.75 11.5h.01M8 11.5h.01M10.25 11.5h.01' },
    ],
  },
  gamepad: {
    paths: [
      {
        d: 'M5 4.75h6a3.5 3.5 0 0 1 3.4 4.3l-.5 2a2 2 0 0 1-3.4.9L9.4 10.9H6.6l-1.1 1.05a2 2 0 0 1-3.4-.9l-.5-2A3.5 3.5 0 0 1 5 4.75z',
        fill: true,
      },
      { d: 'M5 7v2.5M3.75 8.25h2.5M10.75 7.5h.01M12 9h.01' },
    ],
  },
  command: {
    paths: [
      { d: circle(5, 5, 1.75), fill: true },
      { d: circle(11, 5, 1.75), fill: true },
      { d: circle(5, 11, 1.75), fill: true },
      { d: circle(11, 11, 1.75), fill: true },
      { d: 'M6.75 5h2.5M6.75 11h2.5M5 6.75v2.5M11 6.75v2.5' },
    ],
  },
  pulse: {
    paths: [{ d: 'M1.5 8.5h3l1.75-4.5 3.5 8 1.75-3.5h3', fill: false }, { d: circle(8, 8, 6.5) }],
  },
  timer: {
    paths: [{ d: circle(8, 9, 5.25), fill: true }, { d: 'M8 9V6.5M6.25 1.75h3.5' }],
  },
  'window-grid': {
    paths: [{ d: rrect(1.75, 2.5, 12.5, 11, 2), fill: true }, { d: 'M1.75 6h12.5M6.5 6v7.5' }],
  },
  link: {
    paths: [
      { d: 'M6.75 9.25a2.75 2.75 0 0 0 3.9 0l2-2a2.75 2.75 0 0 0-3.9-3.9l-.6.6' },
      { d: 'M9.25 6.75a2.75 2.75 0 0 0-3.9 0l-2 2a2.75 2.75 0 0 0 3.9 3.9l.6-.6' },
    ],
  },
} as const satisfies Record<string, Glyph>;

export type VoltIconName = keyof typeof VOLT_GLYPHS;

export const VOLT_ICON_NAMES = Object.keys(VOLT_GLYPHS) as VoltIconName[];

export function hasVoltGlyph(name: string): name is VoltIconName {
  return Object.prototype.hasOwnProperty.call(VOLT_GLYPHS, name);
}
