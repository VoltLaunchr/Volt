# Volt — Analyse concurrentielle

> Positionnement de Volt par rapport aux principaux lanceurs d'applications. Derniere mise a jour : 2026-06-13.
>
> Ce document est un outil de positionnement, pas une source de claims marketing. Pour le lancement public, utiliser d'abord le registre de preuves : [`../marketing/CLAIMS_EVIDENCE.md`](../marketing/CLAIMS_EVIDENCE.md).

---

## Comparatif des fonctionnalites

| Fonctionnalite | Volt (v0.2.0, workspace) | Alfred (macOS) | Raycast (macOS + Windows beta) | PowerToys Run (Windows) | Ulauncher (Linux) |
|----------------|:---:|:---:|:---:|:---:|:---:|
| **Cross-platform** | ⚠️ Win/Mac/Linux visés, QA release à compléter | ❌ macOS only | ⚠️ macOS + Windows beta | ❌ Windows only | ❌ Linux only |
| **Open source** | ✅ Apache-2.0 | ❌ Proprietary | ❌ Proprietary | ✅ MIT | ✅ GPLv3 |
| **Gratuit** | ✅ | ⚠️ Freemium (£34 Powerpack) | ⚠️ Freemium ($8/mo Pro) | ✅ | ✅ |
| **Recherche apps** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Recherche fichiers** | ⚠️ Implémentée, baseline à mesurer | ✅ | ✅ | ✅ | ⚠️ Via extension |
| **Recherche fuzzy** | ✅ nucleo-matcher | ✅ | ✅ | ✅ | ✅ |
| **Calculatrice** | ✅ Builtin | ✅ | ✅ | ✅ | ⚠️ Via extension |
| **Clipboard history** | ✅ Builtin, privacy copy à finaliser | ✅ Powerpack | ✅ | ✅ | ❌ |
| **Snippets/text expansion** | ✅ Builtin | ✅ Powerpack | ✅ | ❌ | ❌ |
| **Emojis** | ✅ Builtin | ❌ | ✅ | ✅ | ❌ |
| **Web search** | ✅ Multi-moteurs | ✅ | ✅ | ✅ | ✅ |
| **System commands** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **System monitor** | ✅ Builtin | ❌ | ❌ | ❌ | ❌ |
| **Game scanner** | ⚠️ Scanners multi-plateformes, QA à compléter | ❌ | ❌ | ❌ | ❌ |
| **Timer/pomodoro** | ✅ Focus Timer (Pomodoro complet) | ❌ | ⚠️ Extension | ❌ | ❌ |
| **Shell commands inline** | ✅ Streaming + ANSI + historique | ✅ Terminal | ✅ | ❌ | ❌ |
| **Preview fichiers** | ✅ Texte/image/dossier/shell | ✅ Quick Look | ✅ | ❌ | ❌ |
| **Themes** | ✅ Dark/Light/Auto | ✅ Custom | ✅ Custom | ⚠️ Suit le systeme | ✅ Custom |
| **Themes custom** | ❌ Roadmap v2.x | ✅ | ✅ | ❌ | ✅ |
| **Quicklinks** | ✅ URL/dossier/commande + validation | ✅ | ✅ | ❌ | ✅ |
| **Window management** | ✅ Snap windows (6 zones) | ❌ | ✅ | ✅ FancyZones | ❌ |
| **Plugins/extensions** | ✅ Builtins + extensions | ✅ Workflows | ✅ Store riche | ✅ Plugins | ✅ Extensions |
| **Plugin marketplace** | ⚠️ Extension Store, gouvernance à valider | ✅ | ✅ | ✅ | ✅ |
| **Plugin externe (loader)** | ✅ Worker isolation + permissions | ✅ | ✅ | ✅ | ✅ |
| **Hotkey configurable** | ✅ Live rebind | ✅ | ✅ | ✅ | ✅ |
| **Auto-update** | ⚠️ Configuré, update réel à valider | ✅ | ✅ | ✅ Via Microsoft Store | ✅ |
| **Frecency scoring** | ✅ Apps + Shell | ✅ | ✅ | ❌ | ❌ |
| **Code signe** | ❌ En attente certs | ✅ | ✅ | ✅ | N/A |
| **Extension isolation** | ⚠️ HMAC + Worker + SSRF block, audit hostile à faire | N/A | ⚠️ | N/A | ⚠️ |
| **Deep links** | ✅ volt:// protocol | ✅ | ✅ | ❌ | ❌ |
| **Accessibilite (WCAG)** | ⚠️ Partiel | ⚠️ | ⚠️ | ✅ | ⚠️ |

