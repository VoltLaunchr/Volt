# Code Signing Setup

Guide pour activer la signature et la notarisation des bundles Volt afin d'éliminer les avertissements SmartScreen (Windows) et Gatekeeper (macOS) à l'installation.

> **État actuel (v0.0.2) :** builds **non signés**. L'auto-updater signe quand même ses artefacts via `minisign` (`TAURI_SIGNING_PRIVATE_KEY`), mais c'est une signature applicative pour l'updater — pas une signature système.

---

## Windows — Authenticode

### 1. Obtenir un certificat

Deux options :

| Type | Prix indicatif | Délai | Avantage |
|---|---|---|---|
| **OV** (Organization Validation) | ~200-400 € / an | 1-5 jours | Prix correct, valide pour la plupart des cas |
| **EV** (Extended Validation) | ~400-800 € / an | 5-15 jours (vérifs + HSM) | **Contourne SmartScreen immédiatement** (pas de période de chauffe) |

Fournisseurs :
- [Sectigo](https://sectigo.com/ssl-certificates-tls/code-signing)
- [DigiCert](https://www.digicert.com/signing/code-signing-certificates)
- [SSL.com](https://www.ssl.com/certificates/code-signing/)
- [Certum Open Source](https://shop.certum.eu/code-signing-in-the-cloud.html) — option ~25 €/an pour projets open-source

**Recommandation** : commencer par un OV Sectigo (~250 €/an). Les builds auront un "Unknown Publisher" pendant quelques semaines le temps que SmartScreen reconnaisse la réputation, puis deviendront silencieux.

### 2. Configurer le cert dans tauri.conf.json

Après réception du certificat, on a deux modes :

#### Mode A — Thumbprint (cert installé sur le runner)

```jsonc
"bundle": {
  "windows": {
    "certificateThumbprint": "ABCDEF0123456789...",
    "digestAlgorithm": "sha256",
    "timestampUrl": "http://timestamp.digicert.com"
  }
}
```

**Problème** : nécessite d'importer le cert sur chaque runner GitHub Actions, ce qui pose des problèmes de sécurité.

#### Mode B — Fichier `.pfx` + mot de passe (via secrets) — **recommandé**

1. Exporter le cert en `.pfx` avec mot de passe
2. Encoder en base64 : `base64 -i cert.pfx -o cert.pfx.base64`
3. Ajouter les secrets dans GitHub Settings → Secrets :
   - `WINDOWS_CERTIFICATE` : contenu de `cert.pfx.base64`
   - `WINDOWS_CERTIFICATE_PASSWORD` : mot de passe du `.pfx`
4. Laisser `certificateThumbprint: null` dans `tauri.conf.json`
5. Le workflow `release.yml` (déjà scaffolded) passera les variables à `tauri-action` qui fait le sign via `signtool`

### 3. Tester

```bash
# Sur une VM Windows 11 fraîche, après le release :
# 1. Télécharger le .msi
# 2. Clic droit → Propriétés → Signatures numériques → doit lister VoltLaunchr
# 3. Double-clic → SmartScreen doit afficher l'éditeur (pas "Unknown Publisher")
```

---

## macOS — Developer ID + Notarization

### 1. S'inscrire comme Apple Developer

- [developer.apple.com](https://developer.apple.com) → 99 $/an
- Créer un **Developer ID Application** certificate dans Certificates, Identifiers & Profiles

### 2. Générer un app-specific password

- [appleid.apple.com](https://appleid.apple.com/) → Sign-in and Security → App-Specific Passwords → Generate
- Sauvegarder ce mot de passe (affiché une seule fois)

### 3. Exporter le certificat

1. Xcode → Settings → Accounts → ton compte → Manage Certificates
2. Clic droit sur "Developer ID Application" → Export
3. Choisir un mot de passe fort, sauvegarder en `.p12`
4. Encoder en base64 : `base64 -i cert.p12 -o cert.p12.base64`

### 4. Ajouter les secrets dans GitHub

Settings → Secrets and variables → Actions :

| Secret | Valeur |
|---|---|
| `APPLE_CERTIFICATE` | contenu de `cert.p12.base64` |
| `APPLE_CERTIFICATE_PASSWORD` | mot de passe du `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Ton Nom (TEAMID)` |
| `APPLE_ID` | ton email Apple ID |
| `APPLE_ID_PASSWORD` | l'app-specific password généré à l'étape 2 |
| `APPLE_TEAM_ID` | 10 caractères, visible sur developer.apple.com |

### 5. Activer dans release.yml

Dé-commenter le bloc `Import Apple certificate` dans `.github/workflows/release.yml`. Les env vars sont déjà câblées dans le step `Build and Release`.

### 6. Tester

```bash
# Sur un Mac fraîchement réinitialisé :
# 1. Télécharger le .dmg
# 2. Double-clic → drag vers Applications → ouvrir
# 3. Gatekeeper doit autoriser sans demander "Override in System Preferences"
#
# Vérif manuelle :
spctl -a -vvv /Applications/Volt.app
# → "accepted source=Notarized Developer ID"
```

---

## Linux

Pas de signature système requise. Les `.deb`/`.rpm`/`.AppImage` ne sont généralement pas signés par défaut. Si besoin de signer les `.deb` pour un repo APT :
- Générer une clé GPG
- Signer avec `dpkg-sig` ou via `reprepro`

Hors scope pour v1.0.

---

## CSP en prod

La CSP stricte est déjà appliquée dans `tauri.conf.json` :

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: asset: http://asset.localhost https://asset.localhost;
font-src 'self' data:;
connect-src 'self' ipc: http://ipc.localhost https://github.com https://*.githubusercontent.com https://objects.githubusercontent.com;
frame-src 'none';
object-src 'none';
base-uri 'self';
form-action 'self'
```

- `style-src 'unsafe-inline'` est nécessaire pour les attributs `style={}` de React. Pour durcir davantage (nonces), il faudrait un refactor plus large.
- `connect-src` inclut `https://github.com` et `https://*.githubusercontent.com` pour l'auto-updater (fetch de `latest.json` + download des bundles).
- `devCsp: null` désactive la CSP en mode dev pour laisser Vite HMR fonctionner.

**Test manuel à faire après le prochain `bun tauri build`** :
1. Ouvrir l'app buildée
2. DevTools → Console → vérifier qu'il n'y a aucune violation CSP
3. Si une ressource casse, ajouter sa source à la directive correspondante

---

## Checklist release 1.0

- [ ] Cert Windows acheté et uploadé comme secret
- [ ] Cert macOS + notarization setup
- [ ] Test fresh install sur VM Windows 11 vierge → 0 SmartScreen
- [ ] Test fresh install sur macOS récent → 0 Gatekeeper prompt
- [ ] Test auto-update 0.0.2 → 1.0.0
- [ ] Test CSP en prod : 0 violation console

---

## Coûts totaux annuels

| Item | Coût |
|---|---|
| Apple Developer Program | 99 $ |
| Windows OV cert | ~250 € |
| **Total** | **~340 € / an** |

Option Certum Open Source : ~25 €/an si Volt devient open-source publié.
