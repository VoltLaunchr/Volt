# TODO — Refonte cœur Volt 2026

> Plan détaillé : `REFONTE-2026.md`.
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
- [ ] ⚠️ **SMOKE TEST MANUEL requis** : copier texte puis image → vérifier que l'historique se met à jour, pas de busy-loop (la livraison d'event Win32 n'est pas testable hors runtime)

### F1. Codegen IPC Rust→TS `[M]` — résout `ts-02` 🟡 pipeline établi (commits 089cf5d/f193b9c/cf2215b)
- [x] Outil choisi : **ts-rs** (léger, derives) + `TS_RS_EXPORT_DIR` (.cargo/config.toml) → bindings dans `src/shared/types/generated/`
- [x] 1ère struct générée : `LaunchRecord` (64-bit en `#[ts(type="number")]` car wire Tauri = JSON number, pas bigint)
- [x] Frontend re-exporte le type généré comme source unique de vérité (`launcher.types.ts`)
- [x] Garde-fou CI : tests Rust régénèrent + `git diff --exit-code` (ubuntu) ; généré exclu eslint/prettier ; LF via .gitattributes
- [x] Bench `search_bench` réaligné sur la signature HashMap frecency
- [ ] Étendre aux autres structs : `AppInfo`/`FileInfo` (champ enum `category` → décision `#[ts(type)]` ou enum TS partagé), `Settings`, métriques
- [ ] Supprimer les commentaires `[SYNC:]` au fur et à mesure de la couverture
- [ ] ⚠️ rustfmt skew préexistant sur `auth.rs`/`steam.rs` (lignes ~100 col du commit LazyLock) — non lié, laissé tel quel ; à vérifier si la CI fmt les flag

### F3. Events `volt:*` typés `[S]` — résout `ts-08`/`arch-10` ✅ commit cc2d98a (agent A)
- [x] `src/shared/events.ts` : `VOLT_EVENTS` + `VoltEventMap` + `declare global WindowEventMap`
- [x] Helpers typés `emitVoltEvent` / `onVoltEvent` (cleanup retourné)
- [x] 18 events DOM migrés (App.tsx, useGlobalHotkey, shell, calculator, timer, ai-chat, clipboard, systemcommands, systemmonitor, ResultItem...)
- [x] Laissés hors scope (par design) : bridge extension dynamique (`volt:${event}` runtime), events Tauri `volt://*` (IPC cross-fenêtre), clés localStorage `volt:*`

### arch-05 / sec-02. Supprimer les `eslint-disable` ✅ commit 2976ac0 (agent B)
- [x] 8 directives supprimées en corrigeant la racine : stale-closures (Clipboard/FileSearch/Game/Timer via `useCallback`), `no-control-regex` via `String.fromCharCode(27)`, `@ts-expect-error` test via `unknown` narrowé
- [x] EmojiPicker : déjà résolu par react-06 (useMemo) sur cette branche → version supérieure conservée au merge
- [x] Vérifié : 0 `eslint-disable`/`@ts-ignore`/`@ts-expect-error` restant dans `src/`

### F2. `timings` IPC pour profiling `[S]`
- [ ] Ajouter un champ `timings` optionnel aux réponses du hot-path search
- [ ] Instrumenter les étapes (match, frecency, tri) — réutiliser le tracing span existant

---

## 🌊 Vague 2 — Robustesse données

### C. SQLCipher + Credential Manager + repositories `[M]`
- [ ] Passer `rusqlite` en `features = ["bundled-sqlcipher"]` (`Cargo.toml:50`)
- [ ] `PRAGMA key` à l'ouverture de chaque base
- [ ] Algo clé (réutiliser `keyring_store.rs`) :
  - [ ] (a) lire clé dans Credential Manager
  - [ ] (b) sinon DPAPI legacy → migrer vers Credential Manager
  - [ ] (c) sinon si DB existe → **erreur de récupération (NE PAS régénérer)**
  - [ ] (d) sinon générer 64 chars + stocker
- [ ] Adopter `refinery` pour les migrations (remplacer l'ad-hoc de `indexer/database.rs`)
- [ ] Mode WAL explicite
- [ ] Pattern repository par domaine : `clipboard`, `snippets`, `launch_history`, `notes`
- [ ] Base attachée `frecency` (depuis Pilier A) → `ORDER BY frecency_date DESC` en SQL
- [ ] Migration données clair → chiffré (one-shot au 1er lancement post-update)
- [ ] Tests : cas « clé perdue + DB existe » → alerte, pas de corruption ; fallback DPAPI

---

## 🌊 Vague 3 — Recherche fichiers (différenciateur, phasé)

### D1. Index inversé Tantivy (SANS MFT d'abord) `[L]`
- [ ] Ajouter `tantivy` à `Cargo.toml` derrière feature-flag `tantivy`
- [ ] Index persistant alimenté par le scanner actuel (`indexer/scanner.rs`)
- [ ] Schéma : champs `name`, `path`, `path_raw` (exact), `category`
- [ ] Tokenizer : `Lowercase` + ascii-folding + champ `raw` pour chemin exact
- [ ] Scoring en couches : BM25 → boost préfixe → boost distance fuzzy
- [ ] Requête fuzzy Damerau-Levenshtein (tolérance fautes + transpositions)
- [ ] Remplacer le matching nucleo **sur l'index fichiers** (garder nucleo pour les apps)
- [ ] Garder `read_dir` comme fallback non-NTFS
- [ ] Bench avant/après (criterion) : latence + pertinence
- [ ] **Décision GO/NO-GO sur D2/D3 selon résultat de D1**

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

## 📌 Ordre d'attaque recommandé
1. **A** (frecency) → débloque aussi l'audit `rust-history-clone-01`
2. **B** (clipboard event-driven)
3. **F1 + F3** (IPC/events typés) → garde-fou, converge avec l'audit
4. **C** (SQLCipher)
5. **D1** (Tantivy) → **décision GO/NO-GO** pour D2/D3
6. **E1** si besoin produit snippet global ; **E2-E4** seulement si signature dispo
</content>
