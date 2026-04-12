# Volt — Roadmap Produit

> Document vivant. Les estimations sont des fourchettes, pas des engagements. Pour les details techniques (fichiers modifies, criteres d'acceptation), voir la [roadmap technique](../build-release/ROADMAP.md).

---

## Etat actuel du produit (v0.0.4)

### Ce qui est livre et fonctionnel

**Core**
- Recherche fuzzy multi-source (apps, fichiers, plugins) avec scoring intelligent
- Lancement d'applications cross-platform (Windows, macOS, Linux)
- Debounce 150ms + protection contre les reponses perimees
- Navigation 100% clavier (fleches, Enter, Esc, Tab, raccourcis Alt+1-9)
- Menu contextuel (clic droit ou Ctrl+K) : lancer, ouvrir dossier, copier chemin, proprietes

**Plugins builtin (9 frontend)**
- Calculator : expressions math, conversions d'unites, dates, fuseaux horaires
- Emoji Picker : recherche par nom, navigation par categorie, copie instantanee
- Web Search : multi-moteurs (Google, DuckDuckGo, Bing) via prefixe `?`
- Timer : durees flexibles, pomodoro, notifications desktop
- System Monitor : CPU, RAM, disque en temps reel
- System Commands : reload, settings, quit avec matching fuzzy
- Game Scanner : detection Steam, Epic, GOG, EA, Ubisoft, Riot, Xbox
- Steam : integration dediee
- File Explorer : navigation de fichiers

**Plugins backend (3 Rust)**
- Clipboard Manager : historique, pin, recherche, persistance
- Game Scanner : scan multi-plateforme avec cache
- System Monitor : metriques CPU/RAM/disque via sysinfo

**Parametres**
- 8 categories de parametres (general, apparence, hotkeys, indexation, plugins, extensions, about)
- Hotkey globale configurable en live (defaut : Ctrl+Shift+Space)
- 9 positions de fenetre predefinies + coordonnees custom
- Themes : Dark, Light, Auto (suit le systeme)
- Demarrage automatique avec le systeme (autostart)

**Indexation de fichiers**
- Scan en arriere-plan avec filtres (extensions, exclusions, profondeur max)
- Recherche fuzzy sur les fichiers indexes
- Configuration des dossiers a indexer depuis les parametres

**Infrastructure**
- Auto-updater fonctionnel (signature minisign, endpoint GitHub Releases)
- CI/CD multi-plateforme : Windows (MSI/NSIS), macOS Intel+ARM (DMG), Linux (deb/AppImage/rpm)
- 130 tests frontend + 113 tests Rust
- Logging structure (tracing) avec rotation quotidienne, accessible depuis Settings
- CSP securise

**Plateformes**
- Windows 10/11
- macOS (Intel + Apple Silicon)
- Linux (X11, deb/AppImage/rpm)

---

## Phase 1 — v1.0 "Stable Release" (en cours)

**Valeur utilisateur :** Installer Volt sans avertissements systeme ni etapes manuelles. Avoir confiance que l'app est stable et diagnosticable.

### Ce qui est deja fait

| Element | Statut |
|---------|--------|
| Nettoyage dead code et stubs | ✅ M1.1 |
| Script de synchronisation de version | ✅ M1.1 |
| Suite de tests (130 frontend + 113 Rust) | ✅ M1.2 |
| CSP securise dans tauri.conf.json | ✅ M1.3 |
| Capabilities auditees | ✅ M1.3 |
| Scaffolding CI pour code signing | ✅ M1.3 |
| Documentation code signing (SIGNING_SETUP.md) | ✅ M1.3 |
| Logging structure (tracing + rotation) | ✅ M1.4 |
| Migration console → logger (frontend + backend) | ✅ M1.4 |
| Diagnostics exportables depuis Settings | ✅ M1.4 |
| Refactor App.tsx (1090 → 197 lignes) | ✅ M2.1 |
| VoltError type + migration 73 commandes | ✅ M2.2 |
| CI gates clippy + rustfmt | ✅ M2.2 |

### Ce qui reste

| Element | Bloqueur |
|---------|----------|
| **Code signing Windows** (Authenticode) | Achat certificat (~250€/an OV ou ~25€/an Certum Open Source) |
| **Code signing macOS** (Developer ID + notarization) | Inscription Apple Developer (~99$/an) |
| Release de test signee (v1.0-rc) | Certificats ci-dessus |
| Test fresh install Windows 11 + macOS | Release signee |

### Checklist release 1.0

- [ ] Certificats achetes et secrets GitHub configures
- [ ] Installation MSI sur Windows 11 vierge → aucun SmartScreen
- [ ] Installation DMG sur macOS recent → passe Gatekeeper
- [ ] Test auto-update depuis v0.0.4 → v1.0.0
- [ ] Changelog et annonce README mis a jour

---

## Phase 2 — v1.x "Quality & Polish"

**Valeur utilisateur :** Une experience soignee, accessible, et agreable au quotidien.

### Accessibilite (WCAG AA)

- ResultsList en pattern `role="listbox"` + `aria-activedescendant`
- Focus trap dans Modal et Settings (Tab ne sort pas)
- ARIA live region : annonce "N resultats trouves" apres recherche
- Verification contraste WCAG AA sur themes light + dark
- Audit Lighthouse/axe : 0 erreur a11y critique

### Onboarding premier lancement

- Tour guide de 3 ecrans : hotkey globale, indexation, plugins disponibles
- Possibilite de skip pour les utilisateurs avances

### Indicateur d'indexation

- Toast discret au premier demarrage : "Indexation en cours... N fichiers"
- Indicateur visuel pendant le scan en arriere-plan (aujourd'hui silencieux)

### Store Zustand (decouplage etat)

- Remplacer le state monolithique React par un store Zustand
- Meilleure separation des responsabilites entre composants
- Report de M2.1 — PR dediee pour ne pas melanger ajout de dep et refactor

### Autres ameliorations UX

- Help dialog integre (F1 ou `?`) listant les raccourcis
- Toast contextuel sur erreurs (branche sur `logger.error` existant)

---

## Phase 3 — v1.5 "Platform & Extensibility"

**Valeur utilisateur :** Demarrage instantane meme avec des dossiers enormes. Possibilite d'installer des plugins communautaires sans recompiler Volt.

### Index persistant SQLite + watcher incremental

- Base SQLite pour l'index fichiers (plus de rescan complet au demarrage)
- File watcher incremental via `notify` : creation/modification/suppression detectees en < 2s
- Demarrage app avec 50k fichiers indexes < 500ms
- Settings > Indexing : taille DB, derniere mise a jour, bouton "Rebuild"

### Plugin loader externe

- Plugins TypeScript compiles en JS dans `~/.volt/plugins/`
- Format : dossier `.volt-plugin` avec `manifest.json` + `index.js`
- Sandbox JS via Web Worker (isolation, timeout, pas d'acces systeme sans permission)
- Modele de permissions : network, fs, clipboard — confirmation utilisateur au premier load
- Plugin exemple `hello-world-plugin/` distribue dans `examples/`

### Extension marketplace & registry

- Registry JSON statique heberge sur GitHub Pages
- Publication par PR sur le repo registry avec manifest
- UI dans Settings > Extensions > Store : recherche, install, update
- Auto-update : notification quand une version plus recente est disponible

### Plugin SDK / CLI

- CLI `volt-plugin` pour scaffolder, tester et publier un plugin
- Documentation complete et exemples

---

## Phase 4 — v2.0 "Power Features"

**Valeur utilisateur :** Volt devient un hub de productivite, pas juste un lanceur.

### Recherche avancee

- **Frecency scoring** : melange recency + frequence d'utilisation (donnees deja trackees dans `file_history.db` et `launcher/history`)
- **Prefixes de scope** : `f:` fichiers, `a:` apps, `!` plugin force, `>` commande shell
- **Operateurs** : `ext:pdf`, `in:~/Documents`, `size:>10mb`, `modified:<7d`
- **Resultats predictifs** : top suggestions avant frappe basees sur frecency

### Snippets & text expansion

- Triggers rapides → texte ou commande pre-definie
- Gestion depuis Settings avec import/export

### Preview panel

- Panneau lateral affichant le contenu des fichiers (texte, images, PDF)
- Activation via raccourci ou clic

### Clipboard manager avance

- Pin, recherche, redaction automatique des mots de passe detectes
- Historique persistant avec limite configurable

### Shell commands inline

- Prefixe `>` pour executer une commande shell (`>git status`)
- Resultat affiche inline dans Volt

---

## Phase 5 — v2.x "Ecosystem"

**Valeur utilisateur :** Personnalisation complete et integration profonde avec l'OS.

### Themes custom

- Export/import de theme via JSON (tokens CSS variables)
- Editeur de theme UI dans Settings
- Theme marketplace (suit l'extension marketplace)

### Integrations OS natives

- **Linux** : support Wayland propre (aujourd'hui X11 implicite)
- **macOS** : option pour piggyback sur l'index Spotlight
- **Windows** : alternative au scan custom via Windows Search Index

### Protocoles custom

- `volt://search?q=chrome` pour integrations externes
- Deep linking depuis d'autres applications

### Sync settings cloud (optionnel)

- Synchronisation des parametres, snippets et themes entre machines
- Opt-in, aucune donnee envoyee par defaut

---

## Backlog ouvert

Idees non priorisees, a evaluer selon les retours utilisateurs :

- Profils de scoring configurables (exact priority, fuzzy priority, frecency)
- Recherche semantique via tags/descriptions personnalises
- Bookmarks / favoris epingles en tete de liste
- Mode debug avec telemetrie locale (temps de scan, perf recherche)
- Hot reload des plugins en mode dev
- Documentation auto-generee des commandes Tauri
- Support WASM pour plugins haute performance
- Integration avec des services tiers (Notion, Slack, GitHub...)
- Accessibilite avancee (lecteur d'ecran complet, mode haut contraste)

---

## Timeline estimee

| Phase | Version cible | Duree estimee | Description |
|-------|---------------|---------------|-------------|
| Phase 1 | v1.0 | ~3 semaines | Stable, signee, installable |
| Phase 2 | v1.x | ~3-4 semaines | Qualite, accessibilite, polish |
| Phase 3 | v1.5 | ~5-8 semaines | Index persistant, plugins externes, marketplace |
| Phase 4 | v2.0 | ~6-8 semaines | Recherche avancee, snippets, preview, shell |
| Phase 5 | v2.x | Continu | Themes, integrations OS, sync cloud |

> Estimations basees sur un developpeur solo a temps partiel (~3h/jour). Les phases 1-3 representent ~3-4 mois. La phase 4 marque le passage a une v2.0 majeure.

---

_Document vivant — mettre a jour a chaque fin de phase. Les estimations sont des ordres de grandeur, pas des engagements._
