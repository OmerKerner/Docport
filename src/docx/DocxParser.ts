import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type { Root, Heading, Paragraph, Text, Strong, Emphasis, PhrasingContent } from 'mdast';
import type { Manifest, DocportState, ParsedChapter, Comment, Revision } from '../types/index.js';
import { OoxmlCommentParser, type RawComment } from './OoxmlCommentParser.js';
import { OoxmlRevisionParser, type RawRevision } from './OoxmlRevisionParser.js';
import type { FigureReferenceNode } from '../markdown/CrossReferencePlugin.js';

export interface DocxParseResult {
  chapters: ParsedChapter[];
  newComments: Comment[];
  newRevisions: Revision[];
  decidedRevisions: Revision[];
}

/**
 * High-level orchestrator that parses a .docx file back into chapters
 * with remark AST, extracting comments and revisions.
 */
export class DocxParser {
  private static readonly FIGURE_BOOKMARK_PREFIX = 'docport_';
  private static readonly INLINE_FIGURE_REF_PATTERN = /@fig:[A-Za-z0-9:_-]+/g;

  async parse(
    docxBuffer: Buffer,
    manifest: Manifest,
    state: DocportState
  ): Promise<DocxParseResult> {
    // Parse document structure
    const zip = await JSZip.loadAsync(docxBuffer);
    const documentFile = zip.file('word/document.xml');
    if (!documentFile) {
      throw new Error('Invalid .docx: missing document.xml');
    }

    const documentXml = await documentFile.async('text');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseAttributeValue: true,
    });

    const documentDoc = parser.parse(documentXml);

    // Extract paragraphs from document
    const body = (documentDoc['w:document'] as Record<string, unknown>)?.['w:body'];
    if (!body) {
      throw new Error('Invalid .docx: missing document body');
    }

    const paragraphs = (body as Record<string, unknown>)['w:p'];
    const pArray = Array.isArray(paragraphs) ? paragraphs : [paragraphs];

    // Split paragraphs by page breaks to reconstruct chapters
    const chapterParagraphs = this.splitByPageBreaks(pArray, manifest.chapters.length);

    // Parse comments and revisions
    const rawComments = await OoxmlCommentParser.parse(docxBuffer);
    const rawRevisions = await OoxmlRevisionParser.parse(docxBuffer);

    // Convert to unified representation
    const { newComments, decidedRevisions } = this.processAnnotations(
      rawComments,
      rawRevisions,
      state,
      manifest.chapters
    );

    // Convert Word paragraphs back to remark AST
    const chapters: ParsedChapter[] = [];
    for (let i = 0; i < manifest.chapters.length; i++) {
      const chapterConfig = manifest.chapters[i];
      if (!chapterConfig) continue;
      
      const paragraphsForChapter = chapterParagraphs[i] || [];

      const ast = this.convertToAst(paragraphsForChapter);
      const chapterComments = newComments.filter(c => c.chapter === chapterConfig.file);
      const chapterRevisions = rawRevisions
        .filter(r => this.belongsToChapter(r, chapterConfig.file, i, chapterParagraphs))
        .map(r => this.rawRevisionToRevision(r, chapterConfig.file, state));

      chapters.push({
        file: chapterConfig.file,
        ast,
        comments: chapterComments,
        revisions: chapterRevisions,
      });
    }

    return {
      chapters,
      newComments,
      newRevisions: rawRevisions.map(r => {
        const chapter = this.determineChapter(r, manifest.chapters, chapterParagraphs);
        return this.rawRevisionToRevision(r, chapter, state);
      }),
      decidedRevisions,
    };
  }

  /**
   * Splits paragraphs by page breaks to reconstruct chapter boundaries.
   */
  private splitByPageBreaks(paragraphs: Record<string, unknown>[], expectedChapters: number): Record<string, unknown>[][] {
    const chapters: Record<string, unknown>[][] = [];
    let currentChapter: Record<string, unknown>[] = [];

    for (const p of paragraphs) {
      // Check for page break
      const runs = p['w:r'];
      const runArray = runs ? (Array.isArray(runs) ? runs : [runs]) : [];
      
      let hasPageBreak = false;
      for (const run of runArray) {
        if ((run as Record<string, unknown>)['w:br']) {
          const br = (run as Record<string, unknown>)['w:br'];
          const brType = (br as Record<string, unknown>)?.['@_w:type'];
          if (brType === 'page') {
            hasPageBreak = true;
            break;
          }
        }
      }

      if (hasPageBreak && currentChapter.length > 0) {
        chapters.push(currentChapter);
        currentChapter = [];
      } else {
        currentChapter.push(p);
      }
    }

    if (currentChapter.length > 0) {
      chapters.push(currentChapter);
    }

    // Ensure we have the expected number of chapters
    while (chapters.length < expectedChapters) {
      chapters.push([]);
    }

    if (chapters.length > expectedChapters) {
      return chapters.slice(chapters.length - expectedChapters);
    }

    return chapters.slice(0, expectedChapters);
  }

  /**
   * Converts Word paragraphs to remark AST.
   */
  private convertToAst(paragraphs: Record<string, unknown>[]): Root {
    const children: (Heading | Paragraph)[] = [];

    for (const p of paragraphs) {
      const pNode = this.convertParagraph(p);
      if (pNode) {
        children.push(pNode);
      }
    }

    return {
      type: 'root',
      children,
    };
  }

  /**
   * Converts a single Word paragraph to a remark paragraph or heading.
   */
  private convertParagraph(p: Record<string, unknown>): Heading | Paragraph | null {
    // Check for heading style
    const pPr = p['w:pPr'];
    let headingLevel: number | null = null;

    if (pPr && typeof pPr === 'object') {
      const pStyle = (pPr as Record<string, unknown>)['w:pStyle'];
      if (pStyle && typeof pStyle === 'object') {
        const val = (pStyle as Record<string, unknown>)['@_w:val'];
        if (typeof val === 'string' && val.startsWith('Heading')) {
          const levelMatch = val.match(/\d+/);
          if (levelMatch) {
            headingLevel = parseInt(levelMatch[0], 10);
          }
        }
      }
    }

    const paragraphFigureLabels = this.extractFigureLabelsFromParagraphBookmarks(p);

    // Extract text runs
    const runs = p['w:r'];
    const runArray = runs ? (Array.isArray(runs) ? runs : [runs]) : [];

    const children: PhrasingContent[] = [];

    for (const run of runArray) {
      const text = this.extractRunText(run as Record<string, unknown>);
      if (!text) continue;

      const rPr = (run as Record<string, unknown>)['w:rPr'];
      let isBold = false;
      let isItalic = false;

      if (rPr && typeof rPr === 'object') {
        isBold = 'w:b' in (rPr as Record<string, unknown>);
        isItalic = 'w:i' in (rPr as Record<string, unknown>);
      }

      children.push(...this.wrapTextByStyle(text, isBold, isItalic));
    }

    const hyperlinks = p['w:hyperlink'];
    const hyperlinkArray = hyperlinks ? (Array.isArray(hyperlinks) ? hyperlinks : [hyperlinks]) : [];

    for (const hyperlink of hyperlinkArray) {
      const hyperlinkText = this.extractHyperlinkText(hyperlink as Record<string, unknown>);
      if (!hyperlinkText) continue;

      children.push(...this.parseInlineFigureReferenceText(hyperlinkText));
    }

    if (paragraphFigureLabels.length > 0) {
      const labelsText = paragraphFigureLabels.map((label) => `{#${label}}`).join(' ');
      if (labelsText.length > 0) {
        const needsSeparator = children.length > 0;
        const value = needsSeparator ? ` ${labelsText}` : labelsText;
        children.push({ type: 'text', value });
      }
    }

    if (children.length === 0) {
      return null;
    }

    if (headingLevel) {
      return {
        type: 'heading',
        depth: Math.min(headingLevel, 6) as 1 | 2 | 3 | 4 | 5 | 6,
        children: children as (Text | Strong | Emphasis)[],
      };
    }

    return {
      type: 'paragraph',
      children,
    };
  }

  /**
   * Extracts text from a run element.
   */
  private extractRunText(run: Record<string, unknown>): string | null {
    const text = run['w:t'];
    if (typeof text === 'string') {
      return text;
    }
    if (text && typeof text === 'object' && '#text' in text) {
      return (text as Record<string, unknown>)['#text'] as string;
    }
    return null;
  }

  private extractHyperlinkText(hyperlink: Record<string, unknown>): string | null {
    const runs = hyperlink['w:r'];
    if (!runs) {
      return null;
    }

    const runArray = Array.isArray(runs) ? runs : [runs];
    let combinedText = '';

    for (const run of runArray) {
      const runText = this.extractRunText(run as Record<string, unknown>);
      if (runText) {
        combinedText += runText;
      }
    }

    return combinedText.length > 0 ? combinedText : null;
  }

  private parseInlineFigureReferenceText(text: string): PhrasingContent[] {
    const nodes: PhrasingContent[] = [];
    let cursor = 0;
    DocxParser.INLINE_FIGURE_REF_PATTERN.lastIndex = 0;
    let match = DocxParser.INLINE_FIGURE_REF_PATTERN.exec(text);

    while (match) {
      const matchText = match[0];
      const matchStart = match.index;

      if (matchStart > cursor) {
        const prefix = text.slice(cursor, matchStart);
        if (prefix.length > 0) {
          nodes.push({ type: 'text', value: prefix });
        }
      }

      const label = matchText.slice(1);
      const referenceNode: FigureReferenceNode = {
        type: 'figureReference',
        label,
      };
      nodes.push(referenceNode as PhrasingContent);

      cursor = matchStart + matchText.length;
      match = DocxParser.INLINE_FIGURE_REF_PATTERN.exec(text);
    }

    if (cursor < text.length) {
      const tail = text.slice(cursor);
      if (tail.length > 0) {
        nodes.push({ type: 'text', value: tail });
      }
    }

    return nodes.length > 0 ? nodes : [{ type: 'text', value: text }];
  }

  private wrapTextByStyle(text: string, isBold: boolean, isItalic: boolean): PhrasingContent[] {
    const inlineNodes = this.parseInlineFigureReferenceText(text);

    if (!isBold && !isItalic) {
      return inlineNodes;
    }

    const hasFigureRef = inlineNodes.some((node) => node.type === 'figureReference');
    if (hasFigureRef) {
      return inlineNodes;
    }

    const plainText = inlineNodes
      .filter((node): node is Text => node.type === 'text')
      .map((node) => node.value)
      .join('');

    if (isBold && isItalic) {
      return [{
        type: 'strong',
        children: [{
          type: 'emphasis',
          children: [{ type: 'text', value: plainText }],
        }],
      }];
    }

    if (isBold) {
      return [{
        type: 'strong',
        children: [{ type: 'text', value: plainText }],
      }];
    }

    return [{
      type: 'emphasis',
      children: [{ type: 'text', value: plainText }],
    }];
  }

  private extractFigureLabelsFromParagraphBookmarks(p: Record<string, unknown>): string[] {
    const labels: string[] = [];
    const bookmarkStarts = p['w:bookmarkStart'];
    const bookmarkArray = bookmarkStarts ? (Array.isArray(bookmarkStarts) ? bookmarkStarts : [bookmarkStarts]) : [];

    for (const bookmark of bookmarkArray) {
      const name = (bookmark as Record<string, unknown>)['@_w:name'];
      if (typeof name !== 'string') {
        continue;
      }

      if (!name.startsWith(DocxParser.FIGURE_BOOKMARK_PREFIX)) {
        continue;
      }

      const label = name.slice(DocxParser.FIGURE_BOOKMARK_PREFIX.length);
      if (label.length > 0) {
        labels.push(label);
      }
    }

    return labels;
  }

  /**
   * Processes raw comments and revisions, matching them against state.
   */
  private processAnnotations(
    rawComments: RawComment[],
    rawRevisions: RawRevision[],
    state: DocportState,
    chapters: Manifest['chapters']
  ): { newComments: Comment[]; decidedRevisions: Revision[] } {
    const newComments: Comment[] = [];
    const decidedRevisions: Revision[] = [];

    // Process comments
    for (const raw of rawComments) {
      const existing = state.comments.find(c => c.lastDocxId === raw.docxId);
      if (!existing) {
        // New comment
        newComments.push({
          id: crypto.randomUUID(),
          chapter: this.guessChapterForComment(raw, chapters),
          anchorQuote: raw.anchorText,
          author: raw.author,
          date: new Date(raw.date),
          body: raw.body,
          replies: raw.replies.map(r => ({
            id: crypto.randomUUID(),
            author: r.author,
            date: new Date(r.date),
            body: r.body,
          })),
          resolved: false,
        });
      }
    }

    // Process revisions to find decided ones
    const currentRevisionIds = new Set(rawRevisions.map(r => r.docxId));
    for (const stateRevision of state.revisions) {
      if (stateRevision.lastDocxId !== undefined && !currentRevisionIds.has(stateRevision.lastDocxId)) {
        // Revision was in state but is no longer in docx = decided
        decidedRevisions.push({
          id: stateRevision.id,
          chapter: stateRevision.chapter,
          kind: stateRevision.kind,
          author: stateRevision.author,
          date: new Date(stateRevision.date),
          text: stateRevision.text,
          precedingContext: stateRevision.precedingContext,
          decided: true, // Assume accepted if missing
        });
      }
    }

    return { newComments, decidedRevisions };
  }

  /**
   * Guesses which chapter a comment belongs to based on anchor text.
   */
  private guessChapterForComment(_raw: RawComment, chapters: Manifest['chapters']): string {
    // Simple heuristic: use first chapter
    return chapters[0]?.file || 'unknown.md';
  }

  /**
   * Determines if a revision belongs to a specific chapter.
   */
  private belongsToChapter(
    _revision: RawRevision,
    _chapterFile: string,
    _chapterIndex: number,
    _chapterParagraphs: Record<string, unknown>[][]
  ): boolean {
    // Simple heuristic: assume revisions are distributed evenly
    return true;
  }

  /**
   * Determines which chapter a revision belongs to.
   */
  private determineChapter(
    _revision: RawRevision,
    chapters: Manifest['chapters'],
    _chapterParagraphs: Record<string, unknown>[][]
  ): string {
    return chapters[0]?.file || 'unknown.md';
  }

  /**
   * Converts a raw revision to a Revision object.
   */
  private rawRevisionToRevision(raw: RawRevision, chapter: string, state: DocportState): Revision {
    const existing = state.revisions.find(r => r.lastDocxId === raw.docxId);
    
    return {
      id: existing?.id || crypto.randomUUID(),
      chapter,
      kind: raw.kind,
      author: raw.author,
      date: new Date(raw.date),
      text: raw.text,
      precedingContext: raw.precedingContext,
      decided: null,
    };
  }
}
