import { resolve, dirname, basename } from 'path';
import { readFile } from 'fs/promises';
import { ManifestReader } from '../manifest/ManifestReader.js';
import { MarkdownReader } from '../markdown/MarkdownReader.js';
import { MarkdownWriter } from '../markdown/MarkdownWriter.js';
import { DocxParser } from '../docx/DocxParser.js';
import { GitManager } from '../git/GitManager.js';
import { DocportState } from './DocportState.js';
import { AnchorResolver, AnchorNotFoundError } from './AnchorResolver.js';
import { ConflictResolver } from './ConflictResolver.js';

/**
 * Options for the pull operation.
 */
export interface PullOptions {
  /** Skip clean tree check and allow pulling with uncommitted changes */
  force?: boolean;
  /** Resume after conflicts were manually resolved */
  continueAfterConflict?: boolean;
  /** Skip creating post-pull commit */
  noCommit?: boolean;
}

/**
 * DOCX → MD pipeline (implements `docport pull`).
 * Extracts annotations from .docx and writes them back to markdown.
 */
export class Puller {
  /**
   * Execute the pull operation.
   * 
   * @param docxPath - Path to the .docx file to pull from
   * @param manifestPath - Path to paper.manifest.json
   * @param options - Pull options
   */
  async run(docxPath: string, manifestPath: string, options: PullOptions = {}): Promise<void> {
    console.log('⬇️  Starting docport pull...\n');

    // Step 1: Load manifest and state
    console.log('📖 Loading manifest and state...');
    const manifestReader = new ManifestReader();
    const manifest = await manifestReader.loadManifest(manifestPath);
    const manifestDir = dirname(resolve(manifestPath));

    let state: DocportState;
    try {
      state = await DocportState.load(manifestDir);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        console.log('   No existing state file found. Creating new state.');
        state = DocportState.create(manifestDir);
      } else {
        throw error;
      }
    }

    // Step 2: Verify Git status (unless --force)
    const gitManager = new GitManager(manifestDir);
    if (!options.force) {
      console.log('🔍 Checking Git status...');
      await gitManager.validateRepository();

      const isClean = await gitManager.isWorkingTreeClean();
      if (!isClean) {
        const status = await gitManager.getStatusSummary();
        throw new Error(
          `Working tree has uncommitted changes (${status.staged} staged, ${status.unstaged} unstaged). ` +
          `Commit your changes first or use --force to skip this check.`
        );
      }
    }

    // Step 3: Verify docx hash (warn if changed)
    const docxBuffer = await readFile(resolve(docxPath));
    const docxHash = DocportState.computeHash(docxBuffer);

    if (state.lastDocxHash && state.lastDocxHash !== docxHash) {
      console.log('⚠️  Warning: .docx file has changed since last push/pull');
      console.log('   This is expected if the PI made changes in Word.');
    }

    // Step 4: Git commit (pre-pull snapshot)
    if (!options.force) {
      console.log('💾 Creating pre-pull snapshot...');
      try {
        const commitSha = await gitManager.createCommit('auto: pre-pull snapshot');
        console.log(`   Created commit: ${commitSha.slice(0, 8)}`);
      } catch (error) {
        // If there are no changes to commit, that's fine
        if (error instanceof Error && error.message.includes('nothing to commit')) {
          console.log('   No changes to commit.');
        } else {
          throw error;
        }
      }
    }

    // Step 5: Parse .docx
    console.log('📄 Parsing .docx file...');
    const docxParser = new DocxParser();
    const parseResult = await docxParser.parse(docxBuffer, manifest, state.getState());

    console.log(`   Found: ${parseResult.newComments.length} new comments, ${parseResult.newRevisions.length} new revisions`);
    console.log(`   Decided: ${parseResult.decidedRevisions.length} revisions`);
    if (parseResult.equationWarnings.length > 0) {
      console.log(`   ⚠️  Equation warnings: ${parseResult.equationWarnings.length}`);
      for (const warning of parseResult.equationWarnings.slice(0, 5)) {
        console.log(`      - ${warning}`);
      }
    }

    // Step 6: Load current markdown chapters
    console.log('📝 Loading markdown chapters...');
    const mdReader = new MarkdownReader();
    const mdWriter = new MarkdownWriter();
    const chapters = new Map<string, any>();

    for (const chapterDef of manifest.chapters) {
      const chapterName = basename(chapterDef.file);
      const parsed = await mdReader.readChapter(chapterDef.file, state.getState());
      chapters.set(chapterName, { parsed, modified: false });
    }

    // Step 7: Process new comments
    console.log('💬 Processing new comments...');
    let commentsAdded = 0;
    const commentErrors: string[] = [];

