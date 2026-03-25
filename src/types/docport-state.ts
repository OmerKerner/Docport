import { z } from 'zod';

export const CommentStateSchema = z.object({
  /** Stable UUID assigned on first import. Never changes across round-trips. */
  id: z.string().uuid(),
  /** Chapter file this comment belongs to, e.g. "02-methods.md" */
  chapter: z.string(),
  /**
   * Content-addressed anchor: a short quoted string (~40 chars) from the
   * text the comment is attached to. Used to re-locate the comment if the
   * paragraph moves. Chosen to be unique within the chapter.
   */
  anchorQuote: z.string(),
  author: z.string(),
  date: z.string(),            // ISO 8601
  body: z.string(),
  replies: z.array(z.object({
    id: z.string().uuid(),
    author: z.string(),
    date: z.string(),
    body: z.string(),
  })),
  resolved: z.boolean().default(false),
  /** The w:comment id used in the last exported docx. Re-used on re-push. */
  lastDocxId: z.number().optional(),
});

export const RevisionStateSchema = z.object({
  id: z.string().uuid(),
  chapter: z.string(),
  kind: z.enum(['insertion', 'deletion']),
  author: z.string(),
  date: z.string(),
  /**
   * The original text (for deletions) or the inserted text (for insertions).
   * Used to locate the revision in the markdown via string search.
   */
  text: z.string(),
  /** Context: the ~60 chars of unchanged text immediately preceding this revision. */
  precedingContext: z.string(),
  /** null = pending, true = accepted, false = rejected */
  decided: z.boolean().nullable().default(null),
  lastDocxId: z.number().optional(),
});

export const DocportStateSchema = z.object({
  schemaVersion: z.literal(1),
  /** Git commit hash of the markdown at the time of the last push. */
  lastPushCommit: z.string().nullable(),
  /** Git commit hash of the markdown at the time of the last pull. */
  lastPullCommit: z.string().nullable(),
  /** SHA-256 of the .docx file at the time of the last pull. */
  lastDocxHash: z.string().nullable(),
  comments: z.array(CommentStateSchema),
  revisions: z.array(RevisionStateSchema),
});

export type DocportState = z.infer<typeof DocportStateSchema>;
export type CommentState = z.infer<typeof CommentStateSchema>;
export type RevisionState = z.infer<typeof RevisionStateSchema>;

export const emptyDocportState = (): DocportState => ({
  schemaVersion: 1,
  lastPushCommit: null,
  lastPullCommit: null,
  lastDocxHash: null,
  comments: [],
  revisions: [],
});
