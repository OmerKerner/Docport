export interface ParsedOoxmlEquation {
  latex: string;
  kind: 'inline' | 'block';
  warning?: string;
}

function collectRunText(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return '';
  }

  if (Array.isArray(node)) {
    return node.map((part) => collectRunText(part)).join('');
  }

  const record = node as Record<string, unknown>;
  const text = record['m:t'];
  if (typeof text === 'string') {
    return text;
  }
  if (text && typeof text === 'object' && '#text' in text) {
    const value = (text as Record<string, unknown>)['#text'];
    return typeof value === 'string' ? value : '';
  }

  let combined = '';
  for (const key of Object.keys(record)) {
    combined += collectRunText(record[key]);
  }
  return combined;
}

function ensureArray(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function extractNaryOperator(naryPr: unknown): string {
  if (!naryPr || typeof naryPr !== 'object') {
    return '';
  }
  const record = naryPr as Record<string, unknown>;
  const chr = record['m:chr'];
  if (chr && typeof chr === 'object') {
    const val = (chr as Record<string, unknown>)['@_m:val'];
    if (typeof val === 'string') {
      return val;
    }
  }
  return collectRunText(naryPr);
}

export class OoxmlEquationParser {
  parseInline(oMath: Record<string, unknown>): ParsedOoxmlEquation {
    return this.parseFromContainer(oMath, 'inline');
  }

  parseBlock(oMathPara: Record<string, unknown>): ParsedOoxmlEquation {
    const innerMath = oMathPara['m:oMath'];
    if (innerMath && typeof innerMath === 'object' && !Array.isArray(innerMath)) {
      return this.parseFromContainer(innerMath as Record<string, unknown>, 'block');
    }
    if (Array.isArray(innerMath) && innerMath[0] && typeof innerMath[0] === 'object') {
      return this.parseFromContainer(innerMath[0] as Record<string, unknown>, 'block');
    }
    return {
      kind: 'block',
      latex: '',
      warning: 'Equation block did not contain parseable m:oMath payload',
    };
  }

  private parseFromContainer(container: Record<string, unknown>, kind: 'inline' | 'block'): ParsedOoxmlEquation {
    const parts: string[] = [];
    const warnings: string[] = [];

    const fractions = ensureArray(container['m:f']);
    for (const fractionNode of fractions) {
      if (!fractionNode || typeof fractionNode !== 'object') {
        continue;
      }
      const frac = fractionNode as Record<string, unknown>;
      const numerator = collectRunText(frac['m:num']);
      const denominator = collectRunText(frac['m:den']);
      if (numerator || denominator) {
        parts.push(`\\frac{${numerator}}{${denominator}}`);
      }
    }

    const supers = ensureArray(container['m:sSup']);
    for (const supNode of supers) {
      if (!supNode || typeof supNode !== 'object') {
        continue;
      }
      const sup = supNode as Record<string, unknown>;
      const base = collectRunText(sup['m:e']);
      const power = collectRunText(sup['m:sup']);
      if (base || power) {
        parts.push(`${base}^{${power}}`);
      }
    }

    const subs = ensureArray(container['m:sSub']);
    for (const subNode of subs) {
      if (!subNode || typeof subNode !== 'object') {
        continue;
      }
      const sub = subNode as Record<string, unknown>;
      const base = collectRunText(sub['m:e']);
      const index = collectRunText(sub['m:sub']);
      if (base || index) {
        parts.push(`${base}_{${index}}`);
      }
    }

    const radicals = ensureArray(container['m:rad']);
    for (const radNode of radicals) {
      if (!radNode || typeof radNode !== 'object') {
        continue;
      }
      const rad = radNode as Record<string, unknown>;
      const degree = collectRunText(rad['m:deg']);
      const body = collectRunText(rad['m:e']);
      if (degree.length > 0) {
        parts.push(`\\sqrt[${degree}]{${body}}`);
      } else {
        parts.push(`\\sqrt{${body}}`);
      }
    }

    const nary = ensureArray(container['m:nary']);
    for (const naryNode of nary) {
      if (!naryNode || typeof naryNode !== 'object') {
        continue;
      }
      const naryRecord = naryNode as Record<string, unknown>;
      const op = extractNaryOperator(naryRecord['m:naryPr']);
      const base = collectRunText(naryRecord['m:e']);
      const sub = collectRunText(naryRecord['m:sub']);
      const sup = collectRunText(naryRecord['m:sup']);
      if (op.includes('∑')) {
        parts.push(`\\sum${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''} ${base}`.trim());
      } else {
        parts.push(`\\int${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''} ${base}`.trim());
      }
    }

    const plainText = collectRunText(container);
    if (parts.length === 0 && plainText.length > 0) {
      parts.push(plainText);
      warnings.push('Equation parsed as plain text fallback');
    }

    const latex = parts.join(' ').trim();
    if (latex.length === 0) {
      warnings.push('Equation could not be converted to LaTeX');
    }

    return {
      kind,
      latex,
      warning: warnings.length > 0 ? warnings.join('; ') : undefined,
    };
  }
}

