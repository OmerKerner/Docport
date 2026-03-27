import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { remarkCrossReference, remarkCrossReferenceStringify, getFigureLabel } from '../../src/markdown/CrossReferencePlugin.js';

describe('CrossReferencePlugin', () => {
  it('parses inline figure references', async () => {
    const input = 'See @fig:overview and @fig:results for details.';

    const processor = unified()
      .use(remarkParse)
      .use(remarkCrossReference);

    const ast = processor.parse(input);
    const result = await processor.run(ast);
    const serialized = JSON.stringify(result);

    expect(serialized).toContain('"type":"figureReference"');
    expect(serialized).toContain('"label":"fig:overview"');
    expect(serialized).toContain('"label":"fig:results"');
  });

  it('extracts figure label suffix from image paragraph', async () => {
    const input = '![Chart](chart.png){#fig:chart}';

    const processor = unified()
      .use(remarkParse)
      .use(remarkCrossReference);

    const ast = processor.parse(input);
    const result = await processor.run(ast);
    const root = result as { children?: Array<{ children?: Array<{ type: string; url?: string; data?: Record<string, unknown> }> }> };
    const paragraph = root.children?.[0];
    const imageNode = paragraph?.children?.find((node) => node.type === 'image');

    expect(imageNode).toBeDefined();
    if (!imageNode || imageNode.type !== 'image' || !imageNode.url) {
      throw new Error('image node missing');
    }

    expect(getFigureLabel(imageNode)).toBe('fig:chart');
  });

  it('round-trips inline references with stringify plugin', async () => {
    const input = 'As shown in @fig:workflow, this is stable.';

    const processor = unified()
      .use(remarkParse)
      .use(remarkCrossReference)
      .use(remarkCrossReferenceStringify)
      .use(remarkStringify);

    const output = await processor.process(input);
    expect(output.toString().trim()).toContain('@fig:workflow');
  });
});
