import { describe, it, expect } from 'vitest';
import { OoxmlEquationParser } from '../../src/docx/OoxmlEquationParser.js';

describe('OoxmlEquationParser', () => {
  it('parses fraction OMML to latex', () => {
    const parser = new OoxmlEquationParser();
    const parsed = parser.parseInline({
      'm:f': {
        'm:num': { 'm:r': { 'm:t': 'a+b' } },
        'm:den': { 'm:r': { 'm:t': 'c+d' } },
      },
    });

    expect(parsed.latex).toContain('\\frac{a+b}{c+d}');
    expect(parsed.warning).toBeUndefined();
  });

  it('falls back to plain text with warning', () => {
    const parser = new OoxmlEquationParser();
    const parsed = parser.parseInline({
      'm:r': { 'm:t': 'x+y' },
    });

    expect(parsed.latex).toBe('x+y');
    expect(parsed.warning).toContain('plain text fallback');
  });
});

