import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vendor chunks change far less often than game code, so they cache across deploys.
// Rolldown's `codeSplitting.groups` replaces Rollup's deprecated `manualChunks`.
// pnpm nests packages, so match the path after the last `node_modules/`.
const pkg = (names: string) =>
  new RegExp(`node_modules[\\\\/](${names})[\\\\/][^\\\\/]*?(?!.*node_modules)`);
// Groups also capture their dependencies, so higher-priority (earlier) groups claim
// shared packages first; postprocessing comes last to stay a lazy, standalone chunk.
const VENDOR_GROUPS: [name: string, test: RegExp][] = [
  ['three', pkg('three')],
  ['react', pkg('react|react-dom|scheduler|use-sync-external-store|zustand')],
  [
    'r3f',
    pkg(
      '@react-three[\\\\/](?:fiber|drei)|three-stdlib|maath|camera-controls|its-fine|suspend-react|react-use-measure',
    ),
  ],
  ['postprocessing', pkg('postprocessing|@react-three[\\\\/]postprocessing|n8ao')],
];

export default defineConfig({
  plugins: [react()],
  base: '/asteroid-fleet/',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: VENDOR_GROUPS.map(([name, test], i) => ({
            name,
            test,
            priority: VENDOR_GROUPS.length - i,
          })),
        },
      },
    },
  },
});
