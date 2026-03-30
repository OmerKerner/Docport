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
            url: resolve('tests/fixtures/pixel.png'),
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

  it('falls back to field display text when a complex field is dangling', async () => {
    const parser = new DocxParser();

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:fldChar w:fldCharType="begin"/></w:r>
      <w:r><w:instrText xml:space="preserve"> REF missing_target \\h </w:instrText></w:r>
      <w:r><w:t>Figure X</w:t></w:r>
      <w:r><w:t xml:space="preserve"> reference</w:t></w:r>
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
      title: 'Dangling Field Parse Test',
      authors: [{ name: 'Tester' }],
      chapters: [{ file: '01-intro.md' }],
      citationStyle: 'APA' as const,
    };

    const parsed = await parser.parse(buffer, manifest, emptyDocportState());
    const astJson = JSON.stringify(parsed.chapters[0]?.ast ?? {});
    expect(astJson).toContain('Figure X');
    expect(astJson).not.toContain('"type":"figureReference"');
  });

  it('splits chapters robustly across consecutive page breaks', async () => {
    const parser = new DocxParser();

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Chapter One Text</w:t></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:r><w:t>Chapter Two Text</w:t></w:r></w:p>
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
      title: 'PageBreak Split Test',
      authors: [{ name: 'Tester' }],
      chapters: [{ file: '01-a.md' }, { file: '02-b.md' }],
      citationStyle: 'APA' as const,
    };

    const parsed = await parser.parse(buffer, manifest, emptyDocportState());
    expect(parsed.chapters.length).toBe(2);

    const chapterOneJson = JSON.stringify(parsed.chapters[0]?.ast ?? {});
    const chapterTwoJson = JSON.stringify(parsed.chapters[1]?.ast ?? {});
    expect(chapterOneJson).toContain('Chapter One Text');
    expect(chapterTwoJson).toContain('Chapter Two Text');
  });

  it('maps new comments to the matching chapter by anchor signal', async () => {
    const parser = new DocxParser();

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Alpha chapter text.</w:t></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p>
      <w:r><w:commentRangeStart w:id="0"/></w:r>
      <w:r><w:t>Beta anchor sentence for mapping.</w:t></w:r>
      <w:r><w:commentRangeEnd w:id="0"/></w:r>
      <w:r><w:commentReference w:id="0"/></w:r>
    </w:p>
  </w:body>
</w:document>`;

    const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:comment w:id="0" w:author="PI" w:date="2026-03-30T00:00:00Z">
    <w:p><w:r><w:t>Please revise this section.</w:t></w:r></w:p>
  </w:comment>
</w:comments>`;

    const zip = new JSZip();
    zip.file('word/document.xml', documentXml);
    zip.file('word/comments.xml', commentsXml);
    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`,
    );

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const manifest = {
      title: 'Comment Chapter Mapping Test',
      authors: [{ name: 'Tester' }],
      chapters: [{ file: '01-a.md' }, { file: '02-b.md' }],
      citationStyle: 'APA' as const,
    };

    const parsed = await parser.parse(buffer, manifest, emptyDocportState());
    expect(parsed.newComments.length).toBe(1);
    expect(parsed.newComments[0]?.chapter).toBe('02-b.md');
  });
});
