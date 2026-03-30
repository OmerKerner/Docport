import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type { Root, Heading, Paragraph, Text, Strong, Emphasis, PhrasingContent } from 'mdast';
import type { Manifest, DocportState, ParsedChapter, Comment, Revision } from '../types/index.js';
import { OoxmlCommentParser, type RawComment } from './OoxmlCommentParser.js';
import { OoxmlRevisionParser, type RawRevision } from './OoxmlRevisionParser.js';
import type { FigureReferenceNode } from '../markdown/CrossReferencePlugin.js';
import { OoxmlEquationParser, type ParsedOoxmlEquation } from './OoxmlEquationParser.js';
import type { EquationInlineNode } from '../markdown/EquationPlugin.js';

export interface DocxParseResult {
  chapters: ParsedChapter[];
  newComments: Comment[];
  newRevisions: Revision[];
  decidedRevisions: Revision[];
  equationWarnings: string[];
}

type ParsedFieldKind = 'REF' | 'PAGEREF' | 'SEQ' | 'UNKNOWN';

interface ParsedField {
  kind: ParsedFieldKind;
  instruction: string;
  target?: string;
  displayText: string;
  source: 'fldSimple' | 'complex';
}

interface ComplexFieldState {
  instructionChunks: string[];
  displayChunks: string[];
  fallbackTextChunks: string[];
  inResult: boolean;
}

/**
 * High-level orchestrator that parses a .docx file back into chapters
 * with remark AST, extracting comments and revisions.
 */
export class DocxParser {
  private static readonly FIGURE_BOOKMARK_PREFIX = 'docport_';
  private static readonly INLINE_FIGURE_REF_PATTERN = /@fig:[A-Za-z0-9:_-]+/g;
  private readonly equationParser = new OoxmlEquationParser();
  private equationWarnings: string[] = [];

  async parse(
    docxBuffer: Buffer,
    manifest: Manifest,
    state: DocportState
  ): Promise<DocxParseResult> {
    this.equationWarnings = [];
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
    const revisionChapterByDocxId = new Map<number, string>();
    for (const rawRevision of rawRevisions) {
      revisionChapterByDocxId.set(
        rawRevision.docxId,
        this.determineChapter(rawRevision, manifest.chapters, chapterParagraphs),
      );
    }

    const { newComments, decidedRevisions } = this.processAnnotations(
      rawComments,
      rawRevisions,
      state,
      manifest.chapters,
      chapterParagraphs,
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
        .filter((r) => revisionChapterByDocxId.get(r.docxId) === chapterConfig.file)
        .map((r) => this.rawRevisionToRevision(r, chapterConfig.file, state));

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
      newRevisions: rawRevisions.map((r) => {
        const chapter = revisionChapterByDocxId.get(r.docxId) ?? this.fallbackChapter(manifest.chapters);
        return this.rawRevisionToRevision(r, chapter, state);
      }),
      decidedRevisions,
      equationWarnings: [...this.equationWarnings],
    };
  }

  /**
   * Splits paragraphs by page breaks to reconstruct chapter boundaries.
   */
  private splitByPageBreaks(paragraphs: Record<string, unknown>[], expectedChapters: number): Record<string, unknown>[][] {
    const targetChapterCount = Math.max(expectedChapters, 1);
    const chapters: Record<string, unknown>[][] = [];
    let currentChapter: Record<string, unknown>[] = [];

    for (const p of paragraphs) {
      if (this.paragraphHasPageBreak(p)) {
        if (currentChapter.length > 0) {
          chapters.push(currentChapter);
          currentChapter = [];
        }
        if (this.convertParagraph(p) !== null) {
          currentChapter.push(p);
        }
        continue;
      }
      currentChapter.push(p);
    }

    if (currentChapter.length > 0) {
      chapters.push(currentChapter);
    }

    if (chapters.length === 0) {
      chapters.push([]);
    }

    while (chapters.length < targetChapterCount) {
      chapters.push([]);
    }

    if (chapters.length > targetChapterCount) {
      const merged = chapters.slice(0, targetChapterCount);
      const lastIndex = targetChapterCount - 1;
      for (const overflowChapter of chapters.slice(targetChapterCount)) {
        const existing = merged[lastIndex] ?? [];
        merged[lastIndex] = [...existing, ...overflowChapter];
      }
      return merged;
    }

    return chapters.slice(0, targetChapterCount);
  }

