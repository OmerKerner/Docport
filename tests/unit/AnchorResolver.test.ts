import { describe, it, expect } from 'vitest';
import { AnchorResolver, AnchorNotFoundError } from '../../src/bridge/AnchorResolver.js';
import type { Root, Paragraph, Text } from 'mdast';

describe('AnchorResolver', () => {
  describe('resolve', () => {
    it('should find exact match', () => {
      const ast: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'text',
                value: 'This is some text with a specific phrase that we want to find.',
              } as Text,
            ],
          } as Paragraph,
        ],
      };

      const position = AnchorResolver.resolve(ast, 'specific phrase');
      
      expect(position).toBeDefined();
      expect(position.nodeIndex).toBe(0);
      expect(position.charOffset).toBeGreaterThanOrEqual(0);
    });

    it('should find case-insensitive match', () => {
      const ast: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'text',
                value: 'This Contains MIXED case text.',
              } as Text,
            ],
          } as Paragraph,
        ],
      };

      const position = AnchorResolver.resolve(ast, 'contains mixed');
      
      expect(position).toBeDefined();
    });

    it('should handle whitespace normalization', () => {
      const ast: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'text',
                value: 'Text   with    multiple     spaces',
              } as Text,
            ],
          } as Paragraph,
        ],
      };

      const position = AnchorResolver.resolve(ast, 'with multiple spaces');
      
      expect(position).toBeDefined();
    });

    it('should throw AnchorNotFoundError when no match found', () => {
      const ast: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'text',
                value: 'This is some text.',
              } as Text,
            ],
          } as Paragraph,
        ],
      };

      expect(() => {
        AnchorResolver.resolve(ast, 'nonexistent phrase');
      }).toThrow(AnchorNotFoundError);
    });

    it('should find fuzzy match with minor typos', () => {
      const ast: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'text',
                value: 'The quick brown fox jumps over the lazy dog.',
              } as Text,
            ],
          } as Paragraph,
        ],
      };

      // Try with a small typo (should find with fuzzy matching)
      const position = AnchorResolver.resolve(ast, 'quick browm fox');
      
      expect(position).toBeDefined();
    });
  });

  describe('extractAllText', () => {
    it('should extract all text from AST', () => {
      const ast: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'First paragraph.' } as Text,
            ],
          } as Paragraph,
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'Second paragraph.' } as Text,
            ],
          } as Paragraph,
        ],
      };

      const text = AnchorResolver.extractAllText(ast);
      
      expect(text).toBe('First paragraph.Second paragraph.');
    });

    it('should handle empty AST', () => {
      const ast: Root = {
        type: 'root',
        children: [],
      };

      const text = AnchorResolver.extractAllText(ast);
      
      expect(text).toBe('');
    });
  });

  describe('levenshteinDistance', () => {
    it('should compute distance correctly', () => {
      // Access private method through any cast for testing
      const AnchorResolverAny = AnchorResolver as any;
      
      expect(AnchorResolverAny.levenshteinDistance('', '')).toBe(0);
      expect(AnchorResolverAny.levenshteinDistance('a', 'a')).toBe(0);
      expect(AnchorResolverAny.levenshteinDistance('abc', 'abc')).toBe(0);
      expect(AnchorResolverAny.levenshteinDistance('', 'abc')).toBe(3);
      expect(AnchorResolverAny.levenshteinDistance('abc', '')).toBe(3);
      expect(AnchorResolverAny.levenshteinDistance('abc', 'def')).toBe(3);
      expect(AnchorResolverAny.levenshteinDistance('kitten', 'sitting')).toBe(3);
    });
  });
});
