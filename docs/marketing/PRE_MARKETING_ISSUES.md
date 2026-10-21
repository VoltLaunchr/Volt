# Issues pré-marketing proposées

_Backlog préparatoire au 2026-06-13. Chaque item doit devenir une issue GitHub distincte avec propriétaire, milestone et preuve attachée._

## P0 blockers

### 1. Produire et valider une release candidate multiplateforme

- **Contexte :** aucun rapport unique ne prouve installation, premier lancement, recherche et lancement sur tous les OS annoncés.
- **Labels :** `P0`, `release`, `qa`, `cross-platform`
- **Acceptance criteria :** artefacts RC identifiés par commit; parcours critique réussi sur Win10, Win11, macOS Intel, macOS ARM et Linux; résultats attachés à `QA_MATRIX.md`; aucun crash/perte de données.
- **Fichiers/areas :** `.github/workflows/release.yml`, `src-tauri/tauri.conf.json`, `docs/release/QA_MATRIX.md`.
- **Bloque :** Developer Preview **oui**; Public v1 **oui**.

### 2. Activer et vérifier signature Windows et notarisation macOS

- **Contexte :** le workflow peut fonctionner sans certificats; la présence de secrets n'est pas une preuve de signature réussie.
- **Labels :** `P0`, `release`, `security`, `signing`
- **Acceptance criteria :** Authenticode valide sur MSI/NSIS; `spctl` accepte les deux DMG macOS; identités, timestamp et notarisation archivés; échec de signature bloque l'annonce.
- **Fichiers/areas :** `.github/workflows/release.yml`, `docs/build-release/SIGNING_SETUP.md`, `src-tauri/tauri.conf.json`.
- **Bloque :** Developer Preview **non si limitation explicite**; Public v1 **oui**.

### 3. Valider l'auto-update de bout en bout

- **Contexte :** plugin, clé et UI existent, mais aucun upgrade réel documenté n'est fourni.
- **Labels :** `P0`, `release`, `updater`, `security`
- **Acceptance criteria :** update depuis dernière release vers RC sur chaque OS; signature invalide refusée; interruption réseau gérée; relance et version vérifiées; procédure de récupération documentée.
- **Fichiers/areas :** `src/features/settings/services/updateService.ts`, `src-tauri/tauri.conf.json`, `.github/workflows/release.yml`.
- **Bloque :** Developer Preview **non si updater désactivé/documenté**; Public v1 **oui**.

### 4. Publier la politique de confidentialité et les defaults sensibles

- **Contexte :** clipboard monitoring, indexation et update check sont activés par défaut; plusieurs données sont stockées localement.
- **Labels :** `P0`, `privacy`, `documentation`, `product`
- **Acceptance criteria :** inventaire des données et appels réseau; copie onboarding/settings; rétention/suppression; distinction local/opt-in; politique liée depuis README, app et site.
- **Fichiers/areas :** `src-tauri/src/commands/settings.rs`, clipboard, shell history, sync/auth/AI, `docs/security/PRIVACY_AND_TELEMETRY_REVIEW.md`.
- **Bloque :** Developer Preview **oui**; Public v1 **oui**.

### 5. Geler les claims publics sur des preuves vérifiées

- **Contexte :** README et docs annoncent taille, vitesse, parité OS et confidentialité sans baseline consolidée.
- **Labels :** `P0`, `marketing`, `documentation`, `claims`
- **Acceptance criteria :** chaque claim du README/site/release notes pointe vers `CLAIMS_EVIDENCE.md`; claims non vérifiés supprimés ou qualifiés; comparaison concurrents sourcée et datée.
- **Fichiers/areas :** `README.md`, `docs/roadmap/COMPETITIVE_ANALYSIS.md`, site externe, release templates.
- **Bloque :** Developer Preview **oui pour annonces publiques**; Public v1 **oui**.

## P1 high-impact readiness

### 6. Exécuter deux bug bash de release

- **Contexte :** les tests automatisés ne couvrent pas l'intégration OS, les permissions et les transitions de fenêtres.
- **Labels :** `P1`, `qa`, `bug-bash`
- **Acceptance criteria :** sessions par plateforme et par feature; tous les bugs triés; aucun P0/P1 ouvert sans acceptation signée; re-test de la RC finale.
- **Fichiers/areas :** `archive/plans/BUG_BASH_PLAN.md`, issues GitHub.
- **Bloque :** Developer Preview **un cycle**; Public v1 **deux cycles**.

### 7. Réconcilier et terminer l'audit accessibilité

