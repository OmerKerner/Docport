import type { Root, Text, PhrasingContent } from 'mdast';
import type { Plugin } from 'unified';
import { visit, SKIP, CONTINUE } from 'unist-util-visit';

/**
 * CriticMarkup node types for the unified AST.
 */

export interface CriticInsertionNode {
  type: 'criticInsertion';
  value: string;
  data?: Record<string, unknown>;
}

export interface CriticDeletionNode {
  type: 'criticDeletion';
  value: string;
  data?: Record<string, unknown>;
}

export interface CriticSubstitutionNode {
  type: 'criticSubstitution';
  oldValue: string;
  newValue: string;
  data?: Record<string, unknown>;
}

export interface CriticHighlightNode {
  type: 'criticHighlight';
  value: string;
  data?: Record<string, unknown>;
}

export interface CriticCommentNode {
  type: 'criticComment';
  value: string;
  data?: Record<string, unknown>;
}

export type CriticMarkupNode =
  | CriticInsertionNode
  | CriticDeletionNode
  | CriticSubstitutionNode
  | CriticHighlightNode
  | CriticCommentNode;

// Extend mdast types to include our custom nodes
declare module 'mdast' {
  interface PhrasingContentMap {
    criticInsertion: CriticInsertionNode;
    criticDeletion: CriticDeletionNode;
    criticSubstitution: CriticSubstitutionNode;
    criticHighlight: CriticHighlightNode;
    criticComment: CriticCommentNode;
  }
}

/**
 * Token types for the state machine scanner.
 */
type TokenType = 'insertion' | 'deletion' | 'substitution' | 'highlight' | 'comment' | 'text';

interface Token {
  type: TokenType;
  value?: string;
  oldValue?: string;
  newValue?: string;
  start: number;
  end: number;
}

/**
 * State machine tokenizer for CriticMarkup.
 * Handles nested braces and edge cases without regex.
 */
function tokenizeCriticMarkup(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    // Check for CriticMarkup start sequences
    if (i < len - 2 && input[i] === '{') {
      const marker = input.slice(i, i + 3);
      
      if (marker === '{++') {
        // Insertion: {++text++}
        const result = extractBracedContent(input, i, '++', '++}');
        if (result) {
          tokens.push({
            type: 'insertion',
            value: result.content,
            start: i,
            end: result.end,
          });
          i = result.end;
          continue;
        }
      } else if (marker === '{--') {
        // Deletion: {--text--}
        const result = extractBracedContent(input, i, '--', '--}');
        if (result) {
          tokens.push({
            type: 'deletion',
            value: result.content,
            start: i,
            end: result.end,
          });
          i = result.end;
          continue;
        }
      } else if (marker === '{~~') {
        // Substitution: {~~old~>new~~}
        const result = extractSubstitution(input, i);
        if (result) {
          tokens.push({
            type: 'substitution',
            oldValue: result.oldValue,
            newValue: result.newValue,
            start: i,
            end: result.end,
          });
          i = result.end;
          continue;
        }
      } else if (marker === '{==') {
        // Highlight: {==text==}
        const result = extractBracedContent(input, i, '==', '==}');
        if (result) {
          tokens.push({
            type: 'highlight',
            value: result.content,
            start: i,
            end: result.end,
          });
          i = result.end;
          continue;
        }
      } else if (marker === '{>>') {
        // Comment: {>>text<<}
        const result = extractBracedContent(input, i, '>>', '<<}');
        if (result) {
          tokens.push({
            type: 'comment',
            value: result.content,
            start: i,
            end: result.end,
          });
          i = result.end;
          continue;
        }
      }
    }

    // No match, advance
    i++;
  }

  return tokens;
}

/**
 * Extract content between delimiters, handling nested braces.
 */
function extractBracedContent(
  input: string,
  start: number,
  openMarker: string,
  closeMarker: string
): { content: string; end: number } | null {
  const openLen = openMarker.length + 1; // {++ = 3
  let i = start + openLen;
  const len = input.length;
  let braceDepth = 1;
  let content = '';

  while (i < len) {
    // Check for closing sequence
    if (i + closeMarker.length <= len && input.slice(i, i + closeMarker.length) === closeMarker) {
      if (braceDepth === 1) {
        return { content, end: i + closeMarker.length };
      }
      braceDepth--;
      content += closeMarker;
      i += closeMarker.length;
      continue;
    }

    // Check for nested opening brace
    if (input[i] === '{') {
      braceDepth++;
    }

    content += input[i];
    i++;
  }

  // Unclosed marker
  return null;
}

