import { useCallback, useEffect, useState } from 'react';
import { aiQuickActionsService } from '../service';
import type { AiQuickAction, AiQuickActionsReport } from '../types';

export function useQuickActions() {
  const [actions, setActions] = useState<AiQuickAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<AiQuickActionsReport>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await aiQuickActionsService.list();
      setActions(list);
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

  const save = useCallback(
    async (next: AiQuickAction[]) => {
      try {
        await aiQuickActionsService.save(next);
        setActions(next);
        // After save, fetch fresh report on bind success/failure
        const newReport = await aiQuickActionsService.applyAll();
        setReport(newReport);
        setError(null);
      } catch (e) {
        setError(String(e));
        throw e;
      }
    },
    []
  );

  const updateAction = useCallback(
    async (id: string, patch: Partial<AiQuickAction>) => {
      const next = actions.map((a) => (a.id === id ? { ...a, ...patch } : a));
      await save(next);
    },
    [actions, save]
  );

  const createAction = useCallback(
    async (action: Omit<AiQuickAction, 'id'> & { id?: string }) => {
      const id = action.id ?? `custom-${Date.now()}`;
      const next: AiQuickAction[] = [...actions, { ...action, id }];
      await save(next);
      return id;
    },
    [actions, save]
  );

  const deleteAction = useCallback(
    async (id: string) => {
      const next = actions.filter((a) => a.id !== id);
      await save(next);
    },
    [actions, save]
  );

  return { actions, loading, report, error, refresh, updateAction, createAction, deleteAction };
}
