# Revue de préparation produit avant marketing

_État du dépôt examiné : 2026-06-13. Cette revue décrit le workspace actuel, pas une release installée et certifiée._

## Positionnement à préserver

- **Message principal :** « Everything on your computer. One shortcut. »
- **Support :** « Open apps, find files, search clipboard, use snippets, run commands and control your desktop instantly. »
- **Confiance :** « Free, private, open-source, native on Windows, macOS and Linux. »
- **Preuve technique :** « Built with Rust and Tauri. Lightweight. Extensible. No Electron. »

Volt doit être présenté comme un lanceur de bureau généraliste, pas uniquement comme un outil pour développeurs. Les commandes shell, extensions et intégrations sont des capacités avancées, pas le cœur exclusif du produit.

## Méthode de preuve

| Niveau | Signification |
|---|---|
| Présent dans le code | Implémentation identifiable, sans garantie de fonctionnement sur un artefact distribué. |
| Couvert par tests | Tests automatisés ciblés, sans remplacer un test OS réel. |
| Validé sur artefact | Scénario reproduit sur un installateur de release propre. |
| Publiable | Résultat reproductible, documenté et suffisamment stable pour une promesse marketing. |

Une coche dans une roadmap historique n'est pas, seule, une preuve de niveau « validé sur artefact ».

## Décision synthétique

| Cible | Décision actuelle | Motif |
|---|---|---|
| Developer Preview contrôlée | **Go conditionnel** | Possible après un smoke test des flux principaux sur chaque OS annoncé, publication des limites connues et clarification de la collecte locale. |
| Marketing public large | **No-Go** | Les preuves de performance, de taille, de stabilité multiplateforme, de mise à jour et de confidentialité ne sont pas encore consolidées. |
| Public v1 | **No-Go** | Signature/notarisation, QA d'installation, mise à jour depuis une version précédente et critères de sortie ne sont pas démontrés de bout en bout. |

Voir aussi [le scorecard](./MARKETING_READINESS_SCORECARD.md), [les preuves des claims](./CLAIMS_EVIDENCE.md) et [les issues proposées](./PRE_MARKETING_ISSUES.md).

## Critères Developer Preview

Une Developer Preview peut tolérer des limitations documentées, mais pas des pertes de données, une exécution inattendue ou un flux principal inutilisable.

- [ ] Un artefact installable est produit pour Windows 10/11, macOS Intel, macOS Apple Silicon et au moins un format Linux pris en charge.
- [ ] Installation, premier lancement, hotkey, recherche d'apps, lancement, recherche de fichiers et désinstallation passent sur les plateformes annoncées.
- [ ] Aucun P0 ouvert; les P1 ont un contournement documenté ou sont exclus du périmètre annoncé.
- [ ] Les données locales enregistrées sont expliquées avant activation des fonctions sensibles, notamment le presse-papiers et l'historique shell.
- [ ] Les limites Wayland, signature système et formats Linux sont indiquées sur la page de téléchargement.
- [ ] Une procédure de diagnostic et de signalement de bug est testée.
- [ ] Les claims publics sont limités aux lignes `Verified` ou formulés avec les réserves de [CLAIMS_EVIDENCE.md](./CLAIMS_EVIDENCE.md).

**État :** les mécanismes existent largement dans le code et la CI, mais les preuves d'artefacts et la communication confidentialité restent à produire.

## Critères Public v1

- [ ] Tous les critères Developer Preview sont satisfaits sur une release candidate figée.
- [ ] Windows est signé Authenticode; macOS est signé et notarisé; les identités sont vérifiées sur machines propres.
- [ ] L'auto-update est validé depuis la dernière version publique vers la RC, avec signature, reprise sur erreur et relance.
- [ ] La matrice [QA_MATRIX.md](../release/QA_MATRIX.md) est complétée avec preuves et propriétaires.
- [ ] Deux cycles de bug bash ne laissent aucun P0/P1 non accepté explicitement.
- [ ] Les baselines de [PERFORMANCE_BASELINE.md](../benchmarks/PERFORMANCE_BASELINE.md) sont mesurées sur matériel représentatif.
- [ ] La politique de confidentialité et la copie in-app décrivent les données locales, les appels réseau et les fonctions opt-in.
- [ ] Le modèle de menace des extensions est publié sans appeler « sandbox » une isolation non démontrée comme frontière OS.
- [ ] Installation, update, uninstall et conservation/suppression des données utilisateur sont documentés.
- [ ] README, site, release notes et captures utilisent les mêmes versions, plateformes et limites.

