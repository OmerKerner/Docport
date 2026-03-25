// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - docx library ESM/type compatibility issues in NodeNext mode
import docx from 'docx';
import type {
  Root,
  Heading,
  Paragraph as MdParagraph,
  Text,
  Strong,
  Emphasis,
  Link,
  Image,
  List,
  ListItem,
} from 'mdast';
import type { DocportDocument } from '../types/index.js';
import { ImageEmbedder } from './ImageEmbedder.js';

type DocxCtor<T = unknown> = new (options: Record<string, unknown> | string) => T;

const docxRecord = docx as unknown as Record<string, unknown>;
const DocumentCtor = docxRecord['Document'] as DocxCtor;
const ParagraphCtor = docxRecord['Paragraph'] as DocxCtor;
const TextRunCtor = docxRecord['TextRun'] as DocxCtor;
const PageBreakCtor = docxRecord['PageBreak'] as new () => unknown;
const headingLevel = (docxRecord['HeadingLevel'] as Record<string, unknown>) ?? {};
const alignmentType = (docxRecord['AlignmentType'] as Record<string, unknown>) ?? {};
const PackerValue = docxRecord['Packer'] as { toBuffer?: (doc: unknown) => Promise<Buffer> };

/**
 * Converts a DocportDocument (remark AST + metadata) to a .docx buffer.
 */
export class DocxBuilder {
  private baseDir?: string;

  async build(doc: DocportDocument, baseDir?: string): Promise<Buffer> {
    this.baseDir = baseDir;

    const sections: unknown[] = [];

    sections.push(
      new ParagraphCtor({
        text: doc.manifest.title,
        heading: headingLevel['TITLE'],
        alignment: alignmentType['CENTER'],
      }),
    );

    for (const author of doc.manifest.authors) {
      const authorText = author.affiliation ? `${author.name} (${author.affiliation})` : author.name;
      sections.push(
        new ParagraphCtor({
          text: authorText,
          alignment: alignmentType['CENTER'],
        }),
      );
    }

    sections.push(new ParagraphCtor({ children: [new PageBreakCtor()] }));

    for (const chapter of doc.chapters) {
      const chapterParagraphs = await this.convertChapter(chapter.ast, chapter.file);
      sections.push(...chapterParagraphs);
      sections.push(new ParagraphCtor({ children: [new PageBreakCtor()] }));
    }

    const docxDoc = new DocumentCtor({
      sections: [{ properties: {}, children: sections }],
      title: doc.manifest.title,
      creator: doc.manifest.authors[0]?.name ?? 'Docport',
    });

    if (typeof PackerValue?.toBuffer === 'function') {
      return PackerValue.toBuffer(docxDoc);
    }

    throw new Error('docx Packer.toBuffer is unavailable in current runtime');
  }

  private async convertChapter(ast: Root, chapterFile: string): Promise<unknown[]> {
    const paragraphs: unknown[] = [];
    for (const node of ast.children) {
      const converted = await this.convertNode(node, chapterFile);
      if (converted === null) {
        continue;
      }
      if (Array.isArray(converted)) {
        paragraphs.push(...converted);
      } else {
        paragraphs.push(converted);
      }
    }
    return paragraphs;
  }

  private async convertNode(node: unknown, chapterFile: string): Promise<unknown[] | unknown | null> {
    const typedNode = node as { type: string };

    switch (typedNode.type) {
      case 'heading':
        return this.convertHeading(node as Heading);
      case 'paragraph':
        return this.convertParagraph(node as MdParagraph, chapterFile);
      case 'list':
        return this.convertList(node as List, chapterFile);
      case 'blockquote':
        return this.convertBlockquote(node as { children: unknown[] }, chapterFile);
      case 'thematicBreak':
        return new ParagraphCtor({ text: '---' });
      default:
        return null;
    }
  }

  private convertHeading(node: Heading): unknown {
    const levels = [
      headingLevel['HEADING_1'],
      headingLevel['HEADING_2'],
      headingLevel['HEADING_3'],
      headingLevel['HEADING_4'],
      headingLevel['HEADING_5'],
      headingLevel['HEADING_6'],
    ];
    const heading = levels[node.depth - 1] ?? headingLevel['HEADING_1'];
    const runs = this.convertInlineNodes(node.children);
    return new ParagraphCtor({ heading, children: runs });
  }

