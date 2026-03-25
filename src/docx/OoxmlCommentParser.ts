import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

export interface RawComment {
  docxId: number;
  author: string;
  date: string;
  body: string;
  anchorText: string;
  replies: RawCommentReply[];
}

export interface RawCommentReply {
  docxId: number;
  author: string;
  date: string;
  body: string;
}

/**
 * Parses comments from a .docx file by extracting word/comments.xml
 * and word/document.xml to match comment anchors.
 */
export class OoxmlCommentParser {
  static async parse(docxBuffer: Buffer): Promise<RawComment[]> {
    const zip = await JSZip.loadAsync(docxBuffer);
    
    // Extract comments.xml
    const commentsFile = zip.file('word/comments.xml');
    if (!commentsFile) {
      return []; // No comments in document
    }
    
    const commentsXml = await commentsFile.async('text');
    const documentFile = zip.file('word/document.xml');
    if (!documentFile) {
      throw new Error('Invalid .docx: missing document.xml');
    }
    
    const documentXml = await documentFile.async('text');
    
    // Parse XML
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseAttributeValue: true,
    });
    
    const commentsDoc = parser.parse(commentsXml);
    const documentDoc = parser.parse(documentXml);
    
    // Extract comment anchors from document.xml
    const anchors = this.extractCommentAnchors(documentDoc);
    
    // Parse comments
    const commentsArray = commentsDoc['w:comments']?.['w:comment'];
    if (!commentsArray) {
      return [];
    }
    
    const comments = Array.isArray(commentsArray) ? commentsArray : [commentsArray];
    const results: RawComment[] = [];
    const processedIds = new Set<number>();
    
    for (const comment of comments) {
      const docxId = comment['@_w:id'];
      if (processedIds.has(docxId)) {
        continue; // Skip replies, they'll be attached to parent
      }
      
      const author = comment['@_w:author'] || 'Unknown';
      const date = comment['@_w:date'] || new Date().toISOString();
      const body = this.extractCommentText(comment);
      const anchorText = anchors.get(docxId) || '';
      
      // Find replies (comments with same range but different IDs)
      const replies: RawCommentReply[] = [];
      for (const potentialReply of comments) {
        const replyId = potentialReply['@_w:id'];
        if (replyId !== docxId && !processedIds.has(replyId)) {
          // Simple heuristic: replies come right after parent in sequence
          if (replyId === docxId + 1 + replies.length) {
            replies.push({
              docxId: replyId,
              author: potentialReply['@_w:author'] || 'Unknown',
              date: potentialReply['@_w:date'] || new Date().toISOString(),
              body: this.extractCommentText(potentialReply),
            });
            processedIds.add(replyId);
          }
        }
      }
      
      processedIds.add(docxId);
      results.push({
        docxId,
        author,
        date,
        body,
        anchorText,
        replies,
      });
    }
    
    return results;
  }
  
  /**
   * Extracts text content from a comment element.
   */
  private static extractCommentText(comment: Record<string, unknown>): string {
    const paragraphs = comment['w:p'];
    if (!paragraphs) return '';
    
    const pArray = Array.isArray(paragraphs) ? paragraphs : [paragraphs];
    const texts: string[] = [];
    
    for (const p of pArray) {
      const runs = (p as Record<string, unknown>)['w:r'];
      if (!runs) continue;
      
      const runArray = Array.isArray(runs) ? runs : [runs];
      for (const run of runArray) {
        const text = (run as Record<string, unknown>)['w:t'];
        if (typeof text === 'string') {
          texts.push(text);
        }
      }
    }
    
    return texts.join('');
  }
  
  /**
   * Extracts comment anchor text from document.xml by finding
   * commentRangeStart/End markers and collecting text between them.
   */
  private static extractCommentAnchors(documentDoc: Record<string, unknown>): Map<number, string> {
    const anchors = new Map<number, string>();
    
    // Navigate to body paragraphs
    const body = (documentDoc['w:document'] as Record<string, unknown>)?.['w:body'];
    if (!body) return anchors;
    
    const paragraphs = (body as Record<string, unknown>)['w:p'];
    if (!paragraphs) return anchors;
    
    const pArray = Array.isArray(paragraphs) ? paragraphs : [paragraphs];
    
    for (const p of pArray) {
      const elements = (p as Record<string, unknown>)['w:r'] || [];
      const elementArray = Array.isArray(elements) ? elements : [elements];
      
      let currentCommentId: number | null = null;
      let anchorText = '';
      
      for (const elem of elementArray) {
        const commentRangeStart = (elem as Record<string, unknown>)['w:commentRangeStart'];
        const commentRangeEnd = (elem as Record<string, unknown>)['w:commentRangeEnd'];
        const text = (elem as Record<string, unknown>)['w:t'];
        
        if (commentRangeStart) {
          const startId = (commentRangeStart as Record<string, unknown>)['@_w:id'];
          if (typeof startId === 'number') {
            currentCommentId = startId;
            anchorText = '';
          }
        }
        
        if (currentCommentId !== null && typeof text === 'string') {
          anchorText += text;
        }
        
        if (commentRangeEnd && currentCommentId !== null) {
          // Take first 60 chars as anchor quote
          anchors.set(currentCommentId, anchorText.substring(0, 60));
          currentCommentId = null;
          anchorText = '';
        }
      }
    }
    
    return anchors;
  }
}
