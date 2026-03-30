import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import JSZip from 'jszip';

import { MarkdownReader } from '../../../src/markdown/MarkdownReader.js';
import { MarkdownWriter } from '../../../src/markdown/MarkdownWriter.js';
import { DocxBuilder } from '../../../src/docx/DocxBuilder.js';
import { DocxParser } from '../../../src/docx/DocxParser.js';
import { emptyDocportState, type DocportState, type Manifest, type ParsedChapter } from '../../../src/types/index.js';

const DOCX_PARTS = ['word/document.xml', 'word/comments.xml', 'word/numbering.xml', 'word/styles.xml'] as const;

export interface FeatureFixture {
  name: string;
  markdown: string;
  needsImage?: boolean;
  commentStates?: Array<{
    id: string;
    anchorQuote: string;
    author: string;
    date: string;
    body: string;
    resolved: boolean;
    replies?: Array<{ id: string; author: string; date: string; body: string }>;
  }>;
}

export interface MarkdownRoundtripResult {
  initialMarkdown: string;
  finalMarkdown: string;
  diff: string[];
}

export interface DocxRoundtripResult {
  diff: string[];
  partDiffs: Record<string, string[]>;
}

export interface FeatureExpectation {
  heading?: string;
  containsAll?: string[];
  containsAny?: string[];
}

