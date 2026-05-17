import { useCallback, useEffect, useState } from 'react';
import { aiProfileService } from '../service';

interface UseAiProfileReturn {
  profile: string;
  updatedAt: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  save: (text: string) => Promise<void>;
}

export function useAiProfile(): UseAiProfileReturn {
  const [profile, setProfile] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await aiProfileService.get();
        if (cancelled) return;
        setProfile(result.profile);
        setUpdatedAt(result.updatedAt);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (text: string) => {
    setSaving(true);
    try {
      await aiProfileService.set(text);
      // Re-read from disk so the timestamp stays the source of truth.
      const fresh = await aiProfileService.get();
      setProfile(fresh.profile);
      setUpdatedAt(fresh.updatedAt);
      setError(null);
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }, []);

  return { profile, updatedAt, loading, saving, error, save };
}
