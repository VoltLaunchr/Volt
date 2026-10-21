import { check } from '@tauri-apps/plugin-updater';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PACKAGE_MANAGER_UPDATE_MESSAGE,
  checkForUpdate,
  checkUpdateThrottled,
  deferredInstall,
  downloadAndInstall,
  hasPendingUpdate,
  installPendingUpdate,
  isPackageManagerManaged,
  startPeriodicCheck,
  stopPeriodicCheck,
} from './updateService';

vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));
vi.mock('../../../shared/utils/logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe('package-manager-managed update mode', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    localStorage.clear();
    stopPeriodicCheck();
  });

  it('does not check, download, install, or retain pending updater state', async () => {
    vi.stubEnv('VITE_VOLT_PACKAGE_MANAGER', '1');
    localStorage.setItem('volt:pendingUpdateVersion', '9.9.9');

    expect(isPackageManagerManaged()).toBe(true);
    await expect(checkForUpdate()).resolves.toBeNull();
    await expect(checkUpdateThrottled()).resolves.toBeNull();
    await expect(downloadAndInstall()).rejects.toThrow(PACKAGE_MANAGER_UPDATE_MESSAGE);
    await expect(deferredInstall()).rejects.toThrow(PACKAGE_MANAGER_UPDATE_MESSAGE);
    await expect(installPendingUpdate()).rejects.toThrow(PACKAGE_MANAGER_UPDATE_MESSAGE);
    expect(hasPendingUpdate()).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('does not create a periodic updater timer', () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_VOLT_PACKAGE_MANAGER', '1');
    const onUpdate = vi.fn();

    startPeriodicCheck(onUpdate);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);

    expect(check).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('keeps the updater enabled for regular upstream bundles', async () => {
    vi.stubEnv('VITE_VOLT_PACKAGE_MANAGER', '0');
    vi.mocked(check).mockResolvedValue(null);

    expect(isPackageManagerManaged()).toBe(false);
    await expect(checkForUpdate()).resolves.toBeNull();
    expect(check).toHaveBeenCalledOnce();
  });
});