    for (const comment of parseResult.newComments) {
      try {
        // Assign UUID if not present
        if (!comment.id) {
          comment.id = DocportState.generateUuid();
        }

        // Find which chapter this comment belongs to
        const chapter = chapters.get(comment.chapter);
        if (!chapter) {
          commentErrors.push(`Comment ${comment.id}: chapter ${comment.chapter} not found`);
          continue;
        }

        // Use AnchorResolver to find position
        try {
          AnchorResolver.resolve(chapter.parsed.ast, comment.anchorQuote);
          
          // Insert comment anchor
          chapter.parsed.ast = mdWriter.insertCommentAnchor(chapter.parsed.ast, comment);
          chapter.modified = true;
          commentsAdded++;

          // Add to state
          state.upsertComment({
            id: comment.id,
            chapter: comment.chapter,
            anchorQuote: comment.anchorQuote,
            author: comment.author,
            date: comment.date.toISOString(),
            body: comment.body,
            replies: comment.replies.map(r => ({
              id: r.id,
              author: r.author,
              date: r.date.toISOString(),
              body: r.body,
            })),
            resolved: comment.resolved,
          });
        } catch (error) {
          if (error instanceof AnchorNotFoundError) {
            commentErrors.push(
              `Comment ${comment.id}: ${error.message}`
            );
          } else {
            throw error;
          }
        }
      } catch (error) {
        commentErrors.push(
          `Comment ${comment.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    console.log(`   Added: ${commentsAdded} comments`);
    if (commentErrors.length > 0) {
      console.log(`   ⚠️  Errors: ${commentErrors.length}`);
      for (const error of commentErrors.slice(0, 5)) {
        console.log(`      - ${error}`);
      }
      if (commentErrors.length > 5) {
        console.log(`      ... and ${commentErrors.length - 5} more`);
      }
    }

    // Step 8: Process new revisions
    console.log('✏️  Processing new revisions...');
    let revisionsAdded = 0;
    const revisionErrors: string[] = [];
    const conflicts: Array<{ chapter: string; conflict: any }> = [];

    for (const revision of parseResult.newRevisions) {
      try {
        // Assign UUID if not present
        if (!revision.id) {
          revision.id = DocportState.generateUuid();
        }

        const chapter = chapters.get(revision.chapter);
        if (!chapter) {
          revisionErrors.push(`Revision ${revision.id}: chapter ${revision.chapter} not found`);
          continue;
        }

        // Detect conflicts
        const chapterConflicts = ConflictResolver.detectConflicts(
          chapter.parsed.ast,
          [revision]
        );

        if (chapterConflicts.length > 0) {
          // Write conflict markers
          for (const conflict of chapterConflicts) {
            chapter.parsed.ast = ConflictResolver.writeConflictMarkers(
              chapter.parsed.ast,
              conflict
            );
            conflicts.push({ chapter: revision.chapter, conflict });
          }
          chapter.modified = true;
        } else {
          // No conflict - insert revision normally
          chapter.parsed.ast = mdWriter.insertRevision(chapter.parsed.ast, revision);
          chapter.modified = true;
          revisionsAdded++;
        }

        // Add to state
        state.upsertRevision({
          id: revision.id,
          chapter: revision.chapter,
          kind: revision.kind,
          author: revision.author,
          date: revision.date.toISOString(),
          text: revision.text,
          precedingContext: revision.precedingContext,
          decided: revision.decided,
        });
      } catch (error) {
        revisionErrors.push(
          `Revision ${revision.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    console.log(`   Added: ${revisionsAdded} revisions`);
    if (conflicts.length > 0) {
      console.log(`   ⚠️  Conflicts: ${conflicts.length} (marked with conflict markers)`);
    }
    if (revisionErrors.length > 0) {
      console.log(`   ⚠️  Errors: ${revisionErrors.length}`);
      for (const error of revisionErrors.slice(0, 5)) {
        console.log(`      - ${error}`);
      }
    }

    // Step 9: Process decided revisions
    console.log('✅ Processing decided revisions...');
    let revisionsFinalized = 0;

    for (const revision of parseResult.decidedRevisions) {
      const chapter = chapters.get(revision.chapter);
      if (!chapter) continue;

      // Determine if accepted or rejected (for now, assume accepted)
      const accept = true; // TODO: detect from .docx if revision was accepted or rejected
      
      chapter.parsed.ast = mdWriter.finalizeRevision(chapter.parsed.ast, revision, accept);
      chapter.modified = true;
      revisionsFinalized++;

      // Update state
      const stateRevision = state.getRevision(revision.id);
      if (stateRevision) {
        stateRevision.decided = accept;
        state.upsertRevision(stateRevision);
      }
    }

    console.log(`   Finalized: ${revisionsFinalized} revisions`);

    // Step 10: Write modified chapters
    console.log('💾 Writing modified chapters...');
    let chaptersWritten = 0;

    for (const [chapterName, chapter] of chapters) {
      if (chapter.modified) {
        await mdWriter.writeChapter(chapter.parsed, chapter.parsed.file);
        chaptersWritten++;
        console.log(`   - ${chapterName}`);
      }
    }

    // Step 11: Update state
    console.log('💾 Updating state...');
    state.lastDocxHash = docxHash;
    
    if (!options.force) {
      const commitSha = await gitManager.getCurrentCommitSha();
      state.lastPullCommit = commitSha;
    }

    await state.save();
    console.log('   State saved.');

    // Step 12: Git commit (post-pull)
    if (!options.force && !options.noCommit && chaptersWritten > 0) {
      console.log('💾 Creating post-pull commit...');
      try {
        const docxFilename = basename(docxPath);
        const commitSha = await gitManager.createCommit(
          `bridge: pull from ${docxFilename}\n\n` +
          `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
        );
        console.log(`   Created commit: ${commitSha.slice(0, 8)}`);
      } catch (error) {
        console.log(`   ⚠️  Warning: Could not create commit: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Step 13: Print summary
    console.log('\n📊 Summary:');
    console.log(`   Chapters modified: ${chaptersWritten}`);
    console.log(`   New comments: ${commentsAdded}`);
    console.log(`   New revisions: ${revisionsAdded}`);
    console.log(`   Decided revisions: ${revisionsFinalized}`);
    if (conflicts.length > 0) {
      console.log(`   ⚠️  Conflicts detected: ${conflicts.length} (resolve manually)`);
    }
    console.log('\n✅ Pull completed successfully!');
  }
}
