import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveEnabledProviderIds } from '../provider-availability.js';

test('an unset provider allow-list preserves every provider', () => {
  assert.deepEqual(
    [...resolveEnabledProviderIds(undefined)],
    ['claude', 'codex', 'cursor', 'opencode', 'zcode', 'antigravity'],
  );
});

test('the provider allow-list accepts a normalized Antigravity-only deployment', () => {
  assert.deepEqual([...resolveEnabledProviderIds(' Antigravity, antigravity ')], ['antigravity']);
});

test('the provider allow-list rejects unknown provider ids', () => {
  assert.throws(
    () => resolveEnabledProviderIds('antigravity,unknown'),
    /Unknown provider\(s\).*unknown/,
  );
});
