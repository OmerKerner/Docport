import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { remarkEquation, remarkEquationStringify } from '../../src/markdown/EquationPlugin.js';

describe('EquationPlugin', () => {
  it('parses inline $...$ equations', async () => {
    const input = 'Energy is $E=mc^2$ in this context.';
    const processor = unified().use(remarkParse).use(remarkEquation);
    const ast = processor.parse(input);
    const result = await processor.run(ast);
    const json = JSON.stringify(result);
    expect(json).toContain('"type":"equationInline"');
    expect(json).toContain('"latex":"E=mc^2"');
  });

  it('parses block $$...$$ equations', async () => {
    const input = '$$\\frac{a}{b}$$';
    const processor = unified().use(remarkParse).use(remarkEquation);
    const ast = processor.parse(input);
    const result = await processor.run(ast);
    const json = JSON.stringify(result);
    expect(json).toContain('"type":"equationBlock"');
    expect(json).toContain('"latex":"\\\\frac{a}{b}"');
  });

  it('round-trips equation nodes back to markdown syntax', async () => {
    const input = 'Inline $x_{1}$ and block:\n\n$$\\sqrt{x}$$';
    const processor = unified()
      .use(remarkParse)
      .use(remarkEquation)
      .use(remarkEquationStringify)
      .use(remarkStringify);
    const output = await processor.process(input);
    const markdown = output.toString();
    expect(markdown).toContain('$x\\_{1}$');
    expect(markdown).toContain('$$\\sqrt{x}$$');
  });
});

