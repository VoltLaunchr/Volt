# Changelog

---

## v0.1.2 (2026-05-03) — Cloud Sync preview & UI polish

### Added

- **Cloud Sync settings panel**: new Sync section in Settings to push/pull snippets and quicklinks to the cloud (Premium-gated). Marked **Coming soon** — backend wiring lands in a follow-up.
- **System Monitor app window**: dedicated window with live CPU/RAM/disk/network charts (visx-based live line charts).
- **Onboarding wizard**: first-run setup window walks new users through hotkey, theme, and integrations.
- **Settings: Restart Onboarding** action under General.
- **Shell settings panel**: configure default shell, working directory, timeout, and history size; clear shell history.
- **Premium-gated Account UI**: new Account panel with login/upgrade hints.
- **Extension icons**: GitHub and Notion integration icons.
- **Build script**: `pnpm run tauri:build` wraps the PowerShell build pipeline (`scripts/build.ps1`).

### Changed

- Settings window now loads `index.html` (single-page bundle) — `settings.html` removed.
- UI components migrated to Tailwind v4 + shadcn-style primitives (Card, Field, Switch, Input, Label, Separator, Badge); per-component CSS files removed.
- Theme system consolidated into `src/styles/theme.css`.
- App lifecycle and search pipeline hooks refactored for clarity.

### Internal

- `keyring` v3 platform features made explicit (`apple-native`, `windows-native`) — silent mock fallback was breaking auth/credential storage on platforms with no backend feature enabled.
- Tauri config: `onboarding` and `system-monitor` window labels added.
- Bumped to `0.1.2` across `package.json`, `Cargo.toml`, and `tauri.conf.json`.

---

## v0.1.1 (2026-05-03) — Security hardening v2

### Security fixes

- **Auth CSRF (H9)**: `auth_start_login` generates a UUID state nonce (5 min TTL) bound to `volt://auth/callback` deep links. Callbacks without a matching pending nonce are rejected — prevents drive-by session injection via forged deep links.
- **JWT validation**: access token claims (`exp`, `iss`, `sub`) now verified against the configured Supabase URL. `user_id` and `expires_at` are taken from verified JWT claims, never from URL query params.
- **Token refresh guard**: refresh response `user_id` mismatch is rejected outright; `expires_in` is capped at 24 h to prevent upstream abuse.
- **HMAC keyring integrity (M10)**: `store_signed`/`retrieve_signed` attach a domain-tagged HMAC-SHA256 to OS keyring entries. A tampered entry causes silent logout rather than accepting a forged session.
- **Extensions fail-closed (H4)**: `installed.json` HMAC mismatch now resets `granted_permissions` to empty for every extension (forensic log per extension). Users must re-grant deliberately.
- **Extension permission allowlist (M1)**: `update_extension_permissions` validates each permission string against a server-side `ALLOWED_PERMISSIONS` list. The entire batch is rejected on a single unknown entry — no silent filtering.
- **Extension SSRF — redirect & numeric hosts**: the Worker fetch proxy now blocks HTTP redirects and rejects numeric IPv4/IPv6-mapped hostnames in addition to the existing private-range blocklist.
- **Deep-link rate-limit (H9)**: `single-instance` forwards are rate-limited and leave a forensic log trail.
- **Shell blocklist extended (H6, H7, M5)**: 9+ new blocked patterns: `Stop-Computer`, `Restart-Computer`, `Format-Volume`, `Clear-Disk`, `diskpart`, `Remove-Item -Recurse -Force <drive>:\`, `init 0/6`, `telinit 0/6`, `logoff`, PowerShell `-EncodedCommand`, `reg.exe delete`, `find -delete`.
- **Shell NFKC normalization**: blocklist matching now runs on both the raw command and an NFKC + lowercase + quote-stripped variant. Stops bypasses like `"rm" -rf /` and fullwidth homoglyphs.
- **Shell redactors extended (M6, M7)**: GitHub tokens (`ghp_`/`gho_`/…), AWS AKIA access key IDs, Stripe `sk_live_`/`sk_test_`, Slack `xox*` tokens, JSON Web Tokens, and `curl -u user:pass` are now redacted from shell history and logs.
- **UNC path rejection**: `working_dir` (shell), `open_file_with_dialog`, and `open_path` now reject UNC paths (`\\server\share`, `//server/share`) to prevent NTLM credential leaks to attacker-controlled SMB hosts.
- **`open_file_with_dialog` hardened**: `.lnk` shortcuts rejected (prevents silent re-resolution by ShellExecute); path canonicalized before invoking the OS dialog.
- **`open_path` hardened**: refuses executable file extensions so callers cannot bypass `launch_app`'s LOLBIN/extension validation.
- **Windows Search query cap**: query strings sent to the Windows Search index are now length-capped.
- **Snippets import cap**: JSON import payload size and total snippet count are now bounded.
- **`test_credential` command**: new Tauri command to verify stored credentials; token value never crosses the IPC bridge into the renderer.
- **Worker pending-map cleanup**: the extension Worker's in-flight request map is cleared on timeout, preventing memory leaks from stalled requests.

