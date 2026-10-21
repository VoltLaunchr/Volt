# Volt — Plan Extension Ecosystem

> Analyse concurrentielle Raycast + plan d'implémentation pour fermer les gaps.
> Basé sur l'audit du 2026-05-09. Document vivant.

---

## État actuel de notre écosystème

### Ce qui existe déjà (bien)

**CLI `volt-plugin`** — fonctionnel dans `volt-extensions/cli/` :
- `volt-plugin init` — scaffold interactif complet (inquirer, détection PM, git config auto)
- `volt-plugin test` — validation manifest + type-check TypeScript
- `volt-plugin publish` — packaging ZIP + génération entrée `registry.json`

**API TypeScript** — types de base dans `volt-extensions/api/typescript/src/` :
- `Plugin`, `PluginResult`, `PluginContext`, `PluginResultType`, `IPluginRegistry`
- Templates : `typescript-plugin`, `rust-plugin`

**Plugins publiés** : `github`, `notion` dans `volt-extensions/plugins/`

**Sécurité sandbox** (avantage vs Raycast) :
- HMAC-SHA256 sur `installed.json` + `.sig` files
- Fail-closed sur tamper detection
- SSRF prevention (private IPs, redirect SSRF, numeric IPv4)
- Allowlist `ALLOWED_PERMISSIONS` — batch rejeté sur permission inconnue
- Worker : eval/Function/WebSocket/XMLHttpRequest/importScripts désactivés

---

## Analyse des gaps vs Raycast

### Structure manifest Raycast (référence)

```json
{
  "$schema": "https://www.raycast.com/schemas/extension.json",
  "platforms": ["macOS", "Windows"],
  "commands": [
    { "name": "index", "title": "Show Items", "mode": "view" },
    { "name": "create", "title": "Create Item", "mode": "no-view" }
  ],
  "tools": [
    { "name": "get-items", "title": "Get Items", "description": "..." }
  ],
  "preferences": [
    { "name": "apiKey", "type": "password", "title": "API Key", "required": true }
  ]
}
```

### Table des gaps

| Feature | Raycast | Volt actuel | Gap |
|---|---|---|---|
| Multi-commandes par extension | `commands[]` → fichiers séparés | 1 entry point (`canHandle`) | ❌ Absent |
| Preferences système | `textfield/password/checkbox/dropdown` | Aucune | ❌ Absent |
| LocalStorage API | `LocalStorage.getItem/setItem` | Aucune | ❌ Absent |
| Hot reload dev | `ray develop` | Link + reload manuel | ⚠️ Basique |
| Command arguments inline | Définis dans manifest, inline search bar | Aucun | ❌ Absent |
| Schema JSON manifest | `$schema` strict | Runtime TS seulement | ⚠️ Partiel |
| AI Tools | `src/tools/*.ts` + evals | Aucun | ❌ Absent |
| Toast / HUD feedback | `showToast()`, `showHUD()` | `notify()` (DOM event) | ⚠️ Basique |
| `actions[]` first-class | `ActionPanel` + 14 `Action.*` | Défini localement dans github seulement | ⚠️ Partiel |
| Metadata/screenshots | `metadata/` dans le repo | Aucun | ❌ Absent |
| Scheduled commands | `interval: "5m"` | Aucun | ❌ Absent |
| Confirmation human-in-the-loop | `export const confirmation` | Aucun | ❌ Absent |
| Sécurité sandbox | Worker basique | HMAC + fail-closed + SSRF | ✅ **Volt gagne** |
| Tamper detection | Aucune | Signatures `.sig` | ✅ **Volt gagne** |
| Scaffolding CLI | `create-raycast-extension` | `volt-plugin init` ✅ | ✅ **Parité** |

---

## Plan d'implémentation — Priorités

### Critère de priorisation

**ROI** = (débloque N extensions) × (effort inversé)

---

### P0 — Fondations (débloquent tout le reste)

#### 1. `volt-plugin dev` — Hot reload

**Effort** : Moyen | **Impact** : Majeur DX

Le gap DX le plus visible. Aujourd'hui un dev doit réinstaller l'extension à chaque changement.

**Implémentation** :
- `volt-plugin dev` lance un watcher `chokidar` sur `src/`
- Sur changement → rebuild (sucrase/esbuild) → signal au backend via un endpoint local (ou fichier sentinel)
- Backend (`extensions.rs`) : `reload_dev_extension(path)` — réutiliser la commande `load_dev_extension` existante
- Frontend : écouter `volt:extension-reloaded` pour trigger un re-register du Worker

```bash
volt-plugin dev
# → Watching src/ for changes...
# → [12:34:01] Rebuilt in 145ms — extension reloaded
```

---

#### 2. Preferences system — `voltApi.getPreference(key)`

**Effort** : Moyen | **Impact** : Débloque toutes les intégrations API-key

Sans préférences, impossible de faire GitHub, Notion, OpenAI, etc. sans coder l'API key en dur.

