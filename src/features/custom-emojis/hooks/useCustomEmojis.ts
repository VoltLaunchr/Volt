import { useCallback, useEffect, useState } from 'react';
import { customEmojisService } from '../service';
import type { CustomEmoji } from '../types';

export function useCustomEmojis() {
  const [emojis, setEmojis] = useState<CustomEmoji[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, tokenPresent] = await Promise.all([
        customEmojisService.list(),
        customEmojisService.hasToken(),
      ]);
      setEmojis(list);
      setHasToken(tokenPresent);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const generate = useCallback(async (prompt: string): Promise<CustomEmoji | null> => {
    if (!prompt.trim() || generating) return null;
    setGenerating(true);
    setError(null);
    try {
      const created = await customEmojisService.generate(prompt.trim());
      setEmojis((prev) => [created, ...prev]);
      return created;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setGenerating(false);
    }
  }, [generating]);

  const remove = useCallback(async (id: string) => {
    try {
      await customEmojisService.remove(id);
      setEmojis((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  return { emojis, loading, generating, hasToken, error, generate, remove, refresh };
}
