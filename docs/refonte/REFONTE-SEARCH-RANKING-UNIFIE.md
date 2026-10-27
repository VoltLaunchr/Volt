# Ranking unifié de la recherche racine

> Statut : implémenté (2026-10-14). Code : `src-tauri/src/search/tiers.rs`,
> `src-tauri/src/search/mod.rs`, `src-tauri/src/launcher/history.rs`,
> `src/app/searchRanking.ts`, `src/app/commandFrecency.ts`.

## Problème

Le classement mélangeait deux systèmes de nombres magiques : des paliers Rust
pour les apps (1000 / 950 / 900 / 850 / 500-849 / 200-499 + bonus frecency ≤ 20
et binding ≤ 15) et des offsets additifs côté front (`APPLICATION` 200,
`FILE` 160, `PLUGIN_BASE` 100 + score plugin, `PLUGIN_KEYWORD_BOOST` 300,
`GAME_BOOST` 500, web 1250/1300…). Chaque ajustement d'un côté cassait
l'entrelacement de l'autre, la frecency ne concernait que les apps et les
bindings appris n'étaient lus que par le ranker d'apps.

## Modèle retenu (inspiré de Raycast)

Plus aucune addition de scores entre types. Chaque résultat porte un
`ResultRank` et un **comparateur lexicographique unique** (`compareResults`) :

```
bande > tier > qualité > frecency > source (app, commande, fichier) > score déclaré > titre (Intl.Collator numérique)
```

- **Tiers** : une seule échelle, l'enum Rust `SearchTier`. L'ordre des variantes
  *est* le classement. `cargo test` génère `SearchTier.ts` (ts-rs) et
  `searchTierOrder.ts` (test `export_search_tier_order`) : le front n'a aucune
  constante de tier dupliquée.
- **Où ça vit** : les apps et fichiers sont classés en Rust (nucleo, alias,
  bindings, frecency) et arrivent avec `tier` + qualité + frecency. Les
  résultats de plugins sont produits dans le renderer : leur tier est calculé
  en TS (`rankCommand`) avec les mêmes règles (titre exact / préfixe / fuzzy,
  approximation du score nucleo et même mapping log 50-89). Choix justifié par
  le coût IPC : envoyer les candidats plugins à Rust ajouterait un aller-retour
  par frappe et casserait le streaming apps → fichiers. Les seules données
  Rust nécessaires aux plugins arrivent sans IPC supplémentaire :
  - bindings appris : événement `learned` envoyé en tête du canal
    `search_streaming` (lookup O(1) sur le préfixe) ;
  - frecency : cache `commandFrecency.ts` chargé au montage du pipeline,
    rafraîchi quand la requête est vidée, mis à jour par la date renvoyée par
    `record_command_usage`.

### Échelle des tiers (du plus fort au plus faible)

| Tier | Apps | Commandes plugins | Fichiers |
|---|---|---|---|
| `aliasExact` | alias = requête | — | — |
| `learnedExact` | requête tapée exactement avant d'ouvrir l'item (≤ 17 j) | idem (via `learned`) | — |
| `titleExact` | nom = requête | titre = requête | — |
| `aliasPrefix` | alias commence par la requête, ou requête apprise plus longue (≤ 17 j) | requête apprise | — |
| `titlePrefix` | nom commence par la requête | titre commence par la requête | — |
| `activation` | — | préfixe / mot-clé du manifeste (`>`, `;`, `ql:`, `timer`, …) | — |
| `fileExact` | — | — | nom ou radical = requête |
| `fuzzy` | nucleo sur le nom (qualité 50-89) | fuzzy titre (approx. nucleo) | — |
| `filePrefix` | — | — | nom commence par la requête |
| `secondary` | chemin court / mots-clés | sous-titre ou match propre au plugin | — |
| `fileFuzzy` | — | — | fuzzy sur le nom |
| `filePathOnly` | — | — | match hors du nom |

