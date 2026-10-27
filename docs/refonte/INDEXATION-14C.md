# Indexation 14-C

Les règles `.gitignore`, `.ignore` et `.voltignore` sont appliquées au scan et
au watcher. Les exclusions manuelles restent prioritaires. Les dossiers générés
connus sont filtrés avant d’être ajoutés à l’index. Les options correspondantes
dans Paramètres → Recherche de fichiers permettent de désactiver ces politiques.
Une modification des options déclenche un nouveau scan.

Les mesures locales sont **désactivées par défaut**. Activer « Mesurer les scans
localement », puis reconstruire l’index ou attendre un rattrapage. Le bouton
« Copier le rapport local » copie des durées, des compteurs et les deltas des
50 derniers scans réussis. Aucun chemin de fichier, nom de dossier ou contenu
n’est inclus. Aucune donnée n’est envoyée automatiquement.

Les durées couvrent le parcours et la persistance SQLite, avant la reconstruction
de l’index dérivé Tantivy. Un cache servi au démarrage ne constitue pas un scan
et n’ajoute pas de mesure. Une persistance échouée conserve l’ancien snapshot.

Ces mesures permettent de comparer des périmètres identiques avec les options
activées et désactivées. Elles ne prouvent pas un gain sur un profil complet
ou sur un autre disque. Aucun service privilégié n’est installé.

## Validation locale (14 octobre 2026)

- Frontend : 506 tests passent ; build TypeScript/Vite réussi.
- Clippy strict : matrices `tantivy-search` et `--no-default-features --features
  sqlcipher` réussies. La saveur Rust `store` compile également.
- Rust, `tantivy-search` : 464 tests passent ; le test de mesure est ignoré
  dans la suite courante puis exécuté séparément avec succès.
- La fixture de mesure examine 20 000 chemins : 20 000 retenus sans exclusion
  générée, 2 000 avec exclusion (65 ms / 58 ms sur cette exécution). Elle mesure
  uniquement la politique de filtrage, sans parcours disque ni extraction d’icônes.
- Régressions : règles hiérarchiques, réinclusion après édition/suppression,
  règles au-dessus de la racine, chemins Windows conservés, exclusions relatives,
  ancien index SQLite avec cache vide, échec de persistance, historique borné.
- Les harnesses Windows MSVC embarquent désormais la dépendance Common Controls
  v6, requise par `TaskDialogIndirect` ; les tests Cargo démarrent sans modification
  du système.

Le watcher borne la réinclusion à 20 000 entrées par lot. Au-delà, reconstruire
l’index pour compléter la réinclusion. Les mesures restent désactivées par défaut.

## Revalidation du 21 octobre 2026

- 506 tests frontend et 480 tests Rust `tantivy-search` passent, sans échec ;
  le test de mesure reste ignoré par défaut.
- Les deux matrices Clippy strictes (`tantivy-search` et SQLCipher sans
  features par défaut) et le contrôle de formatage Rust passent également.
- Les chemins absents issus de Windows Search conservent le préfixe canonique
  de leur parent existant : une exclusion absolue continue à les filtrer hors
  des racines indexées. La régression correspondante passe sous Windows.
- Le test de concurrence Tantivy vérifie l'identité du document attendu,
  puisque la recherche floue peut aussi retourner les documents voisins.
- Le build natif Store release et le packaging MSIX réussissent ; voir
  [`MICROSOFT_STORE.md`](../build-release/MICROSOFT_STORE.md).

## Corrections de reprise du 24 octobre 2026

La politique appliquée aux résultats Windows Search est publiée lors du
chargement et de la sauvegarde des paramètres, même avec `indexOnStartup=false`.
Elle ne dépend donc plus du premier scan Volt. Un test couvre les exclusions
manuelles et `.voltignore` sans racine indexée ni scan au démarrage.

Le rapport copiable inclut les compteurs du watcher, bornés à 600 entrées
(30 jours × 20 racines). Il n’exporte que les labels `Root N` ou `Other roots`,
jamais le chemin de la racine. Le test d’export couvre aussi un ancien payload
qui contiendrait encore un chemin.
