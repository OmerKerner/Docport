import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import {
  DocportStateSchema,
  emptyDocportState,
  type DocportState as DocportStateType,
  type CommentState,
  type RevisionState,
} from '../types/index.js';

/**
 * State manager for paper.docport.json.
 * Handles loading, saving, and mutation of the bridge state file.
 */
export class DocportState {
  private state: DocportStateType;
  private readonly stateFilePath: string;
  private nextCommentDocxId: number;
  private nextRevisionDocxId: number;

  private constructor(state: DocportStateType, stateFilePath: string) {
    this.state = state;
    this.stateFilePath = stateFilePath;
    
    // Initialize next IDs based on existing state
    const maxCommentId = state.comments.reduce((max, c) => 
      Math.max(max, c.lastDocxId ?? 0), 0
    );
    this.nextCommentDocxId = maxCommentId + 1;
    
    const maxRevisionId = state.revisions.reduce((max, r) => 
      Math.max(max, r.lastDocxId ?? 0), 0
    );
    this.nextRevisionDocxId = maxRevisionId + 1;
  }

  /**
   * Load an existing state file from disk.
   * 
   * @param manifestDir - Directory containing the manifest (and state file)
   * @returns Loaded DocportState instance
   * @throws Error if file doesn't exist or validation fails
   */
  static async load(manifestDir: string): Promise<DocportState> {
    const stateFilePath = resolve(manifestDir, 'paper.docport.json');
    
    let fileContent: string;
    try {
      fileContent = await readFile(stateFilePath, 'utf-8');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw new Error(
          `State file not found: ${stateFilePath}. ` +
          `Run 'docport init' to create a new state file.`
        );
      }
      throw new Error(
        `Failed to read state file: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    let rawData: unknown;
    try {
      rawData = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `State file contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const state = DocportStateSchema.parse(rawData);
    return new DocportState(state, stateFilePath);
  }

  /**
   * Create a new state instance (for initialization).
   * Does not write to disk until save() is called.
   * 
   * @param manifestDir - Directory where the state file should be created
   * @returns New DocportState instance
   */
  static create(manifestDir: string): DocportState {
    const stateFilePath = resolve(manifestDir, 'paper.docport.json');
    const state = emptyDocportState();
    return new DocportState(state, stateFilePath);
  }

  /**
   * Save the current state to disk.
   */
  async save(): Promise<void> {
    const json = JSON.stringify(this.state, null, 2);
    await writeFile(this.stateFilePath, json, 'utf-8');
  }

  /**
   * Get a comment by ID.
   */
  getComment(id: string): CommentState | undefined {
    return this.state.comments.find(c => c.id === id);
  }

  /**
   * Get a revision by ID.
   */
  getRevision(id: string): RevisionState | undefined {
    return this.state.revisions.find(r => r.id === id);
  }

  /**
   * Insert or update a comment in the state.
   */
  upsertComment(comment: CommentState): void {
    const index = this.state.comments.findIndex(c => c.id === comment.id);
    
    if (index >= 0) {
      this.state.comments[index] = comment;
    } else {
      this.state.comments.push(comment);
    }
  }

  /**
   * Insert or update a revision in the state.
   */
  upsertRevision(revision: RevisionState): void {
    const index = this.state.revisions.findIndex(r => r.id === revision.id);
    
    if (index >= 0) {
      this.state.revisions[index] = revision;
    } else {
      this.state.revisions.push(revision);
    }
  }

  /**
   * Assign the next available docx comment ID.
   * These are sequential integers used by Word internally.
   */
  nextCommentId(): number {
    return this.nextCommentDocxId++;
  }

  /**
   * Assign the next available docx revision ID.
   */
  nextRevisionId(): number {
    return this.nextRevisionDocxId++;
  }

  /**
   * Generate a stable UUID for a new comment or revision.
   */
  static generateUuid(): string {
    return randomUUID();
  }

  /**
   * Compute an anchor quote from surrounding text.
   * Takes the first sentence or 40 characters, normalized.
   * 
   * @param surroundingText - The text to extract a quote from
   * @returns Normalized anchor quote (max 40 chars)
   */
  static computeAnchorQuote(surroundingText: string): string {
    // Normalize whitespace
    let normalized = surroundingText.replace(/\s+/g, ' ').trim();
    
    // Try to find the first sentence (ending with . ! ?)
    const sentenceEnd = normalized.search(/[.!?]\s/);
    
    if (sentenceEnd !== -1 && sentenceEnd <= 40) {
      // Use the first sentence if it's short enough
      normalized = normalized.slice(0, sentenceEnd + 1).trim();
    } else {
      // Otherwise, take the first 40 characters
      normalized = normalized.slice(0, 40);
      
      // If we cut in the middle of a word, back up to the last space
      if (normalized.length === 40 && surroundingText.length > 40) {
        const lastSpace = normalized.lastIndexOf(' ');
        if (lastSpace > 20) {
          normalized = normalized.slice(0, lastSpace);
        }
      }
    }
    
    return normalized.trim();
  }

  /**
   * Compute SHA-256 hash of a buffer (for .docx files).
   */
  static computeHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  // Getters for state properties
  get lastPushCommit(): string | null {
    return this.state.lastPushCommit;
  }

  set lastPushCommit(value: string | null) {
    this.state.lastPushCommit = value;
  }

  get lastPullCommit(): string | null {
    return this.state.lastPullCommit;
  }

  set lastPullCommit(value: string | null) {
    this.state.lastPullCommit = value;
  }

  get lastDocxHash(): string | null {
    return this.state.lastDocxHash;
  }

  set lastDocxHash(value: string | null) {
    this.state.lastDocxHash = value;
  }

  get comments(): CommentState[] {
    return this.state.comments;
  }

  get revisions(): RevisionState[] {
    return this.state.revisions;
  }

  /**
   * Get the internal state object (use sparingly).
   */
  getState(): DocportStateType {
    return this.state;
  }
}
