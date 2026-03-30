import * as docx from 'docx';
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
import type { FigureReferenceNode } from '../markdown/CrossReferencePlugin.js';
import { getFigureLabel } from '../markdown/CrossReferencePlugin.js';
import type { EquationInlineNode, EquationBlockNode } from '../markdown/EquationPlugin.js';

type DocxCtor<T = unknown> = new (options: Record<string, unknown> | string) => T;

const docxRecord = docx as unknown as Record<string, unknown>;
const DocumentCtor = docxRecord['Document'] as DocxCtor;
const ParagraphCtor = docxRecord['Paragraph'] as DocxCtor;
const TextRunCtor = docxRecord['TextRun'] as DocxCtor;
const PageBreakCtor = docxRecord['PageBreak'] as new () => unknown;
const BookmarkCtor = docxRecord['Bookmark'] as DocxCtor;
const InternalHyperlinkCtor = docxRecord['InternalHyperlink'] as DocxCtor;
const MathCtor = docxRecord['Math'] as DocxCtor | undefined;
const MathRunCtor = docxRecord['MathRun'] as (new (text: string) => unknown) | undefined;
const MathFractionCtor = docxRecord['MathFraction'] as DocxCtor | undefined;
const MathSuperScriptCtor = docxRecord['MathSuperScript'] as DocxCtor | undefined;
const MathSubScriptCtor = docxRecord['MathSubScript'] as DocxCtor | undefined;
const MathRadicalCtor = docxRecord['MathRadical'] as DocxCtor | undefined;
const MathSumCtor = docxRecord['MathSum'] as DocxCtor | undefined;
const MathIntegralCtor = docxRecord['MathIntegral'] as DocxCtor | undefined;
const headingLevel = (docxRecord['HeadingLevel'] as Record<string, unknown>) ?? {};
const alignmentType = (docxRecord['AlignmentType'] as Record<string, unknown>) ?? {};
const PackerValue = docxRecord['Packer'] as { toBuffer?: (doc: unknown) => Promise<Buffer> };

/**
 * Converts a DocportDocument (remark AST + metadata) to a .docx buffer.
 */
export class DocxBuilder {
  private baseDir?: string;
  private bookmarkIds = new Map<string, string>();
  private static readonly FIGURE_BOOKMARK_PREFIX = 'docport_';

  async build(doc: DocportDocument, baseDir?: string): Promise<Buffer> {
    this.baseDir = baseDir;
    this.bookmarkIds = new Map<string, string>();

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
      case 'equationBlock':
        return this.convertEquationBlock(node as EquationBlockNode);
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
        case 'equationInline':
          runs.push(this.createInlineEquationRun(node as EquationInlineNode));
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
            const imageNode = node as Image;
            const imageRun = await ImageEmbedder.embed(imageNode.url, this.baseDir);
            const figureLabel = getFigureLabel(imageNode);

            if (figureLabel) {
              const bookmarkId = this.ensureBookmarkId(figureLabel);
              runs.push(
                new BookmarkCtor({
                  id: bookmarkId,
                  children: [imageRun],
                }),
              );
            } else {
              runs.push(imageRun);
            }
          } catch {
            const imageNode = node as Image;
            const fallbackRun = new TextRunCtor(`[Image: ${imageNode.url}]`);
            const figureLabel = getFigureLabel(imageNode);

            if (figureLabel) {
              const bookmarkId = this.ensureBookmarkId(figureLabel);
              runs.push(
                new BookmarkCtor({
                  id: bookmarkId,
                  children: [fallbackRun],
                }),
              );
            } else {
              runs.push(fallbackRun);
            }
          }
          break;
        case 'figureReference':
          runs.push(this.createFigureReferenceRun(node as FigureReferenceNode));
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

  private createFigureReferenceRun(node: FigureReferenceNode): unknown {
    const label = node.label;
    const bookmarkId = this.ensureBookmarkId(label);
    const displayText = `@${label}`;
    const textRun = new TextRunCtor(displayText);

    if (InternalHyperlinkCtor) {
      return new InternalHyperlinkCtor({
        children: [textRun],
        anchor: bookmarkId,
      });
    }

    return textRun;
  }

