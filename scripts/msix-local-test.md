# Tester le paquet MSIX de Volt en local

Procédure **manuelle** pour installer et valider le paquet Microsoft Store
(MSIX) de Volt sur ta machine **avant** de l'envoyer au Partner Center.
Le contexte et le processus Store complet sont dans
[`docs/build-release/MICROSOFT_STORE.md`](../docs/build-release/MICROSOFT_STORE.md).

> Les scripts du dépôt ne créent, n'importent ni n'installent **jamais** de
> certificat ou de paquet : toutes les étapes ci-dessous qui touchent au
> système (mode développeur, certificat, installation, WACK) sont à faire par
> toi, à la main.

Le certificat auto-signé sert **uniquement** au test local. Le fichier envoyé
au Store est le `.msix` **non signé** : Microsoft le re-signe gratuitement.

---

## 0. Prérequis

| Outil | État sur la machine de dev (oct. 2026) | Usage |
|---|---|---|
| PowerShell 7 (`pwsh`) | présent | scripts |
| Windows SDK 10.0.26100 (`makeappx`, `makepri`, `signtool`) | présent dans `C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\` | pack + signature |
| Windows App Certification Kit (`appcert.exe`) | présent dans `C:\Program Files (x86)\Windows Kits\10\App Certification Kit\` | WACK |
| `winapp` CLI | **absent** (optionnel) | alternative à makeappx |

Le script détecte `winapp` s'il est dans le `PATH`, sinon les outils du SDK
(même hors `PATH`). `winapp` s'installe avec
`winget install Microsoft.winappcli --source winget` si tu le préfères.

**Avant d'installer le MSIX : quitte (et idéalement désinstalle) la version
NSIS/MSI de Volt.** Les deux versions partagent le même mutex
single-instance et le même raccourci `Ctrl+Space` : la seconde instance
renverrait vers la première. Sauvegarde `%APPDATA%\volt.launch` si tu veux
pouvoir revenir en arrière.

## 1. Activer le mode développeur

Paramètres → Système → **Espace développeurs** → **Mode développeur** : Activé.

Ce n'est pas strictement nécessaire pour installer un `.msix` signé par un
certificat approuvé (le sideload est autorisé par défaut sur Windows 11), mais
c'est requis pour enregistrer un dossier non packé
(`Add-AppxPackage -Register .\target\msix\layout\AppxManifest.xml`) — pratique
pour itérer sans re-signer.

## 2. Créer un certificat de test auto-signé

Le **sujet** du certificat doit être **exactement** la valeur `publisher` de
`packaging/msix/msix.config.json` (par défaut `CN=VOLT-LOCAL-TEST`).
Méthode officielle :
<https://learn.microsoft.com/windows/msix/package/create-certificate-package-signing>

PowerShell (session normale, pas besoin d'admin) :

```powershell
$cert = New-SelfSignedCertificate -Type Custom `
  -Subject "CN=VOLT-LOCAL-TEST" `
  -KeyUsage DigitalSignature `
  -FriendlyName "Volt MSIX - test local" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}") `
  -NotAfter (Get-Date).AddMonths(6)

$pfxPassword = Read-Host -AsSecureString "Mot de passe du .pfx"
Export-PfxCertificate -Cert $cert -FilePath "$env:USERPROFILE\volt-msix-test.pfx" -Password $pfxPassword
Export-Certificate    -Cert $cert -FilePath "$env:USERPROFILE\volt-msix-test.cer"
```

Ne commite jamais le `.pfx` (garde-le hors du dépôt, comme ci-dessus).

## 3. Approuver le certificat (admin)

Dans un PowerShell **administrateur** :

```powershell
Import-Certificate -FilePath "$env:USERPROFILE\volt-msix-test.cer" `
  -CertStoreLocation Cert:\LocalMachine\TrustedPeople
```

## 4. Construire, packer et signer

Depuis la racine du dépôt (session normale) :

```powershell
& ./scripts/package-msix.ps1 `
  -CertPath "$env:USERPROFILE\volt-msix-test.pfx" `
  -CertPassword $pfxPassword
```

