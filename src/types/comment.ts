/**
 * A comment as it exists in the unified in-memory representation,
 * after being parsed from either Markdown or docx.
 */
export interface Comment {
  id: string;
  chapter: string;
  anchorQuote: string;
  author: string;
  date: Date;
  body: string;
  replies: CommentReply[];
  resolved: boolean;
}

export interface CommentReply {
  id: string;
  author: string;
  date: Date;
  body: string;
}
