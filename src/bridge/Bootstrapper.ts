import { basename, dirname, resolve } from 'path';
import { readFile, writeFile } from 'fs/promises';

import type { Root, Heading, Text } from 'mdast';
import type { Manifest, DocportState as DocportStateType, ParsedChapter } from '../types/index.js';
import { emptyDocportState } from '../types/index.js';
import { DocxParser } from '../docx/DocxParser.js';
import { StyleExtractor } from '../docx/StyleExtractor.js';
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
    const styleExtractor = new StyleExtractor();

    const bootstrapManifest: Manifest = {
      title: options.title ?? basename(absDocxPath, '.docx'),
      authors: [{ name: options.author ?? 'Unknown Author' }],
      chapters: this.chapterDefs(chapterMode),
      citationStyle: 'APA',
      outputFile: `${basename(absDocxPath, '.docx')}_docport.docx`,
      referenceDoc: '.docport.reference.docx',
    };

    const parsed = await parser.parse(docxBuffer, bootstrapManifest, emptyDocportState());
    const inferredTitle = this.extractFirstHeadingText(parsed.chapters);
    const chapterPlans = this.toChapterFiles(parsed.chapters, chapterMode);
    const finalManifest: Manifest = {
      ...bootstrapManifest,
      title: options.title ?? inferredTitle ?? bootstrapManifest.title,
      chapters: chapterPlans.map((c) => ({ file: c.file, title: c.title })),
    };

    const initialState = this.buildState(parsed, finalManifest, docxBuffer);
    const styleMetadata = await styleExtractor.extract(docxBuffer, basename(absDocxPath));

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
      if (styleMetadata) {
        console.log('   Styles: extracted from source document');
      }
      return;
    }

    const writer = new MarkdownWriter();
    this.applyImportedAnnotationsToChapters(chapterPlans);
    for (const chapter of chapterPlans) {
      const outputPath = resolve(absOutDir, chapter.file);
      await writer.writeChapter(chapter.parsed, outputPath);
    }

    await writeFile(manifestPath, JSON.stringify(finalManifest, null, 2), 'utf-8');
    await writeFile(resolve(absOutDir, '.docport.reference.docx'), docxBuffer);
    if (styleMetadata) {
      await writeFile(
        resolve(absOutDir, 'paper.styles.json'),
        JSON.stringify(styleMetadata, null, 2),
        'utf-8',
      );
    }

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
    if (styleMetadata) {
      console.log(`   Style metadata: ${resolve(absOutDir, 'paper.styles.json')}`);
    }
  }

  private applyImportedAnnotationsToChapters(
    chapterPlans: Array<{ file: string; title: string; parsed: ParsedChapter }>,
  ): void {
    const writer = new MarkdownWriter();

    for (const chapter of chapterPlans) {
      let ast = chapter.parsed.ast;

      for (const comment of chapter.parsed.comments) {
        ast = writer.insertCommentAnchor(ast, comment);
      }

      for (const revision of chapter.parsed.revisions) {
        ast = writer.insertRevision(ast, revision);
      }

      chapter.parsed.ast = ast;
    }
  }

  private chapterDefs(mode: BootstrapChapterMode): Manifest['chapters'] {
    if (mode === 'single') {
      return [{ file: '01-main.md', title: 'Main' }];
    }
    return Array.from({ length: 64 }, (_unused, i) => ({
      file: `${String(i + 1).padStart(2, '0')}-chapter.md`,
      title: `Chapter ${i + 1}`,
    }));
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

    const usedSlugs = new Set<string>();
    return parsedChapters.map((c, i) => {
      const headingTitle = this.extractChapterHeadingText(c.ast) ?? `Chapter ${i + 1}`;
      const slug = this.uniqueSlug(this.slugify(headingTitle) || `chapter-${i + 1}`, usedSlugs);
      return {
      file: `${String(i + 1).padStart(2, '0')}-${slug}.md`,
      title: headingTitle,
      parsed: {
        ...c,
        file: `${String(i + 1).padStart(2, '0')}-${slug}.md`,
      },
    };
    })
      .filter(({ parsed }) => parsed.ast.children.length > 0);
  }

  private extractFirstHeadingText(chapters: ParsedChapter[]): string | null {
    for (const chapter of chapters) {
      const heading = this.extractChapterHeadingText(chapter.ast);
      if (heading) {
        return heading;
      }
    }
    return null;
  }

  private extractChapterHeadingText(ast: Root): string | null {
    for (const child of ast.children) {
      if (child.type !== 'heading') {
        continue;
      }
      const heading = child as Heading;
      const text = heading.children
        .filter((node): node is Text => node.type === 'text')
        .map((node) => node.value)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 0) {
        return text;
      }
    }
    return null;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  private uniqueSlug(base: string, usedSlugs: Set<string>): string {
    if (!usedSlugs.has(base)) {
      usedSlugs.add(base);
      return base;
    }
    let i = 2;
    while (usedSlugs.has(`${base}-${i}`)) {
      i++;
    }
    const candidate = `${base}-${i}`;
    usedSlugs.add(candidate);
    return candidate;
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
