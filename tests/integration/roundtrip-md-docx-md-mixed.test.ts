import { describe, expect, it } from 'vitest';
import {
  assertSemanticMarkdownRoundtrip,
  createRoundtripFixtures,
  expectedForFeature,
  runMarkdownToDocxToMarkdown,
} from './helpers/roundtripHarness.js';

describe('Roundtrip mixed: markdown -> docx -> markdown', () => {
  it('preserves all supported features together', async () => {
    const fixture = createRoundtripFixtures().find((item) => item.name === 'mixed');
    if (!fixture) {
      throw new Error('Missing mixed fixture');
    }

    const result = await runMarkdownToDocxToMarkdown(fixture);
    const errors = assertSemanticMarkdownRoundtrip(result.finalMarkdown, expectedForFeature(fixture));
    expect(errors).toEqual([]);
  });
});

