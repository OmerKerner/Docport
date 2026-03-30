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

  it('parses n-ary sum and integral operators with limits', () => {
    const parser = new OoxmlEquationParser();
    const sumParsed = parser.parseInline({
      'm:nary': {
        'm:naryPr': { 'm:chr': { '@_m:val': '∑' } },
        'm:sub': { 'm:r': { 'm:t': 'i=1' } },
        'm:sup': { 'm:r': { 'm:t': 'n' } },
        'm:e': { 'm:r': { 'm:t': 'i^2' } },
      },
    });

    const intParsed = parser.parseInline({
      'm:nary': {
        'm:naryPr': { 'm:chr': { '@_m:val': '∫' } },
        'm:sub': { 'm:r': { 'm:t': '0' } },
        'm:sup': { 'm:r': { 'm:t': '\\infty' } },
        'm:e': { 'm:r': { 'm:t': 'e^{-x} dx' } },
      },
    });

    expect(sumParsed.latex).toContain('\\sum_{i=1}^{n} i^2');
    expect(intParsed.latex).toContain('\\int_{0}^{\\infty} e^{-x} dx');
  });

  it('parses superscript, subscript, and radicals', () => {
    const parser = new OoxmlEquationParser();
    const parsed = parser.parseInline({
      'm:sSup': {
        'm:e': { 'm:r': { 'm:t': 'x' } },
        'm:sup': { 'm:r': { 'm:t': '2' } },
      },
      'm:sSub': {
        'm:e': { 'm:r': { 'm:t': '\\Gamma' } },
        'm:sub': { 'm:r': { 'm:t': 'ij' } },
      },
      'm:rad': {
        'm:deg': { 'm:r': { 'm:t': '3' } },
        'm:e': { 'm:r': { 'm:t': 'x+y' } },
      },
    });

    expect(parsed.latex).toContain('x^{2}');
    expect(parsed.latex).toContain('\\Gamma_{ij}');
    expect(parsed.latex).toContain('\\sqrt[3]{x+y}');
  });
});