  private async convertParagraph(node: MdParagraph, chapterFile: string): Promise<unknown> {
    const runs = await this.convertInlineNodesAsync(node.children, chapterFile);
    return new ParagraphCtor({ children: runs });
  }

  private async convertList(node: List, chapterFile: string): Promise<unknown[]> {
    const paragraphs: unknown[] = [];
    for (const item of node.children) {
      const listItem = item as ListItem;
      for (const child of listItem.children) {
        if ((child as { type: string }).type !== 'paragraph') {
          continue;
        }
        const p = child as MdParagraph;
        const runs = await this.convertInlineNodesAsync(p.children, chapterFile);
        paragraphs.push(
          new ParagraphCtor({
            children: runs,
            bullet: node.ordered ? undefined : { level: 0 },
            numbering: node.ordered ? { reference: 'default', level: 0 } : undefined,
          }),
        );
      }
    }
    return paragraphs;
  }

  private async convertBlockquote(node: { children: unknown[] }, chapterFile: string): Promise<unknown[]> {
    const paragraphs: unknown[] = [];
    for (const child of node.children) {
      if ((child as { type: string }).type !== 'paragraph') {
        continue;
      }
      const p = child as MdParagraph;
      const runs = await this.convertInlineNodesAsync(p.children, chapterFile);
      paragraphs.push(
        new ParagraphCtor({
          children: runs,
          indent: { left: 720 },
        }),
      );
    }
    return paragraphs;
  }

  private convertInlineNodes(nodes: unknown[]): unknown[] {
    const runs: unknown[] = [];
    for (const node of nodes) {
      const typedNode = node as { type: string };
      switch (typedNode.type) {
        case 'text':
          runs.push(new TextRunCtor((node as Text).value));
          break;
        case 'strong':
          runs.push(...this.convertStrong(node as Strong));
          break;
        case 'emphasis':
          runs.push(...this.convertEmphasis(node as Emphasis));
          break;
        case 'inlineCode':
          runs.push(
            new TextRunCtor({
              text: (node as { value: string }).value,
              font: 'Courier New',
            }),
          );
          break;
        default:
          break;
      }
    }
    return runs;
  }

  private async convertInlineNodesAsync(nodes: unknown[], _chapterFile: string): Promise<unknown[]> {
    const runs: unknown[] = [];
    for (const node of nodes) {
      const typedNode = node as { type: string };
      switch (typedNode.type) {
        case 'text':
          runs.push(new TextRunCtor((node as Text).value));
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
            runs.push(imageRun);
          } catch {
            runs.push(new TextRunCtor(`[Image: ${(node as Image).url}]`));
          }
          break;
        case 'inlineCode':
          runs.push(
            new TextRunCtor({
              text: (node as { value: string }).value,
              font: 'Courier New',
            }),
          );
          break;
        default:
          break;
      }
    }
    return runs;
  }

  private convertStrong(node: Strong): unknown[] {
    const runs: unknown[] = [];
    for (const child of node.children) {
      if ((child as { type: string }).type !== 'text') {
        continue;
      }
      runs.push(
        new TextRunCtor({
          text: (child as Text).value,
          bold: true,
        }),
      );
    }
    return runs;
  }

  private convertEmphasis(node: Emphasis): unknown[] {
    const runs: unknown[] = [];
    for (const child of node.children) {
      if ((child as { type: string }).type !== 'text') {
        continue;
      }
      runs.push(
        new TextRunCtor({
          text: (child as Text).value,
          italics: true,
        }),
      );
    }
    return runs;
  }

  private convertLink(node: Link): unknown[] {
    const text = node.children
      .filter((c) => (c as { type: string }).type === 'text')
      .map((c) => (c as Text).value)
      .join('');

    return [
      new TextRunCtor({
        text,
        style: 'Hyperlink',
      }),
    ];
  }
}
