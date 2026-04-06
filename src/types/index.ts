// Manifest types and schemas
export { ManifestSchema, type Manifest } from './manifest.js';

// State schemas and types
export {
  CommentStateSchema,
  RevisionStateSchema,
  DocportStateSchema,
  emptyDocportState,
  type CommentState,
  type RevisionState,
  type DocportState,
} from './docport-state.js';

// Runtime comment types
export { type Comment, type CommentReply } from './comment.js';

// Runtime revision types
export { type Revision, type RevisionKind } from './revision.js';

// Document types
export { type ParsedChapter, type DocportDocument } from './document.js';

// Style metadata
export { StyleMetadataSchema, type StyleMetadata } from './style-metadata.js';
