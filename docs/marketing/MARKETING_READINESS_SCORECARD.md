# Scorecard de préparation marketing

_Évaluation provisoire du workspace au 2026-06-13._

## Barème

- **0** : absent, cassé ou sans preuve exploitable.
- **1** : partiel, beta ou limitation documentée.
- **2** : prêt pour une communication publique, avec preuve reproductible.

| # | Domaine | Score | Justification / preuve manquante |
|---:|---|---:|---|
| 1 | Positionnement et message principal | 2 | Message clair, généraliste et différencié fourni pour la préparation du lancement. |
| 2 | Recherche et lancement d'apps | 1 | Implémentés et testés au niveau code; validation end-to-end par OS manquante. |
| 3 | Recherche et indexation de fichiers | 1 | Architecture robuste et tests présents; volumes et plateformes non baselinés. |
| 4 | Clipboard, snippets et shell | 1 | Fonctions présentes; risques de données sensibles et QA OS à fermer. |
| 5 | Game launcher et system monitor | 1 | Implémentations réelles; couverture matérielle/launcher non démontrée. |
| 6 | Hotkey et navigation clavier | 1 | Flux central implémenté; conflits, layouts et Wayland non validés. |
| 7 | Onboarding et settings | 1 | Parcours existants; fresh-install et accessibilité manuelle incomplètes. |
| 8 | Extensions et extensibilité | 1 | Loader, permissions et Worker présents; audit hostile et compatibilité réelle manquants. |
| 9 | Readiness Windows | 1 | CI et bundles présents; signature et fresh install non prouvées. |
| 10 | Readiness macOS Intel/ARM | 0 | Builds ciblés, mais signature, notarisation et tests matériels non démontrés. |
| 11 | Readiness Linux | 1 | Bundles prévus; matrice distro/format et Wayland incomplète. |
| 12 | Update, rollback et uninstall | 1 | Updater implémenté; parcours réel et conservation des données non validés. |
| 13 | Signature et chaîne de release | 0 | Configuration conditionnelle; aucune RC vérifiée signée/notarisée dans cette revue. |
| 14 | Tests automatisés et CI | 2 | CI trois OS, Vitest, Rust, Clippy, Tantivy et SQLCipher documentés. |
| 15 | Bug triage et stabilité | 1 | Audits et risques suivis, mais pas de bug bash de release consolidé. |
| 16 | Preuves de performance | 0 | Aucune baseline publiable pour startup, latence, RAM ou taille. |
| 17 | Sécurité produit | 1 | Nombreux contrôles et audits; audit indépendant et validation d'artefact manquants. |
| 18 | Confidentialité et télémétrie | 1 | Pas de SDK analytics identifié; defaults sensibles et politique utilisateur à clarifier. |
| 19 | Documentation utilisateur/release | 1 | Documentation riche, mais versions et affirmations divergent. |
| 20 | Preuves marketing et assets | 1 | Registre de claims créé; captures OS, démo et résultats vérifiés restent à produire. |
|  | **Total actuel** | **19 / 40** | **Pas de marketing public.** |

## Interprétation

| Score | Décision |
|---:|---|
| 0–20 | Pas de marketing public |
| 21–30 | Developer Preview uniquement |
| 31–36 | Soft launch |
| 37–40 | Lancement public possible |

## Règles d'utilisation

- Un score de 2 exige une preuve attachée à une release candidate, pas uniquement une implémentation.
- Tout P0 ouvert force un **No-Go**, quel que soit le total.
- Les domaines 9 à 13, 16 à 18 ne peuvent pas être compensés par des features supplémentaires.
- Le score doit être recalculé après chaque RC et référencer les rapports QA/benchmarks correspondants.

## Seuil suivant

Pour atteindre **Developer Preview (21+)**, le chemin minimal est :

- compléter un smoke test Windows, macOS et Linux;
- publier la copie confidentialité et les limitations;
- produire au moins une baseline de performance interne;
- fermer ou accepter explicitement les blockers Developer Preview.

Ce seuil autorise une preview contrôlée, pas Product Hunt ni une annonce v1 stable.
