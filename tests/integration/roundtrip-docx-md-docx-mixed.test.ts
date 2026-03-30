import { describe, expect, it } from 'vitest';
import {
  assertSemanticDocxRoundtrip,
  createRoundtripFixtures,
  runDocxToMarkdownToDocx,
} from './helpers/roundtripHarness.js';

describe('Roundtrip mixed: docx -> markdown -> docx', () => {
  it('preserves all supported features together', async () => {
    const fixture = createRoundtripFixtures().find((item) => item.name === 'mixed');
    if (!fixture) {
      throw new Error('Missing mixed fixture');
    }

    const result = await runDocxToMarkdownToDocx(fixture);
    const errors = assertSemanticDocxRoundtrip(result);
    expect(errors).toEqual([]);
  });
});

