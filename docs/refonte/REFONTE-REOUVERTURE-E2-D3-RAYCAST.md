# Réouverture E2/E3 (uiAccess) et D2/D3 (MFT/USN) — preuve Raycast for Windows

> **Statut** : 🔁 decision record de **réouverture** (2026-10-14). Aucun code produit modifié.
> Remplace le verdict « BLOQUÉ sans signature de code » (E2) et réévalue les NO-GO
> D2 (abandon 2026-06-25) / D3 (NO-GO 2026-06-24) à la lumière d'un concurrent qui a
> livré les deux. Ce document **ne modifie pas** les décisions existantes : il fixe les
> conditions (gates) pour les rouvrir réellement.
>
> Méthode : lecture **statique** et en lecture seule du paquet installé (manifeste,
> chaînes des binaires, bundles JS). Aucun binaire Raycast exécuté, aucune base chiffrée
> ouverte, aucun code repris. Les comportements déduits des chaînes sont marqués
> **(inféré)** ; ce qui vient d'une doc officielle est sourcé.

---

## 1. Contexte

### 1.1 Pourquoi E2 et D2/D3 étaient bloqués

| Item | Statut avant | Motif principal (cf. `TODO-REFONTE.md`, `REFONTE-PILIER-D-SEARCH.md`) |
|---|---|---|
| **E2** helper `uiAccess=true` | BLOQUÉ | Pas de chaîne de signature de code + exigence d'installation en Program Files (Volt s'installe en `currentUser`, `%LOCALAPPDATA%\Volt`) |
| **E3** canal sécurisé | non démarré | N'a de sens que si E2 existe |
| **D2** scan `$MFT` brut | ✅ ABANDONNÉ (2026-06-25) | Admin obligatoire ; principe « un launcher ne demande jamais l'UAC pour chercher » ; cas « déjà élevé » marginal |
| **D3** USN incrémental | ⛔ NO-GO (2026-06-24) | Gate (2) fréquence de re-scan **non mesurée** (pas de télémétrie) ; gate (3) USN-delta (462 µs/fichier de résolution `OpenFileById`, noms strippés en mode non privilégié) **non prouvé** meilleur qu'un re-walk ciblé |

### 1.2 Ce que montre Raycast for Windows 2.8.0 (paquet `Raycast.Raycast_2.8.0.0_x64__qypenmj9wpt2a`)

**Distribution / signature** (vérifié localement, 2026-10-14) :

- `Get-AppxPackage Raycast.Raycast` → `SignatureKind : Store`, `Publisher : CN=AE73154B-7136-4580-AC07-F58AB0FA8E9C`
  (éditeur au format GUID Partner Center) ⇒ **paquet MSIX distribué et re-signé par le Microsoft Store**.
- Malgré cela, chaque binaire interne est **aussi** signé Authenticode par l'éditeur
  (`Get-AuthenticodeSignature` → `Valid`, `CN=Raycast Technologies Ltd.`) pour
  `Raycast\Raycast.UIAccess.exe` et `Raycast\Raycast.SystemService.exe`.
  À comparer : `%LOCALAPPDATA%\Volt\volt.exe` et `uninstall.exe` → `NotSigned`.
- `Package.appinstaller` présent mais avec des placeholders `{AppInstallerUri}` non résolus (gabarit inutilisé).

**Point 13 — uiAccess** (`AppxManifest.xml`) :

- Application principale : `Executable="Raycast\Raycast.exe"`, `uap10:TrustLevel="mediumIL"`, `EntryPoint="Windows.FullTrustApplication"`.
- `rescap:Capability` : `runFullTrust`, `uiaccess`, `allowElevation`, `unvirtualizedResources`, `packageQuery`, `packageManagement`
  (+ `desktop6:FileSystemWriteVirtualization=disabled` et `RegistryWriteVirtualization=disabled`).
- `Raycast\Raycast.UIAccess.exe` déclaré comme `desktop:Extension Category="windows.fullTrustProcess"`
  avec `ParameterGroup GroupId="UIAccessGroup" Parameters="/uiaccess"`, **et** comme seconde
  `Application Id="Raycast.UIAccessHelper"` (`AppListEntry="none"`).
- Manifeste Win32 embarqué du helper : `requestedExecutionLevel level="asInvoker" uiAccess="true"`.
- Le helper expose une **RPC à verbes fermés** sur `\\.\pipe\RaycastUIAccessRPC` (chaînes :
  `SimulateCopy`, `SimulatePaste`, `SimulateSelectAll`, `FocusedElementTextBeforeCaret`,
  `FindHiddenInTrayWindows`, `IsUiAccessEnabled`, `UnregisterHotkey`…) et importe
  `SetWindowsHookExW`, `SendInput`, `SetWinEventHook`, `RegisterHotKey`, `WinVerifyTrust`.
  ⇒ **pas d'injection d'entrée arbitraire exposée, mais un jeu d'actions nommées** (inféré).

