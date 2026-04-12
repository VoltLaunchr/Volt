# Guide de Publication des Plugins

Guide pour transformer la documentation Markdown en contenu web pour votre site.

## 📋 Structure recommandée du site

```
votre-site.com/
├── /                              # Page d'accueil
├── /docs                          # Documentation principale
│   ├── /getting-started           # Guide de démarrage
│   ├── /architecture              # Architecture technique
│   └── /contributing              # Guide de contribution
├── /plugins                       # Section plugins
│   ├── /                          # Vue d'ensemble des plugins
│   ├── /guide                     # Guide de développement
│   ├── /api                       # Référence API
│   ├── /examples                  # Exemples
│   └── /template                  # Template de démarrage
└── /showcase                      # Galerie de plugins
```

---

## 🎨 Conversion Markdown → Web

### Option 1 : Site statique (Docusaurus, VitePress, etc.)

#### Docusaurus (React-based)

1. **Installation**

```bash
npx create-docusaurus@latest volt-docs classic
cd volt-docs
```

2. **Structure des fichiers**

```
volt-docs/
├── docs/
│   ├── intro.md
│   ├── plugins/
│   │   ├── guide.md              # ← PLUGIN_DEVELOPMENT.md
│   │   ├── api-reference.md      # ← PLUGIN_API_REFERENCE.md
│   │   ├── examples.md           # ← PLUGIN_EXAMPLES.md
│   │   └── template.md           # ← PLUGIN_TEMPLATE.md
│   └── architecture.md
├── blog/                         # Blog (optionnel)
└── src/
    └── pages/                    # Pages custom
```

3. **Configuration (`docusaurus.config.js`)**

```javascript
module.exports = {
  title: 'Volt Documentation',
  tagline: 'Build powerful plugins for Volt',
  url: 'https://votre-site.com',
  baseUrl: '/',

  themeConfig: {
    navbar: {
      title: 'Volt',
      logo: {
        alt: 'Volt Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'doc',
          docId: 'intro',
          position: 'left',
          label: 'Docs',
        },
        {
          type: 'doc',
          docId: 'plugins/guide',
          position: 'left',
          label: 'Plugin Development',
        },
        {
          href: 'https://github.com/VoltLaunchr/Volt',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },

    sidebar: {
      plugins: [
        {
          type: 'category',
          label: 'Plugin Development',
          items: ['plugins/guide', 'plugins/api-reference', 'plugins/examples', 'plugins/template'],
        },
      ],
    },

    prism: {
      theme: require('prism-react-renderer/themes/github'),
      darkTheme: require('prism-react-renderer/themes/dracula'),
      additionalLanguages: ['rust', 'typescript'],
    },
  },
};
```

4. **Copier les fichiers**

```bash
# Copier la documentation
cp docs/PLUGIN_DEVELOPMENT.md volt-docs/docs/plugins/guide.md
cp docs/PLUGIN_API_REFERENCE.md volt-docs/docs/plugins/api-reference.md
cp docs/PLUGIN_EXAMPLES.md volt-docs/docs/plugins/examples.md
cp docs/PLUGIN_TEMPLATE.md volt-docs/docs/plugins/template.md
```

5. **Ajouter les métadonnées (front matter)**

Ajoutez en haut de chaque fichier :

```markdown
---
id: plugin-guide
title: Plugin Development Guide
sidebar_label: Development Guide
sidebar_position: 1
---

# Plugin Development Guide

...reste du contenu...
```

6. **Build & Deploy**

```bash
npm run build
# Les fichiers statiques sont dans build/
```

---

#### VitePress (Vue-based)

1. **Installation**

```bash
npm init
npm add -D vitepress
npx vitepress init
```

2. **Configuration (`.vitepress/config.ts`)**

```typescript
import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Volt Documentation',
  description: 'Build powerful plugins for Volt',

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Docs', link: '/docs/' },
      { text: 'Plugins', link: '/plugins/guide' },
    ],

    sidebar: {
      '/plugins/': [
        {
          text: 'Plugin Development',
          items: [
            { text: 'Guide', link: '/plugins/guide' },
            { text: 'API Reference', link: '/plugins/api-reference' },
            { text: 'Examples', link: '/plugins/examples' },
            { text: 'Template', link: '/plugins/template' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/VoltLaunchr/Volt' }],
  },
});
```

---

### Option 2 : CMS (Notion, Ghost, WordPress)

#### Notion

