import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

export interface RawRevision {
  docxId: number;
  kind: 'insertion' | 'deletion';
  author: string;
  date: string;
  text: string;
  precedingContext: string;
}

/**
 * Extracts pending track changes (w:ins and w:del elements) from a .docx file.
 * Only returns changes that haven't been accepted or rejected.
 */
export class OoxmlRevisionParser {
  static async parse(docxBuffer: Buffer): Promise<RawRevision[]> {
    const zip = await JSZip.loadAsync(docxBuffer);
    
    const documentFile = zip.file('word/document.xml');
    if (!documentFile) {
      throw new Error('Invalid .docx: missing document.xml');
    }
    
    const documentXml = await documentFile.async('text');
    
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseAttributeValue: true,
      preserveOrder: true,
      ignoreDeclaration: true,
    });
    
    const documentDoc = parser.parse(documentXml);
    
    const revisions: RawRevision[] = [];
    
    // Traverse document tree to find w:ins and w:del elements
    this.traverseForRevisions(documentDoc, revisions, '');
    
    return revisions;
  }
  
  /**
   * Recursively traverses the parsed XML tree to find revision elements.
   */
  private static traverseForRevisions(
    node: unknown,
    revisions: RawRevision[],
    precedingContext: string
  ): string {
    if (!node || typeof node !== 'object') {
      return precedingContext;
    }
    
    if (Array.isArray(node)) {
      let context = precedingContext;
      for (const item of node) {
        context = this.traverseForRevisions(item, revisions, context);
      }
      return context;
    }
    
    // Check for insertion
    if ('w:ins' in node) {
      const insElement = (node as Record<string, unknown>)['w:ins'];
      const insertion = this.parseRevision(insElement, 'insertion', precedingContext);
      if (insertion) {
        revisions.push(insertion);
      }
    }
    
    // Check for deletion
    if ('w:del' in node) {
      const delElement = (node as Record<string, unknown>)['w:del'];
      const deletion = this.parseRevision(delElement, 'deletion', precedingContext);
      if (deletion) {
        revisions.push(deletion);
      }
    }
    
    // Check for regular text runs (not in revisions) to build context
    if ('w:t' in node) {
      const text = (node as Record<string, unknown>)['w:t'];
      if (typeof text === 'string' || (text && typeof text === 'object' && '#text' in text)) {
        const textContent = typeof text === 'string' ? text : ((text as Record<string, unknown>)['#text'] as string);
        precedingContext = (precedingContext + textContent).slice(-60);
      }
    }
    
    // Recursively traverse children
    for (const key in node) {
      if (key.startsWith('@_')) continue; // Skip attributes
      const value = (node as Record<string, unknown>)[key];
      precedingContext = this.traverseForRevisions(value, revisions, precedingContext);
    }
    
    return precedingContext;
  }
  
  /**
   * Parses a single revision element (w:ins or w:del).
   */
  private static parseRevision(
    element: unknown,
    kind: 'insertion' | 'deletion',
    precedingContext: string
  ): RawRevision | null {
    if (!element || typeof element !== 'object') {
      return null;
    }
    
    let docxId = 0;
    let author = 'Unknown';
    let date = new Date().toISOString();
    
    // Extract attributes
    if (Array.isArray(element)) {
      for (const item of element) {
        if (typeof item === 'object' && item !== null) {
          if ('@_w:id' in item) {
            docxId = (item as Record<string, unknown>)['@_w:id'] as number;
          }
          if ('@_w:author' in item) {
            author = (item as Record<string, unknown>)['@_w:author'] as string;
          }
          if ('@_w:date' in item) {
            date = (item as Record<string, unknown>)['@_w:date'] as string;
          }
        }
      }
    } else {
      if ('@_w:id' in element) {
        docxId = (element as Record<string, unknown>)['@_w:id'] as number;
      }
      if ('@_w:author' in element) {
        author = (element as Record<string, unknown>)['@_w:author'] as string;
      }
      if ('@_w:date' in element) {
        date = (element as Record<string, unknown>)['@_w:date'] as string;
      }
    }
    
    // Extract text
    const text = this.extractRevisionText(element, kind);
    
    if (!text) {
      return null;
    }
    
    return {
      docxId,
      kind,
      author,
      date,
      text,
      precedingContext: precedingContext.slice(-60),
    };
  }
  
  /**
   * Extracts text from a revision element.
   * For insertions: w:t elements
   * For deletions: w:delText elements
   */
  private static extractRevisionText(element: unknown, kind: 'insertion' | 'deletion'): string {
    const texts: string[] = [];
    const textTag = kind === 'deletion' ? 'w:delText' : 'w:t';
    
    this.collectTexts(element, textTag, texts);
    
    return texts.join('');
  }
  
  /**
   * Recursively collects text from specified tag.
   */
  private static collectTexts(node: unknown, tag: string, texts: string[]): void {
    if (!node || typeof node !== 'object') {
      return;
    }
    
    if (Array.isArray(node)) {
      for (const item of node) {
        this.collectTexts(item, tag, texts);
      }
      return;
    }
    
    if (tag in node) {
      const textNode = (node as Record<string, unknown>)[tag];
      if (typeof textNode === 'string') {
        texts.push(textNode);
      } else if (textNode && typeof textNode === 'object' && '#text' in textNode) {
        texts.push((textNode as Record<string, unknown>)['#text'] as string);
      }
    }
    
    // Recursively traverse children
    for (const key in node) {
      if (key.startsWith('@_')) continue;
      const value = (node as Record<string, unknown>)[key];
      this.collectTexts(value, tag, texts);
    }
  }
}