- **Contexte :** les roadmaps indiquent WCAG AA complet alors que `ACCESSIBILITY_AUDIT.md` conserve des checks manuels ouverts.
- **Labels :** `P1`, `accessibility`, `qa`, `documentation`
- **Acceptance criteria :** axe sans erreur critique; navigation clavier; focus visible; contraste; NVDA/VoiceOver; état des docs aligné.
- **Fichiers/areas :** `archive/plans/ACCESSIBILITY_AUDIT.md`, SearchBar, ResultsList, Settings, modales.
- **Bloque :** Developer Preview **non avec limitation**; Public v1 **oui**.

### 8. Réparer le contrat de logging frontend/backend

- **Contexte :** `logger.ts` invoque `log_from_frontend`, mais aucune commande backend correspondante n'est identifiée.
- **Labels :** `P1`, `bug`, `diagnostics`, `frontend`, `backend`
- **Acceptance criteria :** erreurs frontend persistées ou comportement retiré/documenté; redaction appliquée; test automatisé; export diagnostics vérifié.
- **Fichiers/areas :** `src/shared/utils/logger.ts`, `src-tauri/src/commands/logging.rs`, `src-tauri/src/lib.rs`.
- **Bloque :** Developer Preview **oui si les erreurs ne sont pas diagnosticables**; Public v1 **oui**.

### 9. Définir officiellement le support Linux X11/Wayland

- **Contexte :** Wayland reste listé comme incomplet dans les roadmaps.
- **Labels :** `P1`, `linux`, `wayland`, `documentation`
- **Acceptance criteria :** distributions/compositeurs supportés listés; hotkey, focus, clipboard et lancement testés; fallback ou limitation visible au téléchargement.
- **Fichiers/areas :** hotkey, window, clipboard, `docs/release/QA_MATRIX.md`, README.
- **Bloque :** Developer Preview **non si X11-only explicite**; Public v1 **oui pour claim Linux général sans réserve**.

### 10. Tester uninstall, réinstallation et conservation des données

- **Contexte :** le comportement des DB, logs, settings et keyring à la désinstallation n'est pas cadré.
- **Labels :** `P1`, `release`, `privacy`, `qa`
- **Acceptance criteria :** comportement par installateur documenté; choix conserver/supprimer défini; réinstallation propre testée; credentials et données sensibles traités.
- **Fichiers/areas :** bundles Tauri, app data, keyring, documentation d'installation.
- **Bloque :** Developer Preview **non avec documentation**; Public v1 **oui**.

## P2 polish

### 11. Qualifier le Game Launcher par plateforme réelle

- **Contexte :** les scanners ont une portée différente selon OS et launcher.
- **Labels :** `P2`, `games`, `qa`, `cross-platform`
- **Acceptance criteria :** tableau launcher × OS; détection/lancement/cache testés; claims ajustés; cas Xbox et launchers absents couverts.
- **Fichiers/areas :** `src-tauri/src/plugins/builtin/game_scanner/`, frontend games.
- **Bloque :** Developer Preview **non**; Public v1 **non si claim retiré**, sinon **oui**.

### 12. Qualifier le System Monitor et les actions privilégiées

- **Contexte :** températures, disques et kill process peuvent être indisponibles ou nécessiter des droits.
- **Labels :** `P2`, `system-monitor`, `qa`
- **Acceptance criteria :** mesures comparées aux outils OS; erreurs/permissions présentées proprement; export CSV testé.
- **Fichiers/areas :** system monitor Rust/TS et capability dédiée.
- **Bloque :** Developer Preview **non**; Public v1 **non si limitation documentée**.

### 13. Consolider versions, changelogs et roadmaps

- **Contexte :** plusieurs documents indiquent des versions et états différents.
- **Labels :** `P2`, `documentation`, `maintenance`
- **Acceptance criteria :** version actuelle unique; documents historiques marqués; liens et dates cohérents; génération de changelog vérifiée.
- **Fichiers/areas :** `README.md`, `CHANGELOG.md`, `docs/changelog/`, `docs/roadmap/`, `docs/README.md`.
- **Bloque :** Developer Preview **non**; Public v1 **oui pour crédibilité**.

## Marketing et documentation

### 14. Produire une démo généraliste et des captures par OS

- **Contexte :** le message doit montrer Volt comme outil de bureau complet, pas uniquement développeur.
- **Labels :** `marketing`, `documentation`, `design`
- **Acceptance criteria :** apps, fichiers, clipboard, snippets, commandes et contrôle desktop visibles; captures Windows/macOS/Linux; aucune feature non validée montrée comme stable.
- **Fichiers/areas :** `docs/assets/`, README, site externe.
- **Bloque :** Developer Preview **non**; Public v1 **oui**.

