import {
  AlignLeft,
  Bot,
  BookOpen,
  Braces,
  Check,
  CheckCheck,
  Code2,
  FileText,
  Languages,
  Lightbulb,
  ListTree,
  Mail,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pencil,
  Quote,
  RefreshCw,
  Reply,
  ScrollText,
  Sparkles,
  Wand2,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Registry of named icons usable by AI Quick Actions and presets.
 *
 * Keys are stored verbatim in `AiQuickAction.icon` (and in Rust defaults).
 * Anything not in this map is rendered as raw text so that legacy installs
 * — which seeded the icon field with glyphs like `✦` or `</>` — keep working.
 */
export const QUICK_ACTION_ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  wand: Wand2,
  check: Check,
  'check-check': CheckCheck,
  pencil: Pencil,
  minimize: Minimize2,
  maximize: Maximize2,
  languages: Languages,
  code: Code2,
  braces: Braces,
  list: AlignLeft,
  'list-tree': ListTree,
  refresh: RefreshCw,
  message: MessageSquare,
  bot: Bot,
  lightbulb: Lightbulb,
  book: BookOpen,
  mail: Mail,
  quote: Quote,
  reply: Reply,
  document: FileText,
  scroll: ScrollText,
  wrench: Wrench,
};

export type QuickActionIconName = keyof typeof QUICK_ACTION_ICONS;

/** Legacy glyph → registry key. Lets `✦`/`</>`/etc. render as real icons too. */
const LEGACY_GLYPH_MAP: Record<string, QuickActionIconName> = {
  '✦': 'sparkles',
  '✓': 'check',
  '✔': 'check',
  '↤': 'minimize',
  '↦': 'maximize',
  '🌐': 'languages',
  '</>': 'code',
  '≡': 'list',
  '⟳': 'refresh',
};

interface QuickActionIconProps {
  /** Registry name, legacy glyph, or arbitrary user string. */
  name: string | null | undefined;
  size?: number;
  /** Tailwind/CSS color, defaults to currentColor. */
  color?: string;
  /** Strokes width forwarded to Lucide. */
  strokeWidth?: number;
}

/**
 * Renders a Lucide icon if `name` matches the registry (or a known legacy
 * glyph). Falls back to displaying the raw string so custom user icons —
 * including emoji — still work. Returns the default `Wand2` if `name` is
 * empty.
 */
export function QuickActionIcon({ name, size = 14, color, strokeWidth = 2 }: QuickActionIconProps) {
  if (!name) {
    return <Wand2 size={size} color={color} strokeWidth={strokeWidth} aria-hidden />;
  }

  const direct = QUICK_ACTION_ICONS[name];
  if (direct) {
    const Icon = direct;
    return <Icon size={size} color={color} strokeWidth={strokeWidth} aria-hidden />;
  }

  const legacy = LEGACY_GLYPH_MAP[name];
  if (legacy) {
    const Icon = QUICK_ACTION_ICONS[legacy];
    return <Icon size={size} color={color} strokeWidth={strokeWidth} aria-hidden />;
  }

  return (
    <span
      aria-hidden
      style={{
        fontSize: size,
        lineHeight: 1,
        color,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {name}
    </span>
  );
}