### Internal

- Clippy `-D warnings` clean on `launcher`, `windows_search`, and `lib` (all targets).
- `extension_state_sig`: new `read_state_with_outcome` API exposes `VerifyOutcome` to callers; `hmac_sign_domain`/`hmac_verify_domain` helpers for credential HMAC (constant-time comparison).
- `keyring_store`: `migrate_from_json_if_needed` now called in `save_auth_session`/`load_auth_session`/`delete_auth_session`.

---

## Version 1.0.0 (1 Janvier 2026) — Plugin documentation initial release

**Date :** 1 janvier 2026
**Auteur :** Volt Team
**Type :** Initial release

### 📚 Nouveaux documents

#### Documentation principale

1. **PLUGIN_DEVELOPMENT.md** (25.83 KB)
   - Guide complet de développement de plugins
   - Architecture du système
   - Guides Frontend et Backend
   - 3 exemples détaillés
   - Meilleures pratiques
   - FAQ

2. **PLUGIN_API_REFERENCE.md** (20.43 KB)
   - Documentation exhaustive de l'interface `Plugin`
   - Types `PluginContext`, `PluginResult`, `PluginResultType`
   - API Backend Rust (`VoltPluginAPI`)
   - Commandes Tauri
   - Helper functions
   - Système d'événements
   - Performance guidelines

3. **PLUGIN_EXAMPLES.md** (36.04 KB)
   - 7 exemples de plugins avancés :
     - Plugin avec cache
     - Plugin avec API externe (Weather)
     - Plugin avec interface dédiée (Color Picker)
     - Plugin hybride Frontend + Backend (Duplicate Finder)
     - Plugin avec paramètres utilisateur (Translator)
     - Plugin avec historique (Snippets)
     - Plugin multi-sources (Unified Search)

4. **PLUGIN_TEMPLATE.md** (13.35 KB)
   - Template prêt à l'emploi
   - Structure complète
   - Code commenté
   - Helper functions
   - Checklist

#### Documentation secondaire

5. **README.md** (6 KB)
   - Index de la documentation
   - Navigation rapide
   - Quick start

6. **PUBLISHING_GUIDE.md** (10 KB)
   - Guide de publication web
   - Conversion Markdown → Web
   - Plateformes (Docusaurus, VitePress, Next.js)
   - SEO et déploiement

7. **SUMMARY.md** (8 KB)
   - Récapitulatif pour publication
   - Structure recommandée du site
   - Contenu de chaque document
   - Checklist

8. **QUICK_REFERENCE.md** (6 KB)
   - Référence rapide
   - Snippets essentiels
   - Patterns communs

### 📊 Statistiques

- **Total :** 8 documents
- **Taille totale :** ~125 KB
- **Exemples de code :** 50+
- **Patterns avancés :** 7
- **Langues :** Français

### 🎯 Couverture

- ✅ Développement Frontend (TypeScript)
- ✅ Développement Backend (Rust)
- ✅ Architecture et design patterns
- ✅ Performance et sécurité
- ✅ Testing et debugging
- ✅ Publication et déploiement

### 🚀 Fonctionnalités documentées

#### Plugin System

- [x] Interface Plugin complète
- [x] PluginRegistry
- [x] PluginContext
- [x] PluginResult
- [x] PluginResultType
- [x] Timeout automatique (500ms)
- [x] Error handling

#### Frontend API

- [x] canHandle()
- [x] match() (sync et async)
- [x] execute()
- [x] Helper functions
- [x] Événements personnalisés
- [x] Cache patterns

#### Backend API (Rust)

- [x] VoltPluginAPI
- [x] Tauri commands
- [x] File system access
- [x] Cache management
- [x] Configuration

#### Examples

- [x] Simple plugins (7 exemples basiques)
- [x] Advanced plugins (7 exemples avancés)
- [x] Hybrid plugins (Frontend + Backend)
- [x] UI components (React views)

### 📝 Notes de release

Cette première version de la documentation couvre tous les aspects du développement de plugins pour Volt, du niveau débutant au niveau avancé. Elle a été conçue pour être :

1. **Accessible** : Guide pas-à-pas pour les débutants
2. **Complète** : Référence exhaustive pour les développeurs expérimentés
3. **Pratique** : Nombreux exemples et templates prêts à l'emploi
4. **Maintenable** : Structure claire et organisation logique

