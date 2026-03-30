import type { Root } from 'mdast';
import { readFile } from 'fs/promises';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { basename } from 'path';

import type { ParsedChapter } from '../types/index.js';
import type { Comment } from '../types/index.js';
import type { Revision } from '../types/index.js';
import type { DocportState } from '../types/index.js';

import { 
  remarkCriticMarkup,
  type CriticSubstitutionNode,
} from './CriticMarkupPlugin.js';
import { 
  remarkCommentAnchor,
  type CommentAnchorNode,
} from './CommentAnchorPlugin.js';
import { remarkFigure, getImageBaseDir } from './FigurePlugin.js';
import { remarkCrossReference } from './CrossReferencePlugin.js';
import { remarkEquation } from './EquationPlugin.js';

/**
 * Reads and parses markdown files into ParsedChapter objects.
 */
export class MarkdownReader {
  /**
   * Read a markdown chapter file and parse it into a unified AST.
   * Extracts comments and revisions from the state and links them to the content.
   * 
   * @param filePath - Absolute path to the markdown file
   * @param state - The DocportState containing known comments and revisions
   * @returns ParsedChapter with AST, comments, and revisions
   */
  async readChapter(filePath: string, state: DocportState): Promise<ParsedChapter> {
    // Read file content
    const content = await readFile(filePath, 'utf-8');
    const chapterName = basename(filePath);

    // Build unified processor pipeline
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkCriticMarkup)
      .use(remarkCommentAnchor)
      .use(remarkFigure, { baseDir: getImageBaseDir(filePath) })
      .use(remarkCrossReference)
      .use(remarkEquation);

    // Parse to AST
    let ast = processor.parse(content) as Root;
    ast = (await processor.run(ast)) as Root;

    // Extract comments and revisions
    const comments = this.extractComments(ast, chapterName, state);
    const revisions = this.extractRevisions(ast, chapterName, state);

    // Remove comment anchor nodes from the AST
    // (They're only metadata; DocxBuilder doesn't need them in the prose)
    ast = this.removeCommentAnchors(ast);

