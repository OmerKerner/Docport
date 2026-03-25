import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { remarkCriticMarkup, remarkCriticMarkupStringify } from '../../src/markdown/CriticMarkupPlugin.js';

describe('CriticMarkupPlugin', () => {
  describe('Insertion', () => {
    it('should parse insertion markup', async () => {
      const input = 'This is {++inserted++} text.';
      
      const processor = unified()
        .use(remarkParse)
        .use(remarkCriticMarkup);
      
      const ast = processor.parse(input);
      const result = await processor.run(ast);
      
      // Check that the AST contains a criticInsertion node
      const hasInsertion = JSON.stringify(result).includes('criticInsertion');
      expect(hasInsertion).toBe(true);
    });

    it('should stringify insertion markup', async () => {
      const input = 'This is {++inserted++} text.';
      
      const processor = unified()
        .use(remarkParse)
        .use(remarkCriticMarkup)
        .use(remarkCriticMarkupStringify)
        .use(remarkStringify);
      
      const result = await processor.process(input);
      
      expect(result.toString()).toContain('{++inserted++}');
    });

    it('should round-trip insertion markup', async () => {
      const input = 'This is {++inserted++} text.';
      
      const processor = unified()
        .use(remarkParse)
        .use(remarkCriticMarkup)
        .use(remarkCriticMarkupStringify)
        .use(remarkStringify);
      
      const result = await processor.process(input);
      
      expect(result.toString().trim()).toContain('{++inserted++}');
    });
  });

  describe('Deletion', () => {
    it('should parse deletion markup', async () => {
      const input = 'This is {--deleted--} text.';
      
      const processor = unified()
        .use(remarkParse)
        .use(remarkCriticMarkup);
      
      const ast = processor.parse(input);
      const result = await processor.run(ast);
      
      const hasDeletion = JSON.stringify(result).includes('criticDeletion');
      expect(hasDeletion).toBe(true);
    });

    it('should round-trip deletion markup', async () => {
      const input = 'This is {--deleted--} text.';
      
      const processor = unified()
        .use(remarkParse)
        .use(remarkCriticMarkup)
        .use(remarkCriticMarkupStringify)
        .use(remarkStringify);
      
      const result = await processor.process(input);
      
      expect(result.toString().trim()).toContain('{--deleted--}');
    });
  });

  describe('Substitution', () => {
    it('should parse substitution markup', async () => {
      const input = 'This is {~~old~>new~~} text.';
      
      const processor = unified()
        .use(remarkParse)
        .use(remarkCriticMarkup);
      
      const ast = processor.parse(input);
      const result = await processor.run(ast);
      
      const hasSubstitution = JSON.stringify(result).includes('criticSubstitution');
      expect(hasSubstitution).toBe(true);
    });

    it('should round-trip substitution markup', async () => {
      const input = 'This is {~~old~>new~~} text.';
      
      const processor = unified()
        .use(remarkParse)
        .use(remarkCriticMarkup)
        .use(remarkCriticMarkupStringify)
        .use(remarkStringify);
      
      const result = await processor.process(input);
      
      expect(result.toString().trim()).toContain('{~~old~>new~~}');
    });
  });

  describe('Highlight', () => {
    it('should parse highlight markup', async () => {
      const input = 'This is {==highlighted==} text.';
      
      const processor = unified()
        .use(remarkParse)
        .use(remarkCriticMarkup);
      
      const ast = processor.parse(input);
      const result = await processor.run(ast);
      
      const hasHighlight = JSON.stringify(result).includes('criticHighlight');
      expect(hasHighlight).toBe(true);
    });

    it('should round-trip highlight markup', async () => {
      const input = 'This is {==highlighted==} text.';
      
      const processor = unified()
        .use(remarkParse)
        .use(remarkCriticMarkup)
        .use(remarkCriticMarkupStringify)
        .use(remarkStringify);
      
      const result = await processor.process(input);
      
      expect(result.toString().trim()).toContain('{==highlighted==}');
    });
  });

  describe('Comment', () => {
    it('should parse comment markup', async () => {
      const input = 'This is a {>>comment<<} in text.';
      
      const processor = unified()
        .use(remarkParse)
        .use(remarkCriticMarkup);
      
      const ast = processor.parse(input);
      const result = await processor.run(ast);
      
      const hasComment = JSON.stringify(result).includes('criticComment');
      expect(hasComment).toBe(true);
    });

    it('should round-trip comment markup', async () => {
      const input = 'This is a {>>comment<<} in text.';
      
      const processor = unified()
        .use(remarkParse)
        .use(remarkCriticMarkup)
        .use(remarkCriticMarkupStringify)
        .use(remarkStringify);
      
      const result = await processor.process(input);
      
      expect(result.toString().trim()).toContain('{>>comment<<}');
    });
  });

  describe('Complex scenarios', () => {
    it('should handle multiple markup types in one text', async () => {
      const input = 'Text with {++insertion++} and {--deletion--} and {~~old~>new~~}.';
      
      const processor = unified()
        .use(remarkParse)
        .use(remarkCriticMarkup)
        .use(remarkCriticMarkupStringify)
        .use(remarkStringify);
      
      const result = await processor.process(input);
      const output = result.toString().trim();
      
      expect(output).toContain('{++insertion++}');
      expect(output).toContain('{--deletion--}');
      expect(output).toContain('{~~old~>new~~}');
    });
  });
});
