import React from 'react';

type ShortcutCategoryIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>;

export interface ShortcutCategoryMeta {
  Icon: ShortcutCategoryIcon;
  colorClass: string;
  bgClass: string;
}

function applicationsGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function browserGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 9.5h15M4.5 14.5h15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 4c2 2.1 3 4.7 3 8s-1 5.9-3 8M12 4c-2 2.1-3 4.7-3 8s1 5.9 3 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function gamingGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M7.5 9.5h9a4.5 4.5 0 0 1 4.1 2.7l.8 3.2a3.1 3.1 0 0 1-5 3l-1.8-1.7H9.4l-1.8 1.7a3.1 3.1 0 0 1-5-3l.8-3.2a4.5 4.5 0 0 1 4.1-2.7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7.5 13.8h3M9 12.3v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M15.5 13.1h.1M18 15h.1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function developmentGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="m9 8-4 4 4 4M15 8l4 4-4 4M13 6l-2 12" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function systemGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="m13.2 3.5.5 2a7 7 0 0 1 1.7.7l1.8-1 1.6 1.6-1 1.8c.3.5.5 1.1.7 1.7l2 .5v2.4l-2 .5a7 7 0 0 1-.7 1.7l1 1.8-1.6 1.6-1.8-1a7 7 0 0 1-1.7.7l-.5 2h-2.4l-.5-2a7 7 0 0 1-1.7-.7l-1.8 1-1.6-1.6 1-1.8a7 7 0 0 1-.7-1.7l-2-.5v-2.4l2-.5c.2-.6.4-1.2.7-1.7l-1-1.8 1.6-1.6 1.8 1c.5-.3 1.1-.5 1.7-.7l.5-2h2.4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function mediaGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="4" y="5" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 9.2v5.6l5-2.8-5-2.8Z" fill="currentColor" />
      <path d="M4 9h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function communicationGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M5 6.5h14a2 2 0 0 1 2 2v6.3a2 2 0 0 1-2 2h-6.3L8.5 20v-3.2H5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7.5 10.5h9M7.5 13.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function graphicsGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M14.5 5.5 18 9l-8.4 8.4-4.2.9.9-4.2 8.2-8.6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13.3 6.8 16.7 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M5 20h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function officeGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M7 3.8h7l4 4V20a1.7 1.7 0 0 1-1.7 1.7H7A1.7 1.7 0 0 1 5.3 20V5.5A1.7 1.7 0 0 1 7 3.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 4v4h4M8.5 17v-3M12 17v-5M15.5 17v-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function fileManagementGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M3.5 7.2A2.2 2.2 0 0 1 5.7 5h4l2 2.2h6.6a2.2 2.2 0 0 1 2.2 2.2v7.4a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2V7.2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4 10h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function otherGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M12 4.5 14 9l4.5 2-4.5 2-2 4.5-2-4.5-4.5-2L10 9l2-4.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M18.5 4.5v3M20 6h-3M5.5 16.5v2M6.5 17.5h-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const SHORTCUT_CATEGORY_META: Record<string, ShortcutCategoryMeta> = {
  applications: {
    Icon: applicationsGlyph,
    colorClass: 'text-sky-300',
    bgClass: 'bg-sky-400/10 border-sky-300/15',
  },
  browsers: {
    Icon: browserGlyph,
    colorClass: 'text-cyan-300',
    bgClass: 'bg-cyan-400/10 border-cyan-300/15',
  },
  gaming: {
    Icon: gamingGlyph,
    colorClass: 'text-violet-300',
    bgClass: 'bg-violet-400/10 border-violet-300/15',
  },
  development: {
    Icon: developmentGlyph,
    colorClass: 'text-emerald-300',
    bgClass: 'bg-emerald-400/10 border-emerald-300/15',
  },
  system: {
    Icon: systemGlyph,
    colorClass: 'text-amber-300',
    bgClass: 'bg-amber-400/10 border-amber-300/15',
  },
  media: {
    Icon: mediaGlyph,
    colorClass: 'text-rose-300',
    bgClass: 'bg-rose-400/10 border-rose-300/15',
  },
  communication: {
    Icon: communicationGlyph,
    colorClass: 'text-indigo-300',
    bgClass: 'bg-indigo-400/10 border-indigo-300/15',
  },
  graphics: {
    Icon: graphicsGlyph,
    colorClass: 'text-fuchsia-300',
    bgClass: 'bg-fuchsia-400/10 border-fuchsia-300/15',
  },
  office: {
    Icon: officeGlyph,
    colorClass: 'text-lime-300',
    bgClass: 'bg-lime-400/10 border-lime-300/15',
  },
  filemanagement: {
    Icon: fileManagementGlyph,
    colorClass: 'text-blue-300',
    bgClass: 'bg-blue-400/10 border-blue-300/15',
  },
  other: {
    Icon: otherGlyph,
    colorClass: 'text-slate-300',
    bgClass: 'bg-slate-400/10 border-slate-300/15',
  },
};

export function getShortcutCategoryMeta(category: string): ShortcutCategoryMeta {
  const normalized = category.replace(/[\s_-]/g, '').toLowerCase();
  return SHORTCUT_CATEGORY_META[normalized] ?? SHORTCUT_CATEGORY_META.other;
}
