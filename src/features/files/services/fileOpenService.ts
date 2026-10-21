import { invoke } from '@tauri-apps/api/core';

interface FileOpenTarget {
  path: string;
  name: string;
}

export async function openFilePath(file: FileOpenTarget): Promise<void> {
  await invoke<void>('open_path', { path: file.path });
  await invoke<void>('track_file_access', { path: file.path, name: file.name });
}

export async function openPath(path: string): Promise<void> {
  await invoke<void>('open_path', { path });
}
