/**
 * useTier — lightweight hook for checking user tier / feature gating.
 */

import { useCallback } from 'react';
import { useAuth } from './useAuth';
import { TIER_HIERARCHY, type UserTier } from '../types';

export interface UseTierReturn {
  tier: UserTier;
  hasMinTier: (minTier: UserTier) => boolean;
}

export function useTier(): UseTierReturn {
  const { tier } = useAuth();

  const hasMinTier = useCallback(
    (minTier: UserTier): boolean => {
      const currentIndex = TIER_HIERARCHY.indexOf(tier);
      const requiredIndex = TIER_HIERARCHY.indexOf(minTier);
      return currentIndex >= requiredIndex;
    },
    [tier]
  );

  return { tier, hasMinTier };
}