### 15. Écrire guides installation, premier lancement et dépannage

- **Contexte :** la documentation contributeur est riche, mais le parcours utilisateur release est dispersé.
- **Labels :** `documentation`, `user-guide`, `release`
- **Acceptance criteria :** guide par OS, conflits hotkey, permissions, logs, reset index, update et uninstall; liens depuis app/site.
- **Fichiers/areas :** `docs/user-guide/`, `docs/build-release/`, Settings/About.
- **Bloque :** Developer Preview **oui au minimum**; Public v1 **oui**.

## Sécurité et confidentialité

### 16. Décider et documenter le chiffrement local par défaut

- **Contexte :** SQLCipher existe mais n'est pas activé dans la feature par défaut; clipboard, notes et stockages d'extensions utilisent `open_db`.
- **Labels :** `security`, `privacy`, `storage`, `architecture`
- **Acceptance criteria :** décision produit explicite; modèle de migration; matrice CI/release; copie utilisateur honnête si données non chiffrées.
- **Fichiers/areas :** `src-tauri/Cargo.toml`, `core/encrypted_db.rs`, bases locales.
- **Bloque :** Developer Preview **non si divulgué**; Public v1 **oui pour claim private fort**.

### 17. Auditer la redaction des logs et exports diagnostics

- **Contexte :** plusieurs redactors existent, mais les erreurs frontend sérialisent des arguments arbitraires.
- **Labels :** `security`, `privacy`, `logging`
- **Acceptance criteria :** corpus de secrets; tests négatifs; chemins/queries/tokens redacted; export diagnostics prévisualisable; rétention définie.
- **Fichiers/areas :** logger TS, tracing Rust, auth, shell, deep links, diagnostics.
- **Bloque :** Developer Preview **oui si export partagé**; Public v1 **oui**.

### 18. Revoir la sécurité et le consentement clipboard

- **Contexte :** monitoring activé par défaut et filtre sensible heuristique.
- **Labels :** `privacy`, `clipboard`, `security`, `ux`
- **Acceptance criteria :** consentement visible; exclusions password managers par défaut ou détection robuste; pause rapide; rétention claire; tests secrets/cartes/tokens.
- **Fichiers/areas :** clipboard backend/frontend, settings defaults, onboarding.
- **Bloque :** Developer Preview **oui**; Public v1 **oui**.

## Performance

### 19. Établir la baseline startup/search/index/resources

- **Contexte :** les claims rapides/légers ne disposent pas de mesures approuvées.
- **Labels :** `performance`, `benchmark`, `release`
- **Acceptance criteria :** protocole et résultats 1k/10k/50k; cold/warm; p50/p95; CPU/RAM idle; tailles artefacts; raw data versionnée.
- **Fichiers/areas :** `docs/benchmarks/PERFORMANCE_BASELINE.md`, Criterion, scripts de mesure.
- **Bloque :** Developer Preview **non**; Public v1 **oui pour claims performance**.

## Extension ecosystem

### 20. Valider le modèle de menace et une extension de référence

- **Contexte :** le Worker et les permissions sont solides dans le code, mais « sandboxed » reste une affirmation de sécurité forte.
- **Labels :** `extensions`, `security`, `qa`, `ecosystem`
- **Acceptance criteria :** extension hostile de test; tentative d'accès réseau/clipboard/IPC/dynamic code; installation/update/uninstall; modèle de menace et limites publiés.
- **Fichiers/areas :** extension loader, Worker bootstrap, backend extensions, registry.
- **Bloque :** Developer Preview **non si store limité**; Public v1 **oui pour claim sandboxed**.

### 21. Définir la gouvernance du registry et de la revue des extensions

- **Contexte :** deux sources de registry sont fusionnées et le portail gère des statuts, mais la revue de sécurité et la révocation doivent être opérationnelles.
- **Labels :** `extensions`, `security`, `operations`, `documentation`
- **Acceptance criteria :** critères d'approbation; provenance; révocation; réponse incident; versioning; contact mainteneur; SLA non promis sans capacité.
- **Fichiers/areas :** `docs/roadmap/EXTENSION_ECOSYSTEM_PLAN.md`, docs plugin/publishing, backend registry et site externe.
- **Bloque :** Developer Preview **non si store désactivé/limité**; Public v1 **oui pour promotion de l'écosystème**.
