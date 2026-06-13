# Refonte Volt — Modernisation cœur launcher 2026

> **Cible** : Volt (Tauri v2 + React + TypeScript).
> **Date** : 2026-06-06.
> **Statut** : plan historique daté du 6 juin 2026. Pour l'état opérationnel actuel, les décisions prises et les validations restantes, voir `TODO-REFONTE.md`.

Ce document conserve la proposition initiale de modernisation du **cœur** de Volt (recherche, données, frecency, clipboard, input). Ses constats et formulations « Volt aujourd'hui » décrivent l'état vérifié le 6 juin 2026 et ne constituent plus le suivi courant.

Principe de fond : **Volt n'a pas besoin de refonte architecturale.** Tauri (cœur Rust + UI web) est déjà le bon socle cross-platform. On importe des **algorithmes et patterns** ciblés, pas une nouvelle topologie de process.

---

## 1. Résumé exécutif

Volt est fonctionnellement solide mais son cœur repose sur quelques choix sous-optimaux face à l'état de l'art 2026. Quatre différenciateurs, par ROI décroissant :

1. **Frecency = un seul timestamp poussé vers le futur** (`ORDER BY frecency_date DESC`, zéro calcul à la requête), comme le modèle de frecency de Mozilla. Volt recalcule `launch_count × decay` pour chaque enregistrement **à chaque frappe** (`search/mod.rs:9`) — c'est la cause racine du finding `rust-history-clone-01` de l'audit. **Quick win à fort levier : changer le modèle élimine le calcul ET le clone de map.**
2. **Recherche fichiers = index inversé full-text (BM25, via Tantivy) alimenté par énumération MFT NTFS + USN journal**, pas un walk de dossiers + fuzzy. Volt fait un `std::fs::read_dir` récursif (depth 10) + nucleo + fallback PowerShell/OLE-DB sur le Windows Search Index. **C'est LE chantier stratégique** (vitesse + pertinence + index instantané au boot).
3. **Clipboard event-driven** (`AddClipboardFormatListener`) vs **polling 500ms** chez Volt (`clipboard_manager/plugin.rs:543`). Quick win : moins de CPU, latence nulle, ne rate plus les changements rapides.
4. **Auto-expansion globale de snippets** via hook clavier bas-niveau + injection, idéalement isolée dans un helper privilégié signé. Volt n'a que des hotkeys `RegisterHotKey` (via `tauri-plugin-global-shortcut`) et des snippets **in-app** (préfixe `;`). **Chantier lourd, à valeur produit élevée mais à isoler.**

Deux patterns de robustesse à importer en transverse :
- **DB chiffrée (SQLCipher) + clé dans le Credential Manager (miroir DPAPI)** avec gestion explicite du cas « clé perdue mais DB existe » → alerte, ne régénère pas. Volt stocke en clair (`rusqlite` bundled, pas de SQLCipher).
- **IPC fortement typé avec contrats générés** → rejoint le finding `ts-02` de l'audit (codegen Rust→TS via tauri-specta/ts-rs).

**Verdict : importer 4 algorithmes/sous-systèmes ciblés, dont 2 sont des quick-wins qui résolvent en plus des findings de l'audit existant.**

---

## 2. Tableau comparatif (état vérifié)

