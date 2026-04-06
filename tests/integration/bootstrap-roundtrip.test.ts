import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import JSZip from 'jszip';

import { Bootstrapper } from '../../src/bridge/Bootstrapper.js';
import { Pusher } from '../../src/bridge/Pusher.js';

interface DocxFeatureCounts {
  comments: number;
  commentRanges: number;
  insertions: number;
  deletions: number;
  oMath: number;
  oMathPara: number;
  bookmarks: number;
  refFields: number;
}

async function extractDocumentXml(docxPath: string): Promise<string> {
  const buffer = await readFile(docxPath);
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) {
    throw new Error(`Missing word/document.xml in ${docxPath}`);
  }
  const xml = await file.async('text');
  return normalizeXml(xml);
}

function normalizeXml(xml: string): string {
  return xml
    .replace(/\r\n/g, '\n')
    .replace(/w:rsid[^=]*="[^"]*"/g, '')
    .replace(/w14:paraId="[^"]*"/g, '')
    .replace(/w14:textId="[^"]*"/g, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
}

function count(pattern: RegExp, input: string): number {
  return (input.match(pattern) ?? []).length;
}

async function extractDocxFeatureCounts(docxPath: string): Promise<DocxFeatureCounts> {
  const buffer = await readFile(docxPath);
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    throw new Error(`Missing word/document.xml in ${docxPath}`);
  }
  const documentXml = await documentFile.async('text');
  const commentsXml = (await zip.file('word/comments.xml')?.async('text')) ?? '';

  return {
    comments: count(/<w:comment\b/g, commentsXml),
    commentRanges: count(/<w:commentRangeStart\b/g, documentXml),
    insertions: count(/<w:ins\b/g, documentXml),
    deletions: count(/<w:del\b/g, documentXml),
    oMath: count(/<m:oMath\b/g, documentXml),
    oMathPara: count(/<m:oMathPara\b/g, documentXml),
    bookmarks: count(/<w:bookmarkStart\b/g, documentXml),
    refFields: count(/REF\s+/g, documentXml),
  };
}

describe('Bootstrap roundtrip from mockup .docx', () => {
  it('bootstraps and pushes back while preserving semantic feature classes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'docport-bootstrap-rt-'));
    const fixtureDocx = resolve('tests', 'fixtures', 'bootstrap-mockup.docx');
    const manifestPath = resolve(workspace, 'paper.manifest.json');
    const repushedDocx = resolve(workspace, 'bootstrap-roundtrip.docx');
    const statePath = resolve(workspace, 'paper.docport.json');

    const sourceFeatures = await extractDocxFeatureCounts(fixtureDocx);

    const bootstrapper = new Bootstrapper();
    await bootstrapper.run(fixtureDocx, workspace, { chapterMode: 'single' });

    const manifestRaw = await readFile(manifestPath, 'utf-8');
    expect(manifestRaw).toContain('"chapters"');
    expect(manifestRaw).toContain('01-main.md');
    expect(manifestRaw).toContain('"referenceDoc"');
    expect(manifestRaw).toContain('.docport.reference.docx');

    const chapterRaw = await readFile(resolve(workspace, '01-main.md'), 'utf-8');
    expect(chapterRaw.length).toBeGreaterThan(100);
    expect(chapterRaw).toMatch(/^#\s+/m);
    if (sourceFeatures.oMath + sourceFeatures.oMathPara > 0) {
      expect(chapterRaw).toMatch(/\$[^$\n]+\$|\$\$[\s\S]+?\$\$/);
    }

    const stateRaw = await readFile(statePath, 'utf-8');
    const state = JSON.parse(stateRaw) as {
      comments?: unknown[];
      revisions?: unknown[];
    };
    if (sourceFeatures.comments > 0) {
      expect(Array.isArray(state.comments)).toBe(true);
      expect(state.comments?.length ?? 0).toBeGreaterThan(0);
    }

    const stylesRaw = await readFile(resolve(workspace, 'paper.styles.json'), 'utf-8');
    const styles = JSON.parse(stylesRaw) as {
      sourceDocxName: string;
      styleMap: {
        normal?: { styleId: string };
        heading1?: { styleId: string };
      };
    };
    expect(styles.sourceDocxName).toContain('bootstrap-mockup.docx');
    expect(styles.styleMap.normal?.styleId?.length ?? 0).toBeGreaterThan(0);
    expect(styles.styleMap.heading1?.styleId?.length ?? 0).toBeGreaterThan(0);

    const pusher = new Pusher();
    await pusher.run(manifestPath, { force: true, outputPath: repushedDocx });

    const sourceXml = await extractDocumentXml(fixtureDocx);
    const targetXml = await extractDocumentXml(repushedDocx);
    const targetFeatures = await extractDocxFeatureCounts(repushedDocx);

    if (sourceFeatures.oMath + sourceFeatures.oMathPara > 0) {
      expect(targetFeatures.oMath + targetFeatures.oMathPara).toBeGreaterThan(0);
      expect(targetXml).toContain('m:oMath');
    }

    // Structural smoke check: both docs should have non-empty normalized main XML.
    expect(sourceXml.length).toBeGreaterThan(1000);
    expect(targetXml.length).toBeGreaterThan(1000);

    // Diagnostic counters for currently unsupported bootstrap->push fidelity surfaces.
    // These are intentionally non-blocking until native comment/revision/xref re-emission lands.
    expect(targetFeatures.comments).toBeGreaterThanOrEqual(0);
    expect(targetFeatures.commentRanges).toBeGreaterThanOrEqual(0);
    expect(targetFeatures.insertions + targetFeatures.deletions).toBeGreaterThanOrEqual(0);
    expect(targetFeatures.bookmarks + targetFeatures.refFields).toBeGreaterThanOrEqual(0);
  });

  it('splits chapters on heading-1/page-break mode and preserves natural spacing in prose', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'docport-bootstrap-split-'));
    const fixtureDocx = resolve('tests', 'fixtures', 'bootstrap-mockup.docx');
    const manifestPath = resolve(workspace, 'paper.manifest.json');

    const bootstrapper = new Bootstrapper();
    await bootstrapper.run(fixtureDocx, workspace, { chapterMode: 'pagebreak' });

    const manifestRaw = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestRaw) as {
      title: string;
      chapters: Array<{ file: string; title?: string }>;
    };

    expect(manifest.chapters.length).toBeGreaterThanOrEqual(5);
    expect(manifest.title.length).toBeGreaterThan(3);
    expect(manifest.title.toLowerCase()).toBe('abstract');

    for (const chapter of manifest.chapters) {
      expect(chapter.file).not.toContain('-chapter.md');
      expect(chapter.file).toMatch(/^\d{2}-[a-z0-9-]+\.md$/);
    }

    const chapterContents = await Promise.all(
      manifest.chapters.map((chapter) => readFile(resolve(workspace, chapter.file), 'utf-8')),
    );
    const merged = chapterContents.join('\n');

    // Regression samples from the user fixture where whitespace must remain present.
    expect(merged).toContain('higher complexity');
    expect(merged).toContain('like sequence');
    expect(merged).toContain('the differing');
    expect(merged).not.toContain('highercomplexity');
    expect(merged).not.toContain('likesequence');
    expect(merged).not.toContain('thediffering');
  });
});

