# Plan de bug bash pré-lancement

_Plan initial : 2026-06-13._

## Objectifs

- Trouver les échecs que les tests unitaires et la CI ne voient pas : intégration OS, focus, permissions, installateurs, update et données locales.
- Vérifier le message « Everything on your computer. One shortcut. » sur des usages non développeurs.
- Produire un backlog trié, reproductible et lié à une release candidate.
- Décider Go/No-Go sur des règles écrites, pas sur une impression générale.

## Préparation

- Geler une RC avec tag, commit et checksums.
- Créer les environnements de [QA_MATRIX.md](./QA_MATRIX.md).
- Préparer comptes non administrateur, machines propres et jeux de données 1k/10k/50k.
- Préparer une extension de référence et une extension hostile de test.
- Ouvrir un board avec colonnes `New`, `Triaged`, `Fixing`, `Ready for retest`, `Verified`, `Accepted`.
- Désigner un lead de triage et un propriétaire par plateforme.

## Sessions plateforme

| Session | Durée | Portée | Sortie attendue |
|---|---:|---|---|
| Windows 10 | 90 min | MSI/NSIS, SmartScreen, WebView2, hotkey, Store apps, clipboard. | Matrice et issues Windows. |
| Windows 11 | 90 min | Même portée + autostart, updater, multi-écran. | Validation plateforme principale. |
| macOS Intel | 90 min | DMG, Gatekeeper, `.app`, hotkey, permissions, update. | Matrice Intel. |
| macOS Apple Silicon | 90 min | Arm64 natif, notarisation, énergie, permissions. | Matrice Apple Silicon. |
| Linux X11 | 120 min | deb/rpm/AppImage, `.desktop`, hotkey, clipboard, dépendances. | Portée distro/format. |
| Linux Wayland | 60 min | Focus, hotkey, clipboard et limites connues. | Décision support ou limitation. |

## Sessions feature

### Flux principal

1. Installer et lancer Volt.
2. Terminer ou ignorer l'onboarding.
3. Ouvrir une app, trouver un fichier, rechercher le clipboard, exécuter un snippet.
4. Modifier la hotkey et les dossiers indexés.
5. Redémarrer et vérifier la persistance.

### Recherche et indexation

- Frappe rapide, suppression, Unicode, requête vide et résultats obsolètes.
- Scan interrompu, dossier inaccessible, fichier supprimé et rebuild.
- 1k/10k/50k fichiers; recherche pendant indexation; watcher après renommage.

### Clipboard, snippets et shell

- Texte, image, fichiers, contenus sensibles de test et applications exclues.
- Paste après changement de fenêtre active.
- Variables snippet, import/export invalide et contenu volumineux.
- Shell succès/erreur/timeout/cancel, secrets dans commande et process enfant.

### Extensions

- Installation, permissions accordées/refusées, update et uninstall.
- Worker timeout/crash, manifest invalide, réseau privé, redirect et archive corrompue.
- Altération de `installed.json` et vérification du fail-closed.

## Session sécurité

- Vérifier les capabilities par fenêtre et les commandes sensibles.
- Inspecter le trafic réseau d'une session standard offline.
- Injecter chemins longs, traversal, UNC, symlinks et fichiers surdimensionnés.
- Tester redaction logs avec tokens GitHub/AWS/Stripe/Slack/JWT et credentials URL.
- Tester signature updater invalide et archive extension redirigée vers IP privée.
- Vérifier keyring, logout, révocation permissions et suppression de données.

Les vulnérabilités ne doivent pas être déposées dans une issue publique; suivre `SECURITY.md`.

## Session onboarding

- Profil non technique, sans connaissance de Tauri ou extensions.
- Compréhension de la hotkey, de l'indexation et du clipboard.
- Permissions refusées, retour arrière, skip et relance.
- Écrans petits, scaling 125/150/200 %, plusieurs moniteurs et thème système.
- Mesurer les points d'hésitation; ne pas enregistrer de données personnelles sans consentement.

## Session performance

- Utiliser le protocole de [PERFORMANCE_BASELINE.md](../benchmarks/PERFORMANCE_BASELINE.md).
- Relever startup froid/chaud, hotkey, search, indexation, CPU/RAM idle et update.
- Noter les freezes visibles, frappes perdues et régressions après 30 minutes.
- Séparer mesure instrumentée et perception utilisateur.

## Session accessibilité

- Clavier seul : Tab, Shift+Tab, flèches, Enter, Escape, menus et modales.
- NVDA sous Windows, VoiceOver sous macOS, Orca sous Linux si plateforme annoncée.
- Zoom/scaling, contraste clair/sombre, focus visible et réduction des animations.
- Axe automatisé puis validation manuelle des annonces de résultats.
- Réconcilier les résultats avec `docs/ACCESSIBILITY_AUDIT.md`.

## Template de bug

```markdown
## Résumé

## Build
- Version/tag :
- Commit :
- Artefact + hash :

## Environnement
- OS/version/architecture :
- Matériel ou VM :
- Session X11/Wayland :

## Préconditions

## Étapes de reproduction
1.
2.
3.

## Résultat observé

## Résultat attendu

## Fréquence
- [ ] Toujours
- [ ] Souvent
- [ ] Intermittent
- [ ] Une fois

## Impact utilisateur

## Logs/captures

## Données sensibles retirées
- [ ] Oui

## Sévérité proposée
P0 / P1 / P2 / P3
```

## Sévérités

| Niveau | Définition | Exemples |
|---|---|---|
| P0 | Sécurité critique, perte/corruption de données, install impossible, flux principal inutilisable sans contournement. | Updater accepte une signature invalide; index effacé; app ne démarre pas. |
| P1 | Fonction clé cassée, crash fréquent, fuite sensible ou régression majeure avec contournement faible. | Hotkey inutilisable; clipboard enregistre un secret malgré politique; update boucle. |
| P2 | Fonction secondaire dégradée ou bug visible avec contournement raisonnable. | Icône absente; métrique indisponible; filtre de recherche incohérent. |
| P3 | Cosmétique, wording, alignement ou amélioration non bloquante. | Troncature, espacement, texte imprécis. |

## Règles de launch blocker

- Tout P0 ouvert : **No-Go**.
- Tout P1 sur install, search, launch, hotkey, update, privacy ou sécurité : **No-Go Public v1**.
- Un P1 peut être accepté pour Developer Preview uniquement si la feature est désactivée ou la limitation visible avant usage.
- Trois P2 sur le même flux principal déclenchent une revue de stabilité et peuvent devenir blocker.
- Un bug « non reproductible » reste ouvert tant que logs et instrumentation sont insuffisants.
- Une correction n'est fermée qu'après retest sur l'OS d'origine et contrôle de non-régression.

## Cadence de triage

1. Triage à mi-session pour isoler immédiatement les P0.
2. Triage final le jour même avec sévérité, propriétaire et milestone.
3. Retest quotidien des fixes de RC.
4. Go/No-Go signé par produit, engineering, sécurité et release owner.
