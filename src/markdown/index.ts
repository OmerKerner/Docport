/**
 * Markdown layer for Docport.
 * Provides Remark-based parsing and stringification with custom plugins
 * for CriticMarkup track changes and comment anchors.
 */

export { MarkdownReader } from './MarkdownReader.js';
export { MarkdownWriter } from './MarkdownWriter.js';

export {
  remarkCriticMarkup,
  remarkCriticMarkupStringify,
  type CriticInsertionNode,
  type CriticDeletionNode,
  type CriticSubstitutionNode,
  type CriticHighlightNode,
  type CriticCommentNode,
  type CriticMarkupNode,
} from './CriticMarkupPlugin.js';

export {
  remarkCommentAnchor,
  remarkCommentAnchorStringify,
  createCommentAnchor,
  type CommentAnchorNode,
} from './CommentAnchorPlugin.js';

export {
  remarkFigure,
  getImageBaseDir,
  type FigurePluginOptions,
} from './FigurePlugin.js';

export {
  remarkCrossReference,
  remarkCrossReferenceStringify,
  getFigureLabel,
  type FigureReferenceNode,
} from './CrossReferencePlugin.js';