| Sous-système | Volt aujourd'hui | État de l'art 2026 | Écart | Réf. code Volt |
|---|---|---|---|---|
| **Architecture** | Tauri v2 (cœur Rust + WebView) | cœur natif partagé + UI web | ✅ Volt déjà aligné | `src-tauri/src/lib.rs` |
| **Frecency** | `launch_count × exp(-age/168h)`, recalculé/frappe | 1 timestamp poussé au futur, `ORDER BY DESC` | 🔴 modèle plus coûteux + clone map/frappe | `search/mod.rs:9-14`, `launcher/history.rs` |
| **Index fichiers** | `read_dir` récursif depth 10 + nucleo + PS/OLE-DB | MFT NTFS + USN + index inversé BM25 | 🔴 walk lent, pas d'index inversé, pas d'incrémental | `indexer/scanner.rs`, `indexer/windows_search.rs` |
| **Scoring** | exact=100/startsWith=90/contains/fuzzy=50 (nucleo) | BM25 + boost préfixe + boost distance fuzzy | 🟠 scoring plat vs scoring en couches | `utils/matching.rs`, `search/mod.rs` |
| **Clipboard** | polling `interval(500ms)` | `AddClipboardFormatListener` (event) | 🟠 CPU + latence + rate les changements rapides | `clipboard_manager/plugin.rs:543` |
| **Hotkeys globaux** | `tauri-plugin-global-shortcut` (RegisterHotKey) | RegisterHotKey (fenêtre message-only) | ✅ équivalent | `Cargo.toml:29` |
| **Snippet auto-expand** | in-app seulement (préfixe `;`) | hook clavier LL global + injection | 🔴 absent globalement | `plugins/builtin/snippets/` |
| **Hyperkey** | absent | remap touche → Ctrl+Alt+Shift+Win | 🟡 fonctionnalité produit absente | — |
| **DB chiffrement** | rusqlite bundled, **non chiffré** | SQLCipher + Credential Manager + DPAPI | 🟠 secrets/historique en clair au repos | `Cargo.toml:50`, `indexer/database.rs` |
| **Frecency storage** | en mémoire (`LaunchHistory`) + JSON | base SQLite dédiée/attachée | 🟡 pas de base dédiée | `launcher/history.rs` |
| **IPC typing** | `invoke<T>` hand-written + commentaires `[SYNC:]` | contrats typés, décodage auto | 🟠 contrats non vérifiés (cf. audit ts-02) | `shared/types/common.types.ts` |

Légende : ✅ Volt OK/aligné · 🟡 fonctionnalité produit absente (optionnel) · 🟠 amélioration de robustesse/perf · 🔴 écart de différenciation majeur.

---

## 3. Principes directeurs

1. **Pas de refonte architecturale.** Tauri = cœur Rust + webview, c'est le bon socle. On importe des **algorithmes**, pas une topologie de process.
2. **Importer en priorité ce qui est mesurablement différenciant** (perf frappe→résultat, pertinence) avant le confort produit (hyperkey).
3. **Chaque chantier doit converger avec `AUDIT-2026.md`**, pas le contredire. Là où les deux docs pointent le même endroit (frecency, IPC typé), on fait d'une pierre deux coups.
4. **Le code privilégié (hook clavier global / injection) est radioactif** : à isoler dans un helper minimal, signé, avec canal de contrôle chiffré et authentifié (un launcher est une cible de choix).
5. **Pas de régression sécurité.** Le hardening existant de Volt (SSRF, JWT, keyring HMAC, CSP, fail-closed extensions) est de qualité pro (cf. audit §« à ne pas casser ») — toute refonte data/input doit le préserver.
6. **Feature-flag Cargo** pour les gros sous-systèmes natifs (`ntfs-scan`, `tantivy`, `uiaccess`) → build opt-in, surface réduite, rollback trivial.

---

## 4. Chantiers de refonte (par pilier)

### Pilier A — Modèle de frecency « timestamp poussé » `[S, ROI très élevé]`

**Constat.** Volt : `calculate_frecency()` fait `launch_count × exp(-age_hours/168)` pour **chaque** record, **à chaque frappe** (3 sites : `search.rs:116` join, `apps.rs:1160`, `launcher.rs:260`). L'audit a déjà dû projeter l'historique en map pour éviter le clone (`rust-history-clone-01`) — mais le calcul lui-même reste par frappe.

