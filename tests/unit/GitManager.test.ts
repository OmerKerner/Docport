import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GitManager } from '../../src/git/GitManager';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { simpleGit } from 'simple-git';

describe('GitManager', () => {
  let testRepoPath: string;
  let gitManager: GitManager;

  beforeAll(async () => {
    // Create a temporary directory for testing
    testRepoPath = await mkdtemp(join(tmpdir(), 'docport-git-test-'));
    
    // Initialize a git repository
    const git = simpleGit(testRepoPath);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');
    
    // Create initial commit
    await writeFile(join(testRepoPath, 'README.md'), '# Test Repository');
    await git.add('README.md');
    await git.commit('Initial commit');
    
    gitManager = new GitManager(testRepoPath);
  });

  afterAll(async () => {
    // Clean up test repository
    await rm(testRepoPath, { recursive: true, force: true });
  });

  describe('validateRepository', () => {
    it('should validate a valid git repository', async () => {
      await expect(gitManager.validateRepository()).resolves.toBeUndefined();
    });

    it('should throw error for non-git directory', async () => {
      const nonGitManager = new GitManager(tmpdir());
      await expect(nonGitManager.validateRepository()).rejects.toThrow('not a Git repository');
    });
  });

  describe('getCurrentCommitSha', () => {
    it('should return a valid SHA', async () => {
      const sha = await gitManager.getCurrentCommitSha();
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe('isWorkingTreeClean', () => {
    it('should return true for clean working tree', async () => {
      const isClean = await gitManager.isWorkingTreeClean();
      expect(isClean).toBe(true);
    });

    it('should return false when there are uncommitted changes', async () => {
      // Create a new file
      await writeFile(join(testRepoPath, 'test.txt'), 'test content');
      
      const isClean = await gitManager.isWorkingTreeClean();
      expect(isClean).toBe(false);
      
      // Clean up
      const git = simpleGit(testRepoPath);
      await git.add('test.txt');
      await git.commit('Add test file');
    });
  });

  describe('getStatusSummary', () => {
    it('should return zero counts for clean repository', async () => {
      const status = await gitManager.getStatusSummary();
      expect(status.staged).toBe(0);
      expect(status.unstaged).toBe(0);
    });

    it('should count unstaged changes', async () => {
      // Create a new file
      await writeFile(join(testRepoPath, 'unstaged.txt'), 'unstaged content');
      
      const status = await gitManager.getStatusSummary();
      expect(status.unstaged).toBeGreaterThan(0);
      expect(status.staged).toBe(0);
      
      // Clean up
      const git = simpleGit(testRepoPath);
      await git.add('unstaged.txt');
      await git.commit('Add unstaged file');
    });

    it('should count staged changes', async () => {
      // Create and stage a file
      await writeFile(join(testRepoPath, 'staged.txt'), 'staged content');
      const git = simpleGit(testRepoPath);
      await git.add('staged.txt');
      
      const status = await gitManager.getStatusSummary();
      expect(status.staged).toBeGreaterThan(0);
      
      // Clean up
      await git.commit('Add staged file');
    });
  });

  describe('createCommit', () => {
    it('should create a commit with all changes', async () => {
      // Create a new file
      await writeFile(join(testRepoPath, 'commit-test.txt'), 'commit test content');
      
      const sha = await gitManager.createCommit('Test commit message');
      
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      
      // Verify working tree is clean after commit
      const isClean = await gitManager.isWorkingTreeClean();
      expect(isClean).toBe(true);
    });

    it('should create a commit with specific files', async () => {
      // Create two files
      await writeFile(join(testRepoPath, 'file1.txt'), 'file 1 content');
      await writeFile(join(testRepoPath, 'file2.txt'), 'file 2 content');
      
      const sha = await gitManager.createCommit('Test specific files', ['file1.txt']);
      
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      
      // file2.txt should still be uncommitted
      const isClean = await gitManager.isWorkingTreeClean();
      expect(isClean).toBe(false);
      
      // Clean up
      await gitManager.createCommit('Commit remaining files');
    });
  });
});
