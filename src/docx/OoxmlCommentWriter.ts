import type { Comment } from '../types/index.js';

/**
 * Writes word/comments.xml directly for fine-grained control over comment structure.
 * Comment IDs MUST be sequential integers starting from 0 (Word validation requirement).
 */
export class OoxmlCommentWriter {
  /**
   * Builds the comments.xml content from an array of comments.
   * Assigns sequential IDs starting from 0, reusing lastDocxId when available.
   */
  static buildXml(comments: Comment[]): string {
    // Sort comments by lastDocxId to maintain stability
    const sortedComments = [...comments].sort((a, b) => {
      const aId = (a as Comment & { lastDocxId?: number }).lastDocxId ?? Infinity;
      const bId = (b as Comment & { lastDocxId?: number }).lastDocxId ?? Infinity;
      return aId - bId;
    });

    // Assign sequential IDs
    const commentElements: string[] = [];
    let nextId = 0;
    
    for (const comment of sortedComments) {
      const docxId = (comment as Comment & { lastDocxId?: number }).lastDocxId ?? nextId;
      nextId = Math.max(nextId, docxId + 1);
      
      const dateStr = comment.date.toISOString();
      const author = escapeXml(comment.author);
      const body = escapeXml(comment.body);
      
      commentElements.push(
        `    <w:comment w:id="${docxId}" w:author="${author}" w:date="${dateStr}"${comment.resolved ? ' w:resolved="1"' : ''}>` +
        `<w:p><w:r><w:t>${body}</w:t></w:r></w:p>`
      );
      
      // Add replies as nested comments
      for (const reply of comment.replies) {
        const replyDateStr = reply.date.toISOString();
        const replyAuthor = escapeXml(reply.author);
        const replyBody = escapeXml(reply.body);
        
        commentElements.push(
          `      <w:comment w:id="${nextId}" w:author="${replyAuthor}" w:date="${replyDateStr}">` +
          `<w:p><w:r><w:t>${replyBody}</w:t></w:r></w:p></w:comment>`
        );
        nextId++;
      }
      
      commentElements.push(`    </w:comment>`);
    }

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
${commentElements.join('\n')}
</w:comments>`;
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
