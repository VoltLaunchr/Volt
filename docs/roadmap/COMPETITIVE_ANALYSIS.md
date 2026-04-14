# Volt — Analyse Concurrentielle

> Positionnement de Volt par rapport aux principaux lanceurs d'applications. Derniere mise a jour : avril 2026.

---

## Comparatif des fonctionnalites

| Fonctionnalite | Volt (v0.0.5) | Alfred (macOS) | Raycast (macOS) | PowerToys Run (Windows) | Ulauncher (Linux) |
|----------------|:---:|:---:|:---:|:---:|:---:|
| **Cross-platform** | ✅ Win/Mac/Linux | ❌ macOS only | ❌ macOS only | ❌ Windows only | ❌ Linux only |
| **Open source** | ✅ MIT | ❌ Proprietary | ❌ Proprietary | ✅ MIT | ✅ GPL |
| **Gratuit** | ✅ | ⚠️ Freemium (£34 Powerpack) | ⚠️ Freemium ($8/mo Pro) | ✅ | ✅ |
| **Recherche apps** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Recherche fichiers** | ✅ | ✅ | ✅ | ✅ | ⚠️ Via extension |
| **Recherche fuzzy** | ✅ nucleo-matcher | ✅ | ✅ | ✅ | ✅ |
| **Calculatrice** | ✅ Builtin | ✅ | ✅ | ✅ | ⚠️ Via extension |
| **Clipboard history** | ✅ Builtin | ✅ Powerpack | ✅ | ✅ | ❌ |
| **Snippets/text expansion** | ❌ Roadmap v2.0 | ✅ Powerpack | ✅ | ❌ | ❌ |
| **Emojis** | ✅ Builtin | ❌ | ✅ | ✅ | ❌ |
| **Web search** | ✅ Multi-moteurs | ✅ | ✅ | ✅ | ✅ |
| **System commands** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **System monitor** | ✅ Builtin | ❌ | ❌ | ❌ | ❌ |
| **Game scanner** | ✅ 7 plateformes | ❌ | ❌ | ❌ | ❌ |
| **Timer/pomodoro** | ✅ Builtin | ❌ | ⚠️ Extension | ❌ | ❌ |
| **Shell commands inline** | ❌ Roadmap v2.0 | ✅ Terminal | ✅ | ❌ | ❌ |
| **Preview fichiers** | ❌ Roadmap v2.0 | ✅ Quick Look | ✅ | ❌ | ❌ |
| **Themes** | ✅ Dark/Light/Auto | ✅ Custom | ✅ Custom | ⚠️ Suit le systeme | ✅ Custom |
| **Themes custom** | ❌ Roadmap v2.x | ✅ | ✅ | ❌ | ✅ |
| **Plugins/extensions** | ✅ 9 builtin | ✅ Workflows | ✅ Store riche | ✅ Plugins | ✅ Extensions |
| **Plugin marketplace** | ❌ Roadmap v1.5 | ✅ | ✅ | ✅ | ✅ |
| **Plugin externe (loader)** | ❌ Roadmap v1.5 | ✅ | ✅ | ✅ | ✅ |
| **Hotkey configurable** | ✅ Live rebind | ✅ | ✅ | ✅ | ✅ |
| **Auto-update** | ✅ | ✅ | ✅ | ✅ Via Microsoft Store | ✅ |
| **Frecency scoring** | ❌ Roadmap v2.0 | ✅ | ✅ | ❌ | ❌ |
| **Code signe** | ❌ En attente certs | ✅ | ✅ | ✅ | N/A |
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

Aucun concurrent ne propose de detection et lancement de jeux integre. Volt scanne 7 plateformes (Steam, Epic, GOG, EA, Ubisoft, Riot, Xbox) automatiquement.

### System monitor integre

Metriques CPU/RAM/disque en temps reel directement dans le lanceur, sans ouvrir un outil externe.

### Extensible par design

Architecture plugin avec isolation (timeout 500ms, error boundaries), API documentee, et roadmap vers un marketplace communautaire.

---

## Gaps a combler pour etre competitif

### Priorite haute (v1.0 - v1.5)

| Gap | Impact | Plan |
|-----|--------|------|
| **Code signing** | Avertissements SmartScreen/Gatekeeper rebutent les utilisateurs | Phase 1 — bloque sur achat certs |
| **Plugin loader externe** | Impossible d'installer des plugins communautaires | Phase 3 — M3.2 |
| **Extension marketplace** | Pas d'ecosysteme de plugins | Phase 3 — M3.3 |

### Priorite moyenne (v2.0)

| Gap | Impact | Plan |
|-----|--------|------|
| **Frecency scoring** | Resultats moins pertinents qu'Alfred/Raycast pour les power users | Phase 4 |
| **Snippets/text expansion** | Feature cle d'Alfred Powerpack et Raycast | Phase 4 |
| **Preview fichiers** | Quick Look est tres apprecie sur macOS | Phase 4 |
| **Shell commands** | Power users veulent executer des commandes sans quitter le lanceur | Phase 4 |

### Priorite basse (v2.x)

| Gap | Impact | Plan |
|-----|--------|------|
| **Themes custom** | Personnalisation visuelle attendue par la communaute | Phase 5 |
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

_Document vivant — a mettre a jour lors de chaque release majeure pour refleter l'evolution du positionnement._
