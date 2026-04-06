import { resolve, dirname } from 'path';
import { ManifestReader } from '../manifest/ManifestReader.js';
import { MarkdownReader } from '../markdown/MarkdownReader.js';
import { DocxBuilder } from '../docx/DocxBuilder.js';
import { applyReferenceDocStyles } from '../docx/ReferenceDocStyler.js';
import { GitManager } from '../git/GitManager.js';
import { DocportState } from './DocportState.js';
import type { DocportDocument, ParsedChapter } from '../types/index.js';

/**
 * Options for the push operation.
 */
export interface PushOptions {
  /** Skip validation and force push even with uncommitted changes */
  force?: boolean;
  /** Show what would be done without actually writing the file */
  dryRun?: boolean;
  /** Override output path for generated .docx */
  outputPath?: string;
}

/**
 * MD → DOCX pipeline (implements `docport push`).
 * Converts markdown chapters to a single .docx file.
 */
export class Pusher {
  /**
   * Execute the push operation.
   * 
   * @param manifestPath - Path to paper.manifest.json
   * @param options - Push options
   */
  async run(manifestPath: string, options: PushOptions = {}): Promise<void> {
    console.log('🚀 Starting docport push...\n');

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
    if (!options.force) {
      console.log('🔍 Checking Git status...');
      const gitManager = new GitManager(manifestDir);
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

    // Step 3: Parse all markdown chapters
    console.log('📝 Parsing markdown chapters...');
    const mdReader = new MarkdownReader();
    const chapters: ParsedChapter[] = [];

    for (const chapter of manifest.chapters) {
      console.log(`   - ${chapter.file}`);
      const parsed = await mdReader.readChapter(chapter.file, state.getState());
      chapters.push(parsed);
    }

    // Step 4: Verify all comment/revision IDs exist in state
    console.log('🔍 Validating annotations...');
    const orphanedComments: string[] = [];
    const orphanedRevisions: string[] = [];

    for (const chapter of chapters) {
      for (const comment of chapter.comments) {
        if (comment.id && !state.getComment(comment.id)) {
          orphanedComments.push(comment.id);
        }
      }

      for (const revision of chapter.revisions) {
        if (revision.id && !state.getRevision(revision.id)) {
          orphanedRevisions.push(revision.id);
        }
      }
    }

    if (orphanedComments.length > 0 || orphanedRevisions.length > 0) {
      let errorMsg = 'Found annotations with IDs not in state:\n';
      if (orphanedComments.length > 0) {
        errorMsg += `  Comments: ${orphanedComments.join(', ')}\n`;
      }
      if (orphanedRevisions.length > 0) {
        errorMsg += `  Revisions: ${orphanedRevisions.join(', ')}\n`;
      }
      errorMsg += 'This indicates corrupted state. Try running `docport pull` first.';
      throw new Error(errorMsg);
    }

    // Step 5: Assign docx IDs to any new items
    console.log('🔢 Assigning docx IDs...');
    let newComments = 0;
    let newRevisions = 0;

    for (const chapter of chapters) {
      for (const comment of chapter.comments) {
        const stateComment = state.getComment(comment.id);
        if (stateComment && !stateComment.lastDocxId) {
          stateComment.lastDocxId = state.nextCommentId();
          state.upsertComment(stateComment);
          newComments++;
        }
      }

      for (const revision of chapter.revisions) {
        const stateRevision = state.getRevision(revision.id);
        if (stateRevision && !stateRevision.lastDocxId) {
          stateRevision.lastDocxId = state.nextRevisionId();
          state.upsertRevision(stateRevision);
          newRevisions++;
        }
      }
    }

    if (newComments > 0 || newRevisions > 0) {
      console.log(`   Assigned IDs: ${newComments} comments, ${newRevisions} revisions`);
    }

    // Step 6: Build the document structure
    console.log('📦 Building document...');
    const document: DocportDocument = {
      manifest,
      chapters,
      state: state.getState(),
    };

    // Step 7: Generate .docx
    console.log('📄 Generating .docx file...');
    const docxBuilder = new DocxBuilder();
    let docxBuffer = await docxBuilder.build(document, manifestDir);
    if (manifest.referenceDoc) {
      console.log(`🎨 Applying reference styles from: ${manifest.referenceDoc}`);
      docxBuffer = await applyReferenceDocStyles(docxBuffer, manifest.referenceDoc);
    }

    // Step 8: Write to output file (unless dry-run)
    const outputPath = options.outputPath
      ? resolve(options.outputPath)
      : resolve(manifestDir, manifest.outputFile || 'output.docx');

    if (options.dryRun) {
      console.log(`\n✅ Dry run completed. Would write to: ${outputPath}`);
      console.log(`   Size: ${(docxBuffer.length / 1024).toFixed(2)} KB`);
    } else {
      const { writeFile } = await import('fs/promises');
      await writeFile(outputPath, docxBuffer);
      console.log(`   Wrote: ${outputPath} (${(docxBuffer.length / 1024).toFixed(2)} KB)`);

      // Step 9: Update state
      console.log('💾 Updating state...');
      if (!options.force) {
        const gitManager = new GitManager(manifestDir);
        const commitSha = await gitManager.getCurrentCommitSha();
        state.lastPushCommit = commitSha;
      }

      const docxHash = DocportState.computeHash(docxBuffer);
      state.lastDocxHash = docxHash;

      await state.save();
      console.log('   State saved.');
    }

    // Step 10: Print summary
    console.log('\n📊 Summary:');
    console.log(`   Chapters: ${chapters.length}`);
    console.log(`   Comments: ${state.comments.length}`);
    console.log(`   Revisions: ${state.revisions.length} (${state.revisions.filter(r => r.decided === null).length} pending)`);
    console.log('\n✅ Push completed successfully!');
  }
}
