import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tauri-apps/api/core BEFORE importing the service so the imported
// `invoke` is the mock and we can inspect calls.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { applicationService } from './applicationService';

describe('applicationService.launchApplication', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('calls launch_application with asAdmin=false by default', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    const result = await applicationService.launchApplication('C:\\app.exe');
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith('launch_application', {
      path: 'C:\\app.exe',
      asAdmin: false,
    });
  });

  it('forwards asAdmin=true to the backend (Shift+Enter path)', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    const result = await applicationService.launchApplication('C:\\app.exe', true);
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith('launch_application', {
      path: 'C:\\app.exe',
      asAdmin: true,
    });
  });

  it('reports failure with the backend error message', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('not found'));
    const result = await applicationService.launchApplication('C:\\missing.exe');
    expect(result.success).toBe(false);
    expect(result.error).toBe('not found');
  });
});
