# 📦 Distribution & Mises à jour - Guide Volt

Ce document explique comment distribuer Volt et configurer les mises à jour automatiques.

## 🔑 Clés de signature (DÉJÀ FAIT ✅)

Les clés ont été générées:

- **Clé privée**: `D:\dev\Volt\tauri-update.key` ⚠️ **GARDER SECRÈTE!**
- **Clé publique**: `D:\dev\Volt\tauri-update.key.pub`

### Clé publique (à mettre dans tauri.conf.json):

```
dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IENDMkY1NTVFM0QzRDU0NTEKUldSUlZEMDlYbFV2ek5haExFWlpyaW14SUJTTStGR2VZT2hBQ2Q1QXo4OXVNcnFKRFFhSldmZXIK
```

---

## ⚠️ IMPORTANT - Sécurité des clés

### Ne JAMAIS commit la clé privée!

Ajouter au `.gitignore`:

```gitignore
# Tauri signing keys
tauri-update.key
*.key
!*.key.pub
```

### Sauvegarde de la clé privée

- Copie `tauri-update.key` dans un endroit sûr (cloud sécurisé, USB, etc.)
- Note ton mot de passe quelque part de sûr
- **Si tu perds la clé ou le mot de passe, les mises à jour ne marcheront plus!**

---

## 📝 Configuration tauri.conf.json

Mettre à jour `src-tauri/tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IENDMkY1NTVFM0QzRDU0NTEKUldSUlZEMDlYbFV2ek5haExFWlpyaW14SUJTTStGR2VZT2hBQ2Q1QXo4OXVNcnFKRFFhSldmZXIK",
      "endpoints": ["https://github.com/VoltLaunchr/Volt/releases/latest/download/latest.json"]
    }
  },
  "bundle": {
    "createUpdaterArtifacts": true
  }
}
```

---

## 🔨 Build pour distribution

### 1. Définir les variables d'environnement

**PowerShell:**

```powershell
# Lire la clé privée
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content D:\dev\Volt\tauri-update.key -Raw

# Mot de passe de la clé (celui que tu as entré lors de la génération)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "ton_mot_de_passe"
```

**Ou avec le chemin:**

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "D:\dev\Volt\tauri-update.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "ton_mot_de_passe"
```

### 2. Build l'application

```bash
bun tauri build
```

### 3. Fichiers générés

```
src-tauri/target/release/bundle/
├── nsis/
│   ├── volt_0.1.0_x64-setup.exe        # Installeur Windows
│   └── volt_0.1.0_x64-setup.exe.sig    # Signature (pour updater)
├── msi/
│   └── volt_0.1.0_x64_en-US.msi        # MSI installer
└── nsis/
    └── latest.json                      # Manifest pour l'auto-updater
```

---

## 🚀 Créer une Release

### Méthode 1: GitHub CLI (Recommandé)

```bash
# 1. Bump la version dans tauri.conf.json (ex: 0.1.0 → 0.2.0)

# 2. Commit et tag
git add .
git commit -m "chore: bump version to 0.2.0"
git tag v0.2.0
git push origin main --tags

# 3. Build avec signature
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content D:\dev\Volt\tauri-update.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "ton_mot_de_passe"
bun tauri build

# 4. Créer la release avec les fichiers
gh release create v0.2.0 `
  "src-tauri/target/release/bundle/nsis/volt_0.2.0_x64-setup.exe" `
  "src-tauri/target/release/bundle/nsis/volt_0.2.0_x64-setup.exe.sig" `
  "src-tauri/target/release/bundle/nsis/latest.json" `
  --title "Volt v0.2.0" `
  --notes "## What's New
- Feature 1
- Feature 2
- Bug fixes"
```

### Méthode 2: Interface GitHub

1. Aller sur https://github.com/VoltLaunchr/Volt/releases
2. Cliquer "Draft a new release"
3. Choisir le tag (v0.2.0)
4. Upload les fichiers:
   - `volt_x.x.x_x64-setup.exe`
   - `volt_x.x.x_x64-setup.exe.sig`
   - `latest.json`
5. Publier

---

## 🔄 Comment fonctionnent les mises à jour

### Côté utilisateur:

1. L'app vérifie `https://github.com/.../latest.json` au démarrage
2. Compare la version actuelle avec `latest.json`
3. Si nouvelle version → notification
4. L'utilisateur clique → téléchargement → installation → redémarrage

