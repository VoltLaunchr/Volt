import { useCallback, useState } from 'react';
import { logger } from '../../../shared/utils/logger';
import {
  checkForUpdate,
  clearPendingUpdate,
  deferredInstall,
  downloadAndInstall,
  hasPendingUpdate,
  skipVersion,
  snoozeUpdate,
  type UpdateChannel,
  type UpdateInfo,
} from '../services/updateService';

export interface UpdateController {
  info: UpdateInfo | null;
  isChecking: boolean;
  isUpdating: boolean;
  isDeferring: boolean;
  /** A downloaded update waits for the next restart. */
  deferralReady: boolean;
  progress: number;
  /** A check finished since the page was opened (or since the last snooze/skip). */
  checked: boolean;
  error: string | null;
  check: () => Promise<void>;
  snooze: () => void;
  skip: () => void;
  installOnRestart: () => Promise<void>;
  cancelDeferral: () => void;
  installNow: () => Promise<void>;
}

/** Update flow of the About page; `info` also drives the sidebar badge. */
export function useUpdateController(channel: UpdateChannel): UpdateController {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeferring, setIsDeferring] = useState(false);
  const [deferralReady, setDeferralReady] = useState(() => hasPendingUpdate());
  const [progress, setProgress] = useState(0);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setIsChecking(true);
    setError(null);
    setInfo(null);
    try {
      setInfo(await checkForUpdate(channel));
      setChecked(true);
    } catch (checkError) {
      logger.error('Failed to check for updates:', checkError);
      setError(checkError instanceof Error ? checkError.message : 'Failed to check for updates');
    } finally {
      setIsChecking(false);
    }
  }, [channel]);

  const snooze = useCallback(() => {
    snoozeUpdate();
    setInfo(null);
    setChecked(false);
  }, []);

  const skip = useCallback(() => {
    if (info) skipVersion(info.version);
    setInfo(null);
    setChecked(false);
  }, [info]);

  const installOnRestart = useCallback(async () => {
    setIsDeferring(true);
    setProgress(0);
    setError(null);
    try {
      await deferredInstall((step) => setProgress(step.percentage));
      setDeferralReady(true);
      setInfo(null);
    } catch (deferError) {
      logger.error('Failed to defer install:', deferError);
      setError(deferError instanceof Error ? deferError.message : 'Failed to download update');
    } finally {
      setIsDeferring(false);
    }
  }, []);

  const cancelDeferral = useCallback(() => {
    clearPendingUpdate();
    setDeferralReady(false);
  }, []);

  const installNow = useCallback(async () => {
    setIsUpdating(true);
    setProgress(0);
    setError(null);
    try {
      await downloadAndInstall((step) => setProgress(step.percentage));
    } catch (installError) {
      logger.error('Failed to download/install update:', installError);
      setError(installError instanceof Error ? installError.message : 'Failed to install update');
      setIsUpdating(false);
    }
  }, []);

  return {
    info,
    isChecking,
    isUpdating,
    isDeferring,
    deferralReady,
    progress,
    checked,
    error,
    check,
    snooze,
    skip,
    installOnRestart,
    cancelDeferral,
    installNow,
  };
}
