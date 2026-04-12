# Plugin Examples - Advanced Patterns

Collection d'exemples de plugins avancés avec patterns et techniques utiles.

## Table des matières

1. [Plugin avec cache](#plugin-avec-cache)
2. [Plugin avec API externe](#plugin-avec-api-externe)
3. [Plugin avec interface dédiée](#plugin-avec-interface-dédiée)
4. [Plugin hybride (Frontend + Backend)](#plugin-hybride-frontend--backend)
5. [Plugin avec paramètres utilisateur](#plugin-avec-paramètres-utilisateur)
6. [Plugin avec historique](#plugin-avec-historique)
7. [Plugin multi-sources](#plugin-multi-sources)

---

## Plugin avec cache

Plugin qui met en cache les résultats pour améliorer les performances.

```typescript
// src/features/plugins/builtin/movie-search/index.ts

import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';

interface Movie {
  id: string;
  title: string;
  year: number;
  poster: string;
}

interface CacheEntry {
  results: Movie[];
  timestamp: number;
}

export class MovieSearchPlugin implements Plugin {
  id = 'movie-search';
  name = 'Movie Search';
  description = 'Search for movies';
  enabled = true;

  private cache = new Map<string, CacheEntry>();
  private cacheTimeout = 3600000; // 1 heure

  canHandle(context: PluginContext): boolean {
    return context.query.toLowerCase().startsWith('movie ');
  }

  async match(context: PluginContext): Promise<PluginResult[]> {
    const query = context.query.substring(6).trim();
    if (!query) return [];

    // Vérifier le cache d'abord
    const cached = this.getFromCache(query);
    if (cached) {
      console.log('[MovieSearch] Using cached results');
      return this.toResults(cached);
    }

    // Chercher dans l'API
    try {
      const movies = await this.searchMovies(query);

      // Mettre en cache
      this.saveToCache(query, movies);

      return this.toResults(movies);
    } catch (error) {
      console.error('[MovieSearch] API error:', error);
      return [];
    }
  }

  async execute(result: PluginResult): Promise<void> {
    const movieId = result.data?.id as string;
    const url = `https://www.imdb.com/title/${movieId}`;
    window.open(url, '_blank');
  }

  // Cache helpers
  private getFromCache(query: string): Movie[] | null {
    const entry = this.cache.get(query.toLowerCase());

    if (!entry) return null;

    // Vérifier si le cache est encore valide
    const age = Date.now() - entry.timestamp;
    if (age > this.cacheTimeout) {
      this.cache.delete(query.toLowerCase());
      return null;
    }

    return entry.results;
  }

  private saveToCache(query: string, results: Movie[]): void {
    this.cache.set(query.toLowerCase(), {
      results,
      timestamp: Date.now(),
    });

    // Limiter la taille du cache (gardez les 100 dernières requêtes)
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  // API call
  private async searchMovies(query: string): Promise<Movie[]> {
    const response = await fetch(`https://api.example.com/search?q=${encodeURIComponent(query)}`);

    if (!response.ok) {
      throw new Error('API request failed');
    }

    const data = await response.json();
    return data.results || [];
  }

  // Convert to plugin results
  private toResults(movies: Movie[]): PluginResult[] {
    return movies.slice(0, 5).map((movie, index) => ({
      id: `movie-${movie.id}`,
      type: PluginResultType.Info,
      title: movie.title,
      subtitle: `${movie.year}`,
      icon: movie.poster,
      score: 90 - index * 2,
      data: movie,
    }));
  }
}
```

---

## Plugin avec API externe

Plugin qui interroge une API REST avec gestion d'erreurs robuste.

```typescript
// src/features/plugins/builtin/weather/index.ts

import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';

interface WeatherData {
  temperature: number;
  condition: string;
  humidity: number;
  city: string;
}

export class WeatherPlugin implements Plugin {
  id = 'weather';
  name = 'Weather';
  description = 'Get current weather information';
  enabled = true;

  private apiKey = 'your-api-key'; // À stocker dans les settings en prod
  private apiUrl = 'https://api.openweathermap.org/data/2.5/weather';

  canHandle(context: PluginContext): boolean {
    const query = context.query.toLowerCase();
    return query.startsWith('weather ') || query.startsWith('météo ');
  }

  async match(context: PluginContext): Promise<PluginResult[]> {
    const query = context.query.toLowerCase();

    // Extraire la ville
    let city = query.replace(/^(weather|météo)\s+/, '').trim();

    // Ville par défaut si non spécifiée
    if (!city) {
      city = await this.getUserLocation();
    }

    if (!city) {
      return [
        {
          id: 'weather-help',
          type: PluginResultType.Info,
          title: 'Weather - Enter a city name',
          subtitle: 'Example: weather Paris',
          score: 50,
          data: {},
        },
      ];
    }

    try {
      const weather = await this.fetchWeather(city);

      return [
        {
          id: `weather-${city}`,
          type: PluginResultType.Info,
          title: `${weather.temperature}°C - ${weather.condition}`,
          subtitle: `${weather.city} • Humidity: ${weather.humidity}%`,
          icon: this.getWeatherIcon(weather.condition),
          score: 95,
          data: weather,
        },
      ];
    } catch (error) {
      console.error('[Weather] Fetch error:', error);

      return [
        {
          id: 'weather-error',
          type: PluginResultType.Info,
          title: `Could not fetch weather for "${city}"`,
          subtitle: 'Check the city name or try again later',
          icon: '⚠️',
          score: 50,
          data: { error: true },
        },
      ];
    }
  }

  async execute(result: PluginResult): Promise<void> {
    // Copier la température dans le presse-papiers
    if (result.data?.error) {
      return; // Ne rien faire en cas d'erreur
    }

    const weather = result.data as WeatherData;
    const text = `${weather.city}: ${weather.temperature}°C, ${weather.condition}`;

    await navigator.clipboard.writeText(text);
    console.log('✓ Weather copied to clipboard');
  }

  // Récupérer la météo depuis l'API
  private async fetchWeather(city: string): Promise<WeatherData> {
    const url = `${this.apiUrl}?q=${encodeURIComponent(city)}&appid=${this.apiKey}&units=metric`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      return {
        temperature: Math.round(data.main.temp),
        condition: data.weather[0].main,
        humidity: data.main.humidity,
        city: data.name,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // Obtenir la localisation de l'utilisateur (fallback)
  private async getUserLocation(): Promise<string | null> {
    try {
      // Utiliser une API de géolocalisation IP
      const response = await fetch('https://ipapi.co/json/', {
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        const data = await response.json();
        return data.city || null;
      }
    } catch (error) {
      console.warn('[Weather] Could not get user location');
    }

    return null;
  }

  // Icône selon la météo
  private getWeatherIcon(condition: string): string {
    const icons: Record<string, string> = {
      Clear: '☀️',
      Clouds: '☁️',
      Rain: '🌧️',
      Snow: '❄️',
      Thunderstorm: '⛈️',
      Drizzle: '🌦️',
      Mist: '🌫️',
      Fog: '🌫️',
    };

    return icons[condition] || '🌡️';
  }
}
```

---

## Plugin avec interface dédiée

Plugin avec une vue React dédiée pour une interaction complexe.

```typescript
// src/features/plugins/builtin/color-picker/index.ts

import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';

export class ColorPickerPlugin implements Plugin {
  id = 'color-picker';
  name = 'Color Picker';
  description = 'Pick and convert colors';
  enabled = true;

  canHandle(context: PluginContext): boolean {
    const query = context.query.toLowerCase();
    return query.startsWith('color ') || query.startsWith('#') || query.startsWith('rgb');
  }

  match(context: PluginContext): PluginResult[] {
    const query = context.query.trim();

    // Parser la couleur
    const color = this.parseColor(query);

    if (!color) {
      return [
        {
          id: 'color-help',
          type: PluginResultType.Info,
          title: 'Color Picker',
          subtitle: 'Try: #ff0000, rgb(255, 0, 0), or color red',
          score: 50,
          data: { showPicker: true },
        },
      ];
    }

    // Afficher les conversions
    const results: PluginResult[] = [];

    // HEX
    results.push({
      id: 'color-hex',
      type: PluginResultType.Info,
      title: color.hex,
      subtitle: 'HEX color',
      icon: this.colorSwatch(color.hex),
      score: 95,
      data: { value: color.hex, format: 'hex' },
    });

    // RGB
    results.push({
      id: 'color-rgb',
      type: PluginResultType.Info,
      title: `rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`,
      subtitle: 'RGB color',
      icon: this.colorSwatch(color.hex),
      score: 93,
      data: { value: `rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`, format: 'rgb' },
    });

    // HSL
    results.push({
      id: 'color-hsl',
      type: PluginResultType.Info,
      title: `hsl(${color.hsl.h}, ${color.hsl.s}%, ${color.hsl.l}%)`,
      subtitle: 'HSL color',
      icon: this.colorSwatch(color.hex),
      score: 91,
      data: { value: `hsl(${color.hsl.h}, ${color.hsl.s}%, ${color.hsl.l}%)`, format: 'hsl' },
    });

    return results;
  }

  async execute(result: PluginResult): Promise<void> {
    if (result.data?.showPicker) {
      // Ouvrir l'interface du color picker
      window.dispatchEvent(new CustomEvent('volt:open-color-picker'));
    } else {
      // Copier la couleur
      const value = result.data?.value as string;
      await navigator.clipboard.writeText(value);
      console.log('✓ Color copied:', value);
    }
  }

  // Parser différents formats de couleur
  private parseColor(input: string): Color | null {
    // HEX format
    const hexMatch = input.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (hexMatch) {
      return this.hexToColor(hexMatch[1]);
    }

    // RGB format
    const rgbMatch = input.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
    if (rgbMatch) {
      return this.rgbToColor(parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3]));
    }

    // Nom de couleur
    const colorName = input.replace(/^color\s+/i, '').trim();
    return this.namedColorToColor(colorName);
  }

  private hexToColor(hex: string): Color {
    // Convertir hex 3 digits en 6 digits
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }

    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);

    return {
      hex: `#${hex.toUpperCase()}`,
      rgb: { r, g, b },
      hsl: this.rgbToHsl(r, g, b),
    };
  }

  private rgbToColor(r: number, g: number, b: number): Color {
    const hex =
      `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();

    return {
      hex,
      rgb: { r, g, b },
      hsl: this.rgbToHsl(r, g, b),
    };
  }

  private rgbToHsl(r: number, g: number, b: number): HSL {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0,
      s = 0,
      l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch (max) {
        case r:
          h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
          break;
        case g:
          h = ((b - r) / d + 2) / 6;
          break;
        case b:
          h = ((r - g) / d + 4) / 6;
          break;
      }
    }

    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100),
    };
  }

  private namedColorToColor(name: string): Color | null {
    const colors: Record<string, string> = {
      red: 'ff0000',
      green: '00ff00',
      blue: '0000ff',
      yellow: 'ffff00',
      // ... autres couleurs
    };

    const hex = colors[name.toLowerCase()];
    return hex ? this.hexToColor(hex) : null;
  }

  // Génère un carré de couleur (SVG data URL)
  private colorSwatch(hex: string): string {
    return `data:image/svg+xml,${encodeURIComponent(`
      <svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" fill="${hex}" rx="4"/>
      </svg>
    `)}`;
  }
}

interface Color {
  hex: string;
  rgb: { r: number; g: number; b: number };
  hsl: HSL;
}

interface HSL {
  h: number;
  s: number;
  l: number;
}
```

```typescript
// src/features/plugins/builtin/color-picker/components/ColorPickerView.tsx

import React, { useState } from 'react';
import './ColorPickerView.css';

interface ColorPickerViewProps {
  onClose: () => void;
}

export const ColorPickerView: React.FC<ColorPickerViewProps> = ({ onClose }) => {
  const [color, setColor] = useState('#ff0000');

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setColor(e.target.value);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(color);
    console.log('✓ Color copied:', color);
  };

  return (
    <div className="color-picker-view">
      <div className="header">
        <h2>Color Picker</h2>
        <button onClick={onClose} className="close-btn">✕</button>
      </div>

      <div className="picker-container">
        <div
          className="color-preview"
          style={{ backgroundColor: color }}
        />

        <input
          type="color"
          value={color}
          onChange={handleColorChange}
          className="color-input"
        />

        <div className="color-values">
          <div className="color-value">
            <span className="label">HEX:</span>
            <code>{color}</code>
          </div>
          {/* Autres formats... */}
        </div>

        <button onClick={handleCopy} className="copy-btn">
          Copy HEX
        </button>
      </div>
    </div>
  );
};
```

---

## Plugin hybride (Frontend + Backend)

Plugin utilisant du code Rust pour les opérations système lourdes.

### Backend (Rust)

```rust
// src-tauri/src/plugins/builtin/duplicate_finder/mod.rs

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;

pub struct DuplicateFinderPlugin {
    api: Arc<VoltPluginAPI>,
    cache: Arc<RwLock<HashMap<PathBuf, u64>>>,
}

impl DuplicateFinderPlugin {
    pub fn new(api: Arc<VoltPluginAPI>) -> Self {
        Self {
            api,
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Trouve les fichiers dupliqués dans un répertoire
    pub async fn find_duplicates(
        &self,
        directory: PathBuf,
    ) -> Result<Vec<DuplicateGroup>, String> {
        let mut file_hashes: HashMap<u64, Vec<PathBuf>> = HashMap::new();

        // Scanner le répertoire
        self.scan_directory(&directory, &mut file_hashes).await?;

        // Trouver les groupes de doublons
        let duplicates: Vec<DuplicateGroup> = file_hashes
            .into_iter()
            .filter(|(_, files)| files.len() > 1)
            .map(|(hash, files)| DuplicateGroup {
                hash,
                files,
                size: self.get_file_size(&files[0]).unwrap_or(0),
            })
            .collect();

        Ok(duplicates)
    }

    async fn scan_directory(
        &self,
        dir: &PathBuf,
        file_hashes: &mut HashMap<u64, Vec<PathBuf>>,
    ) -> Result<(), String> {
        let mut entries = fs::read_dir(dir)
            .await
            .map_err(|e| format!("Failed to read directory: {}", e))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("Failed to read entry: {}", e))?
        {
            let path = entry.path();

            if path.is_dir() {
                // Récursif
                self.scan_directory(&path, file_hashes).await?;
            } else if path.is_file() {
                // Calculer le hash du fichier
                let hash = self.hash_file(&path).await?;

                file_hashes
                    .entry(hash)
                    .or_insert_with(Vec::new)
                    .push(path);
            }
        }

        Ok(())
    }

    async fn hash_file(&self, path: &PathBuf) -> Result<u64, String> {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let contents = fs::read(path)
            .await
            .map_err(|e| format!("Failed to read file: {}", e))?;

        let mut hasher = DefaultHasher::new();
        contents.hash(&mut hasher);
        Ok(hasher.finish())
    }

    fn get_file_size(&self, path: &PathBuf) -> Result<u64, String> {
        std::fs::metadata(path)
            .map(|m| m.len())
            .map_err(|e| format!("Failed to get file size: {}", e))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub hash: u64,
    pub files: Vec<PathBuf>,
    pub size: u64,
}
```

```rust
// src-tauri/src/commands/duplicate_finder.rs

use crate::plugins::builtin::DuplicateFinderPlugin;
use tauri::State;

#[tauri::command]
pub async fn find_duplicate_files(
    plugin: State<'_, DuplicateFinderPlugin>,
    directory: String,
) -> Result<Vec<DuplicateGroup>, String> {
    let path = PathBuf::from(directory);
    plugin.find_duplicates(path).await
}

#[tauri::command]
pub async fn delete_duplicate_file(
    file_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(file_path);

    std::fs::remove_file(&path)
        .map_err(|e| format!("Failed to delete file: {}", e))?;

    Ok(())
}
```

### Frontend (TypeScript)

```typescript
// src/features/plugins/builtin/duplicate-finder/index.ts

import { invoke } from '@tauri-apps/api/core';
import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';

interface DuplicateGroup {
  hash: number;
  files: string[];
  size: number;
}

export class DuplicateFinderPlugin implements Plugin {
  id = 'duplicate-finder';
  name = 'Duplicate Finder';
  description = 'Find duplicate files';
  enabled = true;

  canHandle(context: PluginContext): boolean {
    return context.query.toLowerCase().startsWith('duplicates ');
  }

  async match(context: PluginContext): Promise<PluginResult[]> {
    const query = context.query.substring(11).trim();

    if (!query) {
      return [
        {
          id: 'dup-help',
          type: PluginResultType.Info,
          title: 'Find duplicate files',
          subtitle: 'Example: duplicates C:\\Users\\Documents',
          score: 50,
          data: {},
        },
      ];
    }

    try {
      // Appeler le backend Rust
      const duplicates = await invoke<DuplicateGroup[]>('find_duplicate_files', {
        directory: query,
      });

      if (duplicates.length === 0) {
        return [
          {
            id: 'dup-none',
            type: PluginResultType.Info,
            title: 'No duplicates found',
            subtitle: `in ${query}`,
            icon: '✅',
            score: 90,
            data: {},
          },
        ];
      }

      // Créer des résultats pour chaque groupe
      return duplicates.slice(0, 5).map((group, index) => ({
        id: `dup-${group.hash}`,
        type: PluginResultType.Info,
        title: `${group.files.length} duplicates`,
        subtitle: `${this.formatSize(group.size)} • ${this.getFileName(group.files[0])}`,
        icon: '📋',
        score: 95 - index,
        data: { group },
      }));
    } catch (error) {
      console.error('[DuplicateFinder] Error:', error);

      return [
        {
          id: 'dup-error',
          type: PluginResultType.Info,
          title: 'Failed to scan for duplicates',
          subtitle: error instanceof Error ? error.message : String(error),
          icon: '⚠️',
          score: 50,
          data: { error: true },
        },
      ];
    }
  }

  async execute(result: PluginResult): Promise<void> {
    const group = result.data?.group as DuplicateGroup;

    if (!group) return;

    // Ouvrir une vue pour gérer les doublons
    window.dispatchEvent(
      new CustomEvent('volt:show-duplicates', {
        detail: { group },
      })
    );
  }

  private formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  private getFileName(path: string): string {
    return path.split(/[\\/]/).pop() || path;
  }
}
```

---

## Plugin avec paramètres utilisateur

Plugin qui utilise des paramètres configurables par l'utilisateur.

```typescript
// src/features/plugins/builtin/translator/index.ts

import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';

interface TranslatorSettings {
  apiKey?: string;
  sourceLang?: string;
  targetLang?: string;
  autoDetect?: boolean;
}

export class TranslatorPlugin implements Plugin {
  id = 'translator';
  name = 'Translator';
  description = 'Translate text between languages';
  enabled = true;

  // Paramètres par défaut
  private defaultSettings: TranslatorSettings = {
    sourceLang: 'auto',
    targetLang: 'en',
    autoDetect: true,
  };

  canHandle(context: PluginContext): boolean {
    return context.query.toLowerCase().startsWith('translate ');
  }

  async match(context: PluginContext): Promise<PluginResult[]> {
    // Récupérer les paramètres
    const settings = {
      ...this.defaultSettings,
      ...(context.settings as TranslatorSettings),
    };

    // Vérifier la clé API
    if (!settings.apiKey) {
      return [
        {
          id: 'translator-setup',
          type: PluginResultType.Info,
          title: 'Translator - API key required',
          subtitle: 'Configure your API key in settings',
          icon: '⚙️',
          score: 50,
          data: { needsSetup: true },
        },
      ];
    }

    const query = context.query.substring(10).trim();

    if (!query) {
      return [
        {
          id: 'translator-help',
          type: PluginResultType.Info,
          title: 'Translator',
          subtitle: `Translating from ${settings.sourceLang} to ${settings.targetLang}`,
          score: 50,
          data: {},
        },
      ];
    }

    try {
      const translation = await this.translate(
        query,
        settings.sourceLang!,
        settings.targetLang!,
        settings.apiKey!
      );

      return [
        {
          id: 'translator-result',
          type: PluginResultType.Info,
          title: translation.text,
          subtitle: `${translation.sourceLang} → ${translation.targetLang}`,
          icon: '🌐',
          score: 95,
          data: { translation },
        },
      ];
    } catch (error) {
      return [
        {
          id: 'translator-error',
          type: PluginResultType.Info,
          title: 'Translation failed',
          subtitle: error instanceof Error ? error.message : 'Unknown error',
          icon: '⚠️',
          score: 50,
          data: { error: true },
        },
      ];
    }
  }

  async execute(result: PluginResult): Promise<void> {
    if (result.data?.needsSetup) {
      // Ouvrir les paramètres
      window.dispatchEvent(
        new CustomEvent('volt:open-settings', {
          detail: { section: 'plugins', plugin: this.id },
        })
      );
      return;
    }

    if (result.data?.translation) {
      const text = result.data.translation.text as string;
      await navigator.clipboard.writeText(text);
      console.log('✓ Translation copied');
    }
  }

  private async translate(
    text: string,
    source: string,
    target: string,
    apiKey: string
  ): Promise<TranslationResult> {
    // Appel API (exemple avec Google Translate API)
    const response = await fetch('https://translation.googleapis.com/language/translate/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: text,
        source: source === 'auto' ? undefined : source,
        target,
        key: apiKey,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const translation = data.data.translations[0];

    return {
      text: translation.translatedText,
      sourceLang: translation.detectedSourceLanguage || source,
      targetLang: target,
    };
  }
}

interface TranslationResult {
  text: string;
  sourceLang: string;
  targetLang: string;
}
```

---

## Plugin avec historique

Plugin qui maintient un historique des recherches/actions.

```typescript
// src/features/plugins/builtin/snippets/index.ts

import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';

interface Snippet {
  id: string;
  title: string;
  content: string;
  tags: string[];
  usageCount: number;
  lastUsed: number;
}

export class SnippetsPlugin implements Plugin {
  id = 'snippets';
  name = 'Snippets';
  description = 'Quick text snippets';
  enabled = true;

  private snippets: Snippet[] = [];
  private storageKey = 'volt-snippets';

  constructor() {
    this.loadSnippets();
  }

  canHandle(context: PluginContext): boolean {
    return context.query.toLowerCase().startsWith('snippet ');
  }

  match(context: PluginContext): PluginResult[] {
    const query = context.query.substring(8).trim().toLowerCase();

    if (!query) {
      // Afficher les snippets les plus utilisés
      return this.getTopSnippets();
    }

    // Rechercher dans les snippets
    const filtered = this.searchSnippets(query);

    return filtered.map((snippet, index) => ({
      id: `snippet-${snippet.id}`,
      type: PluginResultType.Info,
      title: snippet.title,
      subtitle: this.truncate(snippet.content, 60),
      badge: `Used ${snippet.usageCount}x`,
      score: 95 - index,
      data: { snippet },
    }));
  }

  async execute(result: PluginResult): Promise<void> {
    const snippet = result.data?.snippet as Snippet;

    if (!snippet) return;

    // Copier le contenu
    await navigator.clipboard.writeText(snippet.content);
    console.log('✓ Snippet copied:', snippet.title);

    // Mettre à jour l'historique
    this.recordUsage(snippet.id);
  }

  // Charger les snippets depuis le localStorage
  private loadSnippets(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        this.snippets = JSON.parse(stored);
      } else {
        // Snippets par défaut
        this.snippets = this.getDefaultSnippets();
        this.saveSnippets();
      }
    } catch (error) {
      console.error('[Snippets] Failed to load snippets:', error);
      this.snippets = this.getDefaultSnippets();
    }
  }

  // Sauvegarder les snippets
  private saveSnippets(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.snippets));
    } catch (error) {
      console.error('[Snippets] Failed to save snippets:', error);
    }
  }

  // Enregistrer l'utilisation
  private recordUsage(snippetId: string): void {
    const snippet = this.snippets.find((s) => s.id === snippetId);

    if (snippet) {
      snippet.usageCount++;
      snippet.lastUsed = Date.now();
      this.saveSnippets();
    }
  }

  // Rechercher dans les snippets
  private searchSnippets(query: string): Snippet[] {
    return this.snippets
      .filter((snippet) => {
        const titleMatch = snippet.title.toLowerCase().includes(query);
        const contentMatch = snippet.content.toLowerCase().includes(query);
        const tagMatch = snippet.tags.some((tag) => tag.toLowerCase().includes(query));

        return titleMatch || contentMatch || tagMatch;
      })
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 8);
  }

  // Top snippets les plus utilisés
  private getTopSnippets(): PluginResult[] {
    const top = [...this.snippets].sort((a, b) => b.usageCount - a.usageCount).slice(0, 8);

    return top.map((snippet, index) => ({
      id: `snippet-top-${snippet.id}`,
      type: PluginResultType.Info,
      title: snippet.title,
      subtitle: this.truncate(snippet.content, 60),
      badge: `${snippet.usageCount}x`,
      score: 90 - index,
      data: { snippet },
    }));
  }

  // Snippets par défaut
  private getDefaultSnippets(): Snippet[] {
    return [
      {
        id: '1',
        title: 'Email Signature',
        content: 'Best regards,\nJohn Doe\njohn@example.com',
        tags: ['email'],
        usageCount: 0,
        lastUsed: 0,
      },
      {
        id: '2',
        title: 'Lorem Ipsum',
        content: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
        tags: ['text', 'placeholder'],
        usageCount: 0,
        lastUsed: 0,
      },
    ];
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
}
```

---

## Plugin multi-sources

Plugin qui agrège des résultats de plusieurs sources.

```typescript
// src/features/plugins/builtin/unified-search/index.ts

import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';

interface SearchSource {
  name: string;
  icon: string;
  search: (query: string) => Promise<SourceResult[]>;
}

interface SourceResult {
  title: string;
  url: string;
  description?: string;
}

export class UnifiedSearchPlugin implements Plugin {
  id = 'unified-search';
  name = 'Unified Search';
  description = 'Search across multiple platforms';
  enabled = true;

  private sources: SearchSource[] = [
    {
      name: 'Google',
      icon: '🔍',
      search: (q) => this.searchGoogle(q),
    },
    {
      name: 'YouTube',
      icon: '▶️',
      search: (q) => this.searchYouTube(q),
    },
    {
      name: 'GitHub',
      icon: '🐙',
      search: (q) => this.searchGitHub(q),
    },
    {
      name: 'Stack Overflow',
      icon: '📚',
      search: (q) => this.searchStackOverflow(q),
    },
  ];

  canHandle(context: PluginContext): boolean {
    return context.query.toLowerCase().startsWith('find ');
  }

  async match(context: PluginContext): Promise<PluginResult[]> {
    const query = context.query.substring(5).trim();

    if (!query) {
      return [
        {
          id: 'unified-help',
          type: PluginResultType.Info,
          title: 'Unified Search',
          subtitle: 'Search across Google, YouTube, GitHub, and more',
          score: 50,
          data: {},
        },
      ];
    }

    try {
      // Rechercher dans toutes les sources en parallèle
      const searchPromises = this.sources.map(async (source) => {
        try {
          const results = await source.search(query);
          return results.map((r) => ({ source, result: r }));
        } catch (error) {
          console.warn(`[UnifiedSearch] ${source.name} failed:`, error);
          return [];
        }
      });

      const allResults = await Promise.all(searchPromises);
      const flatResults = allResults.flat();

      // Limiter à 8 résultats (2 par source max)
      const grouped = this.groupBySource(flatResults);
      const limited = this.limitPerSource(grouped, 2);

      return limited.map((item, index) => ({
        id: `unified-${item.source.name}-${index}`,
        type: PluginResultType.Info,
        title: item.result.title,
        subtitle: item.source.name,
        icon: item.source.icon,
        score: 90 - index,
        data: {
          url: item.result.url,
          source: item.source.name,
        },
      }));
    } catch (error) {
      console.error('[UnifiedSearch] Error:', error);
      return [];
    }
  }

  async execute(result: PluginResult): Promise<void> {
    const url = result.data?.url as string;
    if (url) {
      window.open(url, '_blank');
    }
  }

  // Recherche Google (simplifié)
  private async searchGoogle(query: string): Promise<SourceResult[]> {
    // Dans un vrai plugin, utilisez l'API Google Custom Search
    return [
      {
        title: `Google search: ${query}`,
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      },
    ];
  }

  // Recherche YouTube
  private async searchYouTube(query: string): Promise<SourceResult[]> {
    // API YouTube (exemple simplifié)
    return [
      {
        title: `YouTube search: ${query}`,
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      },
    ];
  }

  // Recherche GitHub
  private async searchGitHub(query: string): Promise<SourceResult[]> {
    try {
      const response = await fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=2`
      );

      if (!response.ok) return [];

      const data = await response.json();

      return data.items.map((item: any) => ({
        title: item.full_name,
        url: item.html_url,
        description: item.description,
      }));
    } catch {
      return [];
    }
  }

  // Recherche Stack Overflow
  private async searchStackOverflow(query: string): Promise<SourceResult[]> {
    try {
      const response = await fetch(
        `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow`
      );

      if (!response.ok) return [];

      const data = await response.json();

      return data.items.slice(0, 2).map((item: any) => ({
        title: item.title,
        url: item.link,
      }));
    } catch {
      return [];
    }
  }

  // Grouper par source
  private groupBySource(results: Array<{ source: SearchSource; result: SourceResult }>) {
    const groups = new Map<string, typeof results>();

    for (const item of results) {
      const key = item.source.name;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(item);
    }

    return groups;
  }

  // Limiter le nombre de résultats par source
  private limitPerSource(
    groups: Map<string, Array<{ source: SearchSource; result: SourceResult }>>,
    limit: number
  ) {
    const limited: Array<{ source: SearchSource; result: SourceResult }> = [];

    for (const items of groups.values()) {
      limited.push(...items.slice(0, limit));
    }

    return limited;
  }
}
```

---

Ces exemples montrent des patterns avancés pour créer des plugins robustes et performants. Adaptez-les selon vos besoins !