**Manifest (`manifest.json`)** :
```json
{
  "preferences": [
    { "name": "apiKey", "type": "secret", "title": "GitHub Token", "required": true },
    { "name": "maxResults", "type": "number", "title": "Max Results", "default": 10 },
    { "name": "language", "type": "select", "title": "Language", "options": ["en", "fr"], "default": "en" }
  ]
}
```

**Types de préférences** :
- `text` — champ texte libre
- `secret` — champ password, valeur dans OS keyring (via `keyring_store.rs`)
- `number` — nombre avec validation min/max optionnels
- `boolean` — toggle
- `select` — dropdown avec `options[]`
- `file` / `directory` — sélecteur de chemin

**API runtime** :
```typescript
const apiKey = voltApi.getPreference<string>('apiKey');
const maxResults = voltApi.getPreference<number>('maxResults', 10);
```

**Implémentation backend** :
- Nouvelle commande Tauri `get_extension_preference(extension_id, key)` dans `extensions.rs`
- `secret` → lu depuis `keyring_store` (clé domaine : `volt:ext:{id}:pref:{key}`)
- Autres types → JSON dans `{app_data}/extensions/{id}/preferences.json`
- UI Settings : panneau preferences auto-généré depuis le manifest quand l'utilisateur clique "Configure" sur une extension

---

#### 3. Storage API — `voltApi.storage.get/set`

**Effort** : Faible | **Impact** : Débloque persistance tokens, cache, état

Raycast utilise `localStorage` browser (non isolé). Volt peut faire mieux : storage par extension isolé.

**API runtime** :
```typescript
await voltApi.storage.set('todos', JSON.stringify(todos));
const raw = await voltApi.storage.get('todos');
const todos = JSON.parse(raw ?? '[]');
await voltApi.storage.remove('todos');
await voltApi.storage.clear(); // vide le storage de cette extension
```

**Implémentation** :
- Nouveau fichier `{app_data}/extensions/{id}/storage.db` (SQLite, table `kv(key TEXT PK, value TEXT)`)
- Commandes Tauri : `ext_storage_get`, `ext_storage_set`, `ext_storage_remove`, `ext_storage_clear`
- Proxy dans le Worker : `postMessage({ type: 'storage', op: 'get', key })` → réponse via `MessageChannel`
- Taille max : 10 MB par extension (configurable)

---

### P1 — Fonctionnalités de haut impact

#### 4. `actions[]` first-class dans l'API core

**Effort** : Faible | **Impact** : Élimine la divergence github/core

`PluginResultAction` est défini localement dans `plugins/github/src/index.ts` mais absent de `api/typescript/src/types.ts`. Il faut l'unifier.

**Types à ajouter dans `api/typescript/src/types.ts`** :
```typescript
export type ActionHandler =
  | 'openUrl'
  | 'copyToClipboard'
  | 'openFile'
  | 'runCommand'
  | 'custom';

export interface PluginResultAction {
  id: string;
  title: string;
  icon?: string;
  shortcut?: string; // ex: "cmd+shift+c"
  handler: ActionHandler;
  data?: Record<string, unknown>;
}

// Ajouter à PluginResult :
// actions?: PluginResultAction[];
```

**Frontend** : `ResultContextMenu` et `useResultActions.ts` lire `result.actions[]` en priorité sur les actions par défaut.

---

#### 5. Toast/feedback first-class

**Effort** : Faible | **Impact** : UX feedback after actions

`voltApi.notify()` existe mais dispatch un DOM event non garanti. Besoin d'un vrai composant.

**API runtime** :
```typescript
voltApi.showToast({ title: 'Copied!', style: 'success' }); // 2s auto-dismiss
voltApi.showToast({ title: 'Fetching...', style: 'loading' }); // dismiss on suivant
voltApi.showToast({ title: 'Error', subtitle: err.message, style: 'error' });
```

**Implémentation** :
- `volt:toast` DOM event avec payload `{ title, subtitle?, style, duration? }`
- Composant `Toast.tsx` dans `shared/components/ui/` (existe probablement déjà une base)
- Wire dans `App.tsx` via `useEffect` + `addEventListener('volt:toast')`

---

#### 6. Multi-commandes par extension

**Effort** : Élevé | **Impact** : Fondamental pour les vraies intégrations

Aujourd'hui une extension = un seul `canHandle`. Pour GitHub il faut : search repos, search issues, open PR, etc. comme commandes séparées dans le launcher.

**Manifest** :
```json
{
  "commands": [
    { "name": "search-repos", "title": "Search Repositories", "prefix": "gh repos" },
    { "name": "search-issues", "title": "Search Issues", "prefix": "gh issues" },
    { "name": "my-prs", "title": "My Pull Requests", "mode": "no-view" }
  ]
}
```

**Implémentation** :
- `ExtensionManifest` : ajouter `commands?: ExtensionCommand[]`
- `ExtensionCommand` : `{ name, title, prefix?, mode: 'view' | 'no-view', icon? }`
- `ExtensionLoader` : pour chaque commande, créer un Worker distinct OU passer `{ command: 'search-repos' }` dans le context
- Search pipeline : si une commande a un `prefix`, la proposer dans les résultats quand le prefix match
- Mode `no-view` : exécution immédiate sans ouvrir une vue, retour via `showToast`

---

