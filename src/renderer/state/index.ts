import { useSyncExternalStore } from 'react';
import { demoStore } from './store';

export * from './types';
export * from './store';
export { getFixtures } from './fixtures';

export function useDemoStore() {
  return useSyncExternalStore(demoStore.subscribe, demoStore.getSnapshot, demoStore.getSnapshot);
}
