# Volt — Analyse Concurrentielle

> Positionnement de Volt par rapport aux principaux lanceurs d'applications. Derniere mise a jour : avril 2026.

---

## Comparatif des fonctionnalites

| Fonctionnalite | Volt (v0.0.8) | Alfred (macOS) | Raycast (macOS) | PowerToys Run (Windows) | Ulauncher (Linux) |
|----------------|:---:|:---:|:---:|:---:|:---:|
| **Cross-platform** | ✅ Win/Mac/Linux | ❌ macOS only | ❌ macOS only | ❌ Windows only | ❌ Linux only |
| **Open source** | ✅ MIT | ❌ Proprietary | ❌ Proprietary | ✅ MIT | ✅ GPL |
| **Gratuit** | ✅ | ⚠️ Freemium (£34 Powerpack) | ⚠️ Freemium ($8/mo Pro) | ✅ | ✅ |
| **Recherche apps** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Recherche fichiers** | ✅ | ✅ | ✅ | ✅ | ⚠️ Via extension |
| **Recherche fuzzy** | ✅ nucleo-matcher | ✅ | ✅ | ✅ | ✅ |
| **Calculatrice** | ✅ Builtin | ✅ | ✅ | ✅ | ⚠️ Via extension |
| **Clipboard history** | ✅ Builtin | ✅ Powerpack | ✅ | ✅ | ❌ |
| **Snippets/text expansion** | ✅ Builtin | ✅ Powerpack | ✅ | ❌ | ❌ |
| **Emojis** | ✅ Builtin | ❌ | ✅ | ✅ | ❌ |
| **Web search** | ✅ Multi-moteurs | ✅ | ✅ | ✅ | ✅ |
| **System commands** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **System monitor** | ✅ Builtin | ❌ | ❌ | ❌ | ❌ |
| **Game scanner** | ✅ 10 plateformes | ❌ | ❌ | ❌ | ❌ |
| **Timer/pomodoro** | ✅ Focus Timer (Pomodoro complet) | ❌ | ⚠️ Extension | ❌ | ❌ |
| **Shell commands inline** | ✅ Streaming + ANSI + historique | ✅ Terminal | ✅ | ❌ | ❌ |
| **Preview fichiers** | ✅ Texte/image/dossier/shell | ✅ Quick Look | ✅ | ❌ | ❌ |
| **Themes** | ✅ Dark/Light/Auto | ✅ Custom | ✅ Custom | ⚠️ Suit le systeme | ✅ Custom |
| **Themes custom** | ❌ Roadmap v2.x | ✅ | ✅ | ❌ | ✅ |
| **Quicklinks** | ✅ URL/dossier/commande + validation | ✅ | ✅ | ❌ | ✅ |
| **Window management** | ✅ Snap windows (6 zones) | ❌ | ✅ | ✅ FancyZones | ❌ |
| **Plugins/extensions** | ✅ 13 builtin | ✅ Workflows | ✅ Store riche | ✅ Plugins | ✅ Extensions |
| **Plugin marketplace** | ✅ Extension Store | ✅ | ✅ | ✅ | ✅ |
| **Plugin externe (loader)** | ✅ Worker sandbox | ✅ | ✅ | ✅ | ✅ |
| **Hotkey configurable** | ✅ Live rebind | ✅ | ✅ | ✅ | ✅ |
| **Auto-update** | ✅ | ✅ | ✅ | ✅ Via Microsoft Store | ✅ |
| **Frecency scoring** | ✅ Apps + Shell | ✅ | ✅ | ❌ | ❌ |
| **Code signe** | ❌ En attente certs | ✅ | ✅ | ✅ | N/A |
| **Extension sandboxing** | ✅ HMAC + Worker isolé + SSRF block | N/A | ⚠️ | N/A | ⚠️ |
| **Deep links** | ✅ volt:// protocol | ✅ | ✅ | ❌ | ❌ |
| **Accessibilite (WCAG)** | ⚠️ Partiel | ⚠️ | ⚠️ | ✅ | ⚠️ |

**Legende :** ✅ Disponible — ⚠️ Partiel/conditionnel — ❌ Absent

---

## Avantages differenciants de Volt

### Cross-platform natif

Volt est le **seul lanceur dans cette categorie a fonctionner sur Windows, macOS ET Linux** a partir d'une seule codebase. Alfred et Raycast sont bloques sur macOS, PowerToys Run sur Windows, Ulauncher sur Linux. Un utilisateur qui change d'OS n'a pas a reapprendre un nouvel outil.

### Open source + gratuit

Contrairement a Alfred (Powerpack a £34) et Raycast (Pro a $8/mois), Volt est entierement gratuit et open source sous licence MIT. Aucune fonctionnalite n'est verrouilllee derriere un paywall.