#### 7. Command arguments inline

**Effort** : Moyen | **Impact** : UX fluide style Raycast

Raycast permet `gh issues <repo>` directement dans la search bar avec auto-complétion des arguments.

**Manifest** :
```json
{
  "commands": [{
    "name": "search-issues",
    "title": "Search Issues",
    "arguments": [
      { "name": "repo", "title": "Repository", "type": "text", "required": false }
    ]
  }]
}
```

**Implémentation** :
- `queryParser.ts` : détecter `<prefix> <arg1> <arg2>` selon le manifest de la commande active
- `SearchBar` : afficher les arguments comme "chips" inline (style Raycast)
- Passer `args: Record<string, string>` dans `PluginContext`

---

### P2 — Différentiation et écosystème

#### 8. JSON Schema pour les manifests

**Effort** : Faible | **Impact** : DX + validation à l'install

```json
{
  "$schema": "https://raw.githubusercontent.com/VoltLaunchr/volt-extensions/main/schemas/manifest.schema.json"
}
```

- Générer le schema depuis les types TypeScript (`manifest.types.ts` → `manifest.schema.json`)
- `volt-plugin test` valide contre le schema en plus du type-check
- Héberger le schéma canonique dans `volt-extensions` et référencer son URL GitHub brute.

---

#### 9. Metadata + screenshots Store

**Effort** : Faible | **Impact** : Extension Store visuel

```
my-extension/
├── metadata/
│   ├── description.md
│   ├── screenshot-1.png   (800×500)
│   └── screenshot-2.png
└── manifest.json
```

- `volt-plugin publish` vérifie la présence de `metadata/` et au moins 1 screenshot
- `registry.json` : ajouter `screenshots[]` et `description_md` path
- Extension Store UI : afficher les screenshots dans la fiche

---

#### 10. AI Tools (vision long terme)

**Effort** : Élevé | **Impact** : Différentiation majeure

Exposer les données des extensions comme outils callables par un modèle AI intégré.

**Pattern** (inspiré de Raycast mais mieux) :
```typescript
// src/tools/search-repos.ts
export const schema = {
  input: { query: 'string', language: 'string?' },
  output: { repos: 'GitHubRepo[]' }
} as const;

export default async function tool(input: typeof schema.input) {
  return { repos: await api.searchRepositories(input.query) };
}
```

- `ai.yaml` par extension : instructions système + evals
- Backend : command `call_extension_tool(extension_id, tool_name, input)`
- Integration avec Volt AI (futur) : les tools des extensions apparaissent comme tools callable

---

## Récapitulatif des priorités

```
P0 — Fondations (sprint 1-2)
  [ ] volt-plugin dev (hot reload)
  [ ] Preferences system (manifest + API + UI Settings)
  [ ] Storage API (SQLite isolé par extension)

P1 — Fonctionnalités (sprint 3-4)
  [ ] actions[] first-class dans api/typescript/src/types.ts
  [ ] Toast/showToast first-class
  [ ] Multi-commandes dans le manifest

P2 — Écosystème (sprint 5+)
  [ ] Command arguments inline
  [ ] JSON Schema manifest
  [ ] Metadata + screenshots Store
  [ ] AI Tools
```

---

## Ce que Volt fait mieux que Raycast

| Point | Volt | Raycast |
|---|---|---|
| **Sécurité sandbox** | HMAC-SHA256 + fail-closed + SSRF prevention | Worker basique |
| **Tamper detection** | Signatures `.sig` + alertes UI | Absent |
| **Storage isolation** | SQLite par extension (P0) | `localStorage` browser partagé |
| **Secrets** | OS keyring (type `secret`) | `password` dans localStorage |
| **Cross-platform** | Win/Mac/Linux | macOS + Windows (beta) |
| **Open source** | MIT | Propriétaire |
| **Prix** | Gratuit | $8/mois Pro |

---

## Notes d'implémentation

### Ordre de modification des fichiers (Volt-public)

**Preferences + Storage (P0)** :
1. `src-tauri/src/commands/extensions.rs` — ajouter `get_extension_preference`, `ext_storage_*`
2. `src-tauri/src/lib.rs` — enregistrer les nouvelles commandes dans `invoke_handler!`
3. `src/features/extensions/types/extension.types.ts` — `ExtensionPreference`, `ExtensionCommand`
4. `src/features/extensions/services/extensionWorker.ts` — proxy storage/prefs dans le Worker
5. `src/features/settings/` — panneau preferences auto-généré

**CLI hot reload (P0)** :
1. `volt-extensions/cli/src/commands/dev.ts` — nouveau fichier
2. `volt-extensions/cli/src/index.ts` — enregistrer la commande `dev`
3. `src-tauri/src/commands/extensions.rs` — `reload_dev_extension` (ou réutiliser `load_dev_extension`)

**Actions first-class (P1)** :
1. `volt-extensions/api/typescript/src/types.ts` — `PluginResultAction`, ajouter à `PluginResult`
2. `src/features/results/components/ResultItem.tsx` — lire `result.actions[]`
3. `src/app/hooks/useResultActions.ts` — dispatcher les actions custom
