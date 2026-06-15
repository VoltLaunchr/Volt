# TODO — Refonte cœur Volt 2026

> Suivi opérationnel actuel. `REFONTE-2026.md` conserve le plan initial à titre historique.
> Convention : `[ ]` à faire · `[~]` en cours · `[x]` fait. Chaque tâche note l'effort `[S/M/L/XL]` et le finding d'audit résolu le cas échéant.
> **Avant tout commit** : `bun run lint` + `bun run build` + `cargo check` + `cargo clippy -- -D warnings` + `bun run test` (cf. CLAUDE.md).

---

## 🌊 Vague 1 — Quick wins (convergent avec l'audit, ROI max)

### A. Frecency « timestamp poussé vers le futur » `[S]` — résout `rust-history-clone-01` ✅ commit 3c8f776
- [x] Ajouter `frecency_date: i64` à `LaunchRecord` (gardé `launch_count`/`last_launched` pour les listes « fréquentes »/« récentes » distinctes)
- [x] Écriture au launch : `frecency_date = max(now, frecency_date) + WEIGHT` (WEIGHT = 1 jour, tunable)
- [x] Lecture/classement : suggestions triées par `frecency_date DESC` ; bonus search borné via `frecency_bonus()` (ln, cap +50), 1 seul `now()`/requête
- [x] Supprimer `calculate_frecency()` du hot-path
- [x] Nettoyer les 3 projections de map par frappe (search.rs ×2, apps.rs, launcher.rs)
- [x] Migration on-load des données existantes (`backfill_frecency_date`, serde default + cap)
- [x] Tests : push forward, backfill idempotent + cappé, used > never-launched (6 nouveaux)
- [x] Validé : `cargo test` + `cargo clippy -- -D warnings` + build front

### B. Clipboard event-driven (Windows) `[S]` ✅ commit 4f86f80
- [x] Remplacer le polling 500ms par `AddClipboardFormatListener` (event-driven primaire)
- [x] Fenêtre message-only + boucle `GetMessageW`/`WM_CLIPBOARDUPDATE` sur thread dédié (`winapi`), signale un `tokio::Notify`
- [x] Re-entrancy : déjà couvert par la dédup content-hash existante
- [x] Backstop poll lent (3s) au lieu d'un fallback feature-flag — garantit zéro régression si un event est raté ; non-Windows garde la cadence normale
- [x] App source déjà capturée via `get_foreground_app_name` (existant)
- [x] Validé : `cargo check` + `cargo clippy -- -D warnings` + 271 tests
- [x] ⚠️ **SMOKE TEST MANUEL requis** : copier texte puis image → vérifier que l'historique se met à jour, pas de busy-loop (la livraison d'event Win32 n'est pas testable hors runtime)

### F1. Codegen IPC Rust→TS `[M]` — résout `ts-02` ✅ AppInfo/FileInfo/Settings couverts (#118)
- [x] Outil choisi : **ts-rs** (léger, derives) + `TS_RS_EXPORT_DIR` (.cargo/config.toml) → bindings dans `src/shared/types/generated/`
- [x] 1ère struct générée : `LaunchRecord` (64-bit en `#[ts(type="number")]` car wire Tauri = JSON number, pas bigint)
- [x] Frontend re-exporte le type généré comme source unique de vérité (`launcher.types.ts`)
- [x] Garde-fou CI : tests Rust régénèrent + `git diff --exit-code` (ubuntu) ; généré exclu eslint/prettier ; LF via .gitattributes
- [x] Bench `search_bench` réaligné sur la signature HashMap frecency
- [x] Étendre aux autres structs : `AppInfo`/`FileInfo` (champ enum `category` exporté), `Settings`
- [x] Métriques IPC couvertes : `SystemMetrics`/`SystemMetricsV2` et leurs types imbriqués générés par ts-rs; `StorageKind` est un enum strict partagé
- [x] Commentaires `[SYNC:]` supprimés pour les contrats désormais générés; les marqueurs restants sont conservés sur les contrats non couverts (`AppCategory`, `FileSearchResult`, résultats/accessoires/actions plugins)
- [x] Skew rustfmt `auth.rs`/`steam.rs` vérifié et résolu : `cargo fmt --all -- --check` passe

### F3. Events `volt:*` typés `[S]` — résout `ts-08`/`arch-10` ✅ commit cc2d98a (agent A)
- [x] `src/shared/events.ts` : `VOLT_EVENTS` + `VoltEventMap` + `declare global WindowEventMap`
- [x] Helpers typés `emitVoltEvent` / `onVoltEvent` (cleanup retourné)
- [x] 18 events DOM migrés (App.tsx, useGlobalHotkey, shell, calculator, timer, ai-chat, clipboard, systemcommands, systemmonitor, ResultItem...)
- [x] Laissés hors scope (par design) : bridge extension dynamique (`volt:${event}` runtime), events Tauri `volt://*` (IPC cross-fenêtre), clés localStorage `volt:*`

