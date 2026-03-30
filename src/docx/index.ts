/**
 * Docx/OOXML layer for Docport.
 * Handles conversion between remark AST and Word .docx format,
 * preserving track changes and comments.
 */

export { DocxBuilder } from './DocxBuilder.js';
export { DocxParser } from './DocxParser.js';
export { OoxmlCommentParser } from './OoxmlCommentParser.js';
export { OoxmlCommentWriter } from './OoxmlCommentWriter.js';
export { OoxmlRevisionParser } from './OoxmlRevisionParser.js';
export { OoxmlRevisionWriter } from './OoxmlRevisionWriter.js';
export { OoxmlEquationParser } from './OoxmlEquationParser.js';
export { ImageEmbedder } from './ImageEmbedder.js';

export type { RawComment, RawCommentReply } from './OoxmlCommentParser.js';
export type { RawRevision } from './OoxmlRevisionParser.js';
export type { ParsedOoxmlEquation } from './OoxmlEquationParser.js';
export type { DocxParseResult } from './DocxParser.js';
