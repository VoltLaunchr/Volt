# 🔐 API Next.js Ultra Sécurisée pour Repo Privé

## Architecture de sécurité

```
Client (Browser)
    ↓ (Aucun token exposé)
Next.js API Route (Server-side)
    ↓ (Token en variable d'env serveur)
GitHub API (Repo privé)
```

## 🔑 1. Créer un GitHub Personal Access Token (PAT)

### Option A : Fine-grained token (Recommandé - Plus sécurisé)

1. Aller sur : <https://github.com/settings/personal-access-tokens/new>
2. Configuration :
   - **Token name** : `Volt Website API - Read Only`
   - **Expiration** : 90 jours (renouvelable)
   - **Repository access** : `Only select repositories` → Choisir **VoltLaunchr/Volt**
   - **Permissions** :
     - ✅ `Contents` : **Read-only**
     - ✅ `Metadata` : **Read-only** (automatique)
3. Cliquer **"Generate token"**
4. ⚠️ **COPIER LE TOKEN**

### Option B : Classic token (si fine-grained ne marche pas)

1. Aller sur : <https://github.com/settings/tokens/new>
2. Configuration :
   - **Note** : `Volt Website API - Read Only`
   - **Expiration** : 90 jours
   - **Permissions** :
     - ✅ `repo` (uniquement pour accès repos privés)
3. Cliquer **"Generate token"**
4. ⚠️ **COPIER LE TOKEN**

---

## 🛡️ 2. Configuration Next.js (Ultra Sécurisée)

### `.env.local` (Ne jamais commit)

```bash
# GitHub API
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=VoltLaunchr
GITHUB_REPO=Volt

# Sécurité API
API_SECRET_KEY=votre_cle_secrete_aleatoire_longue_et_complexe
ALLOWED_ORIGINS=https://votresite.com,https://www.votresite.com

# Rate limiting
RATE_LIMIT_MAX_REQUESTS=10
RATE_LIMIT_WINDOW_MS=60000
```

### `.env.production` (Variables Vercel/Netlify)

```bash
GITHUB_TOKEN=${GITHUB_TOKEN}
GITHUB_OWNER=VoltLaunchr
GITHUB_REPO=Volt
API_SECRET_KEY=${API_SECRET_KEY}
ALLOWED_ORIGINS=https://votresite.com
RATE_LIMIT_MAX_REQUESTS=10
RATE_LIMIT_WINDOW_MS=60000
```

---

## 🔒 3. Middleware de sécurité

### `lib/security/rateLimit.ts`

```typescript
// Simple in-memory rate limiting (pour démo)
// Production : utiliser Redis ou Upstash
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

export function rateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10');
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');

  const record = rateLimitMap.get(ip);

  // Nettoyer les anciennes entrées
  if (record && now > record.resetTime) {
    rateLimitMap.delete(ip);
  }

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, {
      count: 1,
      resetTime: now + windowMs,
    });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (record.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  return { allowed: true, remaining: maxRequests - record.count };
}

// Nettoyage périodique
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000); // Nettoyer toutes les minutes
```

### `lib/security/validateRequest.ts`

```typescript
import { NextRequest } from 'next/server';

export function validateRequest(request: NextRequest): {
  valid: boolean;
  error?: string;
} {
  // Vérifier l'origine
  const origin = request.headers.get('origin');
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];

  if (origin && !allowedOrigins.includes(origin) && process.env.NODE_ENV === 'production') {
    return { valid: false, error: 'Origin not allowed' };
  }

  // Vérifier le User-Agent (basique)
  const userAgent = request.headers.get('user-agent');
  if (!userAgent) {
    return { valid: false, error: 'No user agent' };
  }

  return { valid: true };
}

export function getClientIP(request: NextRequest): string {
  // Essayer plusieurs headers (selon le proxy/CDN)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  return request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip') || '127.0.0.1';
}
```

---

## 🎯 4. API Route Sécurisée

### `app/api/volt/latest-release/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/security/rateLimit';
import { validateRequest, getClientIP } from '@/lib/security/validateRequest';

// Cache en mémoire (1 heure)
let cachedRelease: any = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 heure

