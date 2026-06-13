# Registre des affirmations publiques

_État du dépôt examiné : 2026-06-13. Les statuts portent sur la preuve disponible, pas uniquement sur l'intention du produit._

## Statuts

- **Verified** : preuve directe et stable dans le dépôt, suffisante pour une formulation factuelle étroite.
- **Partial** : implémentation réelle, mais validation d'artefact, portée ou formulation encore limitée.
- **Needs verification** : aucune mesure ou preuve reproductible suffisante.
- **Do not use yet** : formulation trompeuse ou risque trop important tant qu'un prérequis n'est pas fermé.

| Claim | Evidence required | Current confidence | Required proof | Notes |
|---|---|---|---|---|
| Windows 10/11 | Build CI, installateur, scan/lancement, hotkey, update et uninstall sur machines propres. | Partial | Exécuter la matrice Win10 et Win11 avec installateurs signés et preuves. | Le code et la CI ciblent Windows; la fresh install actuelle n'est pas documentée. |
| macOS Intel | Build x86_64, DMG signé/notarisé, scan `.app`, hotkey, update et uninstall. | Partial | Test sur Mac Intel réel ou runner matériel, vérification `spctl`, parcours complet. | Le workflow cible `x86_64-apple-darwin`; notarisation non prouvée. |
| macOS Apple Silicon | Build arm64, DMG signé/notarisé et mêmes scénarios fonctionnels. | Partial | Test sur Apple Silicon réel, vérification `spctl`, update depuis release précédente. | Le workflow cible `aarch64-apple-darwin`; validation utilisateur manquante. |
| Linux | Artefacts deb/rpm/AppImage, installation et fonctions principales sur distributions supportées. | Partial | Matrice distro + format, dépendances, desktop entry, hotkey, uninstall. | Le workflow Linux existe; la portée distro doit être précisée. |
| Fast | Mesures froid/chaud, p50/p95, appareils et datasets reproductibles. | Needs verification | Compléter `PERFORMANCE_BASELINE.md` avec résultats versionnés. | Ne pas utiliser « instant », `<100 ms` ou `<1 s` avant mesure. |
| Lightweight | Taille des installateurs, taille installée, RAM/CPU idle et comparaison méthodologiquement équitable. | Needs verification | Mesurer chaque artefact et trois classes de matériel. | Tauri n'est pas une preuve de taille ou de RAM à lui seul. |
| Private | Inventaire réseau, absence de télémétrie par défaut, données locales, rétention, opt-in et politique publiée. | Partial | Audit trafic sur fresh install; privacy copy; décision sur chiffrement local et clipboard par défaut. | « Private » ne peut pas signifier « zéro réseau » : updater, registry, auth, sync et IA existent. |
| Open-source | Licence, code source et historique publics. | Verified | Conserver `LICENSE` Apache-2.0 et liens repository. | Claim étroit recommandé : « open-source under Apache-2.0 ». |
| Native | Backend/packaging OS natifs, intégrations système et définition publique non ambiguë. | Partial | Définir « native desktop app built with Tauri/system WebView », puis QA OS. | Éviter de laisser entendre que toute l'UI est écrite avec des widgets natifs. |
| No Electron | Absence d'Electron dans runtime/build et artefacts. | Verified | Contrôle dépendances/release à chaque version. | `electron-to-chromium` est une dépendance de données transitive, pas le runtime Electron. |
| Extensible | API, loader, manifests, installation, exemples et extension réelle fonctionnelle. | Verified | Maintenir un test d'installation d'une extension de référence. | Claim factuel acceptable; ne pas promettre un grand écosystème. |
| Sandboxed extensions | Isolation effective, permissions, tests d'évasion, limites et absence d'exécution inline. | Partial | Audit sécurité indépendant, extension hostile de test, modèle de menace publié. | Le code refuse le mode inline et utilise des Workers, mais un Worker n'est pas un sandbox processus/OS. |
| App search | Découverte, matching et lancement sur chaque OS annoncé. | Partial | Corpus d'apps réelles et test end-to-end par OS. | Implémentation et tests existent; parité réelle non prouvée. |
| File search | Indexation, recherche, watcher, permissions et performance sur volumes représentatifs. | Partial | Tests 1k/10k/50k, fichiers cachés, suppressions, renommages et reprise. | nucleo est le défaut; Tantivy est optionnel selon feature de build. |
| Clipboard | Capture, recherche, pin, paste, rétention et exclusions sur chaque OS. | Partial | QA par OS, test gestionnaires de mots de passe, divulgation du stockage local. | Monitoring activé par défaut; filtre sensible heuristique; DB non chiffrée par défaut. |
| Snippets | CRUD, variables, expansion et import/export sur chaque OS. | Partial | Parcours end-to-end, cas Unicode, curseur, clipboard et applications cibles. | Présent dans le code; stabilité utilisateur à confirmer. |
| Shell | Exécution, streaming, annulation, timeout et historique sur shells supportés. | Partial | Matrice PowerShell/cmd/bash/zsh, avertissements et tests de sécurité. | Ne jamais présenter la blocklist comme garantie de sécurité. |
| Auto-update | Manifest signé, téléchargement, vérification, installation, relance et récupération. | Partial | Upgrade réel entre deux releases sur chaque OS, test corruption/signature invalide. | Configuration et UI présentes; preuve end-to-end manquante. |
| Game launcher | Détection et lancement des plateformes annoncées selon OS. | Partial | Matrice launcher × OS avec versions et cas non installés. | « 10 plateformes » ne doit être publié qu'avec le détail des combinaisons validées. |
| System monitor | Mesures correctes, permissions et actions disponibles par OS. | Partial | Comparaison avec outils OS, test températures/process kill et absence de privilèges. | Certaines métriques dépendent du matériel et de l'OS. |

## Formulations recommandées aujourd'hui

- Utilisable : **« Open-source under Apache-2.0. Built with Rust and Tauri, without Electron. »**
- Avec réserve : **« Designed for Windows, macOS and Linux; platform validation is in progress during Developer Preview. »**
- À éviter pour l'instant : **« instant », « ~15 MB », « private by default » sans explication, « identical UX on every OS », « fully sandboxed », « production-ready ».**