  private paragraphHasPageBreak(paragraph: Record<string, unknown>): boolean {
    const runs = paragraph['w:r'];
    const runArray = runs ? (Array.isArray(runs) ? runs : [runs]) : [];

    for (const run of runArray) {
      const br = (run as Record<string, unknown>)['w:br'];
      if (!br) {
        continue;
      }
      const brArray = Array.isArray(br) ? br : [br];
      for (const brNode of brArray) {
        if (!brNode || typeof brNode !== 'object') {
          continue;
        }
        const brType = (brNode as Record<string, unknown>)['@_w:type'];
        if (brType === 'page') {
          return true;
        }
      }
    }

    const pPr = paragraph['w:pPr'];
    if (pPr && typeof pPr === 'object') {
      const sectPr = (pPr as Record<string, unknown>)['w:sectPr'];
      if (sectPr && typeof sectPr === 'object') {
        const sectionType = (sectPr as Record<string, unknown>)['w:type'];
        if (sectionType && typeof sectionType === 'object') {
          const val = (sectionType as Record<string, unknown>)['@_w:val'];
          if (val === 'nextPage') {
            return true;
          }
        }
      }
    }

    return false;
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

    const blockEquationLatex = this.extractBlockEquationLatex(p);
    if (blockEquationLatex) {
      return {
        type: 'paragraph',
        children: [{ type: 'text', value: `$$${blockEquationLatex}$$` }],
      };
    }

    const paragraphFigureLabels = this.extractFigureLabelsFromParagraphBookmarks(p);

    const bookmarkLabelLookup = this.buildBookmarkLabelLookup(p);

    // Extract text runs and complex fields
    const runs = p['w:r'];
    const runArray = runs ? (Array.isArray(runs) ? runs : [runs]) : [];

    const children: PhrasingContent[] = this.parseRunsWithComplexFields(runArray, bookmarkLabelLookup);

    const hyperlinks = p['w:hyperlink'];
    const hyperlinkArray = hyperlinks ? (Array.isArray(hyperlinks) ? hyperlinks : [hyperlinks]) : [];

    for (const hyperlink of hyperlinkArray) {
      const hyperlinkText = this.extractHyperlinkText(hyperlink as Record<string, unknown>);
      if (!hyperlinkText) continue;

      children.push(...this.parseInlineFigureReferenceText(hyperlinkText));
    }

    const inlineMathNodes = this.extractInlineMathNodes(p);
    if (inlineMathNodes.length > 0) {
      children.push(...inlineMathNodes);
    }

    const simpleFields = p['w:fldSimple'];
    const simpleFieldArray = simpleFields ? (Array.isArray(simpleFields) ? simpleFields : [simpleFields]) : [];
    for (const simpleField of simpleFieldArray) {
      const parsedField = this.parseSimpleField(simpleField as Record<string, unknown>);
      if (!parsedField) {
        continue;
      }
      children.push(...this.fieldToInlineNodes(parsedField, bookmarkLabelLookup));
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

  private parseRunsWithComplexFields(
    runArray: unknown[],
    bookmarkLabelLookup: Map<string, string>,
  ): PhrasingContent[] {
    const children: PhrasingContent[] = [];
    let fieldState: ComplexFieldState | null = null;

    for (const runRaw of runArray) {
      const run = runRaw as Record<string, unknown>;
      const fldCharType = this.extractFldCharType(run);

      if (fldCharType === 'begin') {
        if (fieldState) {
          children.push(...this.danglingFieldFallbackNodes(fieldState));
        }
        fieldState = {
          instructionChunks: [],
          displayChunks: [],
          fallbackTextChunks: [],
          inResult: false,
        };
        continue;
      }

      if (fieldState) {
        if (fldCharType === 'separate') {
          fieldState.inResult = true;
          continue;
        }

        if (fldCharType === 'end') {
          const parsedField = this.parseFieldInstruction(
            fieldState.instructionChunks.join(' '),
            fieldState.displayChunks.join(''),
            'complex',
          );
          if (parsedField) {
            children.push(...this.fieldToInlineNodes(parsedField, bookmarkLabelLookup));
          }
          fieldState = null;
          continue;
        }

        const instr = this.extractInstructionText(run);
        if (instr) {
          fieldState.instructionChunks.push(instr);
          continue;
        }

        const runText = this.extractRunText(run);
        if (runText) {
          fieldState.fallbackTextChunks.push(runText);
        }

        if (fieldState.inResult) {
          if (runText) {
            fieldState.displayChunks.push(runText);
          }
        }
        continue;
      }

      const text = this.extractRunText(run);
      if (!text) {
        continue;
      }

      const rPr = run['w:rPr'];
      let isBold = false;
      let isItalic = false;

      if (rPr && typeof rPr === 'object') {
        isBold = 'w:b' in (rPr as Record<string, unknown>);
        isItalic = 'w:i' in (rPr as Record<string, unknown>);
      }

      children.push(...this.wrapTextByStyle(text, isBold, isItalic));
    }

    if (fieldState) {
      children.push(...this.danglingFieldFallbackNodes(fieldState));
    }

    return children;
  }

  private danglingFieldFallbackNodes(fieldState: ComplexFieldState): PhrasingContent[] {
    const fallbackText =
      fieldState.displayChunks.join('') ||
      fieldState.fallbackTextChunks.join('');
    if (fallbackText.length === 0) {
      return [];
    }
    return [{ type: 'text', value: fallbackText }];
  }

  private parseSimpleField(fieldNode: Record<string, unknown>): ParsedField | null {
    const instructionRaw = fieldNode['@_w:instr'];
    if (typeof instructionRaw !== 'string') {
      return null;
    }

    const runs = fieldNode['w:r'];
    const runArray = runs ? (Array.isArray(runs) ? runs : [runs]) : [];
    const displayText = runArray
      .map((run) => this.extractRunText(run as Record<string, unknown>) ?? '')
      .join('');

    return this.parseFieldInstruction(instructionRaw, displayText, 'fldSimple');
  }

  private parseFieldInstruction(
    instructionRaw: string,
    displayText: string,
    source: 'fldSimple' | 'complex',
  ): ParsedField | null {
    const instruction = instructionRaw.replace(/\s+/g, ' ').trim();
    if (!instruction) {
      return null;
    }

    const refMatch = instruction.match(/^(REF|PAGEREF)\s+([^\s\\]+)/i);
    if (refMatch?.[1] && refMatch[2]) {
      const kind = refMatch[1].toUpperCase() as ParsedFieldKind;
      return {
        kind,
        instruction,
        target: refMatch[2],
        displayText,
        source,
      };
    }

    const seqMatch = instruction.match(/^SEQ\s+([^\s\\]+)/i);
    if (seqMatch?.[1]) {
      return {
        kind: 'SEQ',
        instruction,
        target: seqMatch[1],
        displayText,
        source,
      };
    }

    return {
      kind: 'UNKNOWN',
      instruction,
      displayText,
      source,
    };
  }

  private fieldToInlineNodes(field: ParsedField, bookmarkLabelLookup: Map<string, string>): PhrasingContent[] {
    if (field.kind === 'REF' || field.kind === 'PAGEREF') {
      const target = field.target ?? '';
      const label = this.resolveFigureLabelFromFieldTarget(target, bookmarkLabelLookup);
      if (label) {
        const referenceNode: FigureReferenceNode = {
          type: 'figureReference',
          label,
        };
        return [referenceNode as PhrasingContent];
      }
    }

    if (field.displayText.length > 0) {
      return [{ type: 'text', value: field.displayText }];
    }

    return [];
  }

  private resolveFigureLabelFromFieldTarget(target: string, bookmarkLabelLookup: Map<string, string>): string | null {
    const fromBookmark = bookmarkLabelLookup.get(target);
    if (fromBookmark) {
      return fromBookmark;
    }

    if (target.startsWith(DocxParser.FIGURE_BOOKMARK_PREFIX)) {
      const labelFromPrefix = target.slice(DocxParser.FIGURE_BOOKMARK_PREFIX.length);
      if (labelFromPrefix.startsWith('fig:')) {
        return labelFromPrefix;
      }
    }

    if (target.startsWith('fig:')) {
      return target;
    }

    return null;
  }

  private buildBookmarkLabelLookup(p: Record<string, unknown>): Map<string, string> {
    const map = new Map<string, string>();
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
      if (label.startsWith('fig:')) {
        map.set(name, label);
      }
    }

    return map;
  }

  private extractFldCharType(run: Record<string, unknown>): string | null {
    const fldChar = run['w:fldChar'];
    if (!fldChar || typeof fldChar !== 'object') {
      return null;
    }

    const type = (fldChar as Record<string, unknown>)['@_w:fldCharType'];
    return typeof type === 'string' ? type : null;
  }

  private extractInstructionText(run: Record<string, unknown>): string | null {
    const instrText = run['w:instrText'];
    if (typeof instrText === 'string') {
      return instrText;
    }
    if (instrText && typeof instrText === 'object' && '#text' in instrText) {
      const value = (instrText as Record<string, unknown>)['#text'];
      return typeof value === 'string' ? value : null;
    }
    return null;
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

  private extractInlineMathNodes(paragraph: Record<string, unknown>): PhrasingContent[] {
    const nodes: PhrasingContent[] = [];
    const mathNodes = paragraph['m:oMath'];
    const mathArray = mathNodes ? (Array.isArray(mathNodes) ? mathNodes : [mathNodes]) : [];
    for (const mathNode of mathArray) {
      if (!mathNode || typeof mathNode !== 'object') {
        continue;
      }
      const parsed = this.equationParser.parseInline(mathNode as Record<string, unknown>);
      const phrasing = this.parsedEquationToPhrasing(parsed);
      if (phrasing) {
        nodes.push(phrasing);
      }
    }
    return nodes;
  }

  private extractBlockEquationLatex(paragraph: Record<string, unknown>): string | null {
    const mathPara = paragraph['m:oMathPara'];
    if (!mathPara) {
      return null;
    }
    const first = Array.isArray(mathPara) ? mathPara[0] : mathPara;
    if (!first || typeof first !== 'object') {
      return null;
    }
    const parsed = this.equationParser.parseBlock(first as Record<string, unknown>);
    if (parsed.warning) {
      this.equationWarnings.push(parsed.warning);
    }
    return parsed.latex.length > 0 ? parsed.latex : null;
  }

  private parsedEquationToPhrasing(parsed: ParsedOoxmlEquation): PhrasingContent | null {
    if (parsed.warning) {
      this.equationWarnings.push(parsed.warning);
    }
    if (parsed.latex.length === 0) {
      return null;
    }
    const equationNode: EquationInlineNode = {
      type: 'equationInline',
      latex: parsed.latex,
    };
    return equationNode as unknown as PhrasingContent;
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
    chapters: Manifest['chapters'],
    chapterParagraphs: Record<string, unknown>[][],
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
          chapter: this.guessChapterForComment(raw, chapters, chapterParagraphs),
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
  private guessChapterForComment(
    raw: RawComment,
    chapters: Manifest['chapters'],
    chapterParagraphs: Record<string, unknown>[][],
  ): string {
    if (raw.anchorText) {
      return this.findChapterForSignal(raw.anchorText, chapters, chapterParagraphs);
    }
    return this.fallbackChapter(chapters);
  }

  /**
   * Determines which chapter a revision belongs to.
   */
  private determineChapter(
    revision: RawRevision,
    chapters: Manifest['chapters'],
    chapterParagraphs: Record<string, unknown>[][],
  ): string {
    const signal = revision.precedingContext || revision.text;
    return this.findChapterForSignal(signal, chapters, chapterParagraphs);
  }

  private findChapterForSignal(
    signal: string,
    chapters: Manifest['chapters'],
    chapterParagraphs: Record<string, unknown>[][],
  ): string {
    const normalizedSignal = signal.trim();
    if (normalizedSignal.length === 0) {
      return this.fallbackChapter(chapters);
    }

    const chapterCount = Math.min(chapters.length, chapterParagraphs.length);
    for (let i = 0; i < chapterCount; i++) {
      const chapter = chapters[i];
      if (!chapter) {
        continue;
      }
      const chapterText = this.extractChapterText(chapterParagraphs[i] ?? []);
      if (chapterText.includes(normalizedSignal)) {
        return chapter.file;
      }
    }

    const loweredSignal = normalizedSignal.toLowerCase();
    for (let i = 0; i < chapterCount; i++) {
      const chapter = chapters[i];
      if (!chapter) {
        continue;
      }
      const chapterText = this.extractChapterText(chapterParagraphs[i] ?? []).toLowerCase();
      if (chapterText.includes(loweredSignal)) {
        return chapter.file;
      }
    }

    return this.fallbackChapter(chapters);
  }

  private extractChapterText(chapterParagraphs: Record<string, unknown>[]): string {
    const parts: string[] = [];
    for (const paragraph of chapterParagraphs) {
      const runs = paragraph['w:r'];
      const runArray = runs ? (Array.isArray(runs) ? runs : [runs]) : [];
      for (const run of runArray) {
        const text = this.extractRunText(run as Record<string, unknown>);
        if (text) {
          parts.push(text);
        }
      }

      const hyperlinks = paragraph['w:hyperlink'];
      const hyperlinkArray = hyperlinks ? (Array.isArray(hyperlinks) ? hyperlinks : [hyperlinks]) : [];
      for (const hyperlink of hyperlinkArray) {
        const text = this.extractHyperlinkText(hyperlink as Record<string, unknown>);
        if (text) {
          parts.push(text);
        }
      }
    }
    return parts.join(' ');
  }

  private fallbackChapter(chapters: Manifest['chapters']): string {
    return chapters[0]?.file ?? 'unknown.md';
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
