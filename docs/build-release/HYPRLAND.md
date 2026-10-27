# Volt sur Hyprland (Wayland natif)

Voie officielle pour le toggle sous Hyprland : un `bind` qui lance
`volt --toggle`. Le global hotkey in-app (`ctrl+space`, `hotkey/mod.rs`,
backend X11 de `global-hotkey`) **ne fonctionne pas en Wayland natif**
(XWayland uniquement) ; ne pas compter dessus sous Hyprland.

## Prérequis

Paquet Arch (`volt-launchr`, voir `packaging/arch/`) plus, selon l'usage :

- `xdg-desktop-portal-hyprland` — portails desktop (recommandé) ;
- `wl-clipboard` — fallback d’écriture Wayland pour `paste_text` et `paste_sequentially` ;
- `wtype` — simulation de Ctrl+V pour ces deux commandes ;
- `org.freedesktop.secrets` — déjà en `optdepends` du paquet (keyring) ;
- `desktop-file-utils` — uniquement utile en dev (`register_all` debug).

## Toggle (bind)

```ini
# ~/.config/hypr/hyprland.conf
bind = SUPER, SPACE, exec, volt --toggle
```

Sémantique (sans nouvelle dépendance, `std::env::args` uniquement,
`src-tauri/src/lib.rs`) :

- 2e instance : le callback single-instance lit l'`argv` transféré. Si
  `--toggle` (ou `toggle`) est présent → toggle (visible → `hide`,
  cachée → `show` + `unminimize` + `focus`, même logique que la commande
  `toggle_window`). Sinon comportement inchangé (`show`).
- 1re instance lancée avec `--toggle` et aucune autre instance : toggle
  aussi — la fenêtre naît avec `visible: false` (`tauri.conf.json`) et
  l'auto-reveal la montre, soit la transition caché → visible.
- `volt --hidden --toggle` : `--hidden` gagne (reste caché).

L'action desktop `Toggle` (`Exec=volt --toggle`) est déclarée dans
`packaging/arch/com.voltlaunchr.volt.desktop`.

## Windowrules (launcher flottant)

```ini
windowrule = float, class:^(volt)$
windowrule = center, class:^(volt)$
windowrule = stayfocused, class:^(volt)$
windowrule = dimaround, class:^(volt)$
# Optionnel : pas de bordure/ombre gérée par Hyprland (décorations off côté app)
windowrule = noborder, class:^(volt)$
```

Ajuster `class:^(volt)$` selon le `StartupWMClass` réel
(`volt`, voir le `.desktop`) — vérifier avec `hyprctl clients`.

## Autostart silencieux

```ini
exec-once = volt --hidden
```

`--hidden` saute l'auto-reveal du bloc `volt://main-ready` dans `setup()`
(`src-tauri/src/lib.rs`) : l'instance reste en fond jusqu'au premier
`volt --toggle`. Le plugin `tauri-plugin-autostart` s'enregistre déjà avec
`--hidden` (même fichier).

## Dépannage

Les outils de collage ont un délai maximal de cinq secondes couvrant l’écriture
sur stdin et la fin du processus. Une annulation arrête le processus enfant ;
les sorties inutilisées ne sont pas mises en tampon. Ces garanties sont testées
avec des processus factices, sans modifier le presse-papiers ni injecter de
touches. Le fonctionnement avec un véritable compositeur reste à tester sous
Linux ; ces tests ne valident pas l’expansion globale des snippets.

- Fenêtre noire / contenu vide (WebKitGTK + dmabuf) :
  ```ini
  exec-once = env WEBKIT_DISABLE_DMABUF_RENDERER=1 volt --hidden
  ```
- Le bind ne fait que montrer, jamais cacher : vérifier que la commande
  contient bien `--toggle` (sans lui, la 2e instance fait toujours `show`).
- Deux icônes / focuses étranges : réutiliser le même binaire (`volt`) pour
  le bind, l'autostart et le lanceur d'applications — le single-instance ne
  déduplique que le même exécutable.
