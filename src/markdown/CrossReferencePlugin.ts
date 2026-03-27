import type { Image, Root, Text, PhrasingContent, Paragraph } from 'mdast';
import type { Plugin } from 'unified';
import { visit, SKIP, CONTINUE } from 'unist-util-visit';

const FIGURE_LABEL_PATTERN = /^fig:[A-Za-z0-9:_-]+$/;
const INLINE_REF_PATTERN = /@fig:[A-Za-z0-9:_-]+/g;
const IMAGE_LABEL_SUFFIX_PATTERN = /^\s*\{#(fig:[A-Za-z0-9:_-]+)\}/;

export interface FigureReferenceNode {
  type: 'figureReference';
  label: string;
  data?: Record<string, unknown>;
}

declare module 'mdast' {
  interface PhrasingContentMap {
    figureReference: FigureReferenceNode;
  }
}

function isValidFigureLabel(label: string): boolean {
  return FIGURE_LABEL_PATTERN.test(label);
}

function setFigureLabel(image: Image, label: string): void {
  if (!isValidFigureLabel(label)) {
    return;
  }

  const data = (image.data ?? {}) as Record<string, unknown>;
  data['docportFigureLabel'] = label;
  image.data = data;
}

export function getFigureLabel(image: Image): string | null {
  const data = image.data as Record<string, unknown> | undefined;
  const label = data?.['docportFigureLabel'];

  if (typeof label === 'string' && isValidFigureLabel(label)) {
    return label;
  }

  return null;
}

function extractImageSuffixLabel(paragraph: Paragraph): void {
  for (let i = 0; i < paragraph.children.length; i++) {
    const child = paragraph.children[i];
    if (!child || child.type !== 'image') {
      continue;
    }

    const next = paragraph.children[i + 1];
    if (!next || next.type !== 'text') {
      continue;
    }

    const textNode = next as Text;
    const match = textNode.value.match(IMAGE_LABEL_SUFFIX_PATTERN);
    if (!match || !match[1]) {
      continue;
    }

    const label = match[1];
    setFigureLabel(child, label);
    textNode.value = textNode.value.replace(IMAGE_LABEL_SUFFIX_PATTERN, '');

    if (textNode.value.length === 0) {
      paragraph.children.splice(i + 1, 1);
    }
  }
}

function parseInlineFigureRefs(root: Root): void {
  visit(root, 'text', (node: Text, index, parent) => {
    if (index === null || !parent) return CONTINUE;
    INLINE_REF_PATTERN.lastIndex = 0;
    if (!INLINE_REF_PATTERN.test(node.value)) return CONTINUE;

    INLINE_REF_PATTERN.lastIndex = 0;
    const newNodes: PhrasingContent[] = [];
    let cursor = 0;
    let match = INLINE_REF_PATTERN.exec(node.value);

    while (match) {
      const fullMatch = match[0];
      const matchStart = match.index;
      const label = fullMatch.slice(1);

      if (matchStart > cursor) {
        const textBefore = node.value.slice(cursor, matchStart);
        if (textBefore.length > 0) {
          newNodes.push({ type: 'text', value: textBefore });
        }
      }

      if (isValidFigureLabel(label)) {
        newNodes.push({
          type: 'figureReference',
          label,
        });
      } else {
        newNodes.push({ type: 'text', value: fullMatch });
      }

      cursor = matchStart + fullMatch.length;
      match = INLINE_REF_PATTERN.exec(node.value);
    }

    if (cursor < node.value.length) {
      const tail = node.value.slice(cursor);
      if (tail.length > 0) {
        newNodes.push({ type: 'text', value: tail });
      }
    }

    if (newNodes.length > 0) {
      parent.children.splice(index as number, 1, ...newNodes);
      return [SKIP, (index as number) + newNodes.length];
    }

    return CONTINUE;
  });
}

export const remarkCrossReference: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'paragraph', (node: Paragraph) => {
      extractImageSuffixLabel(node);
    });

    parseInlineFigureRefs(tree);
  };
};

export const remarkCrossReferenceStringify: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'figureReference', (node: FigureReferenceNode, index, parent) => {
      if (index === null || !parent) return;

      const textNode: Text = {
        type: 'text',
        value: `@${node.label}`,
      };

      parent.children[index as number] = textNode as PhrasingContent;
      return [SKIP, index];
    });
  };
};