  private convertEquationBlock(node: EquationBlockNode): unknown {
    const mathNode = this.createMathNodeFromLatex(node.latex);
    if (mathNode) {
      return new ParagraphCtor({
        children: [mathNode],
      });
    }
    return new ParagraphCtor({ text: `$$${node.latex}$$` });
  }

  private createInlineEquationRun(node: EquationInlineNode): unknown {
    const mathNode = this.createMathNodeFromLatex(node.latex);
    if (mathNode) {
      return mathNode;
    }
    return new TextRunCtor(`$${node.latex}$`);
  }

  private createMathNodeFromLatex(latex: string): unknown | null {
    if (!MathCtor || !MathRunCtor) {
      return null;
    }

    const parsed = this.parseLatexToDocxMathChildren(latex.trim());
    return new MathCtor({ children: parsed });
  }

  private parseLatexToDocxMathChildren(latex: string): unknown[] {
    if (!MathRunCtor) {
      return [];
    }

    const fraction = latex.match(/^\\frac\{([^{}]+)\}\{([^{}]+)\}$/);
    if (fraction && MathFractionCtor) {
      return [
        new MathFractionCtor({
          numerator: [new MathRunCtor(fraction[1] ?? '')],
          denominator: [new MathRunCtor(fraction[2] ?? '')],
        } as Record<string, unknown>),
      ];
    }

    const radical = latex.match(/^\\sqrt(?:\[([^{}\]]+)\])?\{([^{}]+)\}$/);
    if (radical && MathRadicalCtor) {
      const degree = radical[1];
      const body = radical[2] ?? '';
      return [
        new MathRadicalCtor({
          degree: degree ? [new MathRunCtor(degree)] : undefined,
          children: [new MathRunCtor(body)],
        } as Record<string, unknown>),
      ];
    }

    const sum = latex.match(/^\\sum(?:_\{([^{}]+)\})?(?:\^\{([^{}]+)\})?\s*(.+)?$/);
    if (sum && MathSumCtor) {
      const base = sum[3]?.trim() || '';
      return [
        new MathSumCtor({
          subScript: sum[1] ? [new MathRunCtor(sum[1])] : undefined,
          superScript: sum[2] ? [new MathRunCtor(sum[2])] : undefined,
          children: [new MathRunCtor(base)],
        } as Record<string, unknown>),
      ];
    }

    const integral = latex.match(/^\\int(?:_\{([^{}]+)\})?(?:\^\{([^{}]+)\})?\s*(.+)?$/);
    if (integral && MathIntegralCtor) {
      const base = integral[3]?.trim() || '';
      return [
        new MathIntegralCtor({
          subScript: integral[1] ? [new MathRunCtor(integral[1])] : undefined,
          superScript: integral[2] ? [new MathRunCtor(integral[2])] : undefined,
          children: [new MathRunCtor(base)],
        } as Record<string, unknown>),
      ];
    }

    const superScript = latex.match(/^([^_^{}]+)\^\{([^{}]+)\}$/);
    if (superScript && MathSuperScriptCtor) {
      return [
        new MathSuperScriptCtor({
          children: [new MathRunCtor(superScript[1] ?? '')],
          superScript: [new MathRunCtor(superScript[2] ?? '')],
        } as Record<string, unknown>),
      ];
    }

    const subScript = latex.match(/^([^_^{}]+)_\{([^{}]+)\}$/);
    if (subScript && MathSubScriptCtor) {
      return [
        new MathSubScriptCtor({
          children: [new MathRunCtor(subScript[1] ?? '')],
          subScript: [new MathRunCtor(subScript[2] ?? '')],
        } as Record<string, unknown>),
      ];
    }

    return [new MathRunCtor(latex)];
  }

  private ensureBookmarkId(label: string): string {
    const existing = this.bookmarkIds.get(label);
    if (existing) {
      return existing;
    }

    const sanitized = label.replace(/[^A-Za-z0-9_:-]/g, '_');
    const bookmarkId = `${DocxBuilder.FIGURE_BOOKMARK_PREFIX}${sanitized}`;
    this.bookmarkIds.set(label, bookmarkId);
    return bookmarkId;
  }
}
