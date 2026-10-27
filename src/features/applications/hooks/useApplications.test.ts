import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useApplications } from './useApplications';

const { scan, invoke } = vi.hoisted(() => ({ scan: vi.fn(), invoke: vi.fn() }));
vi.mock('../services/applicationService', () => ({
  applicationService: { scanApplications: scan },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('application startup', () => {
  it('publishes the catalog without hydrating every native icon', async () => {
    const apps = Array.from({ length: 302 }, (_, id) => ({
      id: String(id),
      name: `App ${id}`,
      path: `${id}.exe`,
    }));
    scan.mockResolvedValueOnce(apps);
    const { result } = renderHook(() => useApplications());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.apps).toEqual(apps);
    expect(result.current.scanStatus.appsFound).toBe(302);
    expect(invoke).not.toHaveBeenCalled();
  });
});
