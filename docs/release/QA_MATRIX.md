# Matrice QA multiplateforme

_Plan initial : 2026-06-13. Aucun résultat n'est présumé. Chaque cellule doit être complétée sur un artefact de release identifié._

## Légende

| Code | Signification |
|---|---|
| NT | Non testé |
| PASS | Conforme, preuve attachée |
| FAIL | Échec reproductible, issue liée |
| LIM | Limitation connue et documentée |
| NA | Non applicable, justification obligatoire |

## Environnements minimaux

| ID | Environnement | Artefact attendu | Notes |
|---|---|---|---|
| W10 | Windows 10 x64 à jour | NSIS et/ou MSI | Machine/VM propre, WebView2 absent puis présent si possible. |
| W11 | Windows 11 x64 à jour | NSIS et MSI | Vérifier SmartScreen, autostart et applications Store. |
| MI | macOS Intel supporté | DMG x86_64 | Matériel réel préféré; vérifier Gatekeeper. |
| MA | macOS Apple Silicon supporté | DMG arm64 | Matériel réel; vérifier Rosetta non requise. |
| LD | Linux deb, X11 | `.deb` | Ubuntu/Debian supporté, session X11. |
| LR | Linux rpm, X11 | `.rpm` | Fedora/openSUSE cible à préciser. |
| LA | Linux AppImage, X11 | `.AppImage` | Test avec et sans intégration desktop. |
| LW | Linux Wayland | format choisi | Marquer `LIM` si non supporté officiellement. |

## Matrice principale

| Scénario | W10 | W11 | MI | MA | LD | LR | LA | LW |
|---|---|---|---|---|---|---|---|---|
| Télécharger et vérifier nom/version/checksum | NT | NT | NT | NT | NT | NT | NT | NT |
| Installation sans étapes non documentées | NT | NT | NT | NT | NT | NT | NT | NT |
| Signature système / provenance visible | NT | NT | NT | NT | NA | NA | NA | NA |
| Premier lancement sans crash ni écran vide | NT | NT | NT | NT | NT | NT | NT | NT |
| Onboarding complet, skip et relance | NT | NT | NT | NT | NT | NT | NT | NT |
| Hotkey globale par défaut | NT | NT | NT | NT | NT | NT | NT | NT |
| Changement de hotkey et conflit | NT | NT | NT | NT | NT | NT | NT | NT |
| Recherche et lancement d'app native | NT | NT | NT | NT | NT | NT | NT | NT |
| Recherche avec accents, Unicode et casse | NT | NT | NT | NT | NT | NT | NT | NT |
| Indexation initiale d'un dossier utilisateur | NT | NT | NT | NT | NT | NT | NT | NT |
| Recherche fichier puis ouverture | NT | NT | NT | NT | NT | NT | NT | NT |
| Watcher create/rename/delete | NT | NT | NT | NT | NT | NT | NT | NT |
| Rebuild index sans perte du dernier index cohérent | NT | NT | NT | NT | NT | NT | NT | NT |
| Clipboard capture, recherche, pin et paste | NT | NT | NT | NT | NT | NT | NT | NT |
| Clipboard pause, clear, rétention et exclusion app | NT | NT | NT | NT | NT | NT | NT | NT |
| Snippet simple et variables | NT | NT | NT | NT | NT | NT | NT | NT |
| Shell run, stream, cancel et timeout | NT | NT | NT | NT | NT | NT | NT | NT |
| Extension install, permission, run, update, uninstall | NT | NT | NT | NT | NT | NT | NT | NT |
| Settings persistants après redémarrage | NT | NT | NT | NT | NT | NT | NT | NT |
| Thème auto et changement système | NT | NT | NT | NT | NT | NT | NT | NT |
| Autostart opt-in puis désactivation | NT | NT | NT | NT | NT | NT | NT | NT |
| Check/download/install update | NT | NT | NT | NT | NT | NT | NT | NT |
| Export logs/diagnostics sans secrets | NT | NT | NT | NT | NT | NT | NT | NT |
| Désinstallation puis réinstallation | NT | NT | NT | NT | NT | NT | NT | NT |
| Données utilisateur conservées/supprimées comme documenté | NT | NT | NT | NT | NT | NT | NT | NT |