/**
 * Extract substitution content: {~~old~>new~~}
 */
function extractSubstitution(
  input: string,
  start: number
): { oldValue: string; newValue: string; end: number } | null {
  let i = start + 3; // Skip {~~
  const len = input.length;
  let oldValue = '';
  let newValue = '';
  let inOld = true;
  let braceDepth = 1;

  while (i < len) {
    // Check for separator ~>
    if (inOld && i + 2 <= len && input.slice(i, i + 2) === '~>') {
      inOld = false;
      i += 2;
      continue;
    }

    // Check for closing ~~}
    if (i + 3 <= len && input.slice(i, i + 3) === '~~}') {
      if (braceDepth === 1) {
        return { oldValue, newValue, end: i + 3 };
      }
      braceDepth--;
      if (inOld) {
        oldValue += '~~}';
      } else {
        newValue += '~~}';
      }
      i += 3;
      continue;
    }

    // Track nested braces
    if (input[i] === '{') {
      braceDepth++;
    }

    if (inOld) {
      oldValue += input[i];
    } else {
      newValue += input[i];
    }
    i++;
  }

  return null;
}

/**
 * Parse phase: tokenize text nodes and replace with CriticMarkup nodes.
 */
export const remarkCriticMarkup: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (index === null || !parent) return CONTINUE;

      const tokens = tokenizeCriticMarkup(node.value);
      if (tokens.length === 0) return CONTINUE;

      // Build new nodes array with critic markup nodes interspersed
      const newNodes: PhrasingContent[] = [];
      let lastEnd = 0;

      for (const token of tokens) {
        // Add text before this token
        if (token.start > lastEnd) {
          const textBefore = node.value.slice(lastEnd, token.start);
          if (textBefore) {
            newNodes.push({ type: 'text', value: textBefore });
          }
        }

        // Add the critic markup node
        switch (token.type) {
          case 'insertion':
            newNodes.push({
              type: 'criticInsertion',
              value: token.value!,
            });
            break;
          case 'deletion':
            newNodes.push({
              type: 'criticDeletion',
              value: token.value!,
            });
            break;
          case 'substitution':
            newNodes.push({
              type: 'criticSubstitution',
              oldValue: token.oldValue!,
              newValue: token.newValue!,
            });
            break;
          case 'highlight':
            newNodes.push({
              type: 'criticHighlight',
              value: token.value!,
            });
            break;
          case 'comment':
            newNodes.push({
              type: 'criticComment',
              value: token.value!,
            });
            break;
        }

        lastEnd = token.end;
      }

      // Add remaining text
      if (lastEnd < node.value.length) {
        const textAfter = node.value.slice(lastEnd);
        if (textAfter) {
          newNodes.push({ type: 'text', value: textAfter });
        }
      }

      // Replace the original text node with the new nodes
      if (newNodes.length > 0) {
        parent.children.splice(index as number, 1, ...newNodes);
        return [SKIP, (index as number) + newNodes.length];
      }
      
      return CONTINUE;
    });
  };
};

/**
 * Stringify phase: convert CriticMarkup nodes back to text.
 * This is done via a compiler that modifies nodes during the stringify phase.
 */
export const remarkCriticMarkupStringify: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, (node: any, index, parent) => {
      if (!parent || index === null) return CONTINUE;

      let replacement: any = null;

      if (node.type === 'criticInsertion') {
        replacement = {
          type: 'text',
          value: `{++${node.value}++}`,
        };
      } else if (node.type === 'criticDeletion') {
        replacement = {
          type: 'text',
          value: `{--${node.value}--}`,
        };
      } else if (node.type === 'criticSubstitution') {
        replacement = {
          type: 'text',
          value: `{~~${node.oldValue}~>${node.newValue}~~}`,
        };
      } else if (node.type === 'criticHighlight') {
        replacement = {
          type: 'text',
          value: `{==${node.value}==}`,
        };
      } else if (node.type === 'criticComment') {
        replacement = {
          type: 'text',
          value: `{>>${node.value}<<}`,
        };
      }

      if (replacement) {
        parent.children[index as number] = replacement;
        return [SKIP, index];
      }

      return CONTINUE;
    });
  };
};
