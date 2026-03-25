import type { Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * Result of resolving an anchor to a position in the AST.
 */
export interface AnchorPosition {
  /** Index of the node containing the anchor */
  nodeIndex: number;
  /** Character offset within the node's text */
  charOffset: number;
}

/**
 * Error thrown when an anchor cannot be resolved to a position.
 */
export class AnchorNotFoundError extends Error {
  constructor(
    public readonly anchorQuote: string,
    public readonly closestMatch: string,
    public readonly similarity: number
  ) {
    super(
      `Could not resolve anchor "${anchorQuote}". ` +
      `Closest match: "${closestMatch}" (similarity: ${(similarity * 100).toFixed(1)}%)`
    );
    this.name = 'AnchorNotFoundError';
  }
}

/**
 * Content-addressed anchor resolution.
 * Finds the position of a comment anchor by matching quoted text.
 */
export class AnchorResolver {
  /**
   * Resolve an anchor quote to a position in the AST.
   * 
   * Strategy (in order):
   * 1. Exact match: find anchorQuote as substring
   * 2. Fuzzy match: Levenshtein distance threshold 0.15
   * 3. Semantic match: longest common subsequence
   * 4. Fail with AnchorNotFoundError showing closest match
   * 
   * @param ast - The AST to search in
   * @param anchorQuote - The quoted text to find
   * @returns Position where the anchor should be inserted
   * @throws AnchorNotFoundError if no suitable match is found
   */
  static resolve(ast: Root, anchorQuote: string): AnchorPosition {
    const normalizedQuote = this.normalizeText(anchorQuote);
    
    // Strategy 1: Exact match
    const exactMatch = this.findExactMatch(ast, normalizedQuote);
    if (exactMatch) {
      return exactMatch;
    }

    // Strategy 2 & 3: Fuzzy and semantic matching
    const fuzzyMatch = this.findFuzzyMatch(ast, normalizedQuote);
    if (fuzzyMatch) {
      return fuzzyMatch.position;
    }

    // No match found - throw error with closest match
    const closestMatch = this.findClosestMatch(ast, normalizedQuote);
    throw new AnchorNotFoundError(
      anchorQuote,
      closestMatch.text,
      closestMatch.similarity
    );
  }

  /**
   * Find exact match of anchor quote in the AST.
   */
  private static findExactMatch(ast: Root, normalizedQuote: string): AnchorPosition | null {
    let result: AnchorPosition | null = null;
    let nodeIndex = 0;

    visit(ast, 'text', (node: Text) => {
      if (result) return;

      const normalizedText = this.normalizeText(node.value);
      const index = normalizedText.indexOf(normalizedQuote);

      if (index !== -1) {
        result = {
          nodeIndex,
          charOffset: index,
        };
      }

      nodeIndex++;
    });

    return result;
  }

  /**
   * Find fuzzy match using Levenshtein distance.
   */
  private static findFuzzyMatch(
    ast: Root,
    normalizedQuote: string
  ): { position: AnchorPosition; similarity: number } | null {
    let bestMatch: { position: AnchorPosition; similarity: number } | null = null;
    let nodeIndex = 0;

    visit(ast, 'text', (node: Text) => {
      const normalizedText = this.normalizeText(node.value);
      
      // Try all substrings of similar length
      const quoteLen = normalizedQuote.length;
      const minLen = Math.floor(quoteLen * 0.8);
      const maxLen = Math.ceil(quoteLen * 1.2);

      for (let len = minLen; len <= maxLen; len++) {
        for (let i = 0; i <= normalizedText.length - len; i++) {
          const substring = normalizedText.slice(i, i + len);
          const distance = this.levenshteinDistance(normalizedQuote, substring);
          const similarity = 1 - distance / Math.max(normalizedQuote.length, substring.length);

          if (similarity >= 0.85) {
            if (!bestMatch || similarity > bestMatch.similarity) {
              bestMatch = {
                position: { nodeIndex, charOffset: i },
                similarity,
              };
            }
          }
        }
      }

      nodeIndex++;
    });

    return bestMatch;
  }

  /**
   * Find the closest match for error reporting.
   */
  private static findClosestMatch(
    ast: Root,
    normalizedQuote: string
  ): { text: string; similarity: number } {
    let bestMatch = { text: '', similarity: 0 };
    const quoteLen = normalizedQuote.length;

    visit(ast, 'text', (node: Text) => {
      const normalizedText = this.normalizeText(node.value);
      
      // Try substrings near the quote length
      for (let len = quoteLen - 10; len <= quoteLen + 10; len++) {
        if (len <= 0) continue;
        
        for (let i = 0; i <= normalizedText.length - len; i++) {
          const substring = normalizedText.slice(i, i + len);
          const distance = this.levenshteinDistance(normalizedQuote, substring);
          const similarity = 1 - distance / Math.max(normalizedQuote.length, substring.length);

          if (similarity > bestMatch.similarity) {
            bestMatch = { text: substring, similarity };
          }
        }
      }
    });

    return bestMatch;
  }

  /**
   * Normalize text for comparison: lowercase, collapse whitespace.
   */
  private static normalizeText(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Compute Levenshtein distance between two strings.
   */
  private static levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = Array(a.length + 1);

    // Initialize first column and row
    for (let i = 0; i <= a.length; i++) {
      matrix[i] = Array(b.length + 1).fill(0);
      matrix[i]![0] = i;
    }
    for (let j = 0; j <= b.length; j++) {
      matrix[0]![j] = j;
    }

    // Fill in the rest of the matrix
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        const row = matrix[i]!;
        const prevRow = matrix[i - 1]!;
        row[j] = Math.min(
          prevRow[j]! + 1,        // deletion
          row[j - 1]! + 1,        // insertion
          prevRow[j - 1]! + cost  // substitution
        );
      }
    }

    return matrix[a.length]![b.length]!;
  }

  /**
   * Extract all text from an AST as a single string.
   * Useful for finding text positions.
   */
  static extractAllText(ast: Root): string {
    let text = '';
    
    visit(ast, 'text', (node: Text) => {
      text += node.value;
    });

    return text;
  }
}
