import { resolve, dirname } from 'path';
import { readFile } from 'fs/promises';
import { ManifestReader } from '../manifest/ManifestReader.js';
import { DocxParser } from '../docx/DocxParser.js';
import { DocportState } from './DocportState.js';

/**
 * Preview mode (implements `docport diff`).
 * Shows what changes would be made by a pull operation without modifying files.
 */
export class Differ {
  /**
   * Execute the diff operation.
   * 
   * @param docxPath - Path to the .docx file to compare
   * @param manifestPath - Path to paper.manifest.json
   */
  async run(docxPath: string, manifestPath: string): Promise<void> {
    console.log('🔍 Analyzing .docx changes...\n');

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
        console.log('   No existing state file found.');
        state = DocportState.create(manifestDir);
      } else {
        throw error;
      }
    }

    // Step 2: Check docx hash
    const docxBuffer = await readFile(resolve(docxPath));
    const docxHash = DocportState.computeHash(docxBuffer);

    if (state.lastDocxHash) {
      if (state.lastDocxHash === docxHash) {
        console.log('✅ .docx file unchanged since last push/pull\n');
      } else {
        console.log('📝 .docx file has been modified since last push/pull\n');
      }
    } else {
      console.log('📝 First time analyzing this .docx file\n');
    }

    // Step 3: Parse .docx
    console.log('📄 Parsing .docx file...');
    const docxParser = new DocxParser();
    const parseResult = await docxParser.parse(docxBuffer, manifest, state.getState());

    // Step 4: Display new comments
    console.log('\n💬 New Comments:');
    if (parseResult.newComments.length === 0) {
      console.log('   (none)');
    } else {
      for (const comment of parseResult.newComments) {
        console.log(`\n   📌 Comment in ${comment.chapter}`);
        console.log(`      Author: ${comment.author}`);
        console.log(`      Date: ${comment.date.toISOString()}`);
        console.log(`      Anchor: "${comment.anchorQuote}"`);
        console.log(`      Body: ${this.truncate(comment.body, 80)}`);
        
        if (comment.replies.length > 0) {
          console.log(`      Replies: ${comment.replies.length}`);
          for (const reply of comment.replies) {
            console.log(`         - ${reply.author}: ${this.truncate(reply.body, 60)}`);
          }
        }
      }
    }

    // Step 5: Display new revisions
    console.log('\n✏️  New Revisions:');
    if (parseResult.newRevisions.length === 0) {
      console.log('   (none)');
    } else {
      // Group by chapter
      const byChapter = new Map<string, typeof parseResult.newRevisions>();
      for (const revision of parseResult.newRevisions) {
        if (!byChapter.has(revision.chapter)) {
          byChapter.set(revision.chapter, []);
        }
        byChapter.get(revision.chapter)!.push(revision);
      }

      for (const [chapter, revisions] of byChapter) {
        console.log(`\n   📄 ${chapter}:`);
        
        for (const revision of revisions) {
          const symbol = revision.kind === 'insertion' ? '++' : '--';
          const color = revision.kind === 'insertion' ? '🟢' : '🔴';
          
          console.log(`      ${color} ${symbol} ${this.truncate(revision.text, 60)}`);
          console.log(`         Author: ${revision.author}`);
          console.log(`         Context: "${this.truncate(revision.precedingContext, 40)}..."`);
        }
      }
    }

    // Step 6: Display decided revisions
    console.log('\n✅ Decided Revisions (no longer tracked):');
    if (parseResult.decidedRevisions.length === 0) {
      console.log('   (none)');
    } else {
      const byChapter = new Map<string, typeof parseResult.decidedRevisions>();
      for (const revision of parseResult.decidedRevisions) {
        if (!byChapter.has(revision.chapter)) {
          byChapter.set(revision.chapter, []);
        }
        byChapter.get(revision.chapter)!.push(revision);
      }

      for (const [chapter, revisions] of byChapter) {
        console.log(`\n   📄 ${chapter}:`);
        
        for (const revision of revisions) {
          const action = revision.decided ? 'ACCEPTED' : 'REJECTED';
          const symbol = revision.kind === 'insertion' ? '++' : '--';
          
          console.log(`      ✓ ${action}: ${symbol} ${this.truncate(revision.text, 60)}`);
        }
      }
    }

    // Step 7: Summary statistics
    console.log('\n📊 Summary:');
    console.log(`   New comments: ${parseResult.newComments.length}`);
    console.log(`   New revisions: ${parseResult.newRevisions.length} ` +
                `(${parseResult.newRevisions.filter(r => r.kind === 'insertion').length} insertions, ` +
                `${parseResult.newRevisions.filter(r => r.kind === 'deletion').length} deletions)`);
    console.log(`   Decided revisions: ${parseResult.decidedRevisions.length}`);
    if (parseResult.equationWarnings.length > 0) {
      console.log(`   Equation conversion warnings: ${parseResult.equationWarnings.length}`);
      for (const warning of parseResult.equationWarnings.slice(0, 5)) {
        console.log(`      - ${warning}`);
      }
    }

    // Step 8: Current state info
    console.log('\n📚 Current State:');
    console.log(`   Total comments tracked: ${state.comments.length}`);
    console.log(`   Total revisions tracked: ${state.revisions.length}`);
    console.log(`   Pending revisions: ${state.revisions.filter(r => r.decided === null).length}`);
    console.log(`   Resolved comments: ${state.comments.filter(c => c.resolved).length}`);

    if (state.lastPushCommit) {
      console.log(`   Last push commit: ${state.lastPushCommit.slice(0, 8)}`);
    }
    if (state.lastPullCommit) {
      console.log(`   Last pull commit: ${state.lastPullCommit.slice(0, 8)}`);
    }

    // Step 9: Next steps
    if (parseResult.newComments.length > 0 || parseResult.newRevisions.length > 0) {
      console.log('\n💡 Next Steps:');
      console.log('   Run `docport pull` to import these changes into your markdown files.');
      
      if (parseResult.newRevisions.length > 0) {
        console.log('   Review the revisions and use CriticMarkup to accept/reject them:');
        console.log('     - Accept insertion: remove {++ ++} markers, keep text');
        console.log('     - Reject insertion: remove entire {++ ++} block');
        console.log('     - Accept deletion: remove entire {-- --} block');
        console.log('     - Reject deletion: remove {-- --} markers, keep text');
      }
    } else {
      console.log('\n✅ No new changes in .docx file');
    }
  }

  /**
   * Truncate text to a maximum length with ellipsis.
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(0, maxLength - 3) + '...';
  }
}
