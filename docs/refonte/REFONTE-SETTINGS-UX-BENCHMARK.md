# Settings — UX benchmark (launcher de référence) & plan Volt

> Objectif : faire converger la fenêtre Settings de Volt vers les meilleurs patterns UX des launchers
> desktop, **sans copier** ni textes, ni icônes, ni assets. On reprend des *principes* (IA, densité,
> interactions), pas une charte graphique.

## 1. Architecture d'information observée

Fenêtre unique, **sidebar gauche + panneau de contenu**. Chaque page est décrite de façon
**déclarative** (id, titre, mots-clés, sections, lignes) et cette même définition alimente :
la navigation, la **recherche globale dans les réglages** et le *deep-link vers une ligne*.

- Sidebar : champ de recherche en tête, puis groupes d'items (icône 22px + libellé). Pages
  « cœur » (General, Launcher, Keyboard, Advanced, About, Cloud sync…) puis pages par
  extension/plugin (`/extensions/<id>`), chacune avec en-tête (icône, titre, description repliable).
- Routes plates : `/general`, `/launcher`, `/keyboard`, `/advanced`, `/about`, `/extensions/:id`,
  sous-pages (`…/auto-quit`).
- Chaque ligne a un **id stable** ; une recherche ouvre la page, scrolle jusqu'à la ligne et la
  **pulse 2 s** (surlignage `selection-5`).
- Entrées de recherche typées : `section` | `row` | `action` ; certaines marquées `requiresPro`
  (badge) ou `availability` (masquées selon plateforme/feature flag).
- Les pages Settings sont aussi des **commandes du root search** (`rootSearchCommand`).

### Contenu des pages cœur (rangées, par section)

| Page | Sections → lignes (paraphrasé) |
|---|---|
| **Launcher** | *Behavior* : écran d'affichage, délai de retour à la racine, sensibilité de recherche, reset historique · *Customize search* : inclure fichiers / contenu de fichiers / contacts / agents · *Fallback commands* (liste ordonnable) |
| **Keyboard** | *Keyboard* : comportement d'Escape, Escape ferme les fenêtres secondaires, auto-switch input source, bindings de navigation (flèches/vim/emacs), touches page précédente/suivante, preset de hotkeys, Hyper Key (+ options) |
| **Advanced** | *(sans titre)* activation fenêtre, provider de favicons, options OS · *Export* : passphrase, backup planifié, dossier, auto-delete, skip on battery · *Connection* : proxy système, CA additionnelle |
| **Applications** (ext.) | action de hotkey d'app, **Auto Quit** (sous-page), scopes de recherche (dossiers), deep search |
| **File Search** (ext.) | scopes, patterns d'ignore (+ fichiers ignore), dossiers exclus auto (restaurables), content search, fichiers cachés, volumes réseau/amovibles, reset to defaults |
| **Clipboard** (ext.) | durée de rétention, OCR (+ mode), apps désactivées |
| **About** | version/MAJ, changelog, site, communauté, feedback |

Constat clé : **la description d'une ligne explique l'effet et le piège** (ex. « requiert un
redémarrage », « consomme plus de CPU »), pas juste le nom du réglage.

## 2. Système visuel observé (mesures)

