# TODO — Refonte cœur Volt 2026

> Suivi opérationnel actuel. [`../../archive/plans/REFONTE-2026.md`](../../archive/plans/REFONTE-2026.md) conserve le plan initial à titre historique.
> Convention : `[ ]` à faire · `[~]` en cours · `[x]` fait. Chaque tâche note l'effort `[S/M/L/XL]` et le finding d'audit résolu le cas échéant.
> **Avant tout commit** : `pnpm run lint` + `pnpm run build` + `cargo check` + `cargo clippy -- -D warnings` + `pnpm run test` (cf. CLAUDE.md).

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

### C. SQLCipher + Credential Manager + repositories `[M]` ✅ durcissement sécurité validé Windows + matrice CI macOS/Linux verte
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
- [x] Validation macOS/Linux : matrice CI confirmée verte sur les 3 OS (run GitHub 27540669396, push main v0.3.0 du 2026-06-15 — "SQLCipher Clippy"/"SQLCipher Tests" en `success` sur macos-latest/ubuntu-latest/windows-latest). En cours de route : bug réel découvert et fixé (hang 6h sur macOS — `keyring_store` touchait le vrai Keychain dans les tests ; routé vers un map en mémoire sous `cfg(test)`).
- [x] Tests d'intégration clipboard/notes/extension KV + clé perdue + DB existe + migration legacy DPAPI + récupération interrompue
- [x] **Durcissement SQLCipher suite à l'audit sécurité (validé Windows)** :
  - [x] Découpler les clés DB du HMAC partagé : lecture/écriture directe dans le keyring, validation par ouverture SQLCipher, aucune suppression/régénération destructive sur perte ou rotation HMAC
  - [x] Passer à `rusqlite 0.40.1` / `libsqlite3-sys 0.38.1`, qui embarque **SQLCipher 4.14.0** et **SQLite 3.51.3**, première base corrigée du bug critique de corruption WAL-reset
  - [x] Vérifier le triplet `PRAGMA wal_checkpoint(TRUNCATE)`, sortir de WAL, prendre un verrou de migration inter-processus et empêcher le downgrade/réouverture plaintext via un marqueur keyring persistant
  - [x] Tests ciblés : versions runtime, checkpoint WAL busy/incomplet, clé legacy non réutilisée pour les stores plaintext, refus du downgrade et de la restauration plaintext après migration; 317 tests SQLCipher + Clippy strict

  Références officielles : [SQLite 3.51.3](https://sqlite.org/releaselog/3_51_3.html) corrige le bug WAL-reset; [SQLCipher 4.14.0](https://www.zetetic.net/blog/2026/03/17/sqlcipher-4.14.0-release/) embarque SQLite 3.51.3 et recommande l'upgrade aux applications utilisant WAL.

---

## 🌊 Vague 3 — Recherche fichiers (différenciateur, phasé)

### D1. Index inversé Tantivy (SANS MFT d'abord) `[L]` ✅ feature-complete, bench CI dédié vert
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
- [x] Bench Criterion nucleo/Tantivy ajouté : latence 1k/10k, assertions de pertinence, taille disque; workflow CI dédié ajouté. **Premier run LOCAL fait (2026-06-16)** : nucleo plus rapide que Tantivy sur **toutes** les requêtes ≤10k docs (Tantivy ~2-8 ms d'overhead fixe) → Tantivy ne gagne qu'au-delà de 10k docs. Cf. decision record dans `REFONTE-PILIER-D-SEARCH.md`. **Run GitHub CI confirmé vert** (`search-benchmark.yml`, job "Criterion D1 Tantivy", run 27540669407 sur le push main v0.3.0 du 2026-06-15).
- [x] **Décision : Tantivy reste OFF par défaut** (nucleo gagne aux tailles de corpus réelles) ; **D2/D3 wiring lifecycle = toujours NO-GO** tant qu'un bench d'**énumération** (`scan_files` walk vs USN drain) sur volume NTFS réel n'a pas prouvé que l'énumération à froid est le bottleneck. ⚠️ Le bench actuel mesure la *latence de requête*, pas le *temps d'énumération à froid* — c'est la mesure manquante pour trancher D2/D3.

> **⚠️ Correction de cap (juin 2026) — l'admin était le mauvais chemin.**
> Raycast/Spotlight n'exigent jamais d'élévation pour chercher : ils interrogent
> l'index de l'OS. Sur Windows l'équivalent existe et est **déjà câblé**
> (`indexer/windows_search.rs`, OLE DB `Search.CollatorDSO`). Et surtout, le
> journal USN a un mode **sans admin** : `FSCTL_READ_UNPRIVILEGED_USN_JOURNAL`
> sur un handle ouvert en `FILE_TRAVERSE` (vérifié sur Microsoft Learn).
> Conclusion : **D2 (MFT brute = admin obligatoire) est rétrogradé en
> accélérateur optionnel « si déjà élevé », jamais requis ; la valeur réelle est
> D3 (USN incrémental) en mode unprivileged, par-dessus le baseline Windows
> Search.** On ne demande **jamais** d'UAC pour chercher.

### D2. Scan MFT NTFS brute `[XL]` — ✅ ABANDONNÉ (décision finale, 2026-06-25)
- [x] ~~Stratégie privilèges : service Windows ou élévation ponctuelle~~ → **abandonné** (un launcher ne demande jamais l'UAC pour chercher)
- [x] Accélérateur opportuniste (lecture `$MFT` en un passage si déjà élevé, feature-flag `mft-search`, edge-cases volumes amovibles/réseau/non-NTFS) → **non planifié** : aucun besoin réel (le cas « déjà élevé + NTFS » est marginal), le baseline sans admin (Windows Search Index + `scan_files` walk, D1) couvre 100% des cas. Conservé **doc-only** dans `indexer/mft.rs` (zéro `unsafe`, zéro appel Win32, zéro dépendance NTFS tierce) au cas où le calcul changerait un jour ; n'est plus dans le backlog actif.
- [x] Décision : **NE PAS** bâtir le service Windows / l'élévation ponctuelle ni l'accélérateur opportuniste. Doc-only dans `indexer/mft.rs`.

### D3. Incrémental USN Journal — **SANS ADMIN** `[L]` ⛔ **NO-GO confirmé (2026-06-24)** — primitive validée & gardée OFF, wiring bloqué sur télémétrie
- [x] Module `indexer/usn.rs` (feature `usn-incremental`, OFF par défaut ; FFI `#[cfg(windows)]`, parseur portable)
- [x] FFI fine maison : volume en `FILE_TRAVERSE` (pas `GENERIC_READ`), `FSCTL_QUERY_USN_JOURNAL`, boucle `FSCTL_READ_UNPRIVILEGED_USN_JOURNAL` (= `0x000903AB`)
- [x] Parseur `USN_RECORD_V2/V3` **pur, 15 tests verts** (buffer synthétique, sans volume ; inclut deletes via map, renames, coalescing)
- [x] Mapping `reason` → `RecordChange::{Upsert,Remove,Ignore}` (create+delete coalescé = Ignore), reprise `(UsnJournalID, NextUsn)`, erreurs typées (JournalNotActive→fallback, JournalEntryDeleted→rebuild)
- [x] **Validé au runtime non-élevé** (`examples/usn_probe.rs`) : 300k+ records drainés à ~1 M/s, **zéro admin**
- [x] **Finding : la lecture unprivileged STRIPPE les noms inline** (records 64 o, `FileNameLength=0`, même pour nos propres fichiers). C'est une propriété de sécurité, pas un bug.
- [x] **`resolve_path` (`OpenFileById` + `GetFinalPathNameByHandleW`) implémenté + validé** : résout ~73-78% des FRN changés en **chemin complet**, sans admin (le reste = système inaccessible/déjà supprimé → skip). Donne le chemin complet, pas juste le nom.
- [x] **Map `FRN→path` + résolution des deletes FAIT** (`UsnIndexer` : delete-after-upsert résolu via la map, rename = removal, untracked-FRN skip) — couvert par les 6 nouveaux tests.
- [x] **Bench d'énumération RÉEL exécuté (2026-06-24, `examples/enum_bench.rs`)** — la mesure manquante du NO-GO. Profil complet `C:\Users\Noluc`, non-élevé :
  - Walk `scan_files` à froid : **2 128 042 fichiers en ~83 min (426 files/s)** — mais c'est un upper-bound (inclut AppData/.cargo/node_modules/placeholders OneDrive ; pas la cible réelle d'un launcher)
  - USN drain : 327 873 records en **148 ms** (2.2 M rec/s) MAIS **0 nom** (strippés) → résolution **462 µs/fichier** (`OpenFileById`), 78% de succès ; ~117 s projetés pour résoudre tout le delta
  - **Verdict : walk vs USN drain = apples-to-oranges.** L'USN non-privilégié ne fait **que** des deltas ; le baseline reste forcément un walk (le raw-MFT « instant » est admin-only = D2 abandonné).
- [ ] ❌ **D3 lifecycle wiring = NO-GO confirmé sur données** (cf. decision record `REFONTE-PILIER-D-SEARCH.md` 2026-06-24). Bloqué sur 2 gates non remplis : (2) fréquence de re-scan justifiant l'USN = **non mesurée** (pas de télémétrie) ; (3) preuve que le chemin USN-delta (resolve 462 µs/fichier inclus) bat un re-walk ciblé sur les volumes de changement réels = **non prouvé**. Primitive gardée OFF, **non jetée**.
- [x] **Suite prioritaire (Vague 3.2, AVANT de reconsidérer l'USN)** — découverte : déjà ~80% en place ; seuil configurable + télémétrie re-scan finalisés (2026-06-25).
  - [x] (a) scan background hors hot-path → déjà `tokio::spawn` + `spawn_blocking`, depth borné à 3 (`start_indexing`)
  - [x] (b) watcher `notify` debounced ciblé → déjà `indexer/watcher.rs` (100ms, upsert/remove par-path, sync SQLite+mémoire+tantivy)
  - [x] (c) lazy refresh / réutilisation cache SQLite → déjà fast-path dans `start_indexing`
  - [x] **Catch-up offline (le vrai trou)** : `refresh_index_if_stale(stale_secs)` (commit `75de6b81`) — réconcilie les changements faits app fermée (le watcher ne voit que le live). Re-walk background gated sur `last_full_scan`, swap atomique, silencieux. C'est l'alternative no-admin au drain USN. Frontend : déclenché par `FileWatcherLifecycle` après le watcher (fire-and-forget, seuil 1h).
  - [x] **Seuil de staleness configurable en Settings** : `indexing.staleThresholdSecs` (défaut 3600, `0` = désactivé) exposé via un `<select>` dans le panneau File Search (15min/30min/1h/6h/24h/off). `FileWatcherLifecycle.start(staleSecs)` lit la valeur ; backend `#[serde(default)]` pour compat ascendante.
  - [x] **Métriques re-scan persistées** (la mesure manquante du gate (2) du NO-GO D3) : `record_stale_catchup()` bumpe `stale_catchup_count` + stamp `last_stale_catchup` en meta DB **uniquement** sur le chemin catch-up offline (pas `start_indexing`/rebuild), donc mesure la dérive app-fermée. Exposé via `get_db_index_stats` → 2 tuiles Settings (compteur + dernier rattrapage). C'est la télémétrie qui débloque la reconsidération USN un jour.
- [ ] Baseline sans admin = Windows Search Index (déjà là) + `scan_files` fallback ; l'USN = deltas only
- ⚠️ `StartUsn` doit être `0` / `FirstUsn` / un USN déjà retourné — offset arbitraire → `ERROR_INVALID_PARAMETER` (87)

### D4. Architecture en acteurs `[M]` — ✅ consolidation contenue (2026-06-25)
- [x] Découpler : sources / watch / indexing / queue → **sources** (`indexer/scanner.rs`) et **watch** (`indexer/watcher.rs`) étaient déjà proprement découplés par fichier, rien à faire. **queue** : le design *reject-if-busy* (check-and-set atomique du flag `is_indexing`) est déjà correct et le frontend s'appuie dessus (désactivation de bouton, polling) — pas converti en vraie queue mpsc, ça changerait un comportement observable pour zéro bénéfice.
- [x] Consolidation post D1-D3 : `start_indexing`, `invalidate_index` et `refresh_index_if_stale` dupliquaient à l'identique la séquence *scan → persist SQLite → rebuild Tantivy → swap cache mémoire → update status → emit progress* (c'est ce qui avait failli faire oublier la télémétrie catch-up sur un seul des trois copier-collés). Extrait en une fonction privée unique `reconcile()` + `ReconcileParams`, réutilisée par les 3 commandes ; chacune garde sa logique propre (TOCTOU guard, fast-path SQLite, garde-fous de staleness, abort/stop watcher) et délègue la partie dupliquée. Vérifié que `scan_task: Mutex<Option<AbortHandle>>` + `IndexingGuard` (RAII) sont déjà corrects — non modifiés. Zéro changement de comportement observable, zéro nouveau state Tauri/IPC. -21 lignes nettes malgré l'ajout de `reconcile()` (~250 lignes de copier-collé supprimées). `cargo check`/`clippy -D warnings` (défaut + `tantivy-search`) + `cargo test --lib` (304 et 328 tests) verts.

---

## 🌊 Vague 4 — Input global (optionnel, le plus lourd)

### E1. Auto-expansion snippet via hook in-process `[L]` — ✅ implémenté, ⚠️ smoke test manuel requis avant merge
- [x] Hook `WH_KEYBOARD_LL` dans le process principal (hors fenêtres élevées) — `src-tauri/src/expansion/hook.rs`, thread dédié + boucle `GetMessageW`, feature flag `snippet-global-expansion` (OFF par défaut)
- [x] Résoudre scancode→char via `ToUnicodeEx` + `GetKeyboardLayout` (multi-layout) — `src-tauri/src/expansion/keyboard_layout.rs` ; modificateurs lus via `GetAsyncKeyState` (pas `GetKeyState`, qui dépend de la queue du thread appelant — le thread processor n'en pompe aucune) et toggle CapsLock au bit 0 du tableau `lpKeyState` (pas le bit 7, qui encode l'état "enfoncée")
- [x] Surveiller les triggers enregistrés, détecter match — `src-tauri/src/expansion/trigger_buffer.rs` (buffer borné + règle de frontière de mot + plus-long-trigger-gagne), 19 tests unitaires purs (CI tous OS)
- [x] Au match : supprimer le trigger tapé + injecter le texte via `SendInput` — `src-tauri/src/expansion/injector.rs` (backspaces en unités UTF-16, injection `KEYEVENTF_UNICODE`)
- [x] Anti-boucle sur nos propres injections : filtre `LLKHF_INJECTED` dans le callback hook
- [x] Config : enabled (OFF par défaut), liste d'apps exclues (+ Volt lui-même toujours exclu via `current_exe()`), longueur max de trigger surveillée — `SnippetExpansionSettings` dans `commands/system/settings.rs`, toggle dans Settings → nouvelle section "Snippets"
- [x] Commande Tauri `set_snippet_expansion_enabled` (persiste + démarre/arrête le hook immédiatement)
- [x] **80% de la valeur snippet global, sans uiAccess**
- [x] Validé : `cargo check`/`cargo clippy -- -D warnings` (défaut + `--features snippet-global-expansion`), 19 tests purs verts, `pnpm run lint`/`pnpm run build`/`tsc --noEmit` verts
- [ ] ⚠️ **SMOKE TEST MANUEL requis avant merge** (comme le clipboard event-driven, Pilier B) : le hook lui-même, l'injection `SendInput`, et la résolution multi-layout (FR/US, touches mortes) ne sont délibérément PAS exercés par les tests automatisés — installer un hook clavier global réel ou injecter des frappes depuis un agent aurait manipulé la vraie session Windows de la machine de dev. À tester manuellement : frappe dans Notepad/Chrome/VS Code sans lag ni perte de caractère, expansion correcte avec Shift/AltGr/CapsLock, comportement silencieux (pas de crash) sur une fenêtre élevée en admin.

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

L'ordre ci-dessous était celui du plan initial. A, B, C, F1, F3 et D1 sont implémentés et leurs CI dédiées (matrice SQLCipher macOS/Linux/Windows, bench Tantivy) confirmées vertes sur GitHub (run 27540669396 / 27540669407, push main v0.3.0 du 2026-06-15). **D2/D3 sont désormais en NO-GO confirmé sur données** (bench d'énumération réel exécuté le 2026-06-24, cf. decision record dans `REFONTE-PILIER-D-SEARCH.md`) : le baseline reste un walk, l'USN non-privilégié ne peut pas l'accélérer (deltas only + 462 µs/fichier de résolution). **Prochain travail = Vague 3.2** (scan background + watcher debounced ciblé + lazy refresh) avant toute reconsidération de l'USN.

**Ordre initial :**
1. **A** (frecency) → débloque aussi l'audit `rust-history-clone-01`
2. **B** (clipboard event-driven)
3. **F1 + F3** (IPC/events typés) → garde-fou, converge avec l'audit
4. **C** (SQLCipher)
5. **D1** (Tantivy) → **décision GO/NO-GO** pour D2/D3
6. **E1** si besoin produit snippet global ; **E2-E4** seulement si signature dispo
</content>
