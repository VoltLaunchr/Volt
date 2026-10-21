# Plan de baseline performance

_Plan uniquement. Aucun chiffre de performance n'est affirmé dans ce document._

## Objectif

Produire des mesures reproductibles permettant de détecter les régressions et de décider si les mots « fast », « lightweight » ou « instant » sont défendables publiquement.

## Principes

- Mesurer une release optimisée installée, jamais uniquement Vite dev ou `cargo test`.
- Conserver commit, features Cargo, artefact, OS, matériel, état thermique et dataset.
- Séparer cold start, warm start et ouverture via hotkey.
- Publier p50, p95, minimum/maximum et nombre d'itérations; ne pas publier uniquement le meilleur run.
- Répéter sur au moins trois classes de matériel : entrée de gamme, milieu de gamme, machine récente.
- Désactiver les tâches non déterministes seulement si la condition est documentée et représentative.

## Environnements

| Champ | À enregistrer |
|---|---|
| Version/tag/commit | |
| Build profile et Cargo features | Défaut, `tantivy-search`, `sqlcipher` selon artefact réel. |
| OS/version/architecture | |
| CPU/RAM/stockage | Modèle, capacité, SSD/HDD, chiffrement disque. |
| État machine | Sur batterie/secteur, antivirus, autres apps, température. |
| Dataset | Nombre de fichiers, profondeur, types, taille totale. |
| Outils | ETW/PerfView, Instruments, `hyperfine`, `/usr/bin/time`, Task Manager, Activity Monitor, `pidstat`, etc. |

## Datasets fichiers

Créer des datasets déterministes de 1 000, 10 000 et 50 000 entrées :

- mélange de noms courts/longs, ASCII/Unicode, extensions supportées et fichiers sans extension;
- arborescences de profondeurs variées, sans dépasser les limites configurées;
- distribution fixe des tailles et dates;
- manifest avec seed et hash afin de reproduire exactement le corpus;
- aucun contenu personnel ou confidentiel.

Les datasets doivent mesurer séparément le moteur par défaut et tout moteur optionnel réellement distribué.

## Mesures

### Cold start

**Définition :** temps entre lancement du processus et champ de recherche visible, focalisé et prêt à accepter une frappe, après reboot ou purge documentée des caches OS.

Procédure :

1. Installer la RC et terminer l'onboarding avant la série, sauf test first-run dédié.
2. Fermer Volt et vérifier l'absence de processus résiduel.
3. Purger/rebooter selon protocole OS.
4. Enregistrer timestamp process start, événement `main-ready` et premier input accepté.
5. Répéter au moins 20 fois par environnement.

### Warm hotkey open

**Définition :** temps entre l'événement hotkey OS et la fenêtre visible, focalisée et interactive lorsque Volt tourne en arrière-plan.

- 50 ouvertures espacées;
- mesurer p50/p95 et ouvertures ratées;
- inclure multi-écran, fenêtre plein écran et app cible différente;
- distinguer show/hide d'un démarrage de processus.

### App search latency

**Définition :** temps entre la stabilisation de la requête après debounce et l'affichage du premier jeu de résultats correct.

- corpus d'au moins 100/500/1 000 apps ou entrées simulées représentatives;
- requêtes exactes, préfixes, contains, fautes et Unicode;
- requêtes chaudes et après rescan;
- relever temps frontend, IPC, backend et rendu séparément si instrumentation disponible.

### File search latency

Exécuter pour 1k, 10k et 50k fichiers :

- exact, préfixe, fuzzy, extension, dossier, taille et date;
- résultat présent en tête, milieu, fin et absent;
- index chaud puis après redémarrage;
- p50/p95 sur au moins 100 requêtes prédéfinies;
- vérifier simultanément la pertinence, pas uniquement la vitesse.

### Indexing time

Mesurer :

- scan initial vide;
- rebuild avec ancien index cohérent;
- reprise après erreur/permission refusée;
- temps jusqu'au premier résultat utilisable et temps jusqu'à fin complète;
- débit fichiers/s, CPU/RAM pic, I/O et taille DB;
- coût du watcher pour lots create/rename/delete.

### Idle CPU et RAM

Mesurer après 5 et 30 minutes :

- Volt caché, clipboard monitoring actif/inactif;
- watcher actif sur dataset 50k;
- system monitor ouvert/fermé;
- aucune recherche ou update en cours;
- working set/RSS, private bytes si disponible, CPU moyen et pics, wakeups/energy impact.

### Installer et taille installée

Pour chaque OS/format :

- octets exacts de l'artefact compressé;
- taille installée sur disque;
- taille des données après premier lancement et après index 50k;
- dépendances téléchargées séparément, notamment WebView/runtime/modèle embeddings;
- comparaison uniquement à périmètre fonctionnel et méthode identiques.

### Update time

Mesurer depuis une version publique vers la RC :

- check manifest;
- téléchargement;
- vérification signature;
- installation;
- relance jusqu'à interface interactive;
- taille du téléchargement et comportement après interruption.

## Format de résultats

| Mesure | Environnement | N | p50 | p95 | Max | Notes/artefact |
|---|---|---:|---:|---:|---:|---|
| Cold start | | | | | | |
| Warm hotkey | | | | | | |
| App search | | | | | | |
| File search 1k | | | | | | |
| File search 10k | | | | | | |
| File search 50k | | | | | | |
| Indexing 50k | | | | | | |
| Idle RAM/CPU | | | | | | |
| Update | | | | | | |

Les données brutes, scripts et instructions doivent être versionnés ou attachés à la release.

## Règles pour claims publics

- Aucun claim chiffré sans au moins deux OS et trois classes de matériel.
- Utiliser « measured on … » et préciser dataset/build.
- « Starts instantly » est interdit tant qu'un seuil produit explicite et un p95 ne sont pas approuvés.
- « Lightweight » doit citer taille installateur **et** RAM idle, pas uniquement la technologie Tauri.
- `~15 MB`, `<1 s`, `<100 ms` et comparaisons en pourcentage restent interdits avant résultats reproductibles.
- Une régression de plus de 10 % sur p95 déclenche investigation avant release; le seuil peut être ajusté après première baseline.
- Refaire la baseline pour toute modification de framework, updater, indexeur, SQLCipher, Tantivy ou packaging.
