import { describe, expect, it } from 'vitest';
import {
  assertSemanticMarkdownRoundtrip,
  createRoundtripFixtures,
  expectedForFeature,
  runMarkdownToDocxToMarkdown,
} from './helpers/roundtripHarness.js';

describe('Roundtrip per-feature: markdown -> docx -> markdown', () => {
  const fixtures = createRoundtripFixtures().filter((fixture) => fixture.name !== 'mixed');

  for (const fixture of fixtures) {
    it(`preserves ${fixture.name}`, async () => {
      const result = await runMarkdownToDocxToMarkdown(fixture);
      const errors = assertSemanticMarkdownRoundtrip(result.finalMarkdown, expectedForFeature(fixture));
      expect(errors).toEqual([]);
    });
  }
});

