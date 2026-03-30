import type { Paragraph, PhrasingContent, Root, Text } from 'mdast';
import type { Plugin } from 'unified';
import { CONTINUE, SKIP, visit } from 'unist-util-visit';

export interface EquationInlineNode {
  type: 'equationInline';
  latex: string;
  data?: Record<string, unknown>;
}

export interface EquationBlockNode {
  type: 'equationBlock';
  latex: string;
  label?: string;
  data?: Record<string, unknown>;
}

declare module 'mdast' {
  interface PhrasingContentMap {
    equationInline: EquationInlineNode;
  }

  interface RootContentMap {
    equationBlock: EquationBlockNode;
  }
}

interface InlineSegmentText {
  kind: 'text';
  value: string;
}

interface InlineSegmentEquation {
  kind: 'equation';
  latex: string;
}

type InlineSegment = InlineSegmentText | InlineSegmentEquation;

function parseInlineMathSegments(value: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let cursor = 0;
  let activeStart: number | null = null;
  let current = '';

  const flushText = (text: string): void => {
    if (text.length > 0) {
      segments.push({ kind: 'text', value: text });
    }
  };

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const prev = i > 0 ? value[i - 1] : '';
    const next = i + 1 < value.length ? value[i + 1] : '';
    const escaped = prev === '\\';

    if (ch !== '$' || escaped) {
      continue;
    }

    // Ignore $$...$$ in inline scanner (handled as block equations).
    if (next === '$') {
      continue;
    }

    if (activeStart === null) {
      const textBefore = value.slice(cursor, i);
      flushText(textBefore);
      activeStart = i;
      cursor = i + 1;
      current = '';
      continue;
    }

    current = value.slice(cursor, i);
    if (current.trim().length > 0) {
      segments.push({ kind: 'equation', latex: current.trim() });
    } else {
      flushText(value.slice(activeStart, i + 1));
    }
    activeStart = null;
    cursor = i + 1;
    current = '';
  }

  if (activeStart !== null) {
    flushText(value.slice(activeStart));
  } else if (cursor < value.length) {
    flushText(value.slice(cursor));
  }

  return segments;
}

function extractParagraphPlainText(paragraph: Paragraph): string | null {
  let plain = '';
  for (const child of paragraph.children) {
    if (child.type !== 'text') {
      return null;
    }
    plain += child.value;
  }
  return plain;
}

function parseBlockLatex(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('$$') || !trimmed.endsWith('$$') || trimmed.length < 4) {
    return null;
  }
  const inner = trimmed.slice(2, -2).trim();
  return inner.length > 0 ? inner : null;
}

export const remarkEquation: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'paragraph', (node: Paragraph, index, parent) => {
      if (index === null || index === undefined || !parent) {
        return CONTINUE;
      }
      const plain = extractParagraphPlainText(node);
      if (plain === null) {
        return CONTINUE;
      }
      const blockLatex = parseBlockLatex(plain);
      if (!blockLatex) {
        return CONTINUE;
      }

      const blockNode: EquationBlockNode = {
        type: 'equationBlock',
        latex: blockLatex,
      };
      parent.children[index] = blockNode;
      return [SKIP, index];
    });

    visit(tree, 'text', (node: Text, index, parent) => {
      if (index === null || index === undefined || !parent) {
        return CONTINUE;
      }

      const segments = parseInlineMathSegments(node.value);
      const hasEquation = segments.some((segment) => segment.kind === 'equation');
      if (!hasEquation) {
        return CONTINUE;
      }

      const newNodes: PhrasingContent[] = segments.map((segment) => {
        if (segment.kind === 'text') {
          return { type: 'text', value: segment.value };
        }
        const equationNode: EquationInlineNode = {
          type: 'equationInline',
          latex: segment.latex,
        };
        return equationNode as PhrasingContent;
      });

      parent.children.splice(index, 1, ...newNodes);
      return [SKIP, index + newNodes.length];
    });
  };
};

export const remarkEquationStringify: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'equationBlock', (node: EquationBlockNode, index, parent) => {
      if (index === null || index === undefined || !parent) {
        return;
      }
      const paragraphNode: Paragraph = {
        type: 'paragraph',
        children: [{ type: 'text', value: `$$${node.latex}$$` }],
      };
      parent.children[index] = paragraphNode;
      return [SKIP, index];
    });

    visit(tree, 'equationInline', (node: EquationInlineNode, index, parent) => {
      if (index === null || index === undefined || !parent) {
        return;
      }
      const textNode: Text = {
        type: 'text',
        value: `$${node.latex}$`,
      };
      parent.children[index] = textNode as PhrasingContent;
      return [SKIP, index];
    });
  };
};

