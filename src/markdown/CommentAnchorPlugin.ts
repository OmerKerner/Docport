import type { Root, Html, PhrasingContent } from 'mdast';
import type { Plugin } from 'unified';
import { visit, SKIP } from 'unist-util-visit';

/**
 * Comment anchor node for the unified AST.
 * Represents HTML comments like:
 * <!-- @comment id:"uuid" author:"PI" date:"2025-03-20" -->
 */
export interface CommentAnchorNode {
  type: 'commentAnchor';
  id: string;
  author: string;
  date: string;
  data?: Record<string, unknown>;
}

// Extend mdast types to include our custom node
declare module 'mdast' {
  interface PhrasingContentMap {
    commentAnchor: CommentAnchorNode;
  }
}

/**
 * Parse HTML comment attributes.
 * Format: key:"value" or key:value
 * Supports quoted and unquoted values.
 */
function parseCommentAttributes(content: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  
  // Match key:"value" or key:value patterns
  const attrRegex = /(\w+):\s*(?:"([^"]*)"|(\S+))/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(content)) !== null) {
    const key = match[1];
    const quotedValue = match[2];
    const unquotedValue = match[3];
    if (key && (quotedValue !== undefined || unquotedValue !== undefined)) {
      attrs[key] = quotedValue !== undefined ? quotedValue : (unquotedValue || '');
    }
  }

  return attrs;
}

/**
 * Check if an HTML node is a comment anchor.
 */
function isCommentAnchor(value: string): boolean {
  return value.trim().startsWith('<!-- @comment') && value.trim().endsWith('-->');
}

/**
 * Parse phase: convert HTML comment anchors to commentAnchor nodes.
 */
export const remarkCommentAnchor: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'html', (node: Html, index, parent) => {
      if (index === null || !parent) return;

      if (!isCommentAnchor(node.value)) return;

      // Extract content between <!-- @comment and -->
      const content = node.value
        .trim()
        .replace(/^<!--\s*@comment\s*/, '')
        .replace(/\s*-->$/, '');

      const attrs = parseCommentAttributes(content);

      // Validate required attributes
      if (!attrs['id'] || !attrs['author'] || !attrs['date']) {
        return; // Skip malformed anchors
      }

      // Replace HTML node with commentAnchor node
      const anchorNode: CommentAnchorNode = {
        type: 'commentAnchor',
        id: attrs['id'],
        author: attrs['author'],
        date: attrs['date'],
      };

      parent.children[index as number] = anchorNode as PhrasingContent;
      return [SKIP, index];
    });
  };
};

/**
 * Stringify phase: convert commentAnchor nodes back to HTML comments.
 */
export const remarkCommentAnchorStringify: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'commentAnchor', (node: CommentAnchorNode, index, parent) => {
      if (index === null || !parent) return;

      // Format: <!-- @comment id:"uuid" author:"name" date:"ISO8601" -->
      const htmlValue = `<!-- @comment id:"${node.id}" author:"${node.author}" date:"${node.date}" -->`;
      
      const htmlNode: Html = {
        type: 'html',
        value: htmlValue,
      };

      parent.children[index as number] = htmlNode as PhrasingContent;
      return [SKIP, index];
    });
  };
};

/**
 * Helper to create a comment anchor node.
 */
export function createCommentAnchor(
  id: string,
  author: string,
  date: string
): CommentAnchorNode {
  return {
    type: 'commentAnchor',
    id,
    author,
    date,
  };
}