## Revue fonctionnelle

| Domaine | Preuve actuelle | Risque ou vérification manquante | État marketing |
|---|---|---|---|
| Recherche et lancement d'apps | Scanners et launchers par OS, frecency, tests unitaires, CI sur trois OS. | Pas de matrice d'apps réelles ni de fresh-install publiée. | Partiel |
| Recherche de fichiers | Index SQLite, moteur nucleo par défaut, Tantivy optionnel, watcher et tests Rust. | Benchmarks 1k/10k/50k, volumes réseau, permissions et comportements OS à mesurer. | Partiel |
| Hotkey globale | Plugin Tauri, réglage utilisateur et gestion best-effort. | Conflits OS, dispositions clavier et Wayland non validés. | Partiel |
| Presse-papiers | Historique SQLite, recherche, rétention, filtre heuristique sensible et exclusions d'apps. | Monitoring activé par défaut; heuristique non garantie; base chiffrée seulement avec la feature SQLCipher non activée par défaut. | Partiel |
| Snippets | CRUD, variables, import/export et plugin `;`. | QA d'expansion/paste par OS et cas de secrets non publiée. | Partiel |
| Shell | Streaming, annulation, historique, redaction et blocklist. | Une blocklist ne rend pas l'exécution sûre; wording et avertissement utilisateur à revoir. | Partiel |
| Extensions | Registry, installation, permissions, stockage, Worker et tests de proxy réseau. | Audit externe absent; isolation Worker distincte d'un sandbox OS; compatibilité d'extensions réelles à valider. | Partiel |
| Auto-update | Plugin updater, clé publique, endpoint et UI de progression. | Parcours update réel et gouvernance de clé non prouvés; signature système conditionnelle. | Partiel |
| Game launcher | Scanners multi-plateformes et cache. | Couverture réelle variable selon launcher/OS; claims « 10 plateformes » à tester par combinaison. | Partiel |
| System monitor | Backend sysinfo, vues détaillées et tests. | Exactitude, permissions, températures et kill process varient par OS. | Partiel |
| Onboarding et settings | Fenêtres dédiées, persistance et tests frontend ciblés. | Parcours neuf à valider avec lecteur d'écran et écrans à faible résolution. | Partiel |

## Revue architecture

### Points favorables

- Frontend React/TypeScript séparé des accès OS Rust/Tauri.
- Commandes Tauri typées et capacités séparées par fenêtre.
- Recherche protégée par debounce 150 ms et rejet des réponses obsolètes.
- SQLite reste la source de vérité pour l'index; Tantivy est un dérivé optionnel.
- CI multiplateforme avec lint, build, Vitest, Rust, Clippy et matrices Tantivy/SQLCipher.
- Permissions d'extensions, proxy réseau, keyring et validation de chemins sont explicitement traités.

### Risques à fermer

- Le build par défaut utilise SQLite non chiffré pour plusieurs données locales sensibles; SQLCipher est une feature séparée.
- La fenêtre principale dispose d'une surface IPC large. Les capacités par fenêtre réduisent le risque, mais ne remplacent pas un audit de commandes sensibles.
- Les extensions s'exécutent dans un Web Worker du même processus. C'est une isolation utile, pas une frontière de sécurité équivalente à un processus OS.
- Le frontend tente d'envoyer les erreurs via `log_from_frontend`, mais aucune commande correspondante n'est actuellement trouvée dans le backend ou l'enregistrement Tauri.
- La documentation de release autorise encore des chemins où les certificats ne sont pas configurés; un draft GitHub ne doit pas être annoncé avant vérification des signatures.

## Revue bugs et stabilité

Sources : audits existants, code actuel, roadmaps et workflows. Cette liste ne remplace pas un bug bash.