async function fetchLatestRelease() {
  const now = Date.now();

  // Retourner le cache si valide
  if (cachedRelease && now - cacheTimestamp < CACHE_DURATION) {
    return cachedRelease;
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (!token || !owner || !repo) {
    throw new Error('Missing GitHub configuration');
  }

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    // Pas de cache côté fetch, on gère notre cache
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const release = await response.json();

  // Extraire uniquement les infos nécessaires (ne pas exposer tout)
  const sanitizedRelease = {
    version: release.tag_name,
    name: release.name,
    published_at: release.published_at,
    body: release.body,
    downloads: {
      windows: {
        setup: release.assets.find((a: any) => a.name.endsWith('-setup.exe'))?.browser_download_url,
        msi: release.assets.find((a: any) => a.name.endsWith('.msi'))?.browser_download_url,
      },
      macos: {
        dmg: release.assets.find((a: any) => a.name.endsWith('.dmg') && a.name.includes('x64'))
          ?.browser_download_url,
        dmg_arm: release.assets.find(
          (a: any) => a.name.endsWith('.dmg') && a.name.includes('aarch64')
        )?.browser_download_url,
      },
      linux: {
        deb: release.assets.find((a: any) => a.name.endsWith('.deb'))?.browser_download_url,
        appimage: release.assets.find((a: any) => a.name.endsWith('.AppImage'))
          ?.browser_download_url,
      },
    },
  };

  // Mettre en cache
  cachedRelease = sanitizedRelease;
  cacheTimestamp = now;

  return sanitizedRelease;
}

export async function GET(request: NextRequest) {
  try {
    // 1. Valider la requête
    const validation = validateRequest(request);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 403 });
    }

    // 2. Rate limiting
    const clientIP = getClientIP(request);
    const rateLimitResult = rateLimit(clientIP);

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: {
            'Retry-After': '60',
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    // 3. Récupérer les données
    const release = await fetchLatestRelease();

    // 4. Headers de sécurité
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });

    // CORS si besoin
    const origin = request.headers.get('origin');
    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      headers.set('Access-Control-Max-Age', '86400');
    }

    return NextResponse.json(release, { headers });
  } catch (error) {
    console.error('Error fetching release:', error);

    return NextResponse.json({ error: 'Failed to fetch release information' }, { status: 500 });
  }
}

// Handler pour OPTIONS (CORS preflight)
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');

  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
```

---

## 🎨 5. Page de téléchargement sécurisée

### `app/download/page.tsx`

```typescript
'use client';

import { useEffect, useState } from 'react';

interface ReleaseData {
  version: string;
  name: string;
  published_at: string;
  body: string;
  downloads: {
    windows: { setup?: string; msi?: string };
    macos: { dmg?: string; dmg_arm?: string };
    linux: { deb?: string; appimage?: string };
  };
}

