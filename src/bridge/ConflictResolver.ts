import type { Root, Paragraph, Text } from 'mdast';
import { visit } from 'unist-util-visit';
import type { Revision } from '../types/index.js';

/**
 * Represents a region where both local and PI edits conflict.
 */
export interface ConflictRegion {
  /** The local text that was edited */
  localText: string;
  /** The PI's revision that conflicts */
  piRevision: Revision;
  /** Node index where the conflict occurs */
  nodeIndex: number;
}

/**
 * Conflict detection and resolution for dual edits.
 * Handles cases where both researcher and PI edited the same text.
 */
export class ConflictResolver {
  /**
   * Detect conflicts between local AST and PI revisions.
   * A conflict occurs when a PI revision's precedingContext doesn't exist
   * in the local AST (indicating the researcher edited that same text).
   * 
   * @param localAst - The current local AST
   * @param piRevisions - Revisions made by the PI in the .docx
   * @returns Array of conflict regions
   */
  static detectConflicts(localAst: Root, piRevisions: Revision[]): ConflictRegion[] {
    const conflicts: ConflictRegion[] = [];

    for (const revision of piRevisions) {
      // Try to find the preceding context in the local AST
      const found = this.findPrecedingContext(localAst, revision.precedingContext);

      if (!found) {
        // Context not found - this indicates a conflict
        // The researcher modified the text that the PI's revision was anchored to
        const localText = this.extractLocalTextNearby(localAst, revision);

        conflicts.push({
          localText,
          piRevision: revision,
          nodeIndex: 0, // Will be set when writing markers
        });
      }
    }

    return conflicts;
  }

  /**
   * Write conflict markers into the AST for a detected conflict.
   * 
   * Format:
   * <<<<<<< yours
   * Local text
   * =======
   * PI's {++revision++}
   * >>>>>>> PI (via docport pull 2025-03-24)
   * 
   * @param ast - The AST to modify
   * @param conflict - The conflict region to mark
   * @returns Modified AST
   */
  static writeConflictMarkers(ast: Root, conflict: ConflictRegion): Root {
    const timestamp = new Date().toISOString().split('T')[0];
    const revision = conflict.piRevision;

    // Build the conflict marker text
    const markerText = [
      '<<<<<<< yours',
      conflict.localText,
      '=======',
      this.formatRevisionText(revision),
      `>>>>>>> PI (via docport pull ${timestamp})`,
    ].join('\n');

    // Find the best place to insert the conflict marker
    let inserted = false;

    visit(ast, 'paragraph', (node: Paragraph, index, parent) => {
      if (inserted || !parent || index === null) return;

      // Look for text that matches part of the local text
      const paragraphText = this.extractParagraphText(node);
      
      if (paragraphText.includes(conflict.localText) || 
          conflict.localText.includes(paragraphText.slice(0, 30))) {
        // Insert a new paragraph with the conflict markers
        const conflictParagraph: Paragraph = {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              value: markerText,
            } as Text,
          ],
        };

        parent.children.splice(index as number, 1, conflictParagraph);
        inserted = true;
      }
    });

    // If we couldn't find a good spot, append to the end
    if (!inserted) {
      const conflictParagraph: Paragraph = {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            value: markerText,
          } as Text,
        ],
      };

      ast.children.push(conflictParagraph);
    }

    return ast;
  }

  /**
   * Find if preceding context exists in the AST.
   */
  private static findPrecedingContext(ast: Root, context: string): boolean {
    let found = false;

    visit(ast, 'text', (node: Text) => {
      if (found) return;

      if (node.value.includes(context)) {
        found = true;
      }
    });

    return found;
  }

  /**
   * Extract local text near where the PI revision would have been.
   * This is a best-effort guess for conflict display.
   */
  private static extractLocalTextNearby(ast: Root, revision: Revision): string {
    // Try to find text that's somewhat similar to the revision's text
    let bestMatch = '';
    let bestScore = 0;

    visit(ast, 'text', (node: Text) => {
      const text = node.value;
      
      // Simple similarity: count common words
      const revisionWords = revision.text.toLowerCase().split(/\s+/);
      const textWords = text.toLowerCase().split(/\s+/);
      const commonWords = revisionWords.filter(w => textWords.includes(w)).length;
      const score = commonWords / revisionWords.length;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = text;
      }
    });

    return bestMatch || '(unable to determine local text)';
  }

  /**
   * Format a revision for display in conflict markers.
   */
  private static formatRevisionText(revision: Revision): string {
    if (revision.kind === 'insertion') {
      return `{++${revision.text}++}`;
    } else {
      return `{--${revision.text}--}`;
    }
  }

  /**
   * Extract all text from a paragraph node.
   */
  private static extractParagraphText(paragraph: Paragraph): string {
    let text = '';

    visit(paragraph, 'text', (node: Text) => {
      text += node.value;
    });

    return text;
  }

  /**
   * Check if a conflict has been manually resolved by the user.
   * A conflict is considered resolved if the conflict markers have been removed.
   */
  static isConflictResolved(ast: Root): boolean {
    let foundMarker = false;

    visit(ast, 'text', (node: Text) => {
      if (node.value.includes('<<<<<<< yours') || node.value.includes('>>>>>>> PI')) {
        foundMarker = true;
      }
    });

    return !foundMarker;
  }

  /**
   * Extract the resolution choice from manually resolved conflict markers.
   * Returns 'yours', 'theirs', or 'both' based on which sections were kept.
   */
  static extractResolution(): 'yours' | 'theirs' | 'both' | null {
    // This is a placeholder for future implementation
    // Would parse the text to see which parts of the conflict were kept
    return null;
  }
}
