/**
 * A custom emoji generated via the provider chain wired up in
 * `commands/custom_emojis.rs`: HuggingFace `black-forest-labs/FLUX.1-schnell`,
 * Replicate `fofr/sdxl-emoji`, or Pollinations.ai as a free fallback.
 * Mirrors the Rust struct (camelCase via serde rename_all).
 */
export interface CustomEmoji {
  id: string;
  prompt: string;
  /** Absolute file path on disk; pass through `convertFileSrc()` for `<img src>`. */
  path: string;
  createdAt: string;
}
