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

  it('parses simple REF field codes back to figureReference nodes', async () => {
    const parser = new DocxParser();

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:bookmarkStart w:id="1" w:name="docport_fig:example"/>
      <w:r><w:t>Figure body</w:t></w:r>
      <w:bookmarkEnd w:id="1"/>
    </w:p>
    <w:p>
      <w:fldSimple w:instr=" REF docport_fig:example \\h ">
        <w:r><w:t>Figure 1</w:t></w:r>
      </w:fldSimple>
    </w:p>
  </w:body>
</w:document>`;

    const zip = new JSZip();
    zip.file('word/document.xml', documentXml);
    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`,
    );

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const manifest = {
      title: 'Xref Parse Test',
      authors: [{ name: 'Tester' }],
      chapters: [{ file: '01-intro.md' }],
      citationStyle: 'APA' as const,
    };

    const parsed = await parser.parse(buffer, manifest, emptyDocportState());
    const astJson = JSON.stringify(parsed.chapters[0]?.ast ?? {});
    expect(astJson).toContain('"type":"figureReference"');
    expect(astJson).toContain('"label":"fig:example"');
  });

  it('parses complex REF field runs back to figureReference nodes', async () => {
    const parser = new DocxParser();

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:bookmarkStart w:id="7" w:name="docport_fig:workflow"/>
      <w:r><w:t>Workflow figure</w:t></w:r>
      <w:bookmarkEnd w:id="7"/>
    </w:p>
    <w:p>
      <w:r><w:fldChar w:fldCharType="begin"/></w:r>
      <w:r><w:instrText xml:space="preserve"> REF docport_fig:workflow \\h </w:instrText></w:r>
      <w:r><w:fldChar w:fldCharType="separate"/></w:r>
      <w:r><w:t>Figure 2</w:t></w:r>
      <w:r><w:fldChar w:fldCharType="end"/></w:r>
    </w:p>
  </w:body>
</w:document>`;

    const zip = new JSZip();
    zip.file('word/document.xml', documentXml);
    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`,
    );

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const manifest = {
      title: 'Complex Field Parse Test',
      authors: [{ name: 'Tester' }],
      chapters: [{ file: '01-intro.md' }],
      citationStyle: 'APA' as const,
    };

    const parsed = await parser.parse(buffer, manifest, emptyDocportState());
    const astJson = JSON.stringify(parsed.chapters[0]?.ast ?? {});
    expect(astJson).toContain('"type":"figureReference"');
    expect(astJson).toContain('"label":"fig:workflow"');
  });
});