**Legende :** ✅ Disponible — ⚠️ Partiel/conditionnel — ❌ Absent

---

## Avantages differenciants de Volt

### Cross-platform natif

Volt vise une experience coherente sur Windows, macOS et Linux a partir d'une seule codebase Tauri. C'est un axe de differenciation important, mais la promesse publique doit rester conditionnee a la matrice QA release : Windows 10/11, macOS Intel, macOS Apple Silicon, Linux deb/rpm/AppImage et X11/Wayland.

### Open source + gratuit

Contrairement aux produits proprietaires, Volt est open source sous licence Apache-2.0. Les comparaisons de prix doivent rester datees, car les offres concurrentes changent.

### Performance Rust

Le backend Rust/Tauri donne une base technique favorable a la performance, avec recherche fuzzy via `nucleo-matcher` et index fichier local. Les claims publics de demarrage, latence, taille binaire et memoire doivent attendre les mesures de [`../benchmarks/PERFORMANCE_BASELINE.md`](../benchmarks/PERFORMANCE_BASELINE.md).

### Game scanner unique

Volt inclut des scanners pour plusieurs launchers de jeux (Steam, Epic, GOG, EA, Ubisoft, Riot, Xbox, Amazon Games, Battle.net, Rockstar). Avant de publier un claim chiffre, chaque combinaison launcher/OS doit etre validee dans [`../release/QA_MATRIX.md`](../release/QA_MATRIX.md).

### System monitor integre (v2)

Metriques CPU/RAM/disque en temps reel directement dans le lanceur, sans ouvrir un outil externe. La v2 ajoute : usage par coeur, details par disque (SSD/HDD), reseau par interface, top 5 processus CPU/RAM, temperatures, sparklines 60s, et export CSV.

### Extensible par design avec securite avancee

Architecture plugin avec API documentee, permissions explicites et execution Worker pour les extensions compatibles. Securite defense-in-depth : signatures HMAC-SHA256 sur l'etat des extensions, blocage de primitives dangereuses dans le Worker, proxy reseau avec protections SSRF, validation des manifests et detection de tampering avec alertes UI. Ne pas presenter ce modele comme un sandbox OS.

### Shell commands integre

Volt propose l'execution de commandes shell directement dans le lanceur avec streaming de la sortie, historique avec frecency, rendu ANSI et annulation via Ctrl+C. La blocklist et les redactions reduisent certains risques, mais l'execution shell reste une fonction avancee a presenter avec prudence.

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

**Creneau de Volt :** le lanceur cross-platform, open source, local-first, avec un ecosysteme de plugins en construction. Volt vise les utilisateurs qui :

1. **Travaillent sur plusieurs OS** et veulent un outil unifie
2. **Preferent l'open source** et ne veulent pas payer d'abonnement
3. **Sont gamers** et veulent un lanceur qui connait leurs jeux
4. **Veulent contribuer** a un projet actif et extensible

---

## Sources

- Alfred Powerpack : https://www.alfredapp.com/shop/
- Raycast Windows : https://www.raycast.com/windows
- PowerToys Run : https://learn.microsoft.com/en-us/windows/powertoys/run
- Ulauncher : https://ulauncher.io
- Ulauncher license : https://github.com/Ulauncher/Ulauncher
- Volt claims evidence : ../marketing/CLAIMS_EVIDENCE.md

---

_Document vivant — a mettre a jour lors de chaque release majeure. **Derniere revision : 2026-06-13.**_
