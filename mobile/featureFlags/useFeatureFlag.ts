import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { SettingTypeOf } from '@configcat/sdk/browser';

import { getFeatureFlag, type FeatureFlagValue } from './client';

/** Evaluate on mount, input changes, and foregrounding. Defaults render immediately. */
export function useFeatureFlag<T extends FeatureFlagValue>(
  key: string,
  defaultValue: T,
  userId?: string,
): { value: SettingTypeOf<T>; loading: boolean } {
  const [result, setResult] = useState<{
    key: string;
    defaultValue: T;
    userId?: string;
    value: SettingTypeOf<T>;
  } | null>(null);

  useEffect(() => {
    let active = true;
    let request = 0;
    const evaluate = async () => {
      const currentRequest = ++request;
      const value = await getFeatureFlag(key, defaultValue, userId);
      if (active && currentRequest === request) {
        setResult({ key, defaultValue, userId, value });
      }
    };

    void evaluate();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void evaluate();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [key, defaultValue, userId]);

  // Never display another account's flag while a new evaluation is pending.
  const current = result?.key === key
    && result.defaultValue === defaultValue && result.userId === userId;
  return {
    value: current ? result.value : defaultValue as SettingTypeOf<T>,
    loading: !current,
  };
}
