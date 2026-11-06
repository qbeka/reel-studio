import type { SceneEntry } from '../core/registry';

/**
 * The scenes compiled into this build. To add one, write its adapter, add one entry here
 * and import its stylesheet in src/styles/scenes.css.
 */
export const SCENES: readonly SceneEntry[] = [
  {
    id: 'receipt-split',
    version: 1,
    title: 'Receipt split',
    load: () => import('./receipt/adapter').then((m) => m.receiptAdapter),
  },
];