export default function DownloadPage() {
  const [release, setRelease] = useState<ReleaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/volt/latest-release')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
      })
      .then(data => {
        setRelease(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p>Chargement...</p>
        </div>
      </div>
    );
  }

  if (error || !release) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-red-600">
          <p>Erreur lors du chargement des téléchargements</p>
          <p className="text-sm mt-2">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-16">
      <h1 className="text-4xl font-bold text-center mb-4">
        Télécharger Volt
      </h1>

      <p className="text-center text-gray-600 mb-12">
        Version {release.version} • Publié le{' '}
        {new Date(release.published_at).toLocaleDateString('fr-FR')}
      </p>

      {/* Windows */}
      {release.downloads.windows.setup && (
        <div className="max-w-2xl mx-auto mb-8">
          <h2 className="text-2xl font-semibold mb-4">🪟 Windows 10/11</h2>
          <div className="space-y-2">
            <a
              href={release.downloads.windows.setup}
              className="block p-4 border rounded-lg hover:bg-gray-50 transition"
            >
              <div className="font-semibold">Installeur (.exe)</div>
              <div className="text-sm text-gray-500">Recommandé</div>
            </a>
            {release.downloads.windows.msi && (
              <a
                href={release.downloads.windows.msi}
                className="block p-4 border rounded-lg hover:bg-gray-50 transition"
              >
                <div className="font-semibold">MSI (.msi)</div>
                <div className="text-sm text-gray-500">Pour déploiement entreprise</div>
              </a>
            )}
          </div>
        </div>
      )}

      {/* macOS */}
      {(release.downloads.macos.dmg || release.downloads.macos.dmg_arm) && (
        <div className="max-w-2xl mx-auto mb-8">
          <h2 className="text-2xl font-semibold mb-4">🍎 macOS</h2>
          <div className="space-y-2">
            {release.downloads.macos.dmg_arm && (
              <a
                href={release.downloads.macos.dmg_arm}
                className="block p-4 border rounded-lg hover:bg-gray-50 transition"
              >
                <div className="font-semibold">Apple Silicon (M1/M2/M3)</div>
                <div className="text-sm text-gray-500">Recommandé pour Mac récents</div>
              </a>
            )}
            {release.downloads.macos.dmg && (
              <a
                href={release.downloads.macos.dmg}
                className="block p-4 border rounded-lg hover:bg-gray-50 transition"
              >
                <div className="font-semibold">Intel (x64)</div>
                <div className="text-sm text-gray-500">Pour Mac Intel</div>
              </a>
            )}
          </div>
        </div>
      )}

      {/* Linux */}
      {(release.downloads.linux.deb || release.downloads.linux.appimage) && (
        <div className="max-w-2xl mx-auto mb-8">
          <h2 className="text-2xl font-semibold mb-4">🐧 Linux</h2>
          <div className="space-y-2">
            {release.downloads.linux.deb && (
              <a
                href={release.downloads.linux.deb}
                className="block p-4 border rounded-lg hover:bg-gray-50 transition"
              >
                <div className="font-semibold">Debian/Ubuntu (.deb)</div>
                <div className="text-sm text-gray-500">sudo dpkg -i volt_*.deb</div>
              </a>
            )}
            {release.downloads.linux.appimage && (
              <a
                href={release.downloads.linux.appimage}
                className="block p-4 border rounded-lg hover:bg-gray-50 transition"
              >
                <div className="font-semibold">AppImage</div>
                <div className="text-sm text-gray-500">Portable, toutes distributions</div>
              </a>
            )}
          </div>
        </div>
      )}

      {/* Release notes */}
      {release.body && (
        <div className="max-w-2xl mx-auto mt-12 p-6 bg-gray-50 rounded-lg">
          <h3 className="text-lg font-semibold mb-2">📋 Notes de version</h3>
          <div className="prose prose-sm max-w-none">
            {release.body.split('\n').map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 🚀 6. Déploiement sur Vercel/Netlify

### Ajouter les variables d'environnement

**Vercel :**

```bash
vercel env add GITHUB_TOKEN
vercel env add API_SECRET_KEY
vercel env add ALLOWED_ORIGINS
```

**Ou via dashboard :** Settings → Environment Variables

---

## ✅ Checklist Sécurité

- ✅ Token avec permissions minimales (read-only)
- ✅ Token côté serveur uniquement (jamais exposé au client)
- ✅ Rate limiting par IP
- ✅ Validation des origines (CORS)
- ✅ Cache pour réduire appels API
- ✅ Headers de sécurité
- ✅ Sanitisation des données
- ✅ Gestion d'erreurs sans fuite d'info
- ✅ Token avec expiration (à renouveler tous les 90 jours)

---

## 🔄 Renouveler le token

1. **30 jours avant expiration** : GitHub envoie un email
2. Créer un nouveau token (mêmes permissions)
3. Mettre à jour `GITHUB_TOKEN` sur Vercel/Netlify
4. Révoquer l'ancien token après vérification

---

## 📊 Monitoring (Optionnel)

Ajouter dans l'API route :

```typescript
// Log les requêtes (sans info sensible)
console.log({
  timestamp: new Date().toISOString(),
  ip: clientIP.replace(/\.\d+$/, '.xxx'), // Anonymiser IP
  userAgent: request.headers.get('user-agent')?.substring(0, 50),
  cached: cachedRelease !== null,
});
```

---

## 🛡️ Améliorations futures

1. **Redis** pour rate limiting distribué (Upstash)
2. **CloudFlare** pour protection DDoS
3. **Sentry** pour monitoring erreurs
4. **Webhooks GitHub** pour invalidation cache automatique
5. **Analytics** pour tracking téléchargements