### arch-05 / sec-02. Supprimer les `eslint-disable` ✅ commit 2976ac0 (agent B)
- [x] 8 directives supprimées en corrigeant la racine : stale-closures (Clipboard/FileSearch/Game/Timer via `useCallback`), `no-control-regex` via `String.fromCharCode(27)`, `@ts-expect-error` test via `unknown` narrowé
- [x] EmojiPicker : déjà résolu par react-06 (useMemo) sur cette branche → version supérieure conservée au merge
- [x] Vérifié : 0 `eslint-disable`/`@ts-ignore`/`@ts-expect-error` restant dans `src/`

### F2. `timings` IPC pour profiling `[S]` ✅ tracing hot-path livré
- [x] Instrumenter les commandes hot-path via `tracing` timing (`time_command!`) — logs opt-in, sans changement de payload
- [x] Instrumenter le pipeline réel `search_streaming`
- [x] Conserver les payloads IPC stables : pas de champ `timings` tant qu'aucun consommateur UI/télémétrie ne l'utilise

---

## 🌊 Vague 2 — Robustesse données

### C. SQLCipher + Credential Manager + repositories `[M]` 🟡 durcissement sécurité validé Windows, validations externes ouvertes
- [x] Blueprint détaillé : `REFONTE-PILIER-C-SQLCIPHER.md`
- [x] Ajouter la feature Cargo `sqlcipher` (`rusqlite/bundled-sqlcipher-vendored-openssl`) sans changer le build par défaut
- [x] `core::encrypted_db::open_db` + `PRAGMA key` + migration plaintext→SQLCipher atomique
- [x] Rebrancher les call sites SQLite sensibles : clipboard, notes, extension KV
- [x] Checkpoint WAL + suppression des sidecars plaintext avant installation de la DB chiffrée
- [x] Clé indépendante par base dans le Credential Manager (évite qu'une clé perdue orpheline tous les stores)
- [x] Algo clé (réutiliser `keyring_store.rs`) :
  - [x] (a) lire clé dans Credential Manager
  - [x] (b) ancien compte global DPAPI/Credential Manager → vérifier la clé sur la DB puis migrer vers le compte par base
  - [x] (c) sinon si DB chiffrée/illisible existe → **erreur de récupération (NE PAS régénérer)**
  - [x] (d) sinon générer 64 chars + stocker
- [x] Décision migrations : **ne pas adopter `refinery` maintenant** — schémas locaux petits/hétérogènes; conserver migrations idempotentes explicites jusqu'à un vrai besoin multi-version partagé
- [x] Mode WAL explicite sur les stores branchés
- [x] Décision repositories : **pas de couche générique maintenant** — clipboard/notes/extension KV ont des modèles distincts; extraire seulement lors d'une duplication réelle
- [x] Décision frecency SQL : **conserver `launch_history.json` + modèle timestamp** — faible volume, aucun bottleneck mesuré; migration SQLite différée
- [x] Migration données clair → chiffré (one-shot au 1er lancement post-update)
- [x] Validation Windows : Clippy strict + 317 tests sous `--no-default-features --features sqlcipher`
- [~] Validation macOS/Linux : matrice CI ajoutée pour Clippy + tests SQLCipher sur les 3 OS; premier run GitHub encore requis
- [x] Tests d'intégration clipboard/notes/extension KV + clé perdue + DB existe + migration legacy DPAPI + récupération interrompue
- [x] **Durcissement SQLCipher suite à l'audit sécurité (validé Windows)** :
  - [x] Découpler les clés DB du HMAC partagé : lecture/écriture directe dans le keyring, validation par ouverture SQLCipher, aucune suppression/régénération destructive sur perte ou rotation HMAC
  - [x] Passer à `rusqlite 0.40.1` / `libsqlite3-sys 0.38.1`, qui embarque **SQLCipher 4.14.0** et **SQLite 3.51.3**, première base corrigée du bug critique de corruption WAL-reset
  - [x] Vérifier le triplet `PRAGMA wal_checkpoint(TRUNCATE)`, sortir de WAL, prendre un verrou de migration inter-processus et empêcher le downgrade/réouverture plaintext via un marqueur keyring persistant
  - [x] Tests ciblés : versions runtime, checkpoint WAL busy/incomplet, clé legacy non réutilisée pour les stores plaintext, refus du downgrade et de la restauration plaintext après migration; 317 tests SQLCipher + Clippy strict

  Références officielles : [SQLite 3.51.3](https://sqlite.org/releaselog/3_51_3.html) corrige le bug WAL-reset; [SQLCipher 4.14.0](https://www.zetetic.net/blog/2026/03/17/sqlcipher-4.14.0-release/) embarque SQLite 3.51.3 et recommande l'upgrade aux applications utilisant WAL.

---

## 🌊 Vague 3 — Recherche fichiers (différenciateur, phasé)

### D1. Index inversé Tantivy (SANS MFT d'abord) `[L]` 🟡 feature-complete, premier benchmark CI pending
- [x] Blueprint détaillé : `REFONTE-PILIER-D-SEARCH.md`
- [x] Ajouter `tantivy` à `Cargo.toml` derrière feature-flag `tantivy-search`
- [x] Scaffold `indexer::fulltext` : index persistant, build/query/upsert/remove + tests
- [x] Câbler `search_files` et `search_streaming` vers Tantivy sous feature flag, avec fallback nucleo
- [x] Alimenter/reconstruire l'index depuis SQLite + scanner et le maintenir via watcher
- [x] Validation : Clippy strict `tantivy-search` + 327 tests
- [x] Schéma production : `name`, `name_exact`, `path`, `ext`, `category`, `size`, `mtime`, `hidden`
- [x] Tokenizer lowercase + ASCII folding, testé dans les deux sens accentué/non accentué
- [x] Scoring en couches : exact/BM25 → boost préfixe → fuzzy pondéré
- [x] Requête fuzzy Levenshtein avec transpositions
- [x] Remplacer le matching nucleo **sur l'index fichiers** sous feature flag (fallback conservé)
- [x] Réutiliser l'index persistant si le compteur et le marqueur de synchronisation SQLite concordent
- [x] Démarrer/arrêter le watcher avec le lifecycle UI et le redémarrer après un rebuild manuel
- [x] `read_dir` conservé comme scanner cross-platform et couvert par un test de contrat
- [~] Bench Criterion nucleo/Tantivy ajouté : latence 1k/10k, assertions de pertinence, taille disque; workflow CI dédié ajouté, premier run GitHub encore requis
- [x] **Décision D2/D3 : NO-GO pour cette itération.** D1 est fonctionnel; ne pas engager MFT/USN avant baseline Criterion release sur corpus réel et preuve que l'énumération est le bottleneck utilisateur

### D2. Scan MFT NTFS `[XL]` — seulement si D1 validé
- [ ] Crate `ntfs` + lecture `\\.\C:` (privilèges admin requis)
- [ ] Thread/process dédié émettant des batches vers l'indexeur (pipe nommé)
- [ ] Stratégie privilèges : service Windows ou élévation ponctuelle
- [ ] Gérer edge-cases : volumes amovibles, réseau, non-NTFS → fallback walk
- [ ] Feature-flag `ntfs-scan`

### D3. Incrémental USN Journal `[L]`
- [ ] `FSCTL_QUERY_USN_JOURNAL` / `FSCTL_READ_USN_JOURNAL`
- [ ] Reprise au dernier USN ID (pas de re-crawl complet)
- [ ] Queue persistée sur disque (survit aux redémarrages)
- [ ] Mises à jour live de l'index Tantivy

### D4. Architecture en acteurs `[M]`
- [ ] Découpler : sources / watch / indexing / queue
- [ ] Consolidation post D1-D3

---

## 🌊 Vague 4 — Input global (optionnel, le plus lourd)

### E1. Auto-expansion snippet via hook in-process `[L]`
- [ ] Hook `WH_KEYBOARD_LL` dans le process principal (hors fenêtres élevées)
- [ ] Résoudre scancode→char via `ToUnicodeEx` + `GetKeyboardLayout` (multi-layout)
- [ ] Surveiller les keywords enregistrés, détecter match
- [ ] Au match : supprimer le keyword tapé + injecter le texte via `SendInput`
- [ ] Config : enabled, response time, expansion mode, apps désactivées
- [ ] **80% de la valeur snippet global, sans uiAccess**

### E2. Helper `uiAccess=true` signé `[XL]` — BLOQUÉ sans signature de code
- [ ] ⚠️ Prérequis : chaîne de signature de code valide + install Program Files
- [ ] Binaire Rust séparé, manifeste `uiAccess="true"`
- [ ] Hook LL + injection `SendInput` au-dessus de l'UAC
- [ ] Tracking fenêtre (`SetWinEventHook`)

### E3. Canal sécurisé vers le helper `[L]` — non négociable si E2
- [ ] Named pipe + vérif identité appelant (`CheckTokenMembership`)
- [ ] Chiffrement + auth (Schannel/TLS)
- [ ] Vérif signature de l'appelant (`WinVerifyTrust`)

### E4. Hyperkey `[M]`
- [ ] Remap touche → Ctrl+Alt+Shift+Win

---

## 🚫 Décidé : NE PAS faire
- [x] ~~Backend séparé supervisé (Node/.NET) + multi-cœurs~~ → Tauri est déjà le bon modèle
- [x] ~~Réécrire la recherche d'apps~~ → nucleo OK sur liste bornée (seul l'index fichiers passe à Tantivy)
- [x] ~~Calcul en langage naturel propriétaire~~ → hors scope

---

## 📌 Séquencement historique et état actuel

L'ordre ci-dessous était celui du plan initial. A, B, C, F1, F3 et D1 sont implémentés. C attend le premier run de sa matrice CI macOS/Linux; D1 attend le premier run du benchmark CI dédié et D2/D3 restent en NO-GO pour cette itération.

**Ordre initial :**
1. **A** (frecency) → débloque aussi l'audit `rust-history-clone-01`
2. **B** (clipboard event-driven)
3. **F1 + F3** (IPC/events typés) → garde-fou, converge avec l'audit
4. **C** (SQLCipher)
5. **D1** (Tantivy) → **décision GO/NO-GO** pour D2/D3
6. **E1** si besoin produit snippet global ; **E2-E4** seulement si signature dispo
</content>
