# Microsoft Store (MSIX) — Volt

Ce document décrit le **canal Microsoft Store** de Volt : la saveur de build
`store`, le packaging MSIX, les démarches Partner Center et les risques de
certification identifiés. Le test local pas à pas est dans
[`scripts/msix-local-test.md`](../../scripts/msix-local-test.md).

> État : **préparé, pas encore soumis.** Le compte Partner Center est en cours
> de vérification d'identité ; l'identité du paquet est donc un placeholder de
> test local dans `packaging/msix/msix.config.json`.

### Reprise vérifiée le 14 octobre 2026

- Scripts PowerShell analysés sans erreur de syntaxe.
- Les 26 assets ont été régénérés dans un dossier de test : leurs SHA-256
  correspondent aux fichiers de `packaging/msix/Assets`.
- `makepri` puis `makeappx pack` du SDK 10.0.26100.0 réussissent avec le
  manifeste rendu, les assets et le PRI (29 fichiers dans le layout).
  Cette validation utilise un **fichier factice de quatre octets**, pas
  Volt : le paquet dans `target/msix-script-validation/manifest-only`
  ne doit être ni installé ni soumis. Elle prouve le schéma et le packaging,
  aucune exécution native.
- Les sorties racine du dépôt/racine du disque, une version dépassant
  65535, un nom d'exécutable contenant `..\\` et un exécutable source situé
  dans le layout à reconstruire sont rejetés avant nettoyage. Le fichier
  témoin et l'exécutable source du dossier de test sont conservés.
- Le switch `scripts/build.ps1 -Store` impose `msstore` après chargement
  de `.env`. Un test avec un lanceur simulé confirme la priorité sur
  `VITE_VOLT_DISTRIBUTION=direct`, la transmission des arguments Tauri et
  la restauration de la variable après le build.
- Le staging avec `CARGO_TARGET_DIR` est vérifié avec des fichiers factices,
  en chemins absolu et relatif : les SHA-256 de l'exécutable et de sa DLL
  voisine sont conservés. La saveur par défaut `bundled-onnxruntime` utilise
  le lien statique de `ort-sys` 2.0.0-rc.13 ; elle ne requiert pas
  `onnxruntime.dll`. Cela est établi par le code du build de la dépendance,
  pas par un lancement natif de Volt.
- Le contrôle des jonctions est implémenté ; son test de création d'une
  jonction temporaire a été refusé par la politique d'exécution de l'outil.
- La désactivation d'une tâche imposée par la politique Windows renvoie
  désormais une erreur au lieu de confirmer une désactivation sans effet.
- Signature, installation, lancement sous identité MSIX, démarrage de
  session, toasts et WACK restent à vérifier avec la procédure locale.
- Le build release complet a ensuite été tenté avec un cache Cargo temporaire
  sur C:. Il s'est arrêté sur `windows` 0.57.0 avec l'erreur Windows 112
  (espace disque insuffisant), consignée dans `target-msix-build.log`.
  Cette tentative n'a donc produit aucun paquet contenant Volt compilé.

Les options `-SkipBuild`/`-ExePath` préviennent désormais explicitement que
l'origine du binaire n'est pas vérifiée. Lorsqu'elles servent à réutiliser un
ancien exécutable, un build Store frais reste requis avant soumission.

### Build natif vérifié le 21 octobre 2026

- `scripts/package-msix.ps1 -Packer makeappx` termine le build web et Rust
  **release avec `store`**, depuis les sources locales. L'import de `Path`
  utilisé hors feature Tantivy a été corrigé.
- Les tests Windows gardent leur manifeste Common Controls v6 ; le binaire
  `volt` utilise uniquement le manifeste déjà embarqué par Tauri. Cela évite
  la ressource MANIFEST en double (`CVT1100` / `LNK1123`) au lien natif.
