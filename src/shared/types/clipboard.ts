/**
 * Clipboard item types
 */
export type ClipboardType = 'text' | 'image' | 'files';

/**
 * Clipboard history item
 */
export interface ClipboardItem {
  id: number;
  contentType: ClipboardType;
  content: string; // Text content or base64 for images
  preview: string; // Short preview for display
  timestamp: number; // Unix timestamp
  pinned: boolean;
  contentHash: string; // MD5 hash for deduplication
  source?: string; // Source application (if available)
  wordCount?: number; // Word count for text
  charCount?: number; // Character count for text
  imageWidth?: number; // Image width in pixels
  imageHeight?: number; // Image height in pixels
  fileSize?: number; // File size in bytes
}

/**
 * Clipboard item with formatted date
 */
export interface ClipboardItemWithDate extends ClipboardItem {
  formattedDate: string;
  relativeTime: string;
}

/**
 * Grouped clipboard items by date
 */
export interface ClipboardGroup {
  date: string;
  items: ClipboardItemWithDate[];
}
