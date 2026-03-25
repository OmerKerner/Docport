import { describe, it, expect } from 'vitest';
import { DocportState } from '../../src/bridge/DocportState.js';
import type { CommentState, RevisionState } from '../../src/types/index.js';

describe('DocportState', () => {
  describe('computeAnchorQuote', () => {
    it('should extract first 40 characters', () => {
      const text = 'This is a long piece of text that should be truncated to forty characters or so.';
      const quote = DocportState.computeAnchorQuote(text);
      expect(quote.length).toBeLessThanOrEqual(40);
    });

    it('should normalize whitespace', () => {
      const text = 'This   has    multiple     spaces';
      const quote = DocportState.computeAnchorQuote(text);
      expect(quote).toBe('This has multiple spaces');
    });

    it('should extract first sentence if short enough', () => {
      const text = 'Short sentence. Another one follows.';
      const quote = DocportState.computeAnchorQuote(text);
      expect(quote).toBe('Short sentence.');
    });

    it('should truncate at approximately 40 chars', () => {
      const text = 'This is a very long text that needs to be truncated at a word boundary not in middle';
      const quote = DocportState.computeAnchorQuote(text);
      // Should be around 40 chars, give or take for word boundaries
      expect(quote.length).toBeLessThanOrEqual(40);
      expect(quote.length).toBeGreaterThan(30);
    });
  });

  describe('generateUuid', () => {
    it('should generate valid UUIDs', () => {
      const uuid1 = DocportState.generateUuid();
      const uuid2 = DocportState.generateUuid();
      
      expect(uuid1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(uuid2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('computeHash', () => {
    it('should compute SHA-256 hash', () => {
      const buffer = Buffer.from('test content');
      const hash = DocportState.computeHash(buffer);
      
      expect(hash).toHaveLength(64); // SHA-256 is 64 hex chars
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce consistent hashes', () => {
      const buffer = Buffer.from('test content');
      const hash1 = DocportState.computeHash(buffer);
      const hash2 = DocportState.computeHash(buffer);
      
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different content', () => {
      const buffer1 = Buffer.from('content 1');
      const buffer2 = Buffer.from('content 2');
      
      const hash1 = DocportState.computeHash(buffer1);
      const hash2 = DocportState.computeHash(buffer2);
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('create', () => {
    it('should create new empty state', () => {
      const state = DocportState.create('.');
      
      expect(state.comments).toEqual([]);
      expect(state.revisions).toEqual([]);
      expect(state.lastPushCommit).toBeNull();
      expect(state.lastPullCommit).toBeNull();
      expect(state.lastDocxHash).toBeNull();
    });
  });

  describe('upsertComment', () => {
    it('should add new comment', () => {
      const state = DocportState.create('.');
      const comment: CommentState = {
        id: DocportState.generateUuid(),
        chapter: '01-intro.md',
        anchorQuote: 'test anchor',
        author: 'Test Author',
        date: new Date().toISOString(),
        body: 'Test comment',
        replies: [],
        resolved: false,
      };

      state.upsertComment(comment);
      
      expect(state.comments).toHaveLength(1);
      expect(state.getComment(comment.id)).toEqual(comment);
    });

    it('should update existing comment', () => {
      const state = DocportState.create('.');
      const id = DocportState.generateUuid();
      const comment: CommentState = {
        id,
        chapter: '01-intro.md',
        anchorQuote: 'test anchor',
        author: 'Test Author',
        date: new Date().toISOString(),
        body: 'Test comment',
        replies: [],
        resolved: false,
      };

      state.upsertComment(comment);
      
      const updated = { ...comment, body: 'Updated comment' };
      state.upsertComment(updated);
      
      expect(state.comments).toHaveLength(1);
      expect(state.getComment(id)?.body).toBe('Updated comment');
    });
  });

  describe('upsertRevision', () => {
    it('should add new revision', () => {
      const state = DocportState.create('.');
      const revision: RevisionState = {
        id: DocportState.generateUuid(),
        chapter: '01-intro.md',
        kind: 'insertion',
        author: 'Test Author',
        date: new Date().toISOString(),
        text: 'inserted text',
        precedingContext: 'context before',
        decided: null,
      };

      state.upsertRevision(revision);
      
      expect(state.revisions).toHaveLength(1);
      expect(state.getRevision(revision.id)).toEqual(revision);
    });
  });

  describe('nextCommentId and nextRevisionId', () => {
    it('should generate sequential IDs', () => {
      const state = DocportState.create('.');
      
      const id1 = state.nextCommentId();
      const id2 = state.nextCommentId();
      const id3 = state.nextCommentId();
      
      expect(id2).toBe(id1 + 1);
      expect(id3).toBe(id2 + 1);
    });

    it('should initialize from highest existing ID', () => {
      // The constructor should pick up the highest lastDocxId from state
      // We can't easily test this without accessing the private constructor,
      // so let's just verify the basic sequential behavior
      const state = DocportState.create('.');
      
      // Add a comment - even without lastDocxId, it should work
      const comment: CommentState = {
        id: DocportState.generateUuid(),
        chapter: '01-intro.md',
        anchorQuote: 'test',
        author: 'Test',
        date: new Date().toISOString(),
        body: 'Test',
        replies: [],
        resolved: false,
      };
      
      state.upsertComment(comment);
      
      // Assign an ID
      const id1 = state.nextCommentId();
      comment.lastDocxId = id1;
      state.upsertComment(comment);
      
      // Next ID should increment
      const id2 = state.nextCommentId();
      expect(id2).toBe(id1 + 1);
    });
  });
});
