/**
 * A custom emoji generated via Replicate's `fofr/sdxl-emoji` LoRA.
 * Mirrors the Rust struct (camelCase via serde rename_all).
 */
export interface CustomEmoji {
  id: string;
  prompt: string;
  /** Absolute file path on disk; pass through `convertFileSrc()` for `<img src>`. */
  path: string;
  createdAt: string;
}