Un binding appris ne fait que **promouvoir** un résultat qui matchait déjà
(jamais faire apparaître un résultat non pertinent). La position des fichiers
reprend l'entrelacement précédent (nom exact au-dessus des apps fuzzy, préfixe
au-dessus des matchs chemin / mots-clés).

### Bandes (intentions spéciales, hors échelle)

| Bande | Contenu |
|---|---|
| `explicitWeb` | action web explicite (`?`, `web …`) |
| `liveWeb` | résultats Brave progressifs, ordre du fournisseur |
| `browse` | jeux pour une requête de navigation (`games`, `jeux`, …) |
| `answer` | réponse calculée de la calculatrice, URL détectée |
| `ranked` | tout le reste (échelle ci-dessus) |
| `fallback` | commandes de repli (`shouldShowWebFallbacks`), ordre configuré |

Restent inchangés : préfixes explicites (gérés par les plugins → tier
`activation`), timers, IA, debounce 80/150 ms, garde `latestSearchId`,
streaming apps → fichiers, préservation de la sélection, `maxResults`.

## Frecency universelle

- **Un seul store** : `launch_history.json` (`LaunchHistory`), clé = identité
  stable (`getStableResultIdentity`) : chemin pour les apps,
  `pluginId:resultId` pour les commandes. Nouveau champ
  `LaunchRecord.kind: 'app' | 'command'`.
- **Un seul modèle** : `frecency_date` (crédit daté dans le futur, +1 jour par
  usage, ancré sur `max(now, date)`, style Firefox), déjà en place pour les
  apps. Retenu plutôt qu'une demi-vie exponentielle (Raycast, 10 j) car l'ordre
  entre deux items est invariant dans le temps, ne demande aucun calcul à la
  requête et ne nécessite aucune migration. Comparé brut, il ne sert que de
  départage (pas de bonus borné à additionner).
- **Enregistrement** : `useResultActions` appelle `record_command_usage` (fire
  and forget) pour tout résultat à identité stable qui n'est ni une app
  (`launch_app` l'enregistre déjà) ni un fichier (`track_file_access`). Web,
  URL, calculatrice, fallbacks : identité `null`, jamais enregistrés.
- **Bornes** : 500 enregistrements `command` max (éviction par frecency la plus
  basse), identité ≤ 512 octets, refus d'une identité déjà suivie comme app.
- **API apps inchangées** : récents, fréquents, épinglés, suggestions,
  `count`, nettoyage des chemins invalides ne voient que `kind = app`.

## Migration

- `launch_history.json` : `#[serde(default)]` → les anciens enregistrements se
  chargent en `kind: app`, aucune réécriture nécessaire.
- `query_bindings.json` : nouveaux champs `exactCount` / `lastExact`
  (`#[serde(default)]`). Les anciens bindings ne valent que comme
  `aliasPrefix` (préfixe appris) tant que `lastUsed` < 17 j, jusqu'à ce que
  l'utilisateur retape la requête exacte.
- Supprimés (morts) : `SEARCH_SCORING` (front), `TIER_*` / `FILE_TIER_*`,
  `frecency_bonus`, `QueryBindingStore::get_boost`.

## Suites possibles

Reprise du 24 octobre 2026 : le cache de frecency garde la date la plus récente
quand deux réponses `record_command_usage` arrivent dans l’ordre inverse. Les
dates négatives ou non finies sont rejetées pour conserver un comparateur
numérique valide. Ces deux cas font l’objet de tests de régression.

- Suggestions à requête vide pilotées par la frecency universelle (épinglés,
  puis frecency) — non fait, la vue reste statique.
- Tier « overbounds » de Raycast (la requête prolonge un terme appris de ≤ 3
  caractères) et apprentissage des requêtes exactes de plus de 8 caractères.
- Sensibilité (low / medium / high) appliquée aussi aux titres de plugins.
- Fuzzy des plugins via le vrai matcher (WASM ou envoi groupé à Rust) si
  l'approximation TS s'avère insuffisante.
- Frecency comme départage des fichiers (via `track_file_access`).
