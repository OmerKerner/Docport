import { describe, expect, it } from 'vitest';
import {
  assertSemanticDocxRoundtrip,
  createRoundtripFixtures,
  runDocxToMarkdownToDocx,
} from './helpers/roundtripHarness.js';

describe('Roundtrip per-feature: docx -> markdown -> docx', () => {
  const fixtures = createRoundtripFixtures().filter((fixture) => fixture.name !== 'mixed');

  for (const fixture of fixtures) {
    it(`preserves ${fixture.name}`, async () => {
      const result = await runDocxToMarkdownToDocx(fixture);
      const errors = assertSemanticDocxRoundtrip(result);
      expect(errors).toEqual([]);
    });
  }
});

