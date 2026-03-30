import { basename, dirname, resolve } from 'path';
import { readFile, writeFile } from 'fs/promises';

import type { Root } from 'mdast';
import type { Manifest, DocportState as DocportStateType, ParsedChapter } from '../types/index.js';
import { emptyDocportState } from '../types/index.js';
import { DocxParser } from '../docx/DocxParser.js';
import { MarkdownWriter } from '../markdown/MarkdownWriter.js';
import { DocportState } from './DocportState.js';

export type BootstrapChapterMode = 'single' | 'pagebreak';

export interface BootstrapOptions {
  title?: string;
  author?: string;
  chapterMode?: BootstrapChapterMode;
  manifestPath?: string;
  dryRun?: boolean;
}

/**
 * Bootstrap a Docport workspace from an existing .docx file.
 * This is the "first import" flow for users who started in Word.
 */
export class Bootstrapper {
  async run(docxPath: string, outDir = '.', options: BootstrapOptions = {}): Promise<void> {
    const absDocxPath = resolve(docxPath);
    const absOutDir = resolve(outDir);
    const manifestPath = resolve(options.manifestPath ?? resolve(absOutDir, 'paper.manifest.json'));
    const chapterMode = options.chapterMode ?? 'single';

    console.log('🧭 Bootstrapping Docport from existing .docx...');
    console.log(`   Source: ${absDocxPath}`);
    console.log(`   Target: ${absOutDir}`);

    const docxBuffer = await readFile(absDocxPath);
    const parser = new DocxParser();

    const bootstrapManifest: Manifest = {
      title: options.title ?? basename(absDocxPath, '.docx'),
      authors: [{ name: options.author ?? 'Unknown Author' }],
      chapters: this.chapterDefs(chapterMode),
      citationStyle: 'APA',
      outputFile: `${basename(absDocxPath, '.docx')}_docport.docx`,
    };

    const parsed = await parser.parse(docxBuffer, bootstrapManifest, emptyDocportState());
    const chapterPlans = this.toChapterFiles(parsed.chapters, chapterMode);
    const finalManifest: Manifest = {
      ...bootstrapManifest,
      chapters: chapterPlans.map((c) => ({ file: c.file, title: c.title })),
    };

    const initialState = this.buildState(parsed, finalManifest, docxBuffer);

    if (options.dryRun) {
      console.log('\n🧪 Dry run result:');
      console.log(`   Manifest: ${manifestPath}`);
      for (const c of chapterPlans) {
        console.log(`   Chapter: ${resolve(absOutDir, c.file)}`);
      }
      console.log(`   State: ${resolve(dirname(manifestPath), 'paper.docport.json')}`);
      console.log(
        `   Imported: ${initialState.comments.length} comments, ${initialState.revisions.length} revisions`,
      );
      return;
    }

    const writer = new MarkdownWriter();
    for (const chapter of chapterPlans) {
      const outputPath = resolve(absOutDir, chapter.file);
      await writer.writeChapter(chapter.parsed, outputPath);
    }

    await writeFile(manifestPath, JSON.stringify(finalManifest, null, 2), 'utf-8');

    const state = DocportState.create(dirname(manifestPath));
    for (const comment of initialState.comments) {
      state.upsertComment(comment);
    }
    for (const revision of initialState.revisions) {
      state.upsertRevision(revision);
    }
    state.lastDocxHash = initialState.lastDocxHash;
    await state.save();

    console.log('\n✅ Bootstrap complete');
    console.log(`   Manifest: ${manifestPath}`);
    console.log(`   Chapters: ${chapterPlans.length}`);
    console.log(`   Imported comments: ${initialState.comments.length}`);
    console.log(`   Imported revisions: ${initialState.revisions.length}`);
  }

  private chapterDefs(mode: BootstrapChapterMode): Manifest['chapters'] {
    if (mode === 'single') {
      return [{ file: '01-main.md', title: 'Main' }];
    }
    return [
      { file: '01-chapter.md', title: 'Chapter 1' },
      { file: '02-chapter.md', title: 'Chapter 2' },
      { file: '03-chapter.md', title: 'Chapter 3' },
    ];
  }

  private toChapterFiles(
    parsedChapters: ParsedChapter[],
    mode: BootstrapChapterMode,
  ): Array<{ file: string; title: string; parsed: ParsedChapter }> {
    if (mode === 'single') {
      const merged = this.mergeRoots(parsedChapters.map((c) => c.ast));
      return [
        {
          file: '01-main.md',
          title: 'Main',
          parsed: {
            file: '01-main.md',
            ast: merged,
            comments: parsedChapters.flatMap((c) => c.comments),
            revisions: parsedChapters.flatMap((c) => c.revisions),
          },
        },
      ];
    }

    return parsedChapters.map((c, i) => ({
      file: `${String(i + 1).padStart(2, '0')}-chapter.md`,
      title: `Chapter ${i + 1}`,
      parsed: {
        ...c,
        file: `${String(i + 1).padStart(2, '0')}-chapter.md`,
      },
    }));
  }

  private mergeRoots(roots: Root[]): Root {
    return {
      type: 'root',
      children: roots.flatMap((r) => r.children),
    };
  }

  private buildState(
    parsed: {
      newComments: ParsedChapter['comments'];
      newRevisions: ParsedChapter['revisions'];
    },
    manifest: Manifest,
    docxBuffer: Buffer,
  ): DocportStateType {
    const state = emptyDocportState();
    const fallbackChapter = manifest.chapters[0]?.file ?? '01-main.md';

    state.comments = parsed.newComments.map((c, i) => ({
      id: c.id || DocportState.generateUuid(),
      chapter: c.chapter || fallbackChapter,
      anchorQuote: c.anchorQuote || DocportState.computeAnchorQuote(c.body),
      author: c.author,
      date: c.date.toISOString(),
      body: c.body,
      replies: c.replies.map((r) => ({
        id: r.id || DocportState.generateUuid(),
        author: r.author,
        date: r.date.toISOString(),
        body: r.body,
      })),
      resolved: c.resolved,
      lastDocxId: i,
    }));

    state.revisions = parsed.newRevisions.map((r, i) => ({
      id: r.id || DocportState.generateUuid(),
      chapter: r.chapter || fallbackChapter,
      kind: r.kind,
      author: r.author,
      date: r.date.toISOString(),
      text: r.text,
      precedingContext: r.precedingContext,
      decided: r.decided,
      lastDocxId: i,
    }));

    state.lastDocxHash = DocportState.computeHash(docxBuffer);
    return state;
  }
}
