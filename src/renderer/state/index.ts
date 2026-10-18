import { useMemo, useSyncExternalStore } from 'react';
import { demoStore } from './store';

import { isDesktop, runtimeClient } from '../runtime/client';
import { projectWorks } from '../runtime/projection';
export * from './types';
export * from './store';
export { getFixtures } from './fixtures';

export function useDemoStore() {
  const demo = useSyncExternalStore(
    demoStore.subscribe,
    demoStore.getSnapshot,
    demoStore.getSnapshot,
  );
  const runtime = useSyncExternalStore(
    runtimeClient.subscribe,
    runtimeClient.getSnapshot,
    runtimeClient.getSnapshot,
  );
  return useMemo(
    () => (isDesktop() ? { works: projectWorks(runtime), language: demo.language } : demo),
    [demo, runtime],
  );
}