    return {
      file: filePath,
      ast,
      comments,
      revisions,
    };
  }

  /**
   * Extract comments from commentAnchor nodes and match them with state.
   */
  private extractComments(ast: Root, chapterName: string, state: DocportState): Comment[] {
    const comments: Comment[] = [];

    visit(ast, 'commentAnchor', (node: CommentAnchorNode) => {
      // Find this comment in the state
      const stateComment = state.comments.find(
        c => c.id === node.id && c.chapter === chapterName
      );

      if (stateComment) {
        // Extract anchor quote from following text
        const anchorQuote = this.extractAnchorQuote(ast, node);

        comments.push({
          id: stateComment.id,
          chapter: chapterName,
          anchorQuote: anchorQuote || stateComment.anchorQuote,
          author: stateComment.author,
          date: new Date(stateComment.date),
          body: stateComment.body,
          replies: stateComment.replies.map(r => ({
            id: r.id,
            author: r.author,
            date: new Date(r.date),
            body: r.body,
          })),
          resolved: stateComment.resolved,
        });
      }
    });

    return comments;
  }

  /**
   * Extract revisions from CriticMarkup nodes and match them with state.
   */
  private extractRevisions(ast: Root, chapterName: string, state: DocportState): Revision[] {
    const revisions: Revision[] = [];

    visit(ast, (node: any) => {
      if (node.type === 'criticInsertion' || node.type === 'criticDeletion') {
        const kind = node.type === 'criticInsertion' ? 'insertion' : 'deletion';
        const text = node.value;

        // Try to find this revision in state
        // Match by chapter, kind, and text content
        const stateRevision = state.revisions.find(
          r => r.chapter === chapterName && 
               r.kind === kind && 
               r.text === text
        );

        if (stateRevision) {
          revisions.push({
            id: stateRevision.id,
            chapter: chapterName,
            kind: stateRevision.kind,
            author: stateRevision.author,
            date: new Date(stateRevision.date),
            text: stateRevision.text,
            precedingContext: stateRevision.precedingContext,
            decided: stateRevision.decided,
          });
        } else {
          // New revision not yet in state - we'll assign it an ID later during push
          // For now, include it with a temporary structure
          const precedingContext = this.extractPrecedingContext(ast, node);
          
          revisions.push({
            id: '', // Will be generated later
            chapter: chapterName,
            kind,
            author: 'unknown', // Will be determined from Git during push
            date: new Date(),
            text,
            precedingContext,
            decided: null,
          });
        }
      } else if (node.type === 'criticSubstitution') {
        // Substitution is treated as deletion + insertion
        const substNode = node as CriticSubstitutionNode;
        const precedingContext = this.extractPrecedingContext(ast, node);

        // Find matching deletion in state
        const deletionState = state.revisions.find(
          r => r.chapter === chapterName && 
               r.kind === 'deletion' && 
               r.text === substNode.oldValue
        );

        if (deletionState) {
          revisions.push({
            id: deletionState.id,
            chapter: chapterName,
            kind: 'deletion',
            author: deletionState.author,
            date: new Date(deletionState.date),
            text: deletionState.text,
            precedingContext: deletionState.precedingContext,
            decided: deletionState.decided,
          });
        }

        // Find matching insertion in state
        const insertionState = state.revisions.find(
          r => r.chapter === chapterName && 
               r.kind === 'insertion' && 
               r.text === substNode.newValue
        );

        if (insertionState) {
          revisions.push({
            id: insertionState.id,
            chapter: chapterName,
            kind: 'insertion',
            author: insertionState.author,
            date: new Date(insertionState.date),
            text: insertionState.text,
            precedingContext,
            decided: insertionState.decided,
          });
        }
      }
    });

    return revisions;
  }

  /**
   * Extract ~40 chars of text following a comment anchor.
   */
  private extractAnchorQuote(ast: Root, anchorNode: CommentAnchorNode): string | null {
    let found = false;
    let quote = '';

    visit(ast, (node: any, index, parent) => {
      if (found) return;
      
      if (node === anchorNode) {
        found = true;
        
        // Look at the next sibling
        if (parent && index !== null && (index as number) + 1 < parent.children.length) {
          const nextNode = parent.children[(index as number) + 1];
          quote = this.extractTextFromNode(nextNode, 40);
        }
      }
    });

    return quote || null;
  }

  /**
   * Extract ~60 chars of text preceding a CriticMarkup node.
   */
  private extractPrecedingContext(ast: Root, targetNode: any): string {
    let found = false;
    let context = '';
    const textParts: string[] = [];

    visit(ast, (node: any, index, parent) => {
      if (found) return;

      if (node === targetNode) {
        found = true;
        
        // Collect text from previous siblings
        if (parent && index !== null) {
          for (let i = (index as number) - 1; i >= 0; i--) {
            const prevNode = parent.children[i];
            const text = this.extractTextFromNode(prevNode, 60);
            if (text) {
              textParts.unshift(text);
            }
            
            // Stop if we have enough context
            if (textParts.join('').length >= 60) break;
          }
        }
        
        context = textParts.join('').slice(-60);
      }
    });

    return context;
  }

  /**
   * Extract plain text from a node, up to maxLength characters.
   */
  private extractTextFromNode(node: any, maxLength: number): string {
    let text = '';

    if (node.type === 'text') {
      text = node.value;
    } else if (node.children) {
      for (const child of node.children) {
        text += this.extractTextFromNode(child, maxLength - text.length);
        if (text.length >= maxLength) break;
      }
    }

    return text.slice(0, maxLength);
  }

  /**
   * Remove commentAnchor nodes from the AST.
   * They're metadata-only and shouldn't appear in the prose.
   */
  private removeCommentAnchors(ast: Root): Root {
    visit(ast, 'commentAnchor', (_node: CommentAnchorNode, index, parent) => {
      if (index !== null && parent) {
        parent.children.splice(index as number, 1);
      }
    });

    return ast;
  }
}
