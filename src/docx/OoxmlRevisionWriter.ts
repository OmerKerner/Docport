import * as docx from 'docx';
import type { Revision } from '../types/index.js';

const { TextRun } = docx;

/**
 * Helper for creating track change elements (insertions/deletions).
 * Uses docx library's built-in revision support.
 */
export class OoxmlRevisionWriter {
  /**
   * Creates an insertion run from a revision.
   */
  static createInsertion(revision: Revision & { lastDocxId?: number }): Record<string, unknown> {
    const id = revision.lastDocxId ?? 0;
    
    return {
      type: 'insertion',
      id,
      author: revision.author,
      date: revision.date,
      children: [new TextRun(revision.text)],
    };
  }
  
  /**
   * Creates a deletion run from a revision.
   */
  static createDeletion(revision: Revision & { lastDocxId?: number }): Record<string, unknown> {
    const id = revision.lastDocxId ?? 0;
    
    return {
      type: 'deletion',
      id,
      author: revision.author,
      date: revision.date,
      children: [new TextRun(revision.text)],
    };
  }
  
  /**
   * Creates a substitution (deletion followed by insertion).
   */
  static createSubstitution(
    deletion: Revision & { lastDocxId?: number },
    insertion: Revision & { lastDocxId?: number }
  ): Record<string, unknown>[] {
    return [
      this.createDeletion(deletion),
      this.createInsertion(insertion),
    ];
  }
}