1. Créez une page pour chaque document
2. Utilisez [react-notion](https://github.com/splitbee/react-notion) ou [Notion API](https://developers.notion.com/)
3. Convertissez le Markdown en blocs Notion

#### Ghost

1. Installez [Ghost](https://ghost.org/)
2. Créez des posts pour chaque guide
3. Utilisez des tags pour organiser (`plugin`, `api`, `guide`, etc.)

---

### Option 3 : Custom avec Next.js

1. **Installation**

```bash
npx create-next-app@latest volt-docs
cd volt-docs
npm install next-mdx-remote gray-matter
```

2. **Structure**

```
volt-docs/
├── pages/
│   ├── index.tsx
│   ├── docs/
│   │   └── [slug].tsx           # Page dynamique pour la doc
│   └── plugins/
│       └── [slug].tsx           # Page dynamique pour les plugins
├── content/
│   ├── docs/
│   │   └── getting-started.md
│   └── plugins/
│       ├── guide.md
│       ├── api-reference.md
│       ├── examples.md
│       └── template.md
└── components/
    ├── Layout.tsx
    └── MDXComponents.tsx
```

3. **Page dynamique (`pages/plugins/[slug].tsx`)**

```typescript
import { serialize } from 'next-mdx-remote/serialize';
import { MDXRemote } from 'next-mdx-remote';
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export default function PluginDoc({ source, frontMatter }) {
  return (
    <Layout>
      <h1>{frontMatter.title}</h1>
      <MDXRemote {...source} />
    </Layout>
  );
}

export async function getStaticPaths() {
  const pluginsDir = path.join(process.cwd(), 'content/plugins');
  const files = fs.readdirSync(pluginsDir);

  const paths = files.map((filename) => ({
    params: {
      slug: filename.replace('.md', ''),
    },
  }));

  return { paths, fallback: false };
}

export async function getStaticProps({ params }) {
  const markdownPath = path.join(
    process.cwd(),
    'content/plugins',
    `${params.slug}.md`
  );

  const markdownContent = fs.readFileSync(markdownPath, 'utf-8');
  const { data: frontMatter, content } = matter(markdownContent);
  const mdxSource = await serialize(content);

  return {
    props: {
      source: mdxSource,
      frontMatter,
    },
  };
}
```

---

## 🎯 SEO et Métadonnées

### Ajout de métadonnées

```markdown
---
title: Plugin Development Guide
description: Complete guide to creating powerful plugins for Volt
keywords: volt, plugin, development, typescript, rust
author: Volt Team
canonical: https://votre-site.com/plugins/guide
---
```

### Open Graph (partage social)

```html
<meta property="og:title" content="Plugin Development Guide" />
<meta property="og:description" content="Complete guide to creating plugins for Volt" />
<meta property="og:image" content="https://votre-site.com/images/plugin-guide-og.png" />
<meta property="og:url" content="https://votre-site.com/plugins/guide" />
<meta name="twitter:card" content="summary_large_image" />
```

---

## 🖼️ Enrichissement visuel

### 1. Captures d'écran

Ajoutez des images pour illustrer :

```markdown
## Interface du plugin

![Calculator Plugin](./images/calculator-demo.png)

Le plugin Calculator permet de...
```

### 2. Vidéos

Intégrez des vidéos de démonstration :

```markdown
### Démo en vidéo

<video controls>
  <source src="./videos/plugin-demo.mp4" type="video/mp4">
</video>
```

### 3. Code interactif

Utilisez [CodeSandbox](https://codesandbox.io/) ou [StackBlitz](https://stackblitz.com/) :

```markdown
### Essayez maintenant

<iframe
  src="https://codesandbox.io/embed/volt-plugin-example"
  style="width:100%; height:500px; border:0; border-radius: 4px;"
/>
```

---

## 🎨 Personnalisation visuelle

### Thème custom

```css
/* custom.css */
:root {
  --volt-primary: #6366f1;
  --volt-secondary: #8b5cf6;
  --volt-accent: #ec4899;
}

.plugin-card {
  background: linear-gradient(135deg, var(--volt-primary), var(--volt-secondary));
  border-radius: 12px;
  padding: 20px;
  color: white;
}

.code-block {
  background: #1e1e1e;
  border-radius: 8px;
  padding: 16px;
  overflow-x: auto;
}
```

### Composants React custom

```typescript
// components/PluginCard.tsx
export function PluginCard({ plugin }) {
  return (
    <div className="plugin-card">
      <div className="plugin-icon">{plugin.icon}</div>
      <h3>{plugin.name}</h3>
      <p>{plugin.description}</p>
      <a href={`/plugins/${plugin.id}`}>Learn more →</a>
    </div>
  );
}
```

---

## 🔍 Recherche

### Algolia DocSearch

1. Inscrivez-vous sur [Algolia DocSearch](https://docsearch.algolia.com/)
2. Configurez dans Docusaurus :

```javascript
// docusaurus.config.js
module.exports = {
  themeConfig: {
    algolia: {
      appId: 'YOUR_APP_ID',
      apiKey: 'YOUR_SEARCH_API_KEY',
      indexName: 'volt',
    },
  },
};
```

---

## 📊 Analytics

### Google Analytics

```javascript
// docusaurus.config.js
module.exports = {
  plugins: [
    [
      '@docusaurus/plugin-google-analytics',
      {
        trackingID: 'UA-XXXXXXXXX-X',
      },
    ],
  ],
};
```

### Plausible Analytics (privacy-friendly)

```html
<!-- HTML -->
<script defer data-domain="votre-site.com" src="https://plausible.io/js/plausible.js"></script>
```

---

## 🚀 Déploiement

### Vercel

1. Poussez votre code sur GitHub
2. Importez sur [Vercel](https://vercel.com/)
3. Configurez :
   - Framework: Next.js / Docusaurus / VitePress
   - Build Command: `npm run build`
   - Output Directory: `build` ou `dist`

### Netlify

1. Poussez sur GitHub
2. Connectez sur [Netlify](https://netlify.com/)
3. Configurez :
   - Build command: `npm run build`
   - Publish directory: `build`

### GitHub Pages

```bash
# Package.json
{
  "scripts": {
    "deploy": "gh-pages -d build"
  }
}

# Deploy
npm run deploy
```

---

## 📱 Version mobile

### Responsive design

```css
/* Mobile first */
@media (max-width: 768px) {
  .sidebar {
    display: none;
  }

  .content {
    padding: 16px;
  }

  pre code {
    font-size: 12px;
  }
}
```

### Menu mobile

```typescript
// MobileNav.tsx
export function MobileNav() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)}>☰</button>

      {isOpen && (
        <nav className="mobile-nav">
          <a href="/docs">Docs</a>
          <a href="/plugins/guide">Plugin Guide</a>
          <a href="/plugins/examples">Examples</a>
        </nav>
      )}
    </>
  );
}
```

---

## 🎁 Features bonus

### 1. Playground interactif

Créez un éditeur en ligne pour tester les plugins :

```typescript
// components/PluginPlayground.tsx
import { useState } from 'react';
import { pluginRegistry } from '../lib/plugin-system';

export function PluginPlayground() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  const handleSearch = async () => {
    const results = await pluginRegistry.query({ query });
    setResults(results);
  };

  return (
    <div className="playground">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Try: calc 2+2"
      />
      <button onClick={handleSearch}>Search</button>

      <div className="results">
        {results.map(r => (
          <div key={r.id}>{r.title}</div>
        ))}
      </div>
    </div>
  );
}
```

### 2. Galerie de plugins

Créez une page showcase :

```typescript
// pages/showcase.tsx
const plugins = [
  {
    id: 'calculator',
    name: 'Calculator',
    icon: '🧮',
    description: 'Math expressions and conversions',
    author: 'Volt Team',
    downloads: 1250,
  },
  // ... autres plugins
];

export default function Showcase() {
  return (
    <div className="showcase">
      <h1>Plugin Showcase</h1>

      <div className="plugin-grid">
        {plugins.map(plugin => (
          <PluginCard key={plugin.id} plugin={plugin} />
        ))}
      </div>
    </div>
  );
}
```

### 3. Système de versioning

Gérez plusieurs versions de la doc :

```javascript
// docusaurus.config.js
module.exports = {
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          versions: {
            current: {
              label: 'v2.0 (Current)',
            },
            '1.0': {
              label: 'v1.0',
              path: 'v1',
            },
          },
        },
      },
    ],
  ],
};
```

---

## ✅ Checklist de publication

- [ ] Copier tous les fichiers Markdown
- [ ] Ajouter les métadonnées (front matter)
- [ ] Optimiser les images
- [ ] Ajouter des captures d'écran
- [ ] Configurer la recherche
- [ ] Tester sur mobile
- [ ] Configurer Analytics
- [ ] Ajouter sitemap.xml
- [ ] Tester tous les liens
- [ ] Configurer le domaine
- [ ] Déployer sur production
- [ ] Partager sur les réseaux sociaux

---

## 🔗 Ressources

- [Docusaurus](https://docusaurus.io/)
- [VitePress](https://vitepress.dev/)
- [Next.js](https://nextjs.org/)
- [Algolia DocSearch](https://docsearch.algolia.com/)
- [Vercel](https://vercel.com/)
- [Netlify](https://netlify.com/)

---

Bonne publication ! 🚀