**Point 14 — service NTFS** (`Raycast\Raycast.SystemService.exe`, Rust, ~4,5 Mo, manifeste `asInvoker`) :

- Usage : `initialize` (« Copy binary to Program Files, register, and start service »),
  `install` / `start` / `stop` / `status` / `uninstall`, `scan` (« NTFS scanner data-pipe server
  (spawned on demand by the service) »), `usn-read <drive> [--watch] [--from USN]`.
- Crates/chemins : `windows-service-0.8.1`, `tokio` named pipes,
  `packages/rust/indexer/ntfs-scanner-client/src/ipc.rs`. Nom de service affiché :
  `Raycast System Service (Production)`.
- Pipes : `\\.\pipe\raycast-system-service-Production`, `\\.\pipe\raycast-ntfs-scanner-Production`.
  SDDL présents dans le binaire : `D:(A;;GRGW;;;IU)(A;;GA;;;SY)` (Interactive Users R/W, SYSTEM full)
  et `D:(A;OICI;GRGW;;;AU)` (Authenticated Users R/W).
- Vérification d'appelant : imports `GetNamedPipeClientProcessId`, `WinVerifyTrust` ; messages
  « failed to resolve control-pipe caller », « caller is not a trusted Raycast process »,
  « target failed signature verification », « caller image path has no parent ».
- MFT + USN : « No persisted snapshot for drive, enumerating MFT », « MFT enumeration complete »,
  « USN journal ID changed, full rescan required », « Journal reset, doing full rescan »,
  `delta_scan`, snapshot persistant `NtfsScanner\snapshot.bin.zst` sous `LOCALAPPDATA`,
  « Scanner idle; exiting » (scanner à la demande, pas résident).
- Cycle de vie hors paquet : « Launching Raycast system-service initialize after package creation »,
  « Last Raycast package folder removed; uninstalling service and scheduling deletion »
  ⇒ le service vit **hors** du paquet MSIX et s'auto-désinstalle quand le dernier dossier de
  paquet disparaît (inféré).
- **Le service lance aussi des helpers dans la session utilisateur** : imports `WTSQueryUserToken`,
  `SetTokenInformation`, `CreateProcessAsUserW` (`winsta0\default`) ; messages
  « SetTokenInformation(TokenUIAccess) failed (SeTcbPrivilege missing?) », « Launched elevated helper »,
  « the console user has no elevated linked token (standard account, or UAC disabled) » ;
  cibles `UiAccessHelper` / `NtfsScanner` / `TraceRecorder` ; erreurs `NotElevatable`,
  `SignatureInvalid`. ⇒ second chemin uiAccess **via le service SYSTEM** (positionne
  `TokenUIAccess` sur le jeton utilisateur, éventuellement le jeton lié élevé) (inféré —
  voir risques §5.3).

**Réglages File Search** (`frontend/file-search-settings-page-definition-*.js`) :

- `use-ntfs-scanner` : « Use a scanner based on the NTFS Master File Table. May speed up indexing on
  systems with large HDDs. **Requires User Account Control (UAC) permissions.** » — mots-clés
  `experimental`, et **absent** de la liste `searchEntries` (réglage caché/expérimental).
- `uninstall-ntfs-scanner` : « Uninstall the NTFS Scanner service and stop it from running. »
- `index-network-and-removable-volumes`, `keep-removed-volume-files`, `include-hidden-files`,
  `use-ignore-files` (`.gitignore`, `.ignore`, exclusions Git, `.rayignore`, **hiérarchiques**),
  `content-search`, et **`auto-excluded`** : « Folders an app keeps rewriting, like build output and
  caches » (exclusion automatique des dossiers à fort *churn*).
- Module natif de l'indexer (`backend/indexer-worker.mjs`) : exports `NtfsScannerState`, `WalkPace`,
  `IndexFilesState`, `SearchKind`, `SearchSorting`, `classifyPaths`, `recognizeText`.
- Index local de l'utilisateur : format segmenté maison (`minidex-6` : `.seg/.post/.skip/.mask`),
  ~2,9 k entrées ⇒ **périmètre par défaut petit, NTFS opt-in**.

**Lecture** : Raycast ne contredit pas nos décisions D2/D3, il les **confirme** sur le fond
(défaut = walk borné + ignore files ; MFT = accélérateur expérimental opt-in derrière une UAC
unique) et montre **comment** lever les deux murs : (a) la signature n'est plus un mur si on
passe par le Store MSIX ; (b) l'admin n'est plus « à chaque recherche » mais **une fois, à
l'opt-in**, via un service séparé.

---

## 2. Faits vérifiés (sources officielles)

### 2.1 MSIX, Store, signature

