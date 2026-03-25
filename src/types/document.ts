import type { Root } from 'mdast';

/**
 * A chapter's content after parsing — a remark AST with all
 * CriticMarkup and comment anchors already parsed into typed nodes.
 */
export interface ParsedChapter {
  file: string;
  ast: Root;
  comments: import('./comment.js').Comment[];
  revisions: import('./revision.js').Revision[];
}

/**
 * The full document as it passes through the bridge pipeline.
 */
export interface DocportDocument {
  manifest: import('./manifest.js').Manifest;
  chapters: ParsedChapter[];
  state: import('./docport-state.js').DocportState;
}