Ce que fait le script : build de la saveur `store`
(`--features store`, `--config src-tauri/tauri.store.conf.json`,
`VITE_VOLT_DISTRIBUTION=msstore`, `--no-bundle`), staging dans
`target/msix/layout`, rendu du manifeste, `resources.pri`, pack, signature.
Résultat : `target/msix/Volt_<version>.0_x64.msix`.

Lance la signature depuis la même session PowerShell que `$pfxPassword` :
`SecureString` ne traverse pas les arguments d'un nouveau processus `pwsh -File`.

Options utiles :

- `-SkipBuild` : re-packer sans recompiler ; le script ne peut pas vérifier
  que l'exécutable existant a été compilé avec la saveur `store`.
- `-Version 0.4.0.1` : tester une **mise à jour** par-dessus une installation
  existante (Windows exige une version strictement supérieure). Ne jamais
  envoyer au Store une version dont le 4ᵉ nombre n'est pas `0`.
- `-RenderOnly` : préparer le dossier `layout` sans packer.
- `-Packer makeappx|winapp` : forcer un outil.

## 5. Installer

Le paquet déclare le framework **`Microsoft.VCLibs.140.00.UWPDesktop` x64,
version 14.0.33728.0 minimum**, pour les imports C++ d'ONNX Runtime. Le Store
distribue ce framework ; un sideload local doit aussi résoudre cette dépendance
([procédure Microsoft](https://learn.microsoft.com/en-us/troubleshoot/developer/visualstudio/cpp/libraries/c-runtime-packages-desktop-bridge)).
Vérifier sa présence sans rien installer :

```powershell
Get-AppxPackage Microsoft.VCLibs.140.00.UWPDesktop |
  Where-Object Architecture -eq X64 | Select-Object Name, Version
```

S'il est absent ou trop ancien, obtenir le paquet **Desktop, Retail, x64**
correspondant depuis le SDK indiqué par Microsoft, puis fournir son chemin
avec `Add-AppxPackage -Path <Volt.msix> -DependencyPath <VCLibs.appx>`.
Le redistribuable `vc_redist.x64.exe` seul ne remplace pas cette dépendance
MSIX. Les scripts Volt n'installent pas le framework.

```powershell
Add-AppxPackage .\target\msix\Volt_0.4.0.0_x64.msix
```

(ou double-clic sur le `.msix`). Pour retrouver le nom de famille du paquet :

```powershell
Get-AppxPackage VoltLaunchr.Volt.LocalTest | Select-Object Name, Version, PackageFamilyName, InstallLocation
```

## 6. Lancer le WACK (Windows App Certification Kit)

PowerShell **administrateur** (le WACK installe et lance lui-même le paquet
pendant les tests ; ferme Volt avant) :

```powershell
$wack = "C:\Program Files (x86)\Windows Kits\10\App Certification Kit\appcert.exe"
& $wack reset
& $wack test -appxpackagepath "$PWD\target\msix\Volt_0.4.0.0_x64.msix" `
  -reportoutputpath "$PWD\target\msix\wack-report.xml"
```

Ou en interface graphique : `appcertui.exe` (même dossier) → « Valider une
application du Store » → choisir le `.msix`.

Lis le rapport (`wack-report.xml`) : chaque test est `PASS`, `WARNING` ou
`FAIL`. Les échecs attendus et leur traitement sont décrits dans
[`MICROSOFT_STORE.md` § Risques WACK](../docs/build-release/MICROSOFT_STORE.md#risques-wack-et-certification).

## 7. Que vérifier

Coche chaque ligne ; note toute anomalie avec la version et l'extrait de log
(`%LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalCache\Roaming\volt.launch\logs`).

| # | Test | Attendu |
|---|---|---|
| 1 | Lancer Volt depuis le menu Démarrer | La fenêtre (ou l'onboarding au 1er lancement) apparaît ; une seule entrée « Volt » dans Démarrer (l'application `VoltStartup` est masquée) |
| 2 | `Ctrl+Space` depuis une autre application | Volt s'affiche / se masque |
| 3 | Paramètres → À propos | Message « Les mises à jour sont distribuées par le Microsoft Store », **aucun** bouton « Vérifier les mises à jour » ; aucun toast « Update available » après plusieurs minutes |
| 4 | Persistance des données : modifier un réglage, créer une note, ajouter un snippet, quitter Volt, relancer | Tout est conservé. Les nouveaux fichiers sont dans `%LOCALAPPDATA%\Packages\<PFN>\LocalCache\Roaming\volt.launch\` (redirection MSIX), pas dans `%APPDATA%\volt.launch` |
| 5 | Mise à jour : re-packer avec `-Version 0.4.0.1`, `Add-AppxPackage` | Mise à jour sans perte de données (test 4 toujours OK) |
| 6 | Deep link : `Start-Process "volt://test"` (Volt lancé) | La fenêtre Volt passe au premier plan ; le log contient `[single-instance] forwarded deep link: volt://test` |
| 7 | Deep link à froid : quitter Volt puis `Start-Process "volt://test"` | Volt démarre (pas d'erreur « aucune application associée ») |
| 8 | Connexion OAuth (GitHub/Notion ou compte Volt) si tu l'utilises | Le retour `volt://…callback` revient dans Volt |
| 9 | Démarrage auto : Paramètres → Général → « Ouvrir au démarrage » ON | Pas d'erreur ; Gestionnaire des tâches → Applications de démarrage : « Volt » **Activé** |
| 10 | Se déconnecter / redémarrer la session | Volt démarre **en arrière-plan** (aucune fenêtre), `Ctrl+Space` fonctionne. Si la fenêtre s'affiche à l'ouverture de session, `uap10:Parameters="--hidden"` n'est pas transmis par la tâche de démarrage → à signaler (voir MICROSOFT_STORE.md, plan B) |
| 11 | « Ouvrir au démarrage » OFF | Gestionnaire des tâches : « Volt » Désactivé |
| 12 | Désactiver Volt dans le Gestionnaire des tâches, puis réactiver depuis Volt | Volt affiche une erreur demandant de réactiver dans Paramètres Windows → Applications → Démarrage (comportement imposé par Windows) |
| 13 | Notification native (ex. fin d'un minuteur) | Le toast s'affiche avec le nom/icône Volt |
| 14 | Lancer des applications depuis Volt (Notepad, VS Code, un jeu Steam, un raccourci `.lnk`) | Elles démarrent, survivent à la fermeture de Volt, et écrivent dans **leur** vrai `%APPDATA%` (leurs réglages restent visibles quand on les lance hors Volt) |
| 15 | Plugin shell : `> echo bonjour` | Sortie affichée |
| 16 | Indexation de fichiers, presse-papiers, recherche d'apps | Fonctionnent comme dans la version NSIS |
| 17 | Paramètres → ouvrir le fichier/dossier de logs | **Risque connu** : l'application externe peut ne pas trouver le fichier (chemin virtualisé). Noter le comportement |
| 18 | Désinstaller : `Get-AppxPackage VoltLaunchr.Volt.LocalTest \| Remove-AppxPackage` | Volt disparaît ; ses données redirigées sont supprimées (normal en MSIX) ; plus d'entrée de démarrage |

## 8. Nettoyage après les tests

```powershell
# Paquet (si encore installé)
Get-AppxPackage VoltLaunchr.Volt.LocalTest | Remove-AppxPackage

# Certificat approuvé (PowerShell administrateur)
Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object Subject -eq "CN=VOLT-LOCAL-TEST" | Remove-Item

# Certificat personnel (session normale)
Get-ChildItem Cert:\CurrentUser\My | Where-Object Subject -eq "CN=VOLT-LOCAL-TEST" | Remove-Item
```

Puis désactive le mode développeur si tu n'en as plus besoin, et réinstalle la
version NSIS si c'est elle que tu utilises au quotidien.