Tokens (échelle `--spx` pour le zoom d'interface, tout en `round(calc(N * var(--spx)),1px)`) :

- Espacements : 2/4/6/8/12/16/24/32/40 ; rayons : 2/4/6/8/10/12/16 ; icônes 16/22 ; polices 11/13/16/18/24, graisses 400–700.
- Couleurs **dérivées d'un seul `--fg`/`--bg`** par opacité (`fg-5/10/20/40/60/80`) → thèmes triviaux :
  `border-tertiary=fg-5`, `border-separator=fg-10`, `text-secondary=fg-60`, `text-tertiary=fg-40`,
  `surface-control=fg-10`, `list-selection=fg-10`, `list-hover=fg-5`, `selection-5/10` pour l'actif.
- Accent unique (`--accent`) pour switch ON, liens, focus ; focus-ring = `outline + offset 2px`.

Composants Settings :

- **Section** : titre (min-h 32, padding-left 12) + **carte** `background: fg 2.5 %`, `overflow:hidden`,
  rangées séparées par un filet 1px `border-tertiary`. Gap entre sections 16.
- **Row** : `min-height 46`, padding 12, `gap 12`, **gauche** = label + description (colonne gap 4,
  `flex:1; min-width:0`), **droite** = contrôle (switch, select, bouton, champ). Alignement
  centré si la ligne n'a ni description ni accessoire, sinon `start`. Switch dans une boîte
  de 20px pour ne pas gonfler la ligne.
- **Switch** : 28×16 (Windows) / 36×16 (mac), thumb blanc, ON = accent, transition 100 ms,
  `:active` éclaircit, disabled 40 %.
- **Contenu** : `padding-x 16`, scroll vertical unique, en-tête de page repliable (icône 54,
  titre, description max 500px centrée).
- **Sidebar** : largeur fixe, item = icône 22 + libellé, actif = fond `selection-5`
  (+ bord intérieur 0,5px sur l'icône), séparateur droit `fg-10`, barre de titre à fond `fg-5`
  sur Windows, badges d'état (warning jaune, dev vert/rouge) alignés à droite.
- **Form layout** (pages type formulaire) : grille 3 colonnes `1fr 360px 1fr`, libellés alignés à
  droite, contrôles dans la colonne centrale.
- Extension désactivée ⇒ page entière à `opacity .5; pointer-events:none`.

## 3. Principes UX à retenir pour Volt

1. **Définition déclarative unique** des réglages (page → section → ligne, id stable, mots-clés).
2. **Recherche dans les réglages** (sidebar) + deep-link vers la ligne avec pulse.
3. **Lignes à description utile** ; mêmes composants partout (Section/Row/Switch/Select/Button).
4. **Un seul jeu de tokens** dérivés de fg/bg + accent ; densité compacte (rangée 46px).
5. **Pages par plugin** reprenant le gate d'activation (page grisée si plugin off).
6. Pages système regroupées (General, Launcher, Keyboard, Advanced, About) ; le reste = plugins.
7. Réglages risqués/plateforme → badge + `availability`, jamais d'option morte.

## 4. Inconnus / limites de l'analyse

- Analyse **statique** du bundle UI embarqué (structure, tokens, CSS) ; aucun comportement runtime
  observé ni capture d'écran (outils d'observation native REA = macOS uniquement ; WebView2 non
  attachable ici). Animations hors pulse/transitions CSS, ordre exact des groupes de sidebar et
  rendu pixel-exact **non vérifiés**.
- Le graphe sémantique REA est partiel (budget de résultat dépassé sur 3 vues volumineuses) ;
  les conclusions ci-dessus viennent des définitions de pages et feuilles de style lues telles quelles.
- Les textes d'origine ne sont pas repris : libellés/descriptions Volt à rédiger (i18n `settings:*`).

## 5. Plan d'implémentation Volt

1. `settings/registry` : types `SettingsPage/Section/Row` + définitions déclaratives des pages actuelles.
2. Primitives UI : `SettingsSection`, `SettingsRow`, `Switch`, `SettingsPageHeader` sur tokens existants.
3. Sidebar : recherche (fuzzy sur titres + mots-clés), navigation clavier, états actif/badges.
4. Deep-link : `scrollToRow(id)` + animation pulse 2 s ; câbler aux commandes root search.
5. Migration progressive page par page (General → Launcher → Keyboard → Advanced → plugins).
6. Tests Vitest (registry, recherche, scroll target) ; `pnpm run lint && pnpm run build`.

## 6. Système d'icônes — principes (benchmark)

Constats sur la structure d'un set de référence (pas sur le dessin des glyphes, qui reste propriétaire) :

- **Grille 16×16** pour les glyphes d'UI (variantes 20×20 pour quelques cas), **trait 1.5**, caps/joins arrondis,
  `currentColor` → hérite des tokens `fg-*` et de l'accent.
- Une famille de variantes par glyphe : contour, `-filled`, `-1px` (trait fin), tailles spéciales.
- **Tuile de catégorie** : icône posée dans un carré arrondi 22px (sidebar), bord intérieur 0,5px
  (`border-secondary`) quand l'item est actif ; l'icône ne porte pas la couleur d'état, la tuile oui.
- Inventaire large (centaines de glyphes) nommé par concept (`app-window`, `clipboard`, `keyboard`…),
  pas par usage.

Plan Volt : set **original** de glyphes 16×16 / trait 1.5 / `currentColor`, composant `VoltIcon` +
tuile 22px pour la sidebar Settings, dessinés de zéro (aucune reprise de path externe).