| # | Fait | Source |
|---|---|---|
| F1 | Publier un **MSIX via le Store** : signature **gratuite et automatique**, Microsoft re-signe après certification, pas de certificat à acheter. Un **MSI/EXE** soumis au Store doit, lui, être signé par l'éditeur (CA du Trusted Root Program, pas d'auto-signé). | [Code signing options — MS Learn](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) |
| F2 | Compte développeur Store **gratuit** pour les particuliers (sept. 2025) et pour les entreprises (frais de 99 $ supprimés, mai 2026). | [Code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) (« free developer account »), [Windows Dev Blog 2025-09-10](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/), [Windows Dev Blog 2026-05-07](https://blogs.windows.com/windowsdeveloper/2026/05/07/publish-to-microsoft-store-as-a-company-now-with-free-registration-and-faster-onboarding/) |
| F3 | **Azure Artifact Signing** (ex-Trusted Signing) ≈ 9,99 $/mois ; organisations : USA, Canada, **UE**, UK ; **particuliers : USA et Canada uniquement**. Pas de confiance SmartScreen instantanée. OV ≈ 150–300 $/an (clé sur HSM/token depuis 2023) ; EV ne contourne plus SmartScreen depuis 2024. **SignPath Foundation** : signature gratuite pour projets open source éligibles. | [Code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) |
| F4 | Les **restricted capabilities** exigent une justification dans Partner Center (page *Submission options*) et une revue de certification ; **le sideload n'exige aucune approbation**. | [App capability declarations](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations) |
| F5 | `uiAccess` (restricted) : doit être déclaré quand le manifeste Win32 a `uiAccess="true"`. `allowElevation` : « subject to approval under strict criteria », contacter `reportapp@microsoft.com` **à l'avance**. `packagedServices` / `localSystemServices` : « **In most cases, the use of this capability won't be approved** » pour le Store. `runFullTrust` requis pour une app mediumIL. | [App capability declarations](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations) |
| F6 | Exigences uiAccess (hors MSIX) : binaire **signé Authenticode**, installé dans un **emplacement sécurisé** (ex. Program Files), manifeste `uiAccess`. ⚠️ « UIAccess should not be used by applications that are not assistive technologies. » | [Security Considerations for Assistive Technologies](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview) |
| F7 | `windows.fullTrustProcess` + `FullTrustProcessLauncher.LaunchFullTrustProcessForCurrentAppAsync(parameterGroupId)` lance l'exe déclaré avec le `ParameterGroup` ; requiert `runFullTrust`. | [FullTrustProcessLauncher](https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.fulltrustprocesslauncher) |
| F8 | Paquets installés **par utilisateur** sous `C:\Program Files\WindowsApps\<package_full_name>` ; fichiers **en lecture seule** et verrouillés ; écritures dans le paquet interdites. Les apps virtualisées voient leurs nouveaux fichiers `AppData\Local|Roaming` redirigés vers un emplacement privé par paquet et leurs écritures HKCU copiées-sur-écriture ; tout est supprimé à la désinstallation. | [How packaged desktop apps run](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes) |
| F9 | `unvirtualizedResources` permet `FileSystemWriteVirtualization`/`RegistryWriteVirtualization` = `disabled` (écritures dans le vrai AppData/HKCU). | [App capability declarations](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations) |
| F10 | Constat Tauri : sous Store, `app_local_data_dir` renvoie `…\AppData\Local\Packages\<id>\LocalCache\Local\<app>` (virtualisation). | [tauri#9936](https://github.com/tauri-apps/tauri/issues/9936) |

### 2.2 Tauri et MSIX

| # | Fait | Source |
|---|---|---|
| T1 | « Currently Tauri only generates EXE and MSI installers » ; le Store accepte ces installeurs s'ils sont **signés**, silencieux (`/S`, `/quiet`), WebView2 **offline**, et `publisher` ≠ nom produit. | [Tauri — Microsoft Store](https://v2.tauri.app/distribute/microsoft-store/) |
| T2 | Feature request MSIX **ouverte** (#4818, activité sept. 2026) ; mainteneur : « No explicit plans, we do want it, but it's not the highest priority ». Outils tiers cités : `cargo-packager`, `Choochmeque/tauri-windows-bundle`. | [tauri#4818](https://github.com/tauri-apps/tauri/issues/4818) |
| T3 | Outil Microsoft **`winapp` CLI** : `winapp pack` (dossier → `.msix`/`.msixbundle`), `cert generate`, `sign` ; alternative officielle à `makeappx`/MSIX Packaging Tool. | [winapp CLI](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli), [Packaging guide](https://learn.microsoft.com/en-gb/windows/apps/dev-tools/winapp-cli/guides/packaging-cli) |
| T4 | Signature Windows dans Tauri : `certificateThumbprint`, ou **`signCommand`** personnalisé (Azure Artifact Signing via `artifact-signing-cli`, Azure Key Vault via relic). | [Tauri — Windows code signing](https://v2.tauri.app/distribute/sign/windows/) |
| T5 | Un projet Tauri v2 vierge empaqueté en MSIX échoue au test WACK « Package Sanity » (références `CreateProcessW`, `ShellExecuteW`, `cmd.exe`) — bloquant surtout pour S Mode. | [tauri#14935](https://github.com/tauri-apps/tauri/issues/14935) |

### 2.3 Politique Store pertinente (v7.20)

| # | Fait | Source |
|---|---|---|
| P1 | **10.2.4** : « Generally, dependency on non-Microsoft provided drivers or **NT services** is not allowed but may be considered case by case » ; obligation de le déclarer dans les notes de certification. | [Store Policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies) |
| P2 | **10.2.8** : consentement + méthodes supportées pour modifier l'expérience Windows ; « use of accessibility APIs […] in unsupported ways » listé comme méthode non supportée. | idem |
| P3 | **10.2.7** : désinstallation propre obligatoire (⇒ un service installé hors paquet doit être retiré). | idem |
| P4 | **10.2.2** : pas d'extension fonctionnelle par code dynamique contraire aux règles (à garder en tête pour les extensions Volt). | idem |
| P5 | **10.2.9** : voie « URL d'installeur » = `.msi`/`.exe` signés (tous les PE), URL versionnée immuable, install silencieuse. | idem |

### 2.4 Service Windows, pipes, NTFS

| # | Fait | Source |
|---|---|---|
| S1 | `CreateNamedPipe` sans `lpSecurityAttributes` : DACL par défaut = full control LocalSystem/Administrateurs/créateur **+ lecture pour Everyone et anonymous** ⇒ toujours fournir un SDDL explicite. `FILE_FLAG_FIRST_PIPE_INSTANCE` (anti-squatting), `PIPE_REJECT_REMOTE_CLIENTS`. | [CreateNamedPipe](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea) |
| S2 | Identification de l'appelant : `GetNamedPipeClientProcessId` ; usurpation de contexte : `ImpersonateNamedPipeClient` ; vérification de signature : `WinVerifyTrust`. | [GetNamedPipeClientProcessId](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid), [ImpersonateNamedPipeClient](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-impersonatenamedpipeclient), [WinVerifyTrust](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/nf-wintrust-winverifytrust) |
| S3 | Modifier `TokenSessionId` via `SetTokenInformation` exige le privilège « Act as part of the operating system » (SeTcb). Pour `TokenUIAccess`, la doc ne précise pas le privilège requis — **non vérifié officiellement** (Raycast suppose SeTcb). | [TOKEN_INFORMATION_CLASS](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ne-winnt-token_information_class) |
| S4 | Crates (crates.io, 2026-10-14) : `windows-service` **0.8.1** (Mullvad, celui de Raycast) ; `ntfs-reader` **0.6.0** (⚠️ le blueprint Pilier D cite 0.4.2, obsolète) ; `usn-journal-rs` **0.5.0** ; `ntfs` 0.4.0 (ColinFinck) ; `mft` 0.7.0. Les crates MFT ouvrent le volume en lecture brute ⇒ **admin** ; pertinentes uniquement côté service. | [windows-service](https://crates.io/crates/windows-service), [ntfs-reader](https://crates.io/crates/ntfs-reader), [usn-journal-rs](https://crates.io/crates/usn-journal-rs), [ntfs](https://crates.io/crates/ntfs) |
| S5 | Rappel D3 : le journal USN lu **en non privilégié** (`FSCTL_READ_UNPRIVILEGED_USN_JOURNAL`) ne renvoie pas les noms ⇒ résolution `OpenFileById` à 462 µs/fichier (mesuré 2026-06-24). Un lecteur **privilégié** (service) reçoit les noms inline et peut énumérer la MFT ⇒ ce coût disparaît. | [FSCTL_READ_USN_JOURNAL](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-fsctl_read_usn_journal), `REFONTE-PILIER-D-SEARCH.md` §3.6 et DR 2026-06-24 |

### 2.5 État Volt (vérifié dans le repo / sur la machine, 2026-10-14)

- `tauri.conf.json` : `bundle.windows.certificateThumbprint: null`, NSIS `installMode: "currentUser"`,
  updater `latest.json` sur GitHub Releases, `createUpdaterArtifacts: true`.
- `release.yml` contient un job **SignPath** (`sign-windows`, projet `Voltlaunchr`, policy
  `release-signing`) **non bloquant** ; mais sur **v0.5.0** les assets `volt_0.5.0_x64-setup.exe`
  et `.msi` ont le même horodatage que leurs `.sig` (pas de ré-upload signé) et le binaire installé
  est `NotSigned` ⇒ **SignPath intégré mais inactif en pratique**.
- ⚠️ Risque latent (non vérifié) : si SignPath ré-uploade un `setup.exe` signé **après** la
  génération du `.sig` minisign, la signature updater de `latest.json` ne correspond plus aux
  octets ⇒ mises à jour cassées. Signer **dans** `tauri build` (`signCommand`) évite le problème.
- `winget/manifests/v/VoltLaunchr/Volt/0.0.4/` (installeur NSIS ; hash `TODO_SHA256_HASH`) +
  job `update-winget` dans `release.yml`.
- Télémétrie D3 déjà en place (Vague 3.2) : `stale_catchup_count` + `last_stale_catchup` en meta DB,
  exposés via `get_db_index_stats` — **compteur seulement, pas de durée ni de volume de delta**.

---

## 3. Options — Point 13 : E2/E3 (helper uiAccess)

### Option 13-A — MSIX + Microsoft Store (modèle Raycast)

- **Comment** : produire un MSIX (hors bundler Tauri : `winapp pack` ou `makeappx`) contenant
  `volt.exe` (`mediumIL`, `runFullTrust`) + `volt-uiaccess.exe` (manifeste `uiAccess="true"`)
  déclaré en `windows.fullTrustProcess` ; capacité `rescap:uiAccess`. Le Store re-signe.
- **Pour** : plus de mur de signature (F1), compte gratuit (F2), WindowsApps est sous Program Files
  et install **sans UAC** ; SmartScreen sans avertissement.
- **Contre / inconnues** :
  - justification `uiAccess` à faire accepter alors que la doc réserve uiAccess aux technologies
    d'assistance (F6) et que 10.2.8 vise l'usage d'APIs d'accessibilité « non supporté » (P2) —
    Raycast a été accepté, ce qui prouve que c'est **possible**, pas **garanti** ;
  - **non vérifié** : un exe sans signature Authenticode propre, couvert seulement par la signature
    Store du paquet (catalogue `AppxMetadata\CodeIntegrity.cat`), obtient-il bien uiAccess ?
    Raycast signe *aussi* chaque exe, donc sa preuve ne tranche pas ;
  - le **`tauri-plugin-updater` doit être désactivé** dans la build Store (paquet en lecture seule,
    mises à jour par le Store) ⇒ deux variantes de build ;
  - **autostart** (`tauri-plugin-autostart` écrit un chemin d'exe versionné dans WindowsApps qui
    change à chaque mise à jour) ⇒ passer par l'extension `windows.startupTask` ; **deep-link**
    ⇒ `uap:Protocol` dans le manifeste ; **chemins de données** ⇒ `unvirtualizedResources` +
    write-virtualization `disabled` (comme Raycast) pour garder `%LOCALAPPDATA%` réel et la
    continuité NSIS→MSIX (F8–F10) ;
  - WACK sur Tauri (T5) à vérifier ;
  - pipeline release à doubler (MSIX + NSIS/MSI) ; winget peut pointer vers la source `msstore`.
- **Effort** : packaging MSIX + adaptations runtime **L** ; helper uiAccess **XL** (inchangé) ;
  E3 **L** ; certification Store **M** (délais incompressibles). Total **XL**.

### Option 13-B — MSIX sideload signé (App Installer)

- Même paquet, distribué hors Store (`.msix` + `.appinstaller` pour les MAJ).
- **Pour** : pas de revue des restricted capabilities (F4) ; maîtrise du calendrier.
- **Contre** : il faut **notre propre** certificat de confiance publique (F3) : Artifact Signing
  impossible en **particulier hors USA/Canada**, possible en **organisation UE** ; sinon OV
  150–300 $/an ; SignPath Foundation : couverture MSIX **non vérifiée**. Mêmes adaptations runtime
  que 13-A. Pas de canal de découverte Store.
- **Effort** : **XL** + coût certificat récurrent selon statut juridique.

### Option 13-C — Statu quo amélioré (NSIS signé + E1)

- E1 (hook `WH_KEYBOARD_LL` sans uiAccess) couvre ~80 % de la valeur ; il reste **à smoke-tester**.
- Activer réellement la signature des artefacts existants (SignPath déjà câblé) — utile
  indépendamment de E2 (SmartScreen, confiance utilisateurs).
- Un helper uiAccess « classique » resterait possible plus tard via une variante d'installeur
  **perMachine** (Program Files, UAC à l'installation) + binaire signé — sans MSIX.
- **Effort** : activation signature **S–M** ; smoke test E1 **S**.

### Option 13-D — uiAccess via le service SYSTEM (chemin secondaire Raycast)

- Le service (cf. 14-A) crée le processus helper dans la session avec `TokenUIAccess` positionné.
- **Rejeté pour Volt** : fait du service LocalSystem un lanceur de processus privilégiés dans la
  session — surface d'élévation silencieuse ; la variante « jeton lié élevé » revient à **contourner
  l'UAC après un consentement unique**. Incompatible avec notre posture.

---

## 4. Options — Point 14 : D2/D3 (MFT / USN)

### Option 14-A — Service opt-in installé séparément (modèle Raycast)

- **Comment** : binaire Rust `volt-ntfs-service.exe` (crate `windows-service`), signé ; à l'opt-in
  explicite dans Settings → **une** UAC → `initialize` copie le binaire dans
  `%ProgramFiles%\Volt\` (ACL admin-only), enregistre et démarre le service (LocalSystem,
  démarrage manuel/à la demande). Le service énumère la MFT (baseline « instantanée ») et suit le
  journal USN **privilégié** (noms inline ⇒ plus de résolution 462 µs/fichier, S5), persiste un
  snapshot compressé, expose **uniquement des métadonnées** sur un named pipe. Bouton
  « Désinstaller le scanner NTFS ». Le walk + watcher actuels restent le chemin par défaut et le
  fallback.
- **Pour** : seul chemin réaliste pour un MFT baseline ; compatible avec une distribution NSIS
  **et** MSIX (le service vit hors paquet) ; Raycast prouve la viabilité.
- **Contre** : change le principe « jamais d'UAC pour chercher » → à reformuler en « **jamais d'UAC
  par défaut ni par recherche ; une UAC unique, opt-in, réversible, pour un accélérateur
  expérimental** » ; surface d'attaque SYSTEM (§5) ; dépend d'un binaire **signé** (sinon la
  vérification d'appelant n'a pas de sens et l'UAC affiche « éditeur inconnu ») ; si distribution
  Store : `allowElevation` à faire approuver et P1 (dépendance NT service) à déclarer.
- **Effort** : **XL** (service + IPC + sécurité + snapshot + lifecycle install/uninstall + tests).

### Option 14-B — Service empaqueté dans le MSIX (`desktop6:Service`)

- Nécessite `packagedServices` + `localSystemServices` : « In most cases, the use of this capability
  won't be approved » pour le Store (F5) ; seulement envisageable en sideload/entreprise.
- **Rejeté** : c'est précisément pourquoi Raycast installe son service **hors** paquet.

### Option 14-C — Statu quo + gains bon marché inspirés de Raycast (sans admin)

- Garder Windows Search + walk borné + watcher + catch-up offline (Vague 3.2).
- Ajouter ce que Raycast fait **par défaut** et qui réduit le coût du walk sans privilège :
  **fichiers d'ignore hiérarchiques** (`.gitignore`, `.ignore`, `.voltignore`), **exclusion
  automatique des dossiers à fort churn** (build/caches), réglage explicite volumes
  réseau/amovibles. Ces dossiers expliquent l'essentiel des 83 min du walk « profil complet »
  (DR 2026-06-24).
- **Effort** : **M**.

---

## 5. Risques sécurité (reprend et précise E3)

### 5.1 Canal named pipe (helper uiAccess **et** service NTFS)

1. **SDDL explicite** (jamais la DACL par défaut, S1) : SYSTEM full + **SID de l'utilisateur
   interactif** (ou `IU`) en R/W ; pas d'`AU`/`WD`. `PIPE_REJECT_REMOTE_CLIENTS`.
2. **Anti-squatting** : `FILE_FLAG_FIRST_PIPE_INSTANCE` côté serveur ; côté client, vérifier que le
   serveur est le bon (`GetNamedPipeServerProcessId` + chemin d'image + signature).
3. **Identité de l'appelant** : `GetNamedPipeClientProcessId` → `OpenProcess` →
   `QueryFullProcessImageNameW` → chemin attendu (répertoire d'install Volt / WindowsApps) +
   `WinVerifyTrust` avec **épinglage de l'éditeur** (sujet du certificat), comme Raycast.
   Remplace avantageusement `CheckTokenMembership` listé dans E3.
4. **Limite connue** : un processus du même utilisateur peut injecter du code dans `volt.exe`
   (medium IL) et parler au pipe « en tant que Volt ». La vérification d'appelant **n'est pas une
   frontière de sécurité suffisante** ⇒ la vraie défense est une **API minimale** (5.2).
5. **TLS/Schannel (listé dans E3) : à retirer** — pipe local, distant rejeté, DACL restrictive ;
   le chiffrement n'ajoute rien contre un attaquant déjà local au même niveau d'intégrité.
6. Protocole versionné, messages bornés en taille, désérialisation stricte, timeouts, un client
   à la fois par verbe coûteux (Raycast : « Scan already in progress, rejecting concurrent request »).

### 5.2 Surface fonctionnelle

- **Helper uiAccess** : verbes fermés (`paste_snippet(id)`, `copy_selection`, `register_hotkey`…),
  **jamais** de `SendInput(bytes)` générique ni de « texte arbitraire à injecter » fourni par le
  pipe sans lien avec un snippet existant.
- **Service NTFS** : **métadonnées uniquement** (nom, chemin, taille, mtime, attributs) ; aucun
  verbe de lecture de contenu, de copie, de suppression ou d'exécution.
- **Fuite d'information inter-comptes (nouveau, critique)** : une énumération MFT faite en SYSTEM
  voit les noms de fichiers **de tous les profils** et des dossiers protégés. Le service doit
  **filtrer par l'appelant** : restreindre aux racines configurées par l'utilisateur **et**
  vérifier l'accès via `ImpersonateNamedPipeClient` + `AccessCheck`/ouverture du répertoire sous
  impersonation. Sans ce filtre, le service est une primitive de divulgation. (Le comportement
  de Raycast sur ce point n'est **pas** connu.)

### 5.3 Cycle de vie et élévation

- Binaire du service copié dans un dossier **non inscriptible par l'utilisateur** (Program Files)
  — sinon élévation de privilèges par remplacement de binaire.
- **Ne pas** reproduire le lancement de helpers avec jeton lié élevé (option 13-D).
- Désinstallation propre (P3) : bouton dans Settings + nettoyage à la désinstallation NSIS ;
  en MSIX, auto-retrait du service quand le paquet disparaît (comme Raycast).
- Le service ne doit pas tourner en permanence s'il n'est pas utilisé (scanner à la demande,
  arrêt après inactivité).

---

## 6. Gates go/no-go

### 6.1 Gate télémétrie (celui qui a bloqué D3) — mesure locale, bon marché, opt-in

Aujourd'hui on ne sait que **combien** de rattrapages ont eu lieu. Proposition **[S]**, sans
réseau, sans PII :

1. À chaque `reconcile()` (scan initial, rebuild, catch-up), enregistrer en meta DB un **ring
   buffer des 50 derniers runs** : `kind` (initial/catchup/rebuild), `duration_ms`,
   `files_total`, `roots`, et **delta** `{added, removed, modified}` calculé en diffant l'ancien
   snapshot et le nouveau (les deux sont en mémoire au moment du swap).
2. Compteur d'événements watcher **par dossier racine et par jour** (top 20) ⇒ mesure du churn,
   réutilisable directement pour l'exclusion automatique (14-C).
3. Optionnel, si `usn-incremental` est compilé : au moment du catch-up, **compter** (sans résoudre)
   les records USN depuis le dernier curseur — drain mesuré à 148 ms — pour comparer le volume de
   changements « vu par le journal » au delta réellement utile.
4. Settings → File Search : tuiles « durée médiane du rattrapage », « fichiers changés (médiane) »,
   et bouton **« Copier le rapport de diagnostic »** (JSON agrégé, chemins exclus) que l'utilisateur
   colle volontairement dans une issue. Rien n'est envoyé automatiquement.
5. Échantillon minimal pour décider : machine(s) du mainteneur + **≥ 5 rapports volontaires**,
   sur ≥ 2 semaines d'usage.

### 6.2 Gates par chantier

| Gate | E2 (uiAccess) | D3 USN non privilégié | D2/D3 via service (14-A) |
|---|---|---|---|
| **G0 produit** | E1 smoke-testé et ≥ 1 besoin concret non couvert (snippets/hotkeys au-dessus de fenêtres élevées) remonté par des utilisateurs | — | Demande utilisateur (gros HDD, scope large) |
| **G1 signature** | Spike prouvant qu'un helper du paquet obtient `TokenUIAccess` (et avec quelle signature) | — | Binaire service signé (SignPath/OV/Artifact Signing actif) — **obligatoire** |
| **G2 données** | — | Catch-up médian ≥ **10 s** sur le scope configuré **et** ≥ 1 catch-up/jour **et** `delta × 0,462 ms` < 50 % de la durée du walk | Scan **initial** médian ≥ **60 s** sur le scope configuré chez ≥ 2 rapports **ou** gate D3 atteint mais résolution non privilégiée trop lente |
| **G3 sécurité** | Revue E3 (§5.1/5.2) | — | Revue §5 complète, dont **filtrage par l'appelant** (5.2) |
| **G4 distribution** | Store : justification `uiAccess` acceptée (ou sideload signé choisi) | — | Si Store : P1 déclaré + `allowElevation` approuvé ; sinon NSIS seulement |
| **G5 réversibilité** | Désactivable à chaud | Feature flag OFF par défaut | Bouton désinstaller + fallback walk identique |

Seuils indicatifs, à confirmer une fois le ring buffer en place (ils sont choisis pour qu'un
gain soit perceptible et non pour « prouver » un résultat attendu).

---

## 7. Recommandation

**Point 13 (E2/E3)** — Rouvrir, mais **pas** implémenter maintenant. Le mur « pas de signature »
tombe (Store MSIX = signature gratuite, compte gratuit) ; restent deux inconnues bloquantes : la
recevabilité d'un `uiAccess` pour un launcher (F6/P2) et le fait que la signature du paquet seule
suffise. Ordre : (1) smoke test E1 (déjà dû) ; (2) activer la signature des artefacts actuels
(SignPath est câblé mais inactif ; corriger l'ordre signature/`.sig`) ; (3) spike **M** : MSIX
sideload de Volt (`winapp pack`) + helper `uiAccess` minimal signé par certificat de test, pour
mesurer la casse (updater, autostart, deep-link, chemins) et vérifier `TokenUIAccess` ; (4) décision
Store seulement si G0 est atteint. Option retenue si GO : **13-A** ; 13-D rejetée.

**Point 14 (D2/D3)** — Garder le statu quo par défaut, ajouter tout de suite la **télémétrie locale
§6.1** (S) et les **gains sans admin** de 14-C (ignore files + exclusion auto du churn, M) qui
attaquent la vraie cause du coût du walk. Le seul chemin MFT viable est **14-A** (service séparé,
UAC unique opt-in, métadonnées seulement, filtrage par l'appelant) ; **14-B rejetée** (capacité
non approuvée au Store). 14-A ne démarre que si G1+G2+G3 sont verts. D3 non privilégié reste
NO-GO tant que G2 n'est pas atteint ; si 14-A est un jour construit, il **remplace** D3 non
privilégié (le service lit les noms inline).

---

## 8. Questions ouvertes (à trancher par le mainteneur)

1. **Statut juridique de l'éditeur** (particulier en France vs organisation UE) : conditionne
   Artifact Signing (particulier hors USA/Canada exclu), le type de compte Store et le nom
   d'éditeur affiché.
2. **SignPath Foundation** : le secret `SIGNPATH_API_TOKEN` est-il configuré ? Pourquoi v0.5.0
   n'est-il pas signé ? Couvre-t-il les MSIX et un second binaire (helper/service) ?
3. **Distribuer sur le Store ?** Accepter deux pipelines (Store MSIX sans updater + NSIS avec
   updater) et la revue de certification à chaque release.
4. **Principe UAC** : accepter la reformulation « une UAC unique, opt-in, réversible » pour un
   accélérateur expérimental ?
5. **Collecte des rapports** : OK pour un bouton « Copier le rapport de diagnostic » et un appel à
   volontaires (pas de télémétrie réseau) ?

## 9. Non vérifié / à confirmer par spike

- Qu'un exe uiAccess **non signé Authenticode** mais couvert par la signature Store du paquet obtienne
  uiAccess.
- Le privilège exact requis pour `SetTokenInformation(TokenUIAccess)` (doc muette ; SeTcb supposé).
- Qu'un processus enfant lancé par une app MSIX puisse s'élever (`runas`) **sans** `allowElevation`.
- Le résultat WACK d'un Volt empaqueté (T5).
- La politique de filtrage par utilisateur du service Raycast.
- L'effet d'un ré-upload SignPath sur les `.sig` de l'updater.

## 10. Décisions du mainteneur (2026-10-14)

1. **Signature payante : non** (pas de budget pour l'instant). Aucun certificat OV/EV ni Artifact
   Signing. Seules les voies **gratuites** restent ouvertes : signature Store d'un MSIX (Microsoft
   re-signe) et SignPath Foundation (gratuit pour l'open source, sur candidature).
2. **Release non signée** : conséquence directe du point 1 — la v0.5.0 n'est pas signée par choix,
   pas par panne. Le job SignPath de `release.yml` reste inactif tant que la candidature n'est pas
   acceptée.
3. **Microsoft Store : cible long terme.** Ordre : spike MSIX sideload (non signé, mode développeur)
   → soumission Store gratuite. C'est aussi le chemin qui débloque la signature sans coût.
4. **UAC : accepté uniquement si inévitable**, et jamais par défaut. Rappel de la preuve Raycast :
   Raycast ne demande **aucune** élévation dans son fonctionnement par défaut (walk borné + fichiers
   d'ignore). Seul le réglage opt-in « Use NTFS Scanner » la demande — texte exact du bundle :
   « Requires User Account Control (UAC) permissions », mots-clés `experimental`. Volt suit ce
   modèle : défaut sans admin, accélérateur MFT optionnel et expérimental.
5. **Mesure locale + rapport copiable + appel à volontaires : OK** (aucune télémétrie réseau).

**Conséquence sur le séquencement** : priorité à 14-C (fichiers d'ignore hiérarchiques,
exclusion du churn, télémétrie locale) qui ne demande ni signature ni admin ; 14-A et 13-A restent
gatés par une signature gratuite (Store ou SignPath Foundation).
