import type { Root, PhrasingContent, Paragraph } from 'mdast';
import { writeFile } from 'fs/promises';
import { unified } from 'unified';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import { visit, SKIP, CONTINUE } from 'unist-util-visit';

import type { ParsedChapter } from '../types/index.js';
import type { Comment } from '../types/index.js';
import type { Revision } from '../types/index.js';

import {
  remarkCriticMarkupStringify,
  type CriticInsertionNode,
  type CriticDeletionNode,
  type CriticSubstitutionNode,
} from './CriticMarkupPlugin.js';
import {
  remarkCommentAnchorStringify,
  createCommentAnchor,
} from './CommentAnchorPlugin.js';
import { remarkCrossReferenceStringify } from './CrossReferencePlugin.js';

/**
 * Writes ParsedChapter objects back to markdown files with annotations.
 */
export class MarkdownWriter {
  /**
   * Write a chapter to disk as markdown.
   * 
   * @param chapter - The ParsedChapter containing AST and metadata
   * @param outputPath - Absolute path where the file should be written
   */
  async writeChapter(chapter: ParsedChapter, outputPath: string): Promise<void> {
    // Build unified processor pipeline for stringification
    const processor = unified()
      .use(remarkStringify, {
        bullet: '-',
        emphasis: '_',
        strong: '*',
        rule: '-',
        fences: true,
        incrementListMarker: true,
      })
      .use(remarkGfm)
      .use(remarkCriticMarkupStringify)
      .use(remarkCommentAnchorStringify)
      .use(remarkCrossReferenceStringify);

    // Stringify AST to markdown
    const markdown = processor.stringify(chapter.ast);

    // Write to file
    await writeFile(outputPath, markdown, 'utf-8');
  }

  /**
   * Insert a comment anchor into the AST at the appropriate position.
   * Finds the position by matching the anchorQuote to text in the AST.
   * 
   * @param ast - The AST to modify
   * @param comment - The comment to insert
   * @returns Modified AST
   */
  insertCommentAnchor(ast: Root, comment: Comment): Root {
    let inserted = false;

    visit(ast, 'text', (node: any, index, parent) => {
      if (inserted || index === null || !parent) return CONTINUE;

      // Check if this text node contains the anchor quote
      const textValue = node.value;
      const quoteIndex = textValue.indexOf(comment.anchorQuote);

      if (quoteIndex !== -1) {
        // Create the comment anchor node
        const anchorNode = createCommentAnchor(
          comment.id,
          comment.author,
          comment.date.toISOString()
        );

        // Insert the anchor before the text containing the quote
        parent.children.splice(index as number, 0, anchorNode as PhrasingContent);
        inserted = true;
        return [SKIP, (index as number) + 1];
      }
      
      return CONTINUE;
    });

    if (!inserted) {
      // If we couldn't find the exact quote, insert at the start of the first paragraph
      // This is a fallback for cases where text has been edited
      visit(ast, 'paragraph', (node: Paragraph, index, parent) => {
        if (inserted || !parent || index === null) return CONTINUE;

        const anchorNode = createCommentAnchor(
          comment.id,
          comment.author,
          comment.date.toISOString()
        );

        // Insert as first child of the paragraph
        if (node.children.length > 0) {
          node.children.unshift(anchorNode as PhrasingContent);
          inserted = true;
          return SKIP;
        }
        
        return CONTINUE;
      });
    }

    return ast;
  }

