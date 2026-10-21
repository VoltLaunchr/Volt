import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, 'public', 'icons', 'app');
const LUCIDE_DIR = path.join(ROOT, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons');

const icons = {
  'about-settings_icon.svg': ['info', '#6366f1', '#4338ca'],
  'about_news_icon.svg': ['newspaper', '#8b5cf6', '#6d28d9'],
  'account_icon.svg': ['circle-user-round', '#64748b', '#334155'],
  'advanced_settings_icon.svg': ['settings-2', '#f97316', '#c2410c'],
  'ai_icon.svg': ['brain-circuit', '#a855f7', '#6d28d9'],
  'app_icon.svg': ['layout-grid', '#3b82f6', '#1d4ed8'],
  'calculator_icon.svg': ['calculator', '#a78b5b', '#57534e'],
  'clipboard_history_icon.svg': ['clipboard-clock', '#06b6d4', '#0e7490'],
  'create_extension_icon.svg': ['code-xml', '#10b981', '#047857'],
  'create_note_icons.svg': ['file-plus-corner', '#ef4444', '#b91c1c'],
  'emojis_icon.svg': ['smile-plus', '#f59e0b', '#d97706'],
  'extension_icon.svg': ['package-open', '#8b5cf6', '#5b21b6'],
  'file_search_icon.svg': ['file-search-corner', '#14b8a6', '#0f766e'],
  'games_icon.svg': ['gamepad-2', '#f97316', '#c2410c'],
  'integration_icon.svg': ['cable', '#06b6d4', '#0369a1'],
  'manage_extensions_icon.svg': ['blocks', '#10b981', '#047857'],
  'plugin_icon.svg': ['puzzle', '#ec4899', '#be185d'],
  'pomodoro_icon.svg': ['timer', '#3b82f6', '#1d4ed8'],
  'search_note_icons.svg': ['notebook-tabs', '#ef4444', '#b91c1c'],
  'settings_icon.svg': ['settings', '#64748b', '#334155'],
  'shell_icon.svg': ['square-terminal', '#22c55e', '#15803d'],
  'short_cut_icon.svg': ['keyboard', '#f59e0b', '#b45309'],
  'sync_icon.svg': ['refresh-cw', '#0ea5e9', '#0369a1'],
  'system_monitor_icon.svg': ['chart-no-axes-combined', '#06b6d4', '#0e7490'],
  'volt_note_icons.svg': ['notebook-pen', '#ef4444', '#b91c1c'],
  'web_search_icon.svg': ['earth', '#8b5cf6', '#4f46e5'],
};

const attributeName = (name) =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const escapeAttribute = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const renderNode = ([tag, attributes]) => {
  const renderedAttributes = Object.entries(attributes)
    .filter(([name]) => name !== 'key')
    .map(([name, value]) => `${attributeName(name)}="${escapeAttribute(value)}"`)
    .join(' ');

  return `    <${tag} ${renderedAttributes} />`;
};

const renderIcon = (iconNode, startColor, endColor) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" fill="none">
  <defs>
    <linearGradient id="surface" x1="7" y1="4" x2="41" y2="45" gradientUnits="userSpaceOnUse">
      <stop stop-color="#202330" />
      <stop offset="0.52" stop-color="#151821" />
      <stop offset="1" stop-color="#0D0F16" />
    </linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(13 8) rotate(43) scale(44)">
      <stop stop-color="${startColor}" stop-opacity="0.72" />
      <stop offset="0.42" stop-color="${endColor}" stop-opacity="0.28" />
      <stop offset="1" stop-color="${endColor}" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="edge" x1="7" y1="4" x2="42" y2="43" gradientUnits="userSpaceOnUse">
      <stop stop-color="${startColor}" stop-opacity="0.92" />
      <stop offset="0.36" stop-color="#FFFFFF" stop-opacity="0.15" />
      <stop offset="0.72" stop-color="#FFFFFF" stop-opacity="0.05" />
      <stop offset="1" stop-color="${endColor}" stop-opacity="0.55" />
    </linearGradient>
    <linearGradient id="top-line" x1="11" y1="5" x2="34" y2="5" gradientUnits="userSpaceOnUse">
      <stop stop-color="${startColor}" stop-opacity="0" />
      <stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0.48" />
      <stop offset="1" stop-color="${startColor}" stop-opacity="0" />
    </linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#02030A" flood-opacity="0.52" />
    </filter>
    <filter id="glyph-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.7" />
    </filter>
    <clipPath id="clip">
      <rect x="2" y="2" width="44" height="44" rx="13" />
    </clipPath>
  </defs>
  <g filter="url(#shadow)">
    <rect x="2" y="2" width="44" height="44" rx="13" fill="url(#surface)" />
    <g clip-path="url(#clip)">
      <rect x="2" y="2" width="44" height="44" fill="url(#glow)" />
      <circle cx="39" cy="40" r="13" fill="${endColor}" fill-opacity="0.1" />
    </g>
    <rect x="2.5" y="2.5" width="43" height="43" rx="12.5" stroke="url(#edge)" />
    <path d="M12 4.5H34" stroke="url(#top-line)" stroke-linecap="round" />
  </g>
  <g transform="translate(12 12)" stroke="${startColor}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.28" filter="url(#glyph-glow)">
${iconNode.map(renderNode).join('\n')}
  </g>
  <g transform="translate(12 12)" stroke="#F8FAFF" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
${iconNode.map(renderNode).join('\n')}
  </g>
</svg>
`;

await mkdir(OUTPUT_DIR, { recursive: true });

for (const [filename, [lucideName, startColor, endColor]] of Object.entries(icons)) {
  const moduleUrl = pathToFileURL(path.join(LUCIDE_DIR, `${lucideName}.js`));
  const { __iconNode } = await import(moduleUrl.href);
  const svg = renderIcon(__iconNode, startColor, endColor);
  await writeFile(path.join(OUTPUT_DIR, filename), svg, 'utf8');
}

console.log(`Generated ${Object.keys(icons).length} app icons in ${OUTPUT_DIR}`);
