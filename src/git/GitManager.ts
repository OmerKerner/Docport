import { simpleGit, SimpleGit, StatusResult } from 'simple-git';

/**
 * GitManager wraps simple-git to provide typed Git operations for Docport.
 * 
 * Core responsibilities:
 * - Verify repository status before destructive operations
 * - Auto-commit before pull operations (non-destructive pull invariant)
 * - Provide typed interfaces for Git status and commits
 */
export class GitManager {
  private readonly git: SimpleGit;
  private readonly repoPath: string;

  /**
   * Initialize GitManager for a repository.
   * 
   * @param repoPath - Absolute path to the Git repository root
   */
  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
  }

  /**
   * Get the current HEAD commit SHA.
   * 
   * @returns The full SHA of the current HEAD commit
   * @throws Error if not in a Git repository or HEAD cannot be resolved
   */
  async getCurrentCommitSha(): Promise<string> {
    try {
      const sha = await this.git.revparse(['HEAD']);
      return sha.trim();
    } catch (error) {
      throw new Error(
        `Failed to get current commit SHA: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if the working tree is clean (no uncommitted changes).
   * 
   * @returns true if no staged or unstaged changes exist, false otherwise
   */
  async isWorkingTreeClean(): Promise<boolean> {
    try {
      const status: StatusResult = await this.git.status();
      
      // Check for any changes: modified, added, deleted, renamed, etc.
      return (
        status.files.length === 0 &&
        status.staged.length === 0 &&
        status.modified.length === 0 &&
        status.created.length === 0 &&
        status.deleted.length === 0 &&
        status.renamed.length === 0 &&
        status.conflicted.length === 0
      );
    } catch (error) {
      throw new Error(
        `Failed to check working tree status: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Create a Git commit with the specified message and files.
   * 
   * @param message - Commit message
   * @param files - Optional array of file paths to commit. If omitted, all changes are staged.
   * @returns The SHA of the newly created commit
   * @throws Error if commit fails or if there are no changes to commit
   */
  async createCommit(message: string, files?: string[]): Promise<string> {
    try {
      // Stage files
      if (files && files.length > 0) {
        await this.git.add(files);
      } else {
        // Stage all changes
        await this.git.add('.');
      }

      // Create the commit
      const commitResult = await this.git.commit(message);
      
      if (!commitResult.commit) {
        throw new Error('Commit created but SHA not returned');
      }

      return commitResult.commit;
    } catch (error) {
      throw new Error(
        `Failed to create commit: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Validate that the path is a valid Git repository.
   * 
   * @throws Error with descriptive message if not a valid Git repository
   */
  async validateRepository(): Promise<void> {
    try {
      const isRepo = await this.git.checkIsRepo();
      
      if (!isRepo) {
        throw new Error(
          `Path "${this.repoPath}" is not a Git repository. ` +
          'Initialize a repository with "git init" or clone an existing one.'
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('is not a Git repository')) {
        throw error;
      }
      throw new Error(
        `Failed to validate Git repository at "${this.repoPath}": ` +
        `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get a summary of repository status with counts of staged and unstaged changes.
   * 
   * @returns Object containing counts of staged and unstaged files
   */
  async getStatusSummary(): Promise<{ staged: number; unstaged: number }> {
    try {
      const status: StatusResult = await this.git.status();
      
      // Count staged changes (files in staging area)
      const staged = status.staged.length;
      
      // Count unstaged changes (modified, created, deleted but not staged)
      const unstaged = 
        status.modified.length +
        status.created.length +
        status.deleted.length +
        status.renamed.length;
      
      return { staged, unstaged };
    } catch (error) {
      throw new Error(
        `Failed to get status summary: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