  /**
   * Insert a revision (insertion or deletion) into the AST.
   * Finds the position using precedingContext and text matching.
   * 
   * @param ast - The AST to modify
   * @param revision - The revision to insert
   * @returns Modified AST
   */
  insertRevision(ast: Root, revision: Revision): Root {
    let inserted = false;

    visit(ast, 'text', (node: any, index, parent) => {
      if (inserted || index === null || !parent) return CONTINUE;

      const textValue = node.value;

      // For insertions, look for the preceding context
      if (revision.kind === 'insertion') {
        if (textValue.includes(revision.precedingContext)) {
          const contextEnd = textValue.indexOf(revision.precedingContext) + revision.precedingContext.length;
          
          // Split the text node
          const before = textValue.slice(0, contextEnd);
          const after = textValue.slice(contextEnd);

          const newNodes: PhrasingContent[] = [];
          
          if (before) {
            newNodes.push({ type: 'text', value: before });
          }

          // Insert the insertion node
          const insertionNode: CriticInsertionNode = {
            type: 'criticInsertion',
            value: revision.text,
          };
          newNodes.push(insertionNode as PhrasingContent);

          if (after) {
            newNodes.push({ type: 'text', value: after });
          }

          parent.children.splice(index as number, 1, ...newNodes);
          inserted = true;
          return [SKIP, (index as number) + newNodes.length];
        }
      }

      // For deletions, look for the exact text to mark as deleted
      if (revision.kind === 'deletion') {
        const deleteIndex = textValue.indexOf(revision.text);
        
        if (deleteIndex !== -1) {
          // Split the text node
          const before = textValue.slice(0, deleteIndex);
          const after = textValue.slice(deleteIndex + revision.text.length);

          const newNodes: PhrasingContent[] = [];

          if (before) {
            newNodes.push({ type: 'text', value: before });
          }

          // Insert the deletion node
          const deletionNode: CriticDeletionNode = {
            type: 'criticDeletion',
            value: revision.text,
          };
          newNodes.push(deletionNode as PhrasingContent);

          if (after) {
            newNodes.push({ type: 'text', value: after });
          }

          parent.children.splice(index as number, 1, ...newNodes);
          inserted = true;
          return [SKIP, (index as number) + newNodes.length];
        }
      }
      
      return CONTINUE;
    });

    return ast;
  }

  /**
   * Finalize a revision by either accepting or rejecting it.
   * 
   * - Accept insertion: unwrap the inserted text (remove markup)
   * - Reject insertion: remove the inserted text entirely
   * - Accept deletion: remove the deleted text entirely
   * - Reject deletion: unwrap the deleted text (restore it)
   * 
   * @param ast - The AST to modify
   * @param revision - The revision to finalize
   * @param accept - Whether to accept (true) or reject (false) the revision
   * @returns Modified AST
   */
  finalizeRevision(ast: Root, revision: Revision, accept: boolean): Root {
    visit(ast, (node: any, index, parent) => {
      if (index === null || !parent) return CONTINUE;

      if (node.type === 'criticInsertion' && revision.kind === 'insertion') {
        const insertionNode = node as CriticInsertionNode;
        
        if (insertionNode.value === revision.text) {
          if (accept) {
            // Accept: replace with plain text
            parent.children[index as number] = {
              type: 'text',
              value: insertionNode.value,
            } as PhrasingContent;
          } else {
            // Reject: remove the insertion
            parent.children.splice(index as number, 1);
          }
          return [SKIP, index];
        }
      }

      if (node.type === 'criticDeletion' && revision.kind === 'deletion') {
        const deletionNode = node as CriticDeletionNode;
        
        if (deletionNode.value === revision.text) {
          if (accept) {
            // Accept: remove the deleted text
            parent.children.splice(index as number, 1);
          } else {
            // Reject: restore the text
            parent.children[index as number] = {
              type: 'text',
              value: deletionNode.value,
            } as PhrasingContent;
          }
          return [SKIP, index];
        }
      }

      if (node.type === 'criticSubstitution') {
        const substNode = node as CriticSubstitutionNode;
        
        // Check if this matches our revision
        const matchesOld = revision.kind === 'deletion' && substNode.oldValue === revision.text;
        const matchesNew = revision.kind === 'insertion' && substNode.newValue === revision.text;

        if (matchesOld || matchesNew) {
          if (accept) {
            // Accept: use the new value
            parent.children[index as number] = {
              type: 'text',
              value: substNode.newValue,
            } as PhrasingContent;
          } else {
            // Reject: use the old value
            parent.children[index as number] = {
              type: 'text',
              value: substNode.oldValue,
            } as PhrasingContent;
          }
          return [SKIP, index];
        }
      }
      
      return CONTINUE;
    });

    return ast;
  }

  /**
   * Helper to find all unresolved revisions in an AST.
   * Useful for identifying which revisions still need to be decided.
   */
  findUnresolvedRevisions(ast: Root): Array<{ kind: 'insertion' | 'deletion'; text: string }> {
    const unresolved: Array<{ kind: 'insertion' | 'deletion'; text: string }> = [];

    visit(ast, (node: any) => {
      if (node.type === 'criticInsertion') {
        unresolved.push({
          kind: 'insertion',
          text: node.value,
        });
      } else if (node.type === 'criticDeletion') {
        unresolved.push({
          kind: 'deletion',
          text: node.value,
        });
      } else if (node.type === 'criticSubstitution') {
        const substNode = node as CriticSubstitutionNode;
        unresolved.push({
          kind: 'deletion',
          text: substNode.oldValue,
        });
        unresolved.push({
          kind: 'insertion',
          text: substNode.newValue,
        });
      }
    });

    return unresolved;
  }
}