### Le fichier latest.json

```json
{
  "version": "0.2.0",
  "notes": "Bug fixes and improvements",
  "pub_date": "2025-12-13T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "...",
      "url": "https://github.com/VoltLaunchr/Volt/releases/download/v0.2.0/volt_0.2.0_x64-setup.exe"
    }
  }
}
```

---

## 📋 Checklist Release

- [ ] Mettre à jour la version dans `tauri.conf.json`
- [ ] Mettre à jour le CHANGELOG (optionnel)
- [ ] Commit: `git commit -m "chore: release v0.x.0"`
- [ ] Tag: `git tag v0.x.0`
- [ ] Push: `git push origin main --tags`
- [ ] Build: `bun tauri build` (avec les env vars de signature)
- [ ] Upload les 3 fichiers sur GitHub Release
- [ ] Tester le téléchargement
- [ ] Tester la mise à jour depuis une ancienne version

---

## 🤖 GitHub Actions (Automatisation) ✅ CONFIGURÉ

Le workflow `.github/workflows/release.yml` est configuré pour:

- ✅ Build automatique sur push tag `v*`
- ✅ Multi-plateforme (Windows, macOS Intel, macOS ARM, Linux)
- ✅ Signature automatique avec secrets GitHub
- ✅ Création release automatique (draft)

### 🔐 Configurer les Secrets GitHub (OBLIGATOIRE)

1. Aller sur: https://github.com/VoltLaunchr/Volt/settings/secrets/actions
2. Cliquer **"New repository secret"**
3. Ajouter ces 2 secrets:

| Nom                                  | Valeur                                    |
| ------------------------------------ | ----------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Contenu de `D:\dev\Volt\tauri-update.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Ton mot de passe                          |

#### Comment copier la clé privée:

```powershell
# Dans PowerShell, copier le contenu dans le presse-papier
Get-Content D:\dev\Volt\tauri-update.key | Set-Clipboard
```

Puis coller dans le champ "Value" sur GitHub.

### 🚀 Déclencher une Release

**Méthode 1: Push un tag**

```bash
# 1. Mettre à jour la version dans tauri.conf.json
# 2. Commit
git add .
git commit -m "chore: release v0.2.0"

# 3. Tag et push
git tag v0.2.0
git push origin main --tags
```

Le workflow se déclenche automatiquement et crée une release draft avec tous les builds.

**Méthode 2: Manuellement**

1. Aller sur: https://github.com/VoltLaunchr/Volt/actions/workflows/release.yml
2. Cliquer "Run workflow"
3. Entrer la version

### 📦 Artifacts générés

| Plateforme          | Fichier                             |
| ------------------- | ----------------------------------- |
| Windows             | `volt_x.x.x_x64-setup.exe`          |
| macOS Intel         | `volt_x.x.x_x64.dmg`                |
| macOS Apple Silicon | `volt_x.x.x_aarch64.dmg`            |
| Linux               | `volt_x.x.x_amd64.deb`, `.AppImage` |

### ✅ Publier la Release

Après le build (environ 10-15 min):

1. Aller sur https://github.com/VoltLaunchr/Volt/releases
2. La release est en **Draft** → Cliquer "Edit"
3. Vérifier les fichiers uploadés
4. Modifier les notes de release si besoin
5. Cliquer **"Publish release"**

---

## 🔧 Troubleshooting

### "Update signature mismatch"

- La clé publique dans `tauri.conf.json` ne correspond pas à la clé privée utilisée pour signer
- Solution: Vérifie que tu utilises la bonne clé privée

### "No update available" alors qu'il y en a une

- Vérifie que `latest.json` est accessible: `curl https://github.com/.../latest.json`
- Vérifie que la version dans `latest.json` est supérieure à la version actuelle

### "Failed to download update"

- Vérifie l'URL dans `latest.json`
- Vérifie que le fichier `.exe` est bien uploadé sur la release

---

## 📁 Structure finale

```
D:\dev\Volt\
├── tauri-update.key          # ⚠️ PRIVÉ - Ne pas commit!
├── tauri-update.key.pub      # Public - OK à commit
├── .gitignore                # Doit ignorer tauri-update.key
└── src-tauri/
    └── tauri.conf.json       # Contient la pubkey
```
