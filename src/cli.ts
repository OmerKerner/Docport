#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { Pusher } from './bridge/Pusher.js';
import { Puller } from './bridge/Puller.js';
import { Differ } from './bridge/Differ.js';
import { DocportState } from './bridge/DocportState.js';
import { promises as fs } from 'fs';
import path from 'path';

const program = new Command()
  .name('docport')
  .description('Lossless 2-way Markdown ↔ .docx bridge for research papers')
  .version('0.1.0');

program
  .command('push [manifest]')
  .description('Export markdown workspace to .docx')
  .option('--dry-run', 'Print plan without writing')
  .option('--force', 'Ignore conflict warnings')
  .option('--output <path>', 'Override output .docx path')
  .action(async (manifest = 'paper.manifest.json', opts) => {
    try {
      console.log(chalk.blue('🚀 Docport Push'));
      console.log(chalk.gray(`Manifest: ${manifest}`));
      
      await new Pusher().run(manifest, {
        force: opts.force,
        dryRun: opts.dryRun,
        outputPath: opts.output,
      });
      
      if (opts.dryRun) {
        console.log(chalk.yellow('✓ Dry run complete (no files written)'));
      } else {
        console.log(chalk.green('✓ Push complete'));
      }
    } catch (err) {
      console.error(chalk.red('✗ Push failed:'), (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('pull <docx> [manifest]')
  .description('Import PI annotations from .docx back to markdown')
  .option('--continue', 'Resume after resolving conflict markers')
  .option('--no-commit', "Don't auto-commit after pull")
  .action(async (docx, manifest = 'paper.manifest.json', opts) => {
    try {
      console.log(chalk.blue('⬇️  Docport Pull'));
      console.log(chalk.gray(`DOCX: ${docx}`));
      console.log(chalk.gray(`Manifest: ${manifest}`));
      
      await new Puller().run(docx, manifest, {
        continueAfterConflict: opts.continue,
        noCommit: !opts.commit,
      });
      
      console.log(chalk.green('✓ Pull complete'));
    } catch (err) {
      console.error(chalk.red('✗ Pull failed:'), (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('diff <docx> [manifest]')
  .description('Show pending annotations without pulling')
  .action(async (docx, manifest = 'paper.manifest.json') => {
    try {
      console.log(chalk.blue('📊 Docport Diff'));
      await new Differ().run(docx, manifest);
    } catch (err) {
      console.error(chalk.red('✗ Diff failed:'), (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('init [dir]')
  .description('Create paper.manifest.json and paper.docport.json')
  .option('--title <title>', 'Paper title')
  .option('--author <author>', 'Author name (repeatable)', collect, [])
  .action(async (dir = '.', opts) => {
    try {
      console.log(chalk.blue('📝 Docport Init'));
      
      const title = opts.title ?? 'Untitled Paper';
      const authors = opts.author.length > 0 
        ? opts.author.map((name: string) => ({ name }))
        : [{ name: 'Author Name' }];
      
      const manifestPath = path.join(dir, 'paper.manifest.json');
      const manifest = {
        title,
        authors,
        chapters: [
          { file: '01-introduction.md', title: 'Introduction' },
        ],
        citationStyle: 'APA',
      };
      
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
      console.log(chalk.green(`✓ Created ${manifestPath}`));
      
      const state = DocportState.create(dir);
      await state.save();
      console.log(chalk.green(`✓ Created paper.docport.json`));
      
      console.log(chalk.gray('\nNext steps:'));
      console.log(chalk.gray('  1. Edit paper.manifest.json to add your chapters'));
      console.log(chalk.gray('  2. Write your markdown files'));
      console.log(chalk.gray('  3. Run: docport push'));
    } catch (err) {
      console.error(chalk.red('✗ Init failed:'), (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('status [manifest]')
  .description('Show current state')
  .action(async (manifest = 'paper.manifest.json') => {
    try {
      const manifestDir = path.dirname(path.resolve(manifest));
      const state = await DocportState.load(manifestDir);
      const data = state.data;
      
      console.log(chalk.blue('📋 Docport Status\n'));
      
      console.log(chalk.bold('State:'));
      console.log(`  Last push: ${data.lastPushCommit ?? chalk.gray('never')}`);
      console.log(`  Last pull: ${data.lastPullCommit ?? chalk.gray('never')}`);
      console.log(`  Last docx: ${data.lastDocxHash?.substring(0, 8) ?? chalk.gray('none')}\n`);
      
      const pendingRevisions = data.revisions.filter(r => r.decided === null);
      const acceptedRevisions = data.revisions.filter(r => r.decided === true);
      const rejectedRevisions = data.revisions.filter(r => r.decided === false);
      
      console.log(chalk.bold('Annotations:'));
      console.log(`  Comments: ${data.comments.length} total, ${data.comments.filter(c => !c.resolved).length} unresolved`);
      console.log(`  Revisions: ${data.revisions.length} total`);
      console.log(`    - Pending: ${pendingRevisions.length}`);
      console.log(`    - Accepted: ${acceptedRevisions.length}`);
      console.log(`    - Rejected: ${rejectedRevisions.length}`);
    } catch (err) {
      console.error(chalk.red('✗ Status failed:'), (err as Error).message);
      process.exit(1);
    }
  });

program.parse();

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