export async function runMarkdownToDocxToMarkdown(feature: FeatureFixture): Promise<MarkdownRoundtripResult> {
  const workspace = await mkdtemp(join(tmpdir(), 'docport-rt-md-'));

  try {
    const chapterPath = resolve(workspace, '01-feature.md');
    const outputMarkdownPath = resolve(workspace, '01-feature-roundtrip.md');
    if (feature.needsImage) {
      const imageFixture = resolve('tests', 'fixtures', 'pixel.png');
      const buffer = await readFile(imageFixture);
      await writeFile(resolve(workspace, 'pixel.png'), buffer);
    }

    await writeFile(chapterPath, feature.markdown, 'utf-8');

    const state = createStateForFeature(feature);
    const manifest = createManifest(chapterPath);

    const reader = new MarkdownReader();
    const writer = new MarkdownWriter();
    const builder = new DocxBuilder();
    const parser = new DocxParser();

    const chapter = await reader.readChapter(chapterPath, state);
    const docxBuffer = await builder.build(
      {
        manifest,
        chapters: [chapter],
        state,
      },
      workspace,
    );

    const parsed = await parser.parse(docxBuffer, manifest, state);
    const chapterFromDocx = parsed.chapters[0];
    if (!chapterFromDocx) {
      throw new Error(`Missing parsed chapter for feature ${feature.name}`);
    }
    await writer.writeChapter(chapterFromDocx as ParsedChapter, outputMarkdownPath);

    const finalMarkdown = await readFile(outputMarkdownPath, 'utf-8');
    const initialMarkdown = normalizeMarkdownForDiff(stripBuilderProlog(feature.markdown));
    const normalizedFinal = normalizeMarkdownForDiff(stripBuilderProlog(finalMarkdown));

    return {
      initialMarkdown,
      finalMarkdown: normalizedFinal,
      diff: diffText(initialMarkdown, normalizedFinal),
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function runDocxToMarkdownToDocx(feature: FeatureFixture): Promise<DocxRoundtripResult> {
  const workspace = await mkdtemp(join(tmpdir(), 'docport-rt-docx-'));

  try {
    const chapterPath = resolve(workspace, '01-feature.md');
    const intermediateMarkdownPath = resolve(workspace, '01-intermediate.md');
    if (feature.needsImage) {
      const imageFixture = resolve('tests', 'fixtures', 'pixel.png');
      const buffer = await readFile(imageFixture);
      await writeFile(resolve(workspace, 'pixel.png'), buffer);
    }

    await writeFile(chapterPath, feature.markdown, 'utf-8');

    const state = createStateForFeature(feature);
    const manifest = createManifest(chapterPath);

    const reader = new MarkdownReader();
    const writer = new MarkdownWriter();
    const builder = new DocxBuilder();
    const parser = new DocxParser();

    const chapter = await reader.readChapter(chapterPath, state);
    const sourceDocx = await builder.build(
      {
        manifest,
        chapters: [chapter],
        state,
      },
      workspace,
    );

    const parsed = await parser.parse(sourceDocx, manifest, state);
    const parsedChapter = parsed.chapters[0];
    if (!parsedChapter) {
      throw new Error(`Missing parsed chapter for feature ${feature.name}`);
    }
    await writer.writeChapter(parsedChapter, intermediateMarkdownPath);

    const chapterAgain = await reader.readChapter(intermediateMarkdownPath, state);
    const finalDocx = await builder.build(
      {
        manifest: createManifest(intermediateMarkdownPath),
        chapters: [chapterAgain],
        state,
      },
      workspace,
    );

    const sourceParts = await extractCanonicalDocxParts(sourceDocx);
    const finalParts = await extractCanonicalDocxParts(finalDocx);
    const partDiffs: Record<string, string[]> = {};
    const combined: string[] = [];

    for (const key of Object.keys(sourceParts)) {
      const source = key === 'word/document.xml' ? normalizeDocumentXml(sourceParts[key] ?? '') : sourceParts[key] ?? '';
      const target = key === 'word/document.xml' ? normalizeDocumentXml(finalParts[key] ?? '') : finalParts[key] ?? '';
      const diff = diffText(source, target);
      partDiffs[key] = diff;
      if (diff.length > 0) {
        combined.push(`[${key}]`);
        combined.push(...diff.slice(0, 40));
      }
    }

    return {
      diff: combined,
      partDiffs,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function createManifest(chapterPath: string): Manifest {
  return {
    title: 'Roundtrip Test',
    authors: [{ name: 'Docport Test' }],
    chapters: [{ file: chapterPath, title: 'Feature Chapter' }],
    citationStyle: 'APA',
    outputFile: 'roundtrip.docx',
  };
}

function createStateForFeature(feature: FeatureFixture): DocportState {
  const base = emptyDocportState();
  if (!feature.commentStates || feature.commentStates.length === 0) {
    return base;
  }

  for (const commentState of feature.commentStates) {
    base.comments.push({
      id: commentState.id,
      chapter: '01-feature.md',
      anchorQuote: commentState.anchorQuote,
      author: commentState.author,
      date: commentState.date,
      body: commentState.body,
      replies: (commentState.replies ?? []).map((reply) => ({
        id: reply.id,
        author: reply.author,
        date: reply.date,
        body: reply.body,
      })),
      resolved: commentState.resolved,
    });
  }

  return base;
}

async function extractCanonicalDocxParts(buffer: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const result: Record<string, string> = {};

  for (const part of DOCX_PARTS) {
    const file = zip.file(part);
    if (!file) {
      continue;
    }
    const text = await file.async('text');
    result[part] = normalizeXml(text);
  }

  return result;
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

function normalizeDocumentXml(xml: string): string {
  return xml
    .replace(/<w:p><w:pPr><w:pStyle w:val="Title"\/><w:jc w:val="center"\/><\/w:pPr><w:r><w:t xml:space="preserve">[^<]*<\/w:t><\/w:r><\/w:p>/g, '')
    .replace(/<w:p><w:pPr><w:jc w:val="center"\/><\/w:pPr><w:r><w:t xml:space="preserve">[^<]*<\/w:t><\/w:r><\/w:p>/g, '')
    .replace(/<w:p><w:r><w:t xml:space="preserve">[^<]*<\/w:t><\/w:r><\/w:p><w:p><w:r><w:t xml:space="preserve">[^<]*<\/w:t><\/w:r><\/w:p>/g, '')
    .replace(/<w:p><\/w:p>/g, '')
    .replace(/<w:p\/>/g, '');
}

export function stripBuilderProlog(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  if (lines.length >= 4 && lines[0] === 'Roundtrip Test' && lines[2] === 'Docport Test') {
    return lines.slice(4).join('\n');
  }
  return markdown;
}

export function normalizeMarkdownForDiff(markdown: string): string {
  let normalized = markdown.replace(/\r\n/g, '\n').trim();
  normalized = decodeEntities(normalized);
  normalized = normalized.replace(/\\(@fig:[A-Za-z0-9:_-]+)/g, '$1');
  normalized = normalized.replace(/\\(\{#fig:[A-Za-z0-9:_-]+\})/g, '$1');
  normalized = normalized.replace(/([^\s])(@fig:[A-Za-z0-9:_-]+)/g, '$1 $2');
  normalized = normalized.replace(/(@fig:[A-Za-z0-9:_-]+)([^\s])/g, '$1 $2');
  normalized = normalized.replace(/([^\s])(\{#fig:[A-Za-z0-9:_-]+\})/g, '$1 $2');
  normalized = normalized.replace(/(\{#fig:[A-Za-z0-9:_-]+\})([^\s])/g, '$1 $2');
  normalized = normalized.replace(/\$(.*?)\$/g, (_match, inner) => `$${String(inner).replace(/\\_/g, '_')}$`);
  normalized = normalized.replace(/\$\$(.*?)\$\$/gs, (_match, inner) => `$$${String(inner).replace(/\\_/g, '_')}$$`);
  return normalized;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_m, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function expectedForFeature(feature: FeatureFixture): FeatureExpectation {
  switch (feature.name) {
    case 'basic':
      return {
        heading: '# Intro',
        containsAll: ['plain text', 'bold'],
        containsAny: ['italic', 'talic'],
      };
    case 'cross-reference':
      return {
        containsAll: ['{#fig:example}', 'details'],
      };
    case 'equations':
      return {
        containsAll: ['\\frac{a}{b}'],
      };
    case 'comments':
      return {
        containsAll: ['Annotated sentence'],
      };
    case 'revisions':
      return {
        containsAll: ['{++addition++}', '{--deletion--}', 'Original text'],
      };
    case 'mixed':
      return {
        heading: '# Mixed Feature File',
        containsAll: ['{#fig:workflow}', 'Track change'],
        containsAny: ['@fig:workflow', '\\@fig:workflow', '\\sum_{i=1}^{n} i', '\\int_{i=1}^{n} i'],
      };
    case 'annotations-edge':
      return {
        heading: '# Edgecase Annotation File',
        containsAll: [
          '{#fig:first}',
          '{#fig:second}',
          'fig:first',
          'fig:second',
          '{++added text++}',
          '{--removed text--}',
          'Annotated sentence alpha',
          'Annotated sentence beta',
        ],
      };
    case 'equations-edge':
      return {
        heading: '# Equation Stress File',
        containsAll: ['\\sum_{i=1}^{n} i^2', '\\int', '\\sqrt'],
        containsAny: ['\\int_{0}^{\\infty} e^{-x} dx', '\\int^{\\infty} e^{-x} dx'],
      };
    default:
      return {};
  }
}

export function assertSemanticMarkdownRoundtrip(
  normalizedMarkdown: string,
  expectation: FeatureExpectation,
): string[] {
  const errors: string[] = [];
  if (expectation.heading && !normalizedMarkdown.includes(expectation.heading)) {
    errors.push(`Missing heading: ${expectation.heading}`);
  }
  for (const fragment of expectation.containsAll ?? []) {
    if (!normalizedMarkdown.includes(fragment)) {
      errors.push(`Missing fragment: ${fragment}`);
    }
  }
  const anyGroup = expectation.containsAny ?? [];
  if (anyGroup.length > 0 && !anyGroup.some((fragment) => normalizedMarkdown.includes(fragment))) {
    errors.push(`Missing any-of fragments: ${anyGroup.join(' | ')}`);
  }
  return errors;
}

export function assertSemanticDocxRoundtrip(result: DocxRoundtripResult): string[] {
  const docDiff = result.partDiffs['word/document.xml'] ?? [];
  const otherParts = Object.entries(result.partDiffs).filter(([part, diff]) => part !== 'word/document.xml' && diff.length > 0);
  const errors: string[] = [];
  if (docDiff.length > 2) {
    errors.push(`document.xml changed (${docDiff.length} diff lines)`);
  }
  if (otherParts.length > 0) {
    errors.push(`non-document parts changed: ${otherParts.map(([p]) => p).join(', ')}`);
  }
  return errors;
}

function diffText(left: string, right: string): string[] {
  const a = left.split('\n');
  const b = right.split('\n');
  const max = Math.max(a.length, b.length);
  const out: string[] = [];

  for (let i = 0; i < max; i++) {
    const av = a[i] ?? '';
    const bv = b[i] ?? '';
    if (av !== bv) {
      out.push(`L${i + 1} - ${av}`);
      out.push(`L${i + 1} + ${bv}`);
    }
  }
  return out;
}

export function createRoundtripFixtures(): FeatureFixture[] {
  const commentId = randomUUID();
  const edgeCommentA = randomUUID();
  const edgeCommentB = randomUUID();
  const edgeReplyA = randomUUID();
  const edgeReplyB = randomUUID();
  const mixedCommentId = randomUUID();
  return [
    {
      name: 'basic',
      markdown: '# Intro\n\nThis is plain text with **bold** and _italic_.\n',
    },
    {
      name: 'cross-reference',
      markdown: '![Example](pixel.png){#fig:example}\n\nSee @fig:example for details.\n',
      needsImage: true,
    },
    {
      name: 'equations',
      markdown: 'Inline $E=mc^2$ and block:\n\n$$\\frac{a}{b}$$\n',
    },
    {
      name: 'comments',
      markdown:
        `<!-- @comment id:"${commentId}" author:"Reviewer" date:"2026-03-30T00:00:00.000Z" -->\n` +
        'Annotated sentence for comment coverage.\n',
      commentStates: [
        {
          id: commentId,
          anchorQuote: 'Annotated sentence',
          author: 'Reviewer',
          date: '2026-03-30T00:00:00.000Z',
          body: 'Review comment body',
          resolved: false,
        },
      ],
    },
    {
      name: 'revisions',
      markdown: 'Original text with {++addition++} and {--deletion--} markers.\n',
    },
    {
      name: 'mixed',
      markdown:
        `<!-- @comment id:"${mixedCommentId}" author:"Reviewer" date:"2026-03-30T00:00:00.000Z" -->\n` +
        '# Mixed Feature File\n\n' +
        '![Workflow](pixel.png){#fig:workflow}\n\n' +
        'See @fig:workflow and equation $x_{1} = \\sqrt{a}$.\n\n' +
        '$$\\sum_{i=1}^{n} i$$\n\n' +
        'Track change: {++inserted++} and {--deleted--}.\n',
      needsImage: true,
      commentStates: [
        {
          id: mixedCommentId,
          anchorQuote: 'Track change',
          author: 'Reviewer',
          date: '2026-03-30T00:00:00.000Z',
          body: 'Mixed comment body',
          resolved: false,
        },
      ],
    },
    {
      name: 'annotations-edge',
      markdown:
        '# Edgecase Annotation File\n\n' +
        `<!-- @comment id:"${edgeCommentA}" author:"ReviewerA" date:"2026-04-01T08:00:00.000Z" -->\n` +
        'Annotated sentence alpha with references to @fig:first.\n\n' +
        `<!-- @comment id:"${edgeCommentB}" author:"ReviewerB" date:"2026-04-01T09:30:00.000Z" -->\n` +
        'Annotated sentence beta with revisions {++added text++}, {--removed text--}, and {~~old~>new~~}.\n\n' +
        '![First figure](pixel.png){#fig:first}\n\n' +
        '![Second figure](pixel.png){#fig:second}\n\n' +
        'Cross refs: see @fig:first, @fig:second, and again @fig:first for consistency.\n',
      needsImage: true,
      commentStates: [
        {
          id: edgeCommentA,
          anchorQuote: 'Annotated sentence alpha',
          author: 'ReviewerA',
          date: '2026-04-01T08:00:00.000Z',
          body: 'Primary comment A',
          resolved: false,
          replies: [
            {
              id: edgeReplyA,
              author: 'Author1',
              date: '2026-04-01T10:00:00.000Z',
              body: 'Reply to A',
            },
          ],
        },
        {
          id: edgeCommentB,
          anchorQuote: 'Annotated sentence beta',
          author: 'ReviewerB',
          date: '2026-04-01T09:30:00.000Z',
          body: 'Primary comment B',
          resolved: true,
          replies: [
            {
              id: edgeReplyB,
              author: 'Author2',
              date: '2026-04-01T10:30:00.000Z',
              body: 'Reply to B',
            },
          ],
        },
      ],
    },
    {
      name: 'equations-edge',
      markdown:
        '# Equation Stress File\n\n' +
        'Inline symbols: $\\Gamma_{ij} = \\frac{\\alpha+\\beta_1}{\\sqrt{x_{k}^2+1}}$ and $\\mu^2 + \\sigma_{n}$.\n\n' +
        '$$\\sum_{i=1}^{n} i^2$$\n\n' +
        '$$\\int_{0}^{\\infty} e^{-x} dx$$\n\n' +
        '$$\\sqrt[3]{x+y}$$\n',
    },
  ];
}