| Sujet | Observation | Priorité readiness |
|---|---|---|
| Installation/signature | Windows et macOS ne sont pas démontrés signés/notarisés sur une RC actuelle. | P0 Public v1 |
| Update de bout en bout | Aucun résultat documenté d'un upgrade réel entre deux releases. | P0 Public v1 |
| Accessibilité | `ACCESSIBILITY_AUDIT.md` conserve des vérifications clavier, contraste, axe et lecteur d'écran ouvertes, malgré des roadmaps indiquant « complete ». | P1 |
| Linux Wayland | Les roadmaps le décrivent encore comme restant; le support ne doit pas être promis sans qualification. | P1 |
| Diagnostic frontend | Contrat `log_from_frontend` incomplet ou obsolète. | P1 |
| Risque dépendance Linux | `glib 0.18.5` est enregistré comme risque accepté, bloqué upstream. | P1 suivi sécurité |
| Game scanner | Un point performance ouvert subsiste dans l'audit Rust; la couverture fonctionnelle réelle reste à mesurer. | P2 |
| Documentation divergente | Versions, tailles, performances et niveaux de complétude diffèrent selon README, changelogs et roadmaps. | P1 marketing |

## Revue performance

Le dépôt contient des optimisations et un benchmark Criterion de recherche, mais aucune baseline approuvée ne permet de publier « instant », « fast », « lightweight », `~15 MB`, `<1 s`, `<100 ms` ou une consommation mémoire typique.

Avant toute promesse :

- exécuter le plan [PERFORMANCE_BASELINE.md](../benchmarks/PERFORMANCE_BASELINE.md);
- conserver matériel, OS, commit, build profile, taille d'index et percentile;
- mesurer les artefacts distribués, pas uniquement un serveur Vite ou un test unitaire;
- publier des plages et conditions, pas un meilleur résultat isolé.

## Revue sécurité et confidentialité

### Éléments positifs

- Pas de SDK de télémétrie généraliste identifié dans `package.json`.
- Clés et tokens passent majoritairement par le backend et le keyring OS.
- L'updater vérifie des signatures applicatives via la clé publique embarquée.
- Des contrôles existent pour SSRF, chemins, imports, deep links et commandes shell.

### Points non résolus

- « Private » doit signifier précisément « pas de télémétrie d'usage par défaut », pas « aucune connexion réseau ».
- Update check, registry d'extensions, auth, sync, IA et intégrations peuvent contacter des services distants selon usage/configuration.
- Clipboard, notes, index de fichiers et autres données SQLite ne sont pas chiffrés dans le build par défaut.
- Le presse-papiers est activé par défaut et peut contenir des secrets malgré le filtre heuristique.
- Aucune politique complète de crash reporting, rétention des logs et redaction transversale n'est encore publiée.

Voir [PRIVACY_AND_TELEMETRY_REVIEW.md](../security/PRIVACY_AND_TELEMETRY_REVIEW.md).

## Revue documentation

- [x] Architecture, features, plugins, distribution, sécurité et roadmaps existent.
- [x] Les documents historiques restent utiles comme contexte.
- [ ] Une source de vérité unique doit indiquer la version réellement distribuée.
- [ ] Les claims chiffrés non mesurés doivent être retirés ou qualifiés.
- [ ] Les limitations OS doivent être visibles depuis la page de téléchargement.
- [ ] La confidentialité doit être expliquée en langage utilisateur.
- [ ] Les procédures d'installation, update, uninstall et récupération doivent être testées.
- [ ] Les audits historiques doivent être datés et marqués « superseded » lorsqu'ils contredisent l'état actuel.

## Checklist marketing

- [ ] Page principale centrée sur « Everything on your computer. One shortcut. »
- [ ] Démonstration couvrant apps, fichiers, clipboard, snippets et commandes, pas seulement le shell.
- [ ] Claims limités aux preuves enregistrées dans `CLAIMS_EVIDENCE.md`.
- [ ] Captures réelles des trois OS annoncés.
- [ ] Téléchargements associés à checksums, signatures et instructions.
- [ ] Politique de confidentialité et modèle local/opt-in publiés.
- [ ] Comparatif concurrents revu avec sources datées et formulations non absolues.
- [ ] Changelog, version, README et site alignés.
- [ ] FAQ sur WebView/Tauri, « native », Electron, données locales et extensions.
- [ ] Canal de support, template de bug et procédure sécurité vérifiés.

## Recommandation finale

Ne pas lancer de campagne publique large ni annoncer une v1 stable à ce stade. Préparer une **Developer Preview limitée**, explicitement marquée comme telle, après fermeture des P0 Developer Preview et exécution d'une première matrice QA.

L'ordre recommandé est : qualification des claims, privacy copy, RC multiplateforme, bug bash, baseline performance, puis soft launch. Product Hunt, Hacker News, Reddit et SEO à grande échelle ne doivent commencer qu'après un score d'au moins 31/40 et aucune preuve critique manquante.