## Jeux de données fichier

Exécuter les scénarios suivants au minimum :

- 1 000, 10 000 et 50 000 entrées;
- noms ASCII, accents, CJK, emoji, espaces, points et chemins longs;
- fichiers sans extension, cachés, liens symboliques/raccourcis et permissions refusées;
- création, renommage, déplacement et suppression pendant un scan;
- dossier local, support amovible et chemin réseau lorsque l'OS le permet;
- extensions incluses/exclues et faux positifs d'exclusion par sous-chaîne.

## Détail par domaine

### Installation et premier lancement

- [ ] L'artefact correspond au tag, au commit et à la version affichée.
- [ ] Aucun terminal, prérequis manuel ou droit administrateur inattendu.
- [ ] Les avertissements SmartScreen/Gatekeeper correspondent à la politique annoncée.
- [ ] La fenêtre principale apparaît sur le bon écran et accepte le focus.
- [ ] Un crash avant onboarding laisse un diagnostic exploitable.

### Recherche, lancement et hotkey

- [ ] Apps classiques, Store/UWP, `.app` et `.desktop` selon plateforme.
- [ ] App absente, chemin cassé et permission refusée produisent une erreur compréhensible.
- [ ] Le debounce ne lance pas un ancien résultat après frappe rapide.
- [ ] Les touches fléchées, Enter, Escape, Tab, context menu et raccourcis fonctionnent.
- [ ] La hotkey en conflit ne rend pas l'application inaccessible.

### Clipboard, snippets et shell

- [ ] Le consentement et l'état du monitoring clipboard sont visibles.
- [ ] Les contenus sensibles de test ne sont pas enregistrés selon la politique documentée.
- [ ] Le paste ne cible pas une fenêtre différente de celle attendue.
- [ ] Les snippets gèrent Unicode, presse-papiers vide et import invalide.
- [ ] Le shell affiche clairement le répertoire, le shell choisi et les risques.
- [ ] Annulation/timeout tue le processus enfant sans laisser de processus orphelin.

### Extensions

- [ ] Manifest invalide, permission inconnue et archive trop grande sont rejetés.
- [ ] Clipboard/network/notifications/system sont refusés sans permission.
- [ ] URL privée, redirect privé et headers sensibles sont bloqués.
- [ ] Crash/timeout Worker n'endommage pas le launcher.
- [ ] Tamper detection révoque les permissions et affiche l'alerte.

### Update et uninstall

- [ ] Pas de downgrade involontaire.
- [ ] Signature invalide ou manifest corrompu refusé.
- [ ] Reprise propre après interruption du téléchargement.
- [ ] Paramètres et index restent cohérents après update.
- [ ] Désinstallation traite fichiers locaux et keyring selon la documentation.

### Diagnostics et sécurité

- [ ] Logs sans tokens, clipboard complet, commandes secrètes ni query params sensibles.
- [ ] Export diagnostics prévisualisable avant partage.
- [ ] Les commandes sensibles sont refusées depuis une fenêtre sans capability.
- [ ] Les chemins UNC, exécutables interdits et imports surdimensionnés sont rejetés.
- [ ] Aucun appel réseau inattendu pendant une session offline standard.

## Preuves à enregistrer

Pour chaque run :

| Champ | Valeur |
|---|---|
| Version/tag/commit | |
| Date et testeur | |
| OS exact et architecture | |
| Matériel/VM | |
| Artefact + hash | |
| Résultat par scénario | |
| Issues créées | |
| Logs/captures | |
| Décision de sortie | |

## Règle de sortie

- Developer Preview : aucun P0, parcours critique `PASS` sur au moins W11, MA et une cible Linux; autres cibles explicitement `LIM` si nécessaire.
- Public v1 : aucun `NT` sur une plateforme annoncée, aucun P0/P1 ouvert, signatures vérifiées et update/uninstall `PASS`.
