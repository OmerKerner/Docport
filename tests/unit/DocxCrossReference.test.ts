import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import type { DocportDocument } from '../../src/types/index.js';
import { DocxBuilder } from '../../src/docx/DocxBuilder.js';
import { DocxParser } from '../../src/docx/DocxParser.js';
import { emptyDocportState } from '../../src/types/docport-state.js';
import type { Root } from 'mdast';
import { resolve } from 'path';

function makeAstWithFigureAndRef(): Root {
  return {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'image',
            url: resolve('tests\\fixtures\\pixel.png'),
            alt: 'Example figure',
            data: { docportFigureLabel: 'fig:example' },
          },
        ],
      },
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'See ' },
          { type: 'figureReference', label: 'fig:example' },
          { type: 'text', value: ' for an overview.' },
        ],
      },
    ],
  };
}

describe('Docx cross-reference behavior', () => {
  it('writes bookmark anchors and hyperlink fallback refs', async () => {
    const builder = new DocxBuilder();
    const parser = new DocxParser();

    const doc: DocportDocument = {
      manifest: {
        title: 'Xref Test',
        authors: [{ name: 'Tester' }],
        chapters: [{ file: '01-intro.md' }],
        citationStyle: 'APA',
      },
      chapters: [
        {
          file: '01-intro.md',
          ast: makeAstWithFigureAndRef(),
          comments: [],
          revisions: [],
        },
      ],
      state: emptyDocportState(),
    };

    const buffer = await builder.build(doc, resolve('.'));
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')?.async('text');

    expect(documentXml).toBeDefined();
    const xml = documentXml ?? '';
    expect(xml).toContain('w:bookmarkStart');
    expect(xml).toContain('w:name="docport_fig:example"');
    expect(xml).toContain('w:hyperlink');
    expect(xml).toContain('@fig:example');
    expect(xml).not.toContain('{#fig:example}');

    const parsed = await parser.parse(buffer, doc.manifest, emptyDocportState());
    expect(parsed.chapters.length).toBe(1);
    const chapter = parsed.chapters[0];
    expect(chapter).toBeDefined();
    const parsedJson = JSON.stringify(chapter?.ast);
    expect(parsedJson).toContain('fig:example');
    expect(parsedJson).toContain('figureReference');
  });
});
