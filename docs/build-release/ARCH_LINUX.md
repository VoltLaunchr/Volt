# Distribution Arch Linux

Ce document décrit l'état vérifié du support Linux et la politique du paquet
Arch natif. Le paquet de référence se trouve dans `packaging/arch/`.

## Sources de vérité

- version applicative : `package.json`, `src-tauri/Cargo.toml` et
  `src-tauri/tauri.conf.json` doivent rester synchronisés ;
- version du paquet : tag stable Git `vX.Y.Z`, reporté dans le `PKGBUILD` ;
- exécutable et nom produit : `volt` / `Volt` ;
- identifiant Tauri et protocole : `volt.launch` / `volt://` ;
- licence : Apache-2.0 (`LICENSE`) ;
- architecture Linux publiée : x86_64.

L'identifiant `volt.launch` n'est pas un identifiant DNS inversé. Le changer
peut déplacer les répertoires applicatifs et affecter les associations de
protocole ; il doit donc faire l'objet d'une migration upstream distincte.

## Construction Linux existante

Vite construit le frontend React, puis Cargo construit l'application Tauri 2.
La configuration Tauri demande actuellement tous les formats de bundle : deb,
RPM et AppImage. Le workflow de release utilise pnpm, et non Bun. Le fichier
verrou réellement utilisé est `pnpm-lock.yaml`, avec la version de pnpm déclarée
dans `package.json#packageManager` ; Cargo utilise
`src-tauri/Cargo.lock`.

Les releases stables récentes doivent être contrôlées avant chaque publication
Arch : la présence de la configuration de bundle ne garantit pas que les trois
artefacts Linux aient été publiés. Le paquet Arch ne dépend d'aucun de ces
artefacts et compile le tag depuis les sources.

## Intégration Linux réellement implémentée

- UI : GTK 3 et WebKitGTK 4.1 via Tauri/Wry ;
- global hotkey : backend X11 de `global-hotkey` sous Linux. Cette fonction
  n'est pas native Wayland et peut dépendre de XWayland ;
- presse-papiers : backend X11 d'`arboard` dans la configuration actuelle ;
- autostart : `tauri-plugin-autostart` crée, sur demande de l'utilisateur, un
  fichier dans `~/.config/autostart`. Le paquet ne le crée pas ;
- keyring : protocole Secret Service par D-Bus, sans liaison dynamique à
  libsecret. Un fournisseur `org.freedesktop.secrets` reste optionnel ;
- ouverture de fichiers et URL : `xdg-open`, fourni par `xdg-utils` ;
- applications : lecture des répertoires `.desktop` résolus depuis
  `XDG_DATA_HOME`/`XDG_DATA_DIRS` (avec repli sur les valeurs par défaut),
  plus les répertoires Flatpak et Snap connus, puis scan des exécutables.
  `TryExec`, `OnlyShowIn`/`NotShowIn` (filtrés via `XDG_CURRENT_DESKTOP`) sont
  pris en charge ;
- indexation : scan filesystem, watcher et SQLite. Elle n'impose pas X11 ;
- gestion des fenêtres : repositionnement et snap (`snap_window`) via X11/EWMH (`x11rb`) avec géométrie d'écrans RandR ; détection de la fenêtre active sous X11 (`_NET_ACTIVE_WINDOW`) et Hyprland (`hyprctl`) pour le presse-papiers et les snippets ;
- tray : aucun tray n'est créé par le code actuel. La présence transitive de
  crates relatives au tray ne constitue pas une fonctionnalité ;
- updater : désactivé à la compilation pour un paquet système avec
  `VITE_VOLT_PACKAGE_MANAGER=1`, afin que pacman reste seul propriétaire des
  fichiers installés.

Le support Linux Wayland est donc partiel : la fenêtre WebKit/GTK peut être
affichée sous Wayland, mais le raccourci global et le presse-papiers ne sont pas
des implémentations Wayland natives. Ces fonctions doivent être modernisées en
upstream avant de déclarer un support Wayland complet.

