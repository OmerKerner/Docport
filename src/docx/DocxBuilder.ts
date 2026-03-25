// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - docx library has ESM compatibility issues with TypeScript
import docx from 'docx';
import type { Root, Heading, Paragraph as MdParagraph, Text, Strong, Emphasis, Link, Image, List, ListItem } from 'mdast';
import type { DocportDocument } from '../types/index.js';
import { ImageEmbedder } from './ImageEmbedder.js';

// Workaround for docx ESM/TypeScript compatibility
const Document = (docx as Record<string, unknown>).Document as unknown as typeof import('docx').Document;
const Packer = (docx as Record<string, unknown>).Packer as unknown as typeof import('docx').Packer;
const Paragraph = (docx as Record<string, unknown>).Paragraph as unknown as new (...args: unknown[]) => unknown;
const TextRun = (docx as Record<string, unknown>).TextRun as unknown as new (...args: unknown[]) => unknown;
const HeadingLevel = (docx as Record<string, unknown>).HeadingLevel as Record<string, number>;
const AlignmentType = (docx as Record<string, unknown>).AlignmentType as Record<string, string>;
const PageBreak = (docx as Record<string, unknown>).PageBreak as unknown as new () => unknown;

/**
 * Converts a DocportDocument (remark AST + metadata) to a .docx buffer.
 */
export class DocxBuilder {
  private commentIdMap = new Map<string, number>();
  private revisionIdMap = new Map<string, number>();
  private nextCommentId = 0;
  private nextRevisionId = 0;
  private baseDir?: string;

  async build(doc: DocportDocument, baseDir?: string): Promise<Buffer> {
    this.baseDir = baseDir;
    
    // Assign stable IDs to comments and revisions
    this.assignIds(doc);

    const sections: Paragraph[] = [];

    // Title page
    sections.push(
      new Paragraph({
        text: doc.manifest.title,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
      })
    );

    // Authors
    if (doc.manifest.authors && doc.manifest.authors.length > 0) {
      for (const author of doc.manifest.authors) {
        const authorText = author.affiliation
          ? `${author.name} (${author.affiliation})`
          : author.name;
        sections.push(
          new Paragraph({
            text: authorText,
            alignment: AlignmentType.CENTER,
          })
        );
      }
    }

    sections.push(new Paragraph({ children: [new PageBreak()] }));

    // Process each chapter
    for (let i = 0; i < doc.chapters.length; i++) {
      const chapter = doc.chapters[i];
      const chapterParagraphs = await this.convertChapter(chapter.ast, chapter.file);
      sections.push(...chapterParagraphs);

      // Add page break between chapters (except last)
      if (i < doc.chapters.length - 1) {
        sections.push(new Paragraph({ children: [new PageBreak()] }));
      }
    }

    // Create document
    const docxDoc = new Document({
      sections: [
        {
          properties: {},
          children: sections,
        },
      ],
      title: doc.manifest.title,
      creator: (doc.manifest.authors && doc.manifest.authors[0])?.name || 'Docport',
    });

    return await Packer.toBuffer(docxDoc);
  }

  /**
   * Assigns stable IDs to comments and revisions from state.
   */
  private assignIds(doc: DocportDocument): void {
    // Reset counters
    this.commentIdMap.clear();
    this.revisionIdMap.clear();
    this.nextCommentId = 0;
    this.nextRevisionId = 0;

    // Assign comment IDs
    for (const chapter of doc.chapters) {
      for (const comment of chapter.comments) {
        const stateComment = doc.state.comments.find(c => c.id === comment.id);
        const docxId = stateComment?.lastDocxId ?? this.nextCommentId++;
        this.commentIdMap.set(comment.id, docxId);
        if (docxId >= this.nextCommentId) {
          this.nextCommentId = docxId + 1;
        }
      }
    }

    // Assign revision IDs
    for (const chapter of doc.chapters) {
      for (const revision of chapter.revisions) {
        const stateRevision = doc.state.revisions.find(r => r.id === revision.id);
        const docxId = stateRevision?.lastDocxId ?? this.nextRevisionId++;
        this.revisionIdMap.set(revision.id, docxId);
        if (docxId >= this.nextRevisionId) {
          this.nextRevisionId = docxId + 1;
        }
      }
    }
  }

  /**
   * Converts a chapter's AST to docx paragraphs.
   */
  private async convertChapter(ast: Root, chapterFile: string): Promise<Paragraph[]> {
    const paragraphs: Paragraph[] = [];

    for (const node of ast.children) {
      const converted = await this.convertNode(node, chapterFile);
      if (converted) {
        if (Array.isArray(converted)) {
          paragraphs.push(...converted);
        } else {
          paragraphs.push(converted);
        }
      }
    }

    return paragraphs;
  }

  /**
   * Converts a single mdast node to docx paragraph(s).
   */
  private async convertNode(node: unknown, chapterFile: string): Promise<Paragraph | Paragraph[] | null> {
    const typedNode = node as { type: string };

    switch (typedNode.type) {
      case 'heading':
        return this.convertHeading(node as Heading);
      case 'paragraph':
        return await this.convertParagraph(node as MdParagraph, chapterFile);
      case 'list':
        return await this.convertList(node as List, chapterFile);
      case 'thematicBreak':
        return new Paragraph({ text: '---' });
      case 'blockquote':
        return await this.convertBlockquote(node as { children: unknown[] }, chapterFile);
      default:
        return null;
    }
  }