### 🔗 Liens utiles

- Repository : https://github.com/VoltLaunchr/Volt
- Documentation en ligne : (à venir)
- Issues : https://github.com/VoltLaunchr/Volt/issues

---

## Roadmap (Versions futures)

### Version 1.1.0 (Q1 2025) - Prévu

#### Améliorations prévues

- [ ] **Traduction anglaise** de toute la documentation
- [ ] **Vidéos tutorielles** (YouTube)
- [ ] **Plugin Marketplace** (documentation)
- [ ] **Playground interactif** en ligne
- [ ] **Générateur de plugins** (outil web)

#### Nouveaux exemples

- [ ] Plugin de recherche de fichiers avancée
- [ ] Plugin d'intégration Notion
- [ ] Plugin de gestion de bookmarks
- [ ] Plugin de screenshots avec OCR
- [ ] Plugin de traduction en temps réel

#### Nouvelles sections

- [ ] Debugging avancé
- [ ] Testing automatisé
- [ ] CI/CD pour plugins
- [ ] Distribution de plugins externes
- [ ] Signature et sécurité

### Version 1.2.0 (Q2 2025) - Prévu

#### Extensions

- [ ] **Plugin SDK** (CLI pour créer des plugins)
- [ ] **Plugin Boilerplate Generator**
- [ ] **Documentation des plugins natifs** (Windows/macOS/Linux spécifiques)
- [ ] **Performance profiling** (outils et guides)

#### Community

- [ ] **Showcase gallery** (plugins communautaires)
- [ ] **Plugin contests** (concours mensuels)
- [ ] **Contributors guide** (comment contribuer)

---

## Contributions

### Comment contribuer à la documentation

1. **Fork** le repository
2. **Créer une branche** : `git checkout -b docs/improve-plugin-guide`
3. **Modifier** les fichiers dans `docs/`
4. **Commit** : `git commit -m "docs: improve plugin examples"`
5. **Push** : `git push origin docs/improve-plugin-guide`
6. **Pull Request** avec une description claire

### Standards de contribution

#### Format

- **Markdown** : Respecter la syntaxe Markdown standard
- **Code blocks** : Spécifier le langage (typescript, rust, etc.)
- **Liens** : Utiliser des liens relatifs pour la navigation interne
- **Images** : Optimiser (< 200KB), nommer clairement

#### Style

- **Ton** : Pédagogique et accessible
- **Exemples** : Concrets et testés
- **Code** : Commenté et formaté
- **Longueur** : Sections de < 500 mots si possible

#### Checklist avant PR

- [ ] Pas de typos (relecture)
- [ ] Code testé et fonctionnel
- [ ] Liens vérifiés
- [ ] Images optimisées
- [ ] Cohérence avec le reste de la doc

---

## Maintenance

### Responsables

- **Lead maintainer** : @VoltTeam
- **Contributors** : Community

### Processus de review

1. **Automated checks** : Markdown lint, liens cassés
2. **Human review** : Vérification du contenu
3. **Testing** : Exemples de code testés
4. **Merge** : Après approbation

### Fréquence de mise à jour

- **Correctifs** : Au besoin (typos, liens cassés)
- **Mises à jour mineures** : Mensuelles (nouveaux exemples)
- **Mises à jour majeures** : Trimestrielles (nouvelles sections)

---

## Feedback

### Comment donner votre avis

1. **GitHub Issues** : Pour bugs/erreurs/suggestions
2. **Discussions** : Pour questions/idées
3. **Email** : contact@volt.dev (si disponible)

### Ce que nous recherchons

- 📝 **Clarté** : Y a-t-il des sections confuses ?
- 🐛 **Erreurs** : Avez-vous trouvé des bugs dans les exemples ?
- 💡 **Suggestions** : Quelles sections manquent ?
- ⭐ **Popularité** : Quels patterns utilisez-vous le plus ?

---

## Licence

Cette documentation est sous licence **MIT**, comme le projet Volt.

Vous êtes libre de :

- Utiliser la documentation à des fins personnelles ou commerciales
- Modifier et adapter le contenu
- Distribuer le contenu original ou modifié

Sous conditions de :

- Mentionner l'auteur original
- Inclure la licence MIT

---

## Remerciements

Merci à tous les contributeurs qui ont aidé à créer cette documentation ! 🙏

- **Core team** : Pour la review et les feedbacks
- **Early adopters** : Pour avoir testé les exemples
- **Community** : Pour les suggestions et corrections

---

**Version actuelle :** 1.0.0
**Dernière mise à jour :** 1 janvier 2026
**Status :** ✅ Production ready

---

_Documentation maintenue par l'équipe Volt avec ❤️_