- Le PE x64 importe `MSVCP140.dll` et `MSVCP140_1.dll` : le manifeste MSIX
  déclare donc **`Microsoft.VCLibs.140.00.UWPDesktop` >= 14.0.33728.0**,
  conformément au [déploiement C++ Desktop Bridge de Microsoft](https://learn.microsoft.com/en-us/troubleshoot/developer/visualstudio/cpp/libraries/c-runtime-packages-desktop-bridge).
  Les 206 symboles importés sont présents dans le framework x64 de cette
  version installé sur la machine. Le runtime ONNX est statique, mais ses
  imports de bibliothèque standard C++ restent dynamiques.
- Après cet ajout au manifeste, le même binaire fraîchement compilé a été
  re-packé avec `-SkipBuild`. `makepri` et `makeappx` réussissent. Le paquet
  final contient 31 entrées, dont 26 assets, `resources.pri` et `volt.exe`.
  L'exécutable extrait de l'archive a le même SHA-256 que la sortie du build.
- Résultat : `target/msix/Volt_0.4.0.0_x64.msix`, **30 160 997 octets**,
  SHA-256 `B26C49BBB57CA8402115F627354D8B872BCE2CFFB0A18EBE54E1C7F60391D988`.
  Le rapport local est dans `target/msix/verification.json` ; les traces du
  build et du re-pack sont `target-msix-verified.log` et
  `target-msix-package-final.log`.
- Revalidation : **506 tests frontend**, **480 tests Rust** réussis (un test
  de mesure ignoré par défaut). ESLint : zéro erreur, 229 avertissements.
- Les deux matrices Clippy strictes passent sur cet arbre local :
  `--all-targets --features tantivy-search -- -D warnings` et
  `--all-targets --no-default-features --features sqlcipher -- -D warnings`.
  Les logs sont `target-clippy-resume.log` et
  `target-clippy-sqlcipher-resume.log`. `cargo fmt --all -- --check` passe.
- Le paquet est **non signé**, avec l'identité **LOCAL TEST**. Aucune
  installation, création/import de certificat, modification de sécurité
  Windows ou soumission n'a été effectuée. Lancement sous identité MSIX,
  démarrage, toasts et WACK restent à valider manuellement.

---

## Pourquoi le Store, et pourquoi en MSIX

- Pas de budget pour un certificat de signature de code payant.
- Le Store **re-signe gratuitement** les paquets **MSIX** soumis. En revanche,
  une soumission EXE/MSI au Store exige que l'installeur soit déjà signé par
  l'éditeur (certificat payant) —
  [Code signing options](https://learn.microsoft.com/windows/apps/package-and-deploy/code-signing-options).
- Tauri v2 ne produit que NSIS (`.exe`) et WiX (`.msi`), pas de MSIX
  ([tauri#4818](https://github.com/tauri-apps/tauri/issues/4818)). On packe donc
  nous-mêmes le `volt.exe` produit par Tauri, avec `makeappx` (Windows SDK) ou
  le CLI [`winapp`](https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli).

## Deux canaux de distribution

| | Canal « direct » (inchangé) | Canal Microsoft Store (nouveau) |
|---|---|---|
| Format | NSIS `.exe` + `.msi` (tauri-action, `release.yml`) | `.msix` (`scripts/package-msix.ps1`) |
| Signature | non signé (SmartScreen) | signé par Microsoft à la publication |
| Mises à jour | `tauri-plugin-updater` + `latest.json` (GitHub Releases) | Microsoft Store uniquement |
| winget | `winget/manifests` (installeur NSIS) | possible plus tard via la source `msstore` |
| Démarrage auto | `tauri-plugin-autostart` (clé HKCU `Run`) | tâche `windows.startupTask` (API WinRT `StartupTask`) |
| Données | `%APPDATA%\volt.launch` | redirigées par MSIX (voir plus bas) |
| Build | `pnpm run tauri:build` | `pwsh -File scripts/package-msix.ps1` |

Rien n'a été modifié dans `release.yml`, `tauri.conf.json`, les manifests
winget ni le flux de l'updater : la saveur Store est **opt-in** et n'existe
qu'à travers les fichiers listés ci-dessous.

> Un utilisateur ne doit pas installer les deux versions en même temps : elles
> partagent l'identifiant `volt.launch` (mutex single-instance, `Ctrl+Space`).
> À mentionner dans la fiche Store et le README le moment venu.

## La saveur de build `store`

Trois interrupteurs, tous posés automatiquement par `scripts/package-msix.ps1` :

1. **Feature Cargo `store`** (`src-tauri/Cargo.toml`, désactivée par défaut).
   Active la dépendance optionnelle `windows` 0.61 (déjà présente dans le
   lockfile via Tauri/WebView2, aucun nouveau crate téléchargé) et :
   - **Démarrage auto** (`src-tauri/src/commands/system/autostart.rs`) : sous
     MSIX, toute écriture HKCU d'une app packagée est copiée dans une ruche
     privée au paquet (« copy-on-write »), qu'Explorer ne lit jamais — la clé
     `Run` de `tauri-plugin-autostart` n'a donc **aucun effet**
     ([fonctionnement des apps packagées](https://learn.microsoft.com/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)).
     Les commandes `enable/disable/is_autostart_enabled` pilotent à la place la
     tâche `VoltStartup` via `Windows.ApplicationModel.StartupTask`
     (`RequestEnableAsync`, `Disable`, `State`). Si l'utilisateur a désactivé
     la tâche dans Windows, Volt renvoie une erreur explicite (Windows interdit
     de la réactiver par programme).
   - **Notifications** (`src-tauri/src/commands/system/notifications.rs`) : le
     toast utilise l'AUMID du paquet `<PackageFamilyName>!Volt` au lieu de
     `volt.launch` (qui n'est enregistré que par le raccourci NSIS).
   - Les deux chemins retombent sur le comportement normal si le processus n'a
     pas d'identité de paquet (`cargo run --features store`).
2. **Overlay de config Tauri** `src-tauri/tauri.store.conf.json`, fusionné via
   `tauri build --config` (JSON Merge Patch) : `bundle.active=false`,
   `createUpdaterArtifacts=false`, `plugins.updater.endpoints=[]`. Le plugin
   updater reste enregistré (pas de modification de `lib.rs`), mais tout appel
   `check()` échoue avec `EmptyEndpoints` : aucune requête vers `latest.json`
   n'est possible, même par erreur.
3. **Variable Vite** `VITE_VOLT_DISTRIBUTION=msstore` : `updateService.ts`
   expose `getUpdateOwner()` (`self` / `package-manager` / `microsoft-store`).
   En mode Store, tout le service de mise à jour est inerte (même mécanisme que
   le paquet Arch `VITE_VOLT_PACKAGE_MANAGER=1`) et Paramètres → À propos
   affiche « Les mises à jour sont distribuées par le Microsoft Store » au lieu
   des boutons de mise à jour. Couvert par `updateService.test.ts`.

Commande de build équivalente (ce que fait le script) :

```powershell
$env:VITE_VOLT_DISTRIBUTION = 'msstore'
pwsh -File scripts/build.ps1 -Store --no-bundle --features store --config src-tauri/tauri.store.conf.json
```

## Fichiers du canal Store

| Fichier | Rôle |
|---|---|
| `packaging/msix/AppxManifest.template.xml` | Manifeste MSIX avec jetons `{{…}}` |
| `packaging/msix/msix.config.json` | Identité (placeholders de test local), nom affiché, version (`auto`), archi, versions Windows |
| `packaging/msix/Assets/` | Tuiles, logo Store, icônes barre des tâches (générés, remplaçables à la main) |
| `scripts/generate-msix-assets.ps1` | Génère `Assets/` depuis `src-tauri/icons/icon.png` (System.Drawing, sans dépendance) |
| `scripts/package-msix.ps1` | Build store → layout → manifeste → `resources.pri` → `.msix` (→ signature de test optionnelle) |
| `scripts/msix-local-test.md` | Procédure de test local (certificat, installation, WACK, checklist) |
| `src-tauri/tauri.store.conf.json` | Overlay Tauri (pas d'updater) |

### Le manifeste

- `Windows.FullTrustApplication` + capacité `runFullTrust` **uniquement**
  (pas de `uiAccess`, `unvirtualizedResources`, etc. dans cette 1ʳᵉ version).
- Application **`Volt`** : tuile du menu Démarrer + protocole `volt://`
  (`uap3:Protocol Parameters="&quot;%1&quot;"`) : l'URL arrive comme unique
  argument, exactement ce que lisent `tauri-plugin-deep-link` et
  `single-instance`. Pas d'appel à `register_all()` nécessaire en release.
- Application **`VoltStartup`** : masquée (`AppListEntry="none"`), porte la
  tâche `windows.startupTask` (`TaskId="VoltStartup"`, `Enabled="false"` :
  l'utilisateur active lui-même « Ouvrir au démarrage ») et
  `uap10:Parameters="--hidden"` pour démarrer en arrière-plan comme le fait
  l'autostart classique. ⚠️ À valider en test local (le schéma ne garantit pas
  explicitement que la tâche de démarrage transmet ces paramètres) — voir
  « Plan B » plus bas.
- `MinVersion` 10.0.19041.0 (Windows 10 2004, requis par `uap10`),
  `MaxVersionTested` 10.0.26100.0. Langues `en-us` et `fr-fr`.
- Framework C++ Desktop Bridge : `Microsoft.VCLibs.140.00.UWPDesktop`,
  minimum 14.0.33728.0. Le Store le distribue ; en sideload, cette dépendance
  doit être installée ou fournie via `-DependencyPath` (voir le guide local).
- Version : `package.json` + `.0` (le Store exige un 4ᵉ nombre à `0`).
- Les identifiants croisés (`Application Id="Volt"`, `TaskId="VoltStartup"`)
  sont des constantes dans `notifications.rs` et `autostart.rs` : les changer
  des deux côtés.

### Construire le MSIX

```powershell
# Candidat Store (non signé) -> target/msix/Volt_<version>.0_x64.msix
pwsh -File scripts/package-msix.ps1

# Test local signé avec TON certificat de test
& ./scripts/package-msix.ps1 -CertPath C:\chemin\volt-msix-test.pfx -CertPassword (Read-Host -AsSecureString)

# Re-packer sans recompiler / préparer le layout seulement
pwsh -File scripts/package-msix.ps1 -SkipBuild
pwsh -File scripts/package-msix.ps1 -SkipBuild -RenderOnly
```

Le script refuse de continuer s'il reste un jeton non résolu, si le XML est
mal formé, ou si un asset référencé manque ; il avertit tant que l'identité
est celle de test. Il ne crée/importe aucun certificat et n'installe rien.
Le nettoyage du layout vérifie son chemin absolu et refuse les jonctions.
Le script lit l'exécutable et les DLL voisines dans
`$env:CARGO_TARGET_DIR/release` lorsque cette variable est définie, sinon dans
`src-tauri/target/release`. Une valeur relative est résolue depuis `src-tauri`,
comme le build Tauri. Le chargement de `.env` est pris en compte avant staging.
`-SkipBuild` et `-ExePath` vérifient le packaging uniquement : ils ne prouvent
pas la saveur Store de l'exécutable réutilisé. Avant soumission, reconstruire
sans ces options. Pour signer, utiliser `& ./scripts/package-msix.ps1` dans
la session où le `SecureString` est disponible.

Outils : `winapp` s'il est dans le `PATH`, sinon `makeappx` + `makepri` +
`signtool` du Windows SDK (détectés aussi hors `PATH`, dans
`C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\`). Sur la machine de
dev : SDK 10.0.19041 / 22621 / 26100 et WACK présents, `winapp` absent.

## Données sous MSIX

- Le dossier d'installation (`C:\Program Files\WindowsApps\…`) est en lecture
  seule : Volt n'y écrit rien (tout passe par `app_data_dir`/`app_local_data_dir`).
- Les **nouveaux** fichiers créés sous `%APPDATA%`/`%LOCALAPPDATA%` sont
  redirigés vers `%LOCALAPPDATA%\Packages\<PFN>\LocalCache\{Roaming,Local}\…`
  mais restent visibles **pour Volt** au chemin habituel. Les fichiers qui
  existaient déjà (ancienne install NSIS) sont modifiés sur place.
- Ces données survivent aux mises à jour et sont **supprimées à la
  désinstallation** du paquet.
- Les **autres processus** (Explorer, Bloc-notes…) ne voient pas les fichiers
  redirigés : ouvrir/révéler un fichier de données Volt par son chemin
  « normal » peut échouer
  ([tauri#9936](https://github.com/tauri-apps/tauri/issues/9936)). Cas
  concernés : « ouvrir le fichier de logs », révéler un export placé dans
  AppData. Les fichiers de l'utilisateur (Documents, Bureau…) ne sont pas
  concernés. Correctif possible plus tard (derrière `store`) : traduire ces
  chemins vers `ApplicationData.Current.LocalCacheFolder`. Contournement
  documenté dans l'issue (`unvirtualizedResources`) **volontairement écarté**
  (capacité restreinte).
- WebView2 garde ses données dans `%LOCALAPPDATA%\volt.launch\EBWebView`
  (redirigé lui aussi) : `localStorage` persiste normalement.

## Risques WACK et certification

| # | Risque | Origine | Mitigation |
|---|---|---|---|
| 1 | **Package sanity / Blocked executables** : références à `CreateProcessW`, `ShellExecuteW`, `cmd.exe` signalées même sur un projet Tauri vierge | WebView2/Tauri ([tauri#14935](https://github.com/tauri-apps/tauri/issues/14935)) + code Volt légitime (lancement d'apps, plugin shell `>` qui lance `cmd`/`powershell`) | Test lié à Windows en mode S. Microsoft indique que ces résultats peuvent être des faux positifs à justifier ([App Consult](https://learn.microsoft.com/archive/blogs/appconsult/how-to-validate-if-your-application-is-compliant-with-the-windows-store-polices-windows-10-and-windows-10-s)). Expliquer dans les **Notes de certification** que Volt est un lanceur : il démarre des programmes et un shell **uniquement à la demande explicite** de l'utilisateur. Plan B si refus : désactiver le plugin shell dans la saveur `store`. Volt n'est de toute façon pas utile en mode S (lancement d'exécutables tiers bloqué). |
| 2 | Build debug ou direct soumis par erreur | cause probable de certains échecs WACK cités dans tauri#14935 | Le build automatique produit la saveur Store en release ; `-SkipBuild` et `-ExePath` ne vérifient pas l'origine du binaire. Toujours reconstruire avant soumission. |
| 3 | « L'app ne peut pas être lancée » à la certification | retour Microsoft cité dans tauri#14935 (invite de version / prérequis) | WebView2 est préinstallé sur Windows 11 et Windows 10 ≥ 2004 à jour, mais absent de certaines éditions (N/LTSC) : le préciser dans « Configuration requise » et les notes. `MinVersion` 19041. |
| 4 | **Binary analyzer / BinSkim** (ASLR, DEP, CFG…) | binaire Rust MSVC | Rust active `/DYNAMICBASE`, `/NXCOMPAT`, `/HIGHENTROPYVA` par défaut. Si le WACK signale Control Flow Guard : ajouter `-C control-flow-guard` aux `RUSTFLAGS` de la saveur store. |
| 5 | Validation des images | tailles d'assets | Assets générés aux tailles exactes (scale-100 non qualifiés + scale-200/400 + targetsize) ; `resources.pri` généré. Validé par `makeappx`. |
| 6 | Ressources de langue | `fr-fr` déclaré sans chaîne localisée dans le PRI | Possible avertissement. Sinon : localiser `DisplayName`/`Description` via `ms-resource:` ou retirer `fr-fr` (la fiche Store reste bilingue). |
| 7 | `runFullTrust` = capacité restreinte | toute app desktop packagée | Justification demandée à la soumission (texte prêt dans la checklist). |
| 8 | Démarrage auto | politique Store : pas de lancement auto sans consentement | `Enabled="false"` + activation uniquement via le réglage utilisateur. |
| 9 | Processus enfants (apps lancées par Volt) | sous MSIX, un exécutable **hors** paquet lancé par l'app sort normalement du conteneur (pas de virtualisation), comportement variable selon le build Windows ([discussion MSIX](https://techcommunity.microsoft.com/discussions/msix-discussions/msix-breakaway-in-22h2-win-10--11/4002473)) | Test n°14 de `msix-local-test.md` obligatoire avant soumission. |
| 10 | Notifications via `tauri-plugin-notification` côté JS | le plugin force l'AUMID `volt.launch` | Sous Windows, Volt passe par la commande Rust `send_native_notification` (corrigée en saveur `store`). Ne pas réintroduire l'appel JS direct sous Windows. |

### Plan B — démarrage masqué

Si le test n°10 de `msix-local-test.md` montre la fenêtre à l'ouverture de
session (paramètre `--hidden` non transmis), la correction la plus sûre est de
détecter l'activation par tâche de démarrage dans `launched_hidden()`
(`src-tauri/src/lib.rs`) :
`AppInstance::GetActivatedEventArgs()` → `Kind() == ActivationKind::StartupTask`
(feature `ApplicationModel_Activation` du crate `windows`, derrière `store`).
Non fait pour l'instant afin de ne pas toucher `lib.rs`.

## Démarches Partner Center (à faire plus tard)

1. **Compte** : compte développeur individuel (vérification d'identité en
   cours). Pas de certificat à acheter : le Store signe le MSIX.
2. **Réserver le nom** : Applications et jeux → Nouveau produit → *Application
   MSIX ou PWA* → réserver le nom (ex. « Volt », sinon « Volt Launcher »). Le
   nom réservé doit être **identique** à `displayName` dans
   `msix.config.json`.
3. **Identité du produit** : Gestion du produit → *Identité du produit*.
   Copier dans `packaging/msix/msix.config.json` :
   - `Package/Identity/Name` → `identityName`
   - `Package/Identity/Publisher` (`CN=…`) → `publisher`
   - `Package/Properties/PublisherDisplayName` → `publisherDisplayName`

   Puis re-générer le paquet (`pwsh -File scripts/package-msix.ps1`) : le
   warning « LOCAL TEST identity » doit disparaître. Le certificat de test
   local ne fonctionnera plus avec ce publisher (normal : on n'envoie au Store
   que le paquet **non signé**).
4. **Tarification et disponibilité** : gratuit, marchés, visibilité (possible
   de commencer en *privé / lien direct* pour une bêta).
5. **Propriétés** : catégorie *Productivité* (ou *Utilitaires et outils*),
   **URL de politique de confidentialité obligatoire** (Volt a des comptes,
   de la synchro, des intégrations OAuth et de l'IA : la politique 10.5.1 du
   Store s'applique) — à publier sur voltlaunchr.com, cf.
   [`security/PRIVACY_AND_TELEMETRY_REVIEW.md`](../security/PRIVACY_AND_TELEMETRY_REVIEW.md).
   Site web, contact support, configuration requise (clavier, Windows 10 2004+,
   WebView2).
6. **Classification par âge** : questionnaire IARC (utilitaire ; répondre
   honnêtement sur le chat IA et les échanges en ligne).
7. **Paquets** : téléverser le `.msix` **non signé** ; Partner Center vérifie
   que l'identité correspond à la réservation.
8. **Fiches Store** (fr-FR + en-US) : description, nouveautés, au moins une
   capture d'écran desktop (PNG, ≥ 1366×768 ; viser 4-6 : recherche, plugins,
   notes, paramètres), mots-clés, logo de fiche optionnel (les logos du
   paquet sont utilisés sinon).
9. **Options de soumission** :
   - *Capacités restreintes* — justification `runFullTrust` : « Volt est une
     application de bureau Win32 (Tauri/WebView2) packagée en MSIX ; en tant
     que lanceur, elle a besoin d'un accès complet pour énumérer et lancer les
     applications installées, indexer les fichiers de l'utilisateur et
     enregistrer un raccourci clavier global. »
   - *Notes pour la certification* : `Ctrl+Space` ouvre Volt ; aucun compte
     requis ; Volt lance des programmes et un shell uniquement à la demande de
     l'utilisateur (explique les références `cmd.exe`/`ShellExecute`) ; mises
     à jour gérées par le Store (updater interne désactivé) ; protocole
     `volt://` utilisé pour les retours OAuth.
10. **Soumettre** → certification (jusqu'à quelques jours ouvrés). Les mises à
    jour suivantes : bump de version (`scripts/bump-version.mjs`), nouveau
    paquet, nouvelle soumission.

## Checklist

**Avant la première soumission**

- [ ] `cargo check --features store` et `cargo clippy --features store` OK
- [ ] `pnpm run test` (dont `updateService.test.ts`) et `pnpm run lint` OK
- [ ] `pwsh -File scripts/package-msix.ps1` produit `target/msix/Volt_X.Y.Z.0_x64.msix`
- [ ] Test local complet (`scripts/msix-local-test.md`, tableau § 7) — en particulier 3 (pas d'updater), 4-5 (données), 6-8 (deep links), 9-12 (démarrage), 13 (toasts), 14 (apps lancées)
- [ ] WACK lancé, rapport lu, chaque FAIL/WARNING traité ou justifié
- [ ] Nom réservé, identité collée dans `msix.config.json`, paquet régénéré sans warning d'identité
- [ ] Politique de confidentialité en ligne
- [ ] Captures d'écran + descriptions fr/en
- [ ] Questionnaire IARC
- [ ] Justification `runFullTrust` + notes de certification
- [ ] Paquet **non signé** téléversé

**À chaque version Store**

- [ ] Version `package.json` bumpée (le Store refuse une version ≤ à la précédente ; 4ᵉ nombre = 0)
- [ ] `pwsh -File scripts/package-msix.ps1` sur l'arbre de la release
- [ ] Smoke test local signé (tests 1-4 au minimum)
- [ ] Notes de version dans la fiche Store

## Hors périmètre (pour plus tard)

- Paquet ARM64 / `.msixbundle` (x64 seulement pour l'instant).
- Job CI de packaging MSIX (le workflow `release.yml` reste inchangé).
- Correctif des chemins redirigés pour « ouvrir le fichier de logs ».
- Publication winget via la source `msstore`.