  /**
   * Converts a heading node.
   */
  private convertHeading(node: Heading): Paragraph {
    const level = [
      HeadingLevel.HEADING_1,
      HeadingLevel.HEADING_2,
      HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4,
      HeadingLevel.HEADING_5,
      HeadingLevel.HEADING_6,
    ][node.depth - 1] || HeadingLevel.HEADING_1;

    const runs = this.convertInlineNodes(node.children);

    return new Paragraph({
      heading: level,
      children: runs,
    });
  }

  /**
   * Converts a paragraph node.
   */
  private async convertParagraph(node: MdParagraph, chapterFile: string): Promise<Paragraph> {
    const runs = await this.convertInlineNodesAsync(node.children, chapterFile);

    return new Paragraph({
      children: runs,
    });
  }

  /**
   * Converts a list node.
   */
  private async convertList(node: List, chapterFile: string): Promise<Paragraph[]> {
    const paragraphs: Paragraph[] = [];

    for (const item of node.children) {
      const listItem = item as ListItem;
      for (const child of listItem.children) {
        if ((child as { type: string }).type === 'paragraph') {
          const p = child as MdParagraph;
          const runs = await this.convertInlineNodesAsync(p.children, chapterFile);
          paragraphs.push(
            new Paragraph({
              children: runs,
              bullet: node.ordered ? undefined : { level: 0 },
              numbering: node.ordered ? { reference: 'default', level: 0 } : undefined,
            })
          );
        }
      }
    }

    return paragraphs;
  }

  /**
   * Converts a blockquote node.
   */
  private async convertBlockquote(node: { children: unknown[] }, chapterFile: string): Promise<Paragraph[]> {
    const paragraphs: Paragraph[] = [];

    for (const child of node.children) {
      if ((child as { type: string }).type === 'paragraph') {
        const p = child as MdParagraph;
        const runs = await this.convertInlineNodesAsync(p.children, chapterFile);
        paragraphs.push(
          new Paragraph({
            children: runs,
            indent: { left: 720 }, // 0.5 inch
          })
        );
      }
    }

    return paragraphs;
  }

  /**
   * Converts inline nodes (text, strong, emphasis, etc.) synchronously.
   */
  private convertInlineNodes(nodes: unknown[]): TextRun[] {
    const runs: TextRun[] = [];

    for (const node of nodes) {
      const typedNode = node as { type: string };

      switch (typedNode.type) {
        case 'text':
          runs.push(new TextRun((node as Text).value));
          break;
        case 'strong':
          runs.push(...this.convertStrong(node as Strong));
          break;
        case 'emphasis':
          runs.push(...this.convertEmphasis(node as Emphasis));
          break;
        case 'inlineCode':
          runs.push(new TextRun({
            text: (node as { value: string }).value,
            font: 'Courier New',
          }));
          break;
        default:
          break;
      }
    }

    return runs;
  }

  /**
   * Converts inline nodes asynchronously (for images).
   */
  private async convertInlineNodesAsync(nodes: unknown[], _chapterFile: string): Promise<(TextRun | CommentRangeStart | CommentRangeEnd | CommentReference | ImageRun)[]> {
    const runs: (TextRun | CommentRangeStart | CommentRangeEnd | CommentReference)[] = [];

    for (const node of nodes) {
      const typedNode = node as { type: string };

      switch (typedNode.type) {
        case 'text':
          runs.push(new TextRun((node as Text).value));
          break;
        case 'strong':
          runs.push(...this.convertStrong(node as Strong));
          break;
        case 'emphasis':
          runs.push(...this.convertEmphasis(node as Emphasis));
          break;
        case 'link':
          runs.push(...this.convertLink(node as Link));
          break;
        case 'image':
          try {
            const imageRun = await ImageEmbedder.embed((node as Image).url, this.baseDir);
            runs.push(imageRun as unknown as TextRun);
          } catch (error) {
            runs.push(new TextRun(`[Image: ${(node as Image).url}]`));
          }
          break;
        case 'inlineCode':
          runs.push(new TextRun({
            text: (node as { value: string }).value,
            font: 'Courier New',
          }));
          break;
        default:
          break;
      }
    }

    return runs;
  }

  /**
   * Converts a strong node.
   */
  private convertStrong(node: Strong): TextRun[] {
    const runs: TextRun[] = [];

    for (const child of node.children) {
      if ((child as { type: string }).type === 'text') {
        runs.push(new TextRun({
          text: (child as Text).value,
          bold: true,
        }));
      }
    }

    return runs;
  }

  /**
   * Converts an emphasis node.
   */
  private convertEmphasis(node: Emphasis): TextRun[] {
    const runs: TextRun[] = [];

    for (const child of node.children) {
      if ((child as { type: string }).type === 'text') {
        runs.push(new TextRun({
          text: (child as Text).value,
          italics: true,
        }));
      }
    }

    return runs;
  }

  /**
   * Converts a link node.
   */
  private convertLink(node: Link): TextRun[] {
    const text = node.children
      .filter(c => (c as { type: string }).type === 'text')
      .map(c => (c as Text).value)
      .join('');

    return [
      new TextRun({
        text,
        style: 'Hyperlink',
      }),
    ];
  }
}