### Performance Rust

Le backend Tauri v2 + Rust offre des performances natives : demarrage rapide, faible consommation memoire (~50-100 MB), et recherche fuzzy via `nucleo-matcher` (la meme librairie que le fuzzy finder `nushell`).

### Game scanner unique

Aucun concurrent ne propose de detection et lancement de jeux integre. Volt scanne **10 plateformes** (Steam, Epic, GOG, EA, Ubisoft, Riot, Xbox, Amazon Games, Battle.net, Rockstar) automatiquement avec scan parallele et deduplication.

### System monitor integre (v2)

Metriques CPU/RAM/disque en temps reel directement dans le lanceur, sans ouvrir un outil externe. La v2 ajoute : usage par coeur, details par disque (SSD/HDD), reseau par interface, top 5 processus CPU/RAM, temperatures, sparklines 60s, et export CSV.

### Extensible par design avec securite avancee

Architecture plugin avec isolation (timeout 500ms, error boundaries), API documentee, et marketplace communautaire avec extension store integre. Securite renforcee : signatures HMAC-SHA256 sur l'etat des extensions, sandbox Worker avec blocage eval/WebSocket/SSRF, validation des manifests, et detection de tampering avec alertes UI.

### Shell commands integre

Volt propose l'execution de commandes shell directement dans le lanceur avec streaming temps reel de la sortie, historique avec frecency, rendu des couleurs ANSI, et annulation via Ctrl+C. Aucun concurrent ne propose le streaming ligne-par-ligne ni le rendu ANSI natif.

---

## Gaps a combler pour etre competitif

### Resolus ✅

| Gap | Statut | Detail |
|-----|--------|--------|
| **Plugin loader externe** | ✅ v0.0.6 | Worker sandbox + Sucrase transpilation |
| **Extension marketplace** | ✅ v0.0.6 | Extension Store dans Settings |
| **Frecency scoring** | ✅ v0.0.7 | Apps + Shell commands avec frecency |
| **Snippets/text expansion** | ✅ v0.0.7 | Prefixe `;`, variables dynamiques, import/export |
| **Preview fichiers** | ✅ v0.0.7 | Texte, images, dossiers, output shell |
| **Shell commands** | ✅ v0.0.8 | Streaming, ANSI colors, historique, `!!`, Ctrl+C, blocklist securite |
| **Extension security** | ✅ v0.0.8 | HMAC state signatures, sandbox hardening, SSRF prevention, tamper alerts |
| **System Monitor v2** | ✅ v0.0.8 | Per-core CPU, reseau, top processes, temperatures, sparklines, CSV export |
| **10 game platforms** | ✅ v0.0.8 | +Amazon Games, Battle.net, Rockstar (scan parallele, deduplication) |
| **Focus Timer (Pomodoro)** | ✅ v0.0.8 | Modes focus/break, auto-cycle, gestion taches, notifications |
| **Deep links** | ✅ v0.0.8 | volt:// protocol pour OAuth callback, single-instance |
| **CI automation** | ✅ v0.0.8 | Auto-tag, PR title lint, changelog generation, commitlint |

### Restants

| Gap | Impact | Plan |
|-----|--------|------|
| **Code signing** | Avertissements SmartScreen/Gatekeeper | Bloque sur achat certs (~340 €/an) |
| **Themes custom** | Personnalisation visuelle attendue | Phase 5 |
| **Wayland Linux** | Support Linux moderne incomplet | Phase 5 |
| **Sync cloud** | Pas de synchro cross-device | Phase 5 |

---

## Positionnement strategique

```
                    Cross-platform
                         ▲
                         │
                    Volt ●
                         │
         ┌───────────────┼───────────────┐
         │               │               │
  Open source ◄──────────┼──────────────► Proprietary
         │               │               │
    Ulauncher ●          │          ● Raycast
         │               │          ● Alfred
         │               │               │
         └───────────────┼───────────────┘
                         │
                  PowerToys Run ●
                         │
                         ▼
                   Single-platform
```

**Creneau de Volt :** le lanceur cross-platform, open source, performant (Rust), avec un ecosysteme de plugins en construction. Volt vise les utilisateurs qui :

1. **Travaillent sur plusieurs OS** et veulent un outil unifie
2. **Preferent l'open source** et ne veulent pas payer d'abonnement
3. **Sont gamers** et veulent un lanceur qui connait leurs jeux
4. **Veulent contribuer** a un projet actif et extensible

---

## Sources

- Alfred : https://www.alfredapp.com
- Raycast : https://www.raycast.com
- PowerToys Run : https://learn.microsoft.com/en-us/windows/powertoys/run
- Ulauncher : https://ulauncher.io

---

_Document vivant — a mettre a jour lors de chaque release majeure. **Derniere revision : 2026-04-18.**_