## Politique du paquet

Le nom retenu est `volt-launchr`. Il évite les noms proches déjà utilisés par
d'autres logiciels, tout en conservant l'exécutable upstream `/usr/bin/volt`.
Le paquet n'annonce pas de `provides` ou `conflicts` artificiel.

Le paquet installe uniquement :

- `/usr/bin/volt` ;
- `/usr/share/applications/com.voltlaunchr.volt.desktop` ;
- `/usr/share/icons/hicolor/{32x32,64x64,128x128,256x256}/apps/com.voltlaunchr.volt.png` ;
- `/usr/share/metainfo/com.voltlaunchr.volt.metainfo.xml` ;
- `/usr/share/licenses/volt-launchr/LICENSE`.

La compilation utilise `pnpm fetch` et `cargo fetch --locked` dans `prepare()`,
seule phase autorisée à accéder au réseau par makepkg. `build()` et `check()`
utilisent ensuite les modes offline/frozen. Le paquet sélectionne ONNX Runtime
du système (`onnxruntime-cpu`) au lieu de laisser `ort` télécharger une archive
précompilée pendant la construction. SQLite reste compilé via la feature
bundled existante.

La configuration cliente Supabase est récupérée au runtime depuis l'API
VoltLaunchr. Le build Arch n'injecte donc aucune valeur Supabase et aucun secret.
L'API refuse de servir une clé serveur ; la clé publishable retournée reste, par
définition, observable par les clients et doit être protégée par les politiques
RLS et les jetons utilisateur.

## Dépendances

Runtime directes ou justifiées par le binaire/comportement : `bash`, `cairo`,
`dbus`, `glibc`, `glib2`, `gtk3`, `libgcc`, `onnxruntime-cpu`, `openssl`,
`webkit2gtk-4.1`, `xdg-utils` et `xz`. Construction : `cargo`, `nodejs`, `pnpm`, `pkgconf`.
`org.freedesktop.secrets` est une dépendance optionnelle.

`libappindicator-gtk3`, `librsvg`, `libsecret` et `xdotool` ne sont pas ajoutés :
le code/binaire examiné ne les utilise pas directement. Les dépendances
transitives restent la responsabilité des paquets Arch qui les fournissent.

## Validation et publication

Depuis `packaging/arch/` :

```sh
makepkg --verifysource
makepkg --syncdeps --cleanbuild
namcap PKGBUILD
namcap ./*.pkg.tar.zst
makepkg --printsrcinfo > .SRCINFO
pkgctl build
```

Le workflow `arch-package.yml` effectue la construction et namcap dans un
conteneur Arch à jour, sans perturber les matrices Windows/macOS/Linux
existantes. `pkgctl build` reste la validation finale à exécuter dans un clean
chroot Arch local avant dépôt AUR.

Le dépôt AUR doit contenir le contenu de `packaging/arch/` et sa `.SRCINFO`, pas
le reste du monorepo. Lors d'une release, mettre à jour `pkgver`, recalculer le
checksum du tarball, mettre à jour la release AppStream, exécuter la validation
ci-dessus puis régénérer `.SRCINFO`. Une automatisation future peut proposer ces
changements par pull request ; elle ne doit pas disposer de credentials AUR dans
ce repository sans décision explicite.

## Avant une candidature dans `extra`

Il faut au minimum plusieurs releases Linux stables et installables, des builds
clean-chroot reproductibles continus, une maintenance AUR réactive, des retours
utilisateurs et une popularité démontrée. Les échecs actuels du pipeline de
release Linux, la configuration Supabase injectée au build, le support Wayland
partiel, l'identifiant non DNS inversé et la maturité du support Linux doivent
être résolus ou documentés durablement. L'updater doit rester désactivé pour les
paquets de distribution et les audits sécurité/dépendances doivent suivre les
releases.