**Cible (modèle Mozilla-frecency).** Un seul champ `frecency_date` par item. À chaque usage : `frecency_date = now + poids` (le poids encode la valeur d'une visite). Classement = `ORDER BY frecency_date DESC`. **Zéro calcul, zéro decay à lire à la requête** — récence ET fréquence sont encodées dans une valeur monotone.

**Refonte.**
1. Remplacer `LaunchRecord { launch_count, last_launched }` par `LaunchRecord { frecency_date: i64, search_terms }` (garder `pinned`).
2. À chaque launch : `frecency_date = max(now, frecency_date) + WEIGHT` (incrément additif → fréquence cumulée ; ancrage sur `now` → récence). Calibrer `WEIGHT` empiriquement (ex. visite = +1 jour, à tuner).
3. Lecture : pré-trier les items connus par `frecency_date DESC` ; le score de recherche reste le match nucleo, le tie-break devient la frecency (déjà ordonnée).
4. Supprimer `calculate_frecency()` du hot-path → supprime les 3 projections de map par frappe.

**Bénéfices croisés.** Résout `rust-history-clone-01` à la racine (plus rien à projeter), simplifie `search.rs`/`apps.rs`/`launcher.rs`, recents stables.

**Risque.** Migration des données d'historique existantes (`launch_count`→`frecency_date`) : one-shot `now + count_normalisé`. Pas de perte si fait avant le bump.

---

### Pilier B — Clipboard event-driven `[S, ROI élevé]`

**Constat.** `clipboard_manager/plugin.rs:543` : boucle `tokio::time::interval(500ms)` qui relit le presse-papier. CPU réveillé en continu, latence jusqu'à 500ms, et **rate les changements multiples sous 500ms** (copier A puis B rapidement = A perdu).

**Cible.** `AddClipboardFormatListener(hwnd)` → message `WM_CLIPBOARDUPDATE` → callback. Event-driven, zéro polling.

**Refonte (Windows).**
1. Créer une fenêtre message-only, `AddClipboardFormatListener`, pomper `WM_CLIPBOARDUPDATE` sur un thread dédié (via `windows`/`winapi`, déjà deps du projet).
2. Émettre vers le frontend via l'event Tauri existant au lieu du tick.
3. Garder un fallback polling derrière feature-flag pour macOS/Linux (pas d'équivalent universel).
4. Bonus optionnel : capturer l'app source (`GetForegroundWindow` → PID → exe) pour enrichir l'historique.

**Risque.** Faible. Bien borné. Tester le re-entrancy (ne pas réagir à sa propre écriture `set_clipboard`).

---

### Pilier C — Couche de données chiffrée + repositories `[M, ROI moyen]`

**Constat.** Volt : `rusqlite` bundled non chiffré (`Cargo.toml:50`). Historique clipboard, snippets, notes, historique de lancement en clair sur disque. Pas de pattern repository unifié ni de migrations versionnées centralisées.

**Cible.** SQLCipher (`PRAGMA key`) ; clé 64 chars dans **Windows Credential Manager** + miroir **DPAPI** en fallback + migration legacy ; **gestion du cas « clé perdue mais DB existe » → alerte de récupération, ne régénère JAMAIS** (sinon corruption silencieuse) ; migrations versionnées (`refinery`) ; mode WAL ; **bases attachées** par sous-système ; **repository par domaine**.

**Refonte.**
1. Passer `rusqlite` en `features = ["bundled-sqlcipher"]`.
2. Algo clé : (a) lire clé dans Credential Manager ; (b) sinon DPAPI legacy → migrer ; (c) sinon si DB existe → **erreur de récupération** ; (d) sinon générer + stocker. Réutiliser `keyring_store.rs` (déjà HMAC-signé) comme abstraction.
3. Adopter `refinery` pour les migrations (aujourd'hui ad-hoc dans `indexer/database.rs`).
4. Pattern repository par domaine : `clipboard`, `snippets`, `launch_history`, `notes`.
5. Base attachée `frecency` (cf. Pilier A) → `ORDER BY frecency_date DESC` côté SQL plutôt qu'en mémoire.

**Risque.** Moyen. Migration de données (clair→chiffré) one-shot au premier lancement post-update. **Le cas « clé perdue » est critique** : ne pas l'implémenter = risque de corruption. Bien tester le fallback DPAPI.

---

### Pilier D — Moteur de recherche fichiers : MFT NTFS + index inversé `[XL, ROI élevé — différenciateur]`

**Constat.** Volt indexe via `std::fs::read_dir` récursif (`indexer/scanner.rs`, depth 10, `notify` v6 pour le watch) et complète par des requêtes PowerShell/OLE-DB au Windows Search Index (`indexer/windows_search.rs`, subprocess lent par requête). Matching = nucleo fuzzy. **Pas d'index inversé, pas de scan MFT, pas d'incrémental USN.**

**Cible (techniques éprouvées : Everything pour la MFT, Lucene/Tantivy pour le full-text).**
- **Énumération MFT NTFS** (lecture directe de la Master File Table, façon Everything) → index quasi-instantané vs walk de dossiers.
- **Incrémental via USN Journal** (reprise au dernier change ID, pas de re-crawl complet).
- **Queue persistée sur disque** (survit aux redémarrages).
- **Tantivy** (moteur full-text Rust type Lucene) : index inversé, **BM25** + scoring custom (boost préfixe, boost distance fuzzy), requête fuzzy Damerau-Levenshtein, tokenizer `Lowercase`+ascii-fold + champ chemin exact.

**Refonte (phasée — ne pas tout faire d'un coup).**
- **D1 `[L]` — Tantivy d'abord (sans MFT).** Remplacer le matching nucleo sur l'index fichiers par un index Tantivy persistant, alimenté par le scanner actuel. Scoring en couches BM25 + boost préfixe + boost fuzzy. Gain immédiat de pertinence + index persistant (pas de re-scan complet au boot). Crate : `tantivy`. Feature-flag `tantivy`.
- **D2 `[XL]` — Scan MFT NTFS.** Crate `ntfs` + lecture directe du volume (privilèges admin pour `\\.\C:` — typiquement via un service Windows). Thread/process dédié émettant des batches vers l'indexeur. **C'est le vrai gain « Everything ».** Remplace le walk `read_dir`. Feature-flag `ntfs-scan`.
- **D3 `[L]` — Incrémental USN Journal.** Lire le change journal NTFS (`FSCTL_QUERY_USN_JOURNAL` / `FSCTL_READ_USN_JOURNAL`) → mises à jour live sans re-scan. Queue persistée pour reprise.
- **D4 `[M]` — Architecture en acteurs** (découpler découverte / watch / indexing / queue) une fois D1-D3 stabilisés.

**Bénéfices.** Vitesse (index inversé vs scan linéaire), pertinence (BM25 + scorers), index instantané au boot (persisté + incrémental).

**Risque.** Élevé. MFT = privilèges + edge-cases (volumes amovibles, réseau, non-NTFS). **Approche recommandée : livrer D1 (Tantivy) seul d'abord** — gros gain de pertinence sans toucher aux privilèges — puis évaluer D2/D3 selon le retour. Garder le walk `read_dir` comme fallback non-NTFS.

---

### Pilier E — Auto-expansion snippets & input global `[XL, ROI produit, à isoler]`

**Constat.** Volt : hotkeys via `tauri-plugin-global-shortcut` (= `RegisterHotKey`, suffisant pour le toggle Ctrl+Space). Pas de hook clavier bas-niveau, pas d'auto-expansion globale de snippets (uniquement in-app `;`), pas de hyperkey.

**Cible.** Hook clavier bas-niveau (`WH_KEYBOARD_LL`) + injection (`SendInput`) résolvant scancode→char via `ToUnicodeEx`+`GetKeyboardLayout` (snippets multi-layout). Pour fonctionner **au-dessus des fenêtres élevées (UAC)**, le code privilégié vit dans un helper séparé `uiAccess=true` **signé**, piloté par un canal chiffré + authentifié. Hyperkey en bonus (remap d'une touche).

**Refonte (très lourd, opt-in).**
1. **E1 `[L]` — Snippet auto-expansion global** sans privilège d'abord : hook `WH_KEYBOARD_LL` dans le process principal (fonctionne hors fenêtres élevées). Résoudre scancode→char via `ToUnicodeEx`+layout actif. Supprimer keyword + injecter via `SendInput`. **80% de la valeur, 20% de la complexité.**
2. **E2 `[XL]` — Helper `uiAccess=true`** : binaire Rust séparé, manifeste `uiAccess="true"`, **signé**, dans Program Files. Pilote le hook + injection au-dessus de l'UAC. **Prérequis : signature de code valide** (sinon uiAccess refusé par Windows).
3. **E3 `[L]` — Canal sécurisé** vers le helper : named pipe + vérif identité appelant (`CheckTokenMembership`) + chiffrement (Schannel/TLS) + vérif signature (`WinVerifyTrust`). **Non négociable** (le helper peut injecter des frappes partout).
4. **E4 `[M]` — Hyperkey** : remap d'une touche vers Ctrl+Alt+Shift+Win.

**Risque.** Très élevé. uiAccess exige signature + emplacement de confiance → impossible en dev non signé. **Recommandation : E1 seul (hook in-process) couvre l'auto-expansion pour la plupart des apps ; ne lancer E2-E4 que si un besoin produit concret le justifie.** Pilier le plus éloignable.

---

### Pilier F — Hygiène IPC & contrats typés `[S-M, ROI moyen — converge avec l'audit]`

**Constat.** Volt : ~80 contrats `invoke<T>` hand-written, 8 commentaires `[SYNC:]` non-enforced (cf. audit `ts-02`).

**Refonte.**
1. **F1** — Codegen Rust→TS via `tauri-specta` ou `ts-rs` (= finding `ts-02` de l'audit). Générer d'abord les 10-15 structs les plus utilisées (Settings, FileInfo, AppInfo, LaunchRecord, métriques) + test CI qui échoue sur divergence.
2. **F2** — Ajouter des `timings` optionnels aux commandes du hot-path (search) pour profiler frappe→résultat (réutiliser le tracing span déjà partiellement là).
3. **F3** — Events `volt:*` typés (= findings `ts-08`/`arch-10` de l'audit) : un seul `shared/events.ts` avec union nommée des `detail`.

**Risque.** Faible. Purement additif. **À faire en parallèle de l'audit (mêmes findings).**

---

## 5. Feuille de route séquencée

### Vague 1 — Quick wins (convergent avec Sprint 1 de l'audit) `[2-3 semaines]`
1. **Pilier A** (frecency timestamp) — résout aussi `rust-history-clone-01`. **Commencer ici.**
2. **Pilier B** (clipboard event-driven).
3. **Pilier F1/F3** (codegen IPC + events typés) — déjà dans l'audit (`ts-02`/`ts-08`).

> Ces trois items ferment des findings de l'audit ET modernisent le cœur. ROI maximal.

### Vague 2 — Robustesse données `[3-4 semaines]`
4. **Pilier C** (SQLCipher + Credential Manager + repositories + migrations refinery). Prérequis souple de A (base attachée `frecency`).

### Vague 3 — Le différenciateur recherche `[6-10 semaines, phasé]`
5. **Pilier D1** (Tantivy seul, alimenté par le scanner actuel) — **gros gain, risque maîtrisé**.
6. **Pilier D2/D3** (MFT NTFS + USN) — **uniquement si D1 valide l'approche** ; nécessite stratégie privilèges/service.
7. **Pilier D4** (acteurs) — consolidation.

### Vague 4 — Input produit (optionnel, le plus lourd) `[à décider]`
8. **Pilier E1** (auto-expansion snippet via hook in-process).
9. **Pilier E2-E4** (helper uiAccess signé + hyperkey) — **seulement sur besoin produit avéré + chaîne de signature en place**.

### Dépendances clés
```
A (frecency) ──► simplifie C (base frecency attachée)
B (clipboard) ── indépendant
F1/F3 (IPC typé) ── indépendant, à faire tôt (garde-fou)
C (SQLCipher) ──► prérequis souple de D (index persistant chiffré)
D1 (Tantivy) ──► PRÉREQUIS de décision pour D2/D3 (MFT)
E1 (hook in-process) ──► PRÉREQUIS conceptuel de E2 (uiAccess)
E2 ── BLOQUÉ tant que signature de code absente
```

---

## 6. Matrice effort / impact

| # | Chantier | Effort | Impact | Résout aussi (audit) | Vague |
|---|---|---|---|---|---|
| A | Frecency timestamp poussé | S | 🔥 élevé | `rust-history-clone-01` | 1 |
| B | Clipboard event-driven | S | élevé | — | 1 |
| F1 | Codegen IPC Rust→TS | M | élevé | `ts-02` | 1 |
| F3 | Events `volt:*` typés | S | moyen | `ts-08`/`arch-10` | 1 |
| C | SQLCipher + Credential Mgr + repos | M | moyen | — | 2 |
| D1 | Tantivy (index inversé BM25) | L | 🔥 élevé | — | 3 |
| D2 | Scan MFT NTFS | XL | élevé | — | 3 |
| D3 | Incrémental USN journal | L | moyen | — | 3 |
| D4 | Architecture en acteurs | M | moyen | — | 3 |
| E1 | Auto-expand snippet (hook in-process) | L | moyen | — | 4 |
| E2 | Helper uiAccess signé | XL | moyen | — | 4 |
| E3 | Canal chiffré vers helper | L | (sécu E2) | — | 4 |
| E4 | Hyperkey | M | faible | — | 4 |
| F2 | `timings` IPC (profiling) | S | faible | — | 1-2 |

---

## 7. Ce que Volt fait DÉJÀ bien (ne pas « refondre »)

- **Architecture Tauri** : cœur Rust cross-platform + UI web, sans le poids d'un backend supervisé séparé.
- **Hardening sécurité** (SSRF multi-forme, JWT alg-confusion, keyring HMAC, CSP stricte, fail-closed extensions, launch validation LOLBIN) — de qualité pro, **à préserver intégralement** lors des refontes data/input (cf. `AUDIT-2026.md` §« à ne pas casser »).
- **Hotkeys** via `tauri-plugin-global-shortcut` = équivalent fonctionnel du toggle global.
- **Pipeline de scoring nucleo** : correct comme matcher d'apps (liste bornée) ; le remplacement Tantivy ne concerne que **l'index fichiers** (grand volume), pas la recherche d'apps.

---

## 8. Risques transverses & garde-fous

| Risque | Mitigation |
|---|---|
| MFT/uiAccess exigent privilèges/signature | Feature-flags Cargo (`ntfs-scan`, `uiaccess`), fallback non-privilégié (walk/in-process hook), opt-in |
| Migration de données (frecency, clair→chiffré) | One-shot idempotent au 1er lancement post-update, testé, **jamais de régénération silencieuse de clé** |
| Régression sécurité pendant la refonte data/input | Re-run de la checklist sécurité de l'audit ; ne pas toucher au sandbox extensions |
| Bundle/cycle Rollup (cf. v0.1.8) | Respecter l'Étape 3A de `CLAUDE.md` (cycle-scan) sur tout ajout front |
| Sur-ingénierie | Principe #1 : importer des algos, pas une topologie de process |

---

## 9. Références

- Audit Volt : `AUDIT-2026.md` (findings `rust-history-clone-01`, `ts-02`, `ts-08`, `arch-10`).
- Code Volt clé : `src-tauri/src/search/mod.rs`, `launcher/history.rs`, `indexer/{scanner,windows_search,database}.rs`, `plugins/builtin/clipboard_manager/plugin.rs`.
- Techniques de référence : Mozilla frecency (modèle de classement), Everything (énumération MFT NTFS), Lucene/Tantivy (index inversé BM25).
- TODO opérationnel : `TODO-REFONTE.md`.
</content>
