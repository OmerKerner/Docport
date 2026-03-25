# Docport Skill

**Skill Name:** `docport`  
**Version:** 0.1.0  
**Category:** Document Translation, Academic Writing, Collaboration

## Overview

Docport is a lossless 2-way translator between Markdown workspaces and Microsoft Word .docx files, preserving track changes, comments, figures, and citations. Use this skill to bridge the gap between researchers working in Markdown + Git + AI agents and collaborators working in Word.

## When to Use This Skill

- Converting multi-file Markdown papers to a single Word document
- Extracting Word comments and track changes back to Markdown
- Managing collaborative academic writing workflows
- Preserving annotation metadata across Markdown ↔ .docx round-trips
- Integrating Word-based review processes with Git-based writing workflows

## Core Capabilities

### 1. Push (Markdown → Word)
Convert Markdown chapters to a single .docx with:
- Multi-chapter merging with page breaks
- CriticMarkup → Word track changes
- HTML comment anchors → Word comment balloons
- Images, tables, citations, formatting

### 2. Pull (Word → Markdown)
Extract Word annotations back to Markdown:
- Comment balloons → HTML anchors + state file
- Track changes → CriticMarkup syntax
- Accepted/rejected changes → update Markdown
- Non-destructive (Git commit before writing)

### 3. State Management
- Stable UUIDs for all comments and revisions
- Content-addressed anchors (survive text moves)
- Round-trip fidelity (no data loss)
- Git integration for version control

## Command Reference

### Initialize a Paper
```bash
docport init [options] [dir]
  --title <title>      Paper title
  --author <author>    Author name (repeatable)
```

### Push to Word
```bash
docport push [options] [manifest]
  --dry-run           Preview without writing
  --force             Push even with unresolved conflicts
  --output <path>     Override output filename
```

### Pull from Word
```bash
docport pull [options] <docx> [manifest]
  --continue          Resume after resolving conflicts
  --no-commit         Don't auto-commit after pull
```

### Preview Changes
```bash
docport diff <docx> [manifest]
```

### Check Status
```bash
docport status [manifest]
```

## CriticMarkup Syntax

| Syntax | Meaning | Word Equivalent |
|--------|---------|-----------------|
| `{++text++}` | Insertion | Track Changes insertion |
| `{--text--}` | Deletion | Track Changes deletion |
| `{~~old~>new~~}` | Substitution | Delete + Insert |
| `{==text==}` | Highlight | Yellow highlight |

## Manifest File Structure

**paper.manifest.json:**
```json
{
  "title": "Paper Title",
  "authors": [
    { "name": "Author Name", "email": "author@example.com" }
  ],
  "chapters": [
    { "file": "01-intro.md", "title": "Introduction" },
    { "file": "02-methods.md", "title": "Methods" }
  ],
  "bibliography": "references.bib",
  "citationStyle": "APA",
  "outputFile": "paper.docx"
}
```

## Comment Anchors

Comments stored as HTML anchors with metadata in state file:

```markdown
<!-- @comment id:"uuid" author:"PI" date:"2026-03-25" -->
The text being commented on appears here.
```

Comment body and replies stored in `paper.docport.json`:
```json
{
  "comments": [
    {
      "id": "uuid",
      "chapter": "01-intro.md",
      "anchorQuote": "The text being commented on appears",
      "author": "PI",
      "date": "2026-03-25T10:30:00Z",
      "body": "Please cite Smith et al. (2024) here.",
      "replies": [],
      "resolved": false
    }
  ]
}
```

## Typical Workflows

### Researcher → PI Review Cycle
1. Researcher writes chapters in Markdown
2. `docport push` → generates .docx
3. PI reviews in Word (adds comments, track changes)
4. `docport pull paper.docx` → extracts annotations to Markdown
5. Researcher addresses comments
6. Repeat from step 2

### Collaborative Writing with Multiple Reviewers
1. Push initial draft: `docport push`
2. Reviewer 1 returns paper_v1.docx
3. Pull: `docport pull paper_v1.docx`
4. Review changes: `git diff`
5. Commit: `git commit -m "Addressed reviewer 1 comments"`
6. Push updated: `docport push --output paper_v2.docx`
7. Reviewer 2 reviews paper_v2.docx
8. Repeat pull cycle

## Architecture

```
src/
├── types/          TypeScript types and Zod schemas
├── manifest/       Paper configuration reader/validator
├── markdown/       Remark parser with CriticMarkup plugin
├── docx/           OOXML reader/writer
├── git/            Git operations wrapper
├── bridge/         Push/pull/diff orchestration
└── cli.ts          Commander.js interface
```

## Core Invariants

1. **Markdown is source of truth** - .docx is always derived
2. **Stable UUIDs** - Every annotation survives round-trips
3. **Content-addressed anchors** - Comments survive paragraph moves
4. **Non-destructive pull** - Always Git commit before writing
5. **TypeScript strict mode** - No `any` types
6. **Async file I/O** - All operations are async

## Installation

```bash
cd path/to/docport
npm install
npm run build
npm link
```

## Testing

```bash
npm test                    # Run all tests
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only
```

## Known Limitations

- **docx library compatibility**: TypeScript/ESM type errors (works at runtime)
- **Word requirement**: Generated .docx files optimized for Microsoft Word
- **Git dependency**: Pull operation requires Git repository
- **Sequential comment IDs**: Word requires IDs starting from 0

## Troubleshooting

### TypeScript Build Errors
Known issue with docx library ESM compatibility. Code works correctly at runtime.

### Anchor Resolution Failures
If comment anchor cannot be found in updated Markdown:
1. Check error message for closest match
2. Manually edit `paper.docport.json` to update `anchorQuote`
3. Re-run `docport pull`

### Conflict Markers
When both researcher and PI edit same text:
```markdown
<<<<<<< yours
Local version
=======
PI's {++revision++}
>>>>>>> PI
```
Manually resolve, then `docport pull --continue`

## Files and State

### Generated Files
- `paper.docport.json` - Bridge state (commit to Git!)
- `Paper_Title_YYYY-MM-DD.docx` - Generated Word document

### File Layout
```
project/
├── paper.manifest.json      ← Configuration
├── paper.docport.json       ← State (commit!)
├── 01-intro.md             ← Chapters
├── 02-methods.md
├── 03-results.md
├── references.bib          ← Optional
└── Paper_YYYY-MM-DD.docx   ← Generated
```

## Advanced Usage

### Custom Output Path
```bash
docport push --output "submissions/journal_submission_v1.docx"
```

### Preview Before Pull
```bash
docport diff paper_reviewed.docx
# Shows: 3 new comments, 5 revisions
docport pull paper_reviewed.docx
```

### Dry Run
```bash
docport push --dry-run
# Shows what would be written without creating .docx
```

## Integration Points

### With Git
- Auto-commits before pull (non-destructive)
- Tracks lastPushCommit and lastPullCommit in state
- Verify clean working tree before pull

### With Citation Managers
- Supports BibTeX bibliography files
- Citation styles: APA, MLA, Chicago, Vancouver
- Uses citation-js for formatting

### With Image Assets
- Embeds PNG, JPG, SVG images
- SVG rasterized to PNG automatically (using sharp)
- Relative paths resolved from chapter directory

## Performance Considerations

- **Large documents**: 100+ page papers work fine
- **Many annotations**: Tested with 50+ comments, 100+ revisions
- **Image processing**: SVG rasterization may take a few seconds
- **Git operations**: Pull creates 2 commits (pre-pull snapshot + actual changes)

## Security Notes

- **No external API calls**: All processing is local
- **Git commit author**: Uses system Git configuration
- **File permissions**: Respects system file permissions
- **State file**: Contains full comment text (be mindful of sensitive data)

## Documentation

- `README.md` - User guide and quick start
- `docs/markup-spec.md` - Complete CriticMarkup specification
- `docs/ooxml-notes.md` - OOXML implementation details and quirks
- `AGENTS.md` - Architecture and agent fleet build instructions

## Support

- GitHub Issues: For bugs and feature requests
- Tests: `npm test` for comprehensive test suite
- Documentation: See docs/ directory

## Version History

- **0.1.0** - Initial implementation
  - Push/pull pipelines
  - CriticMarkup support
  - Comment anchoring
  - Git integration
  - CLI interface

## Future Enhancements

- Reference document support (custom Word styles)
- Multi-user conflict resolution
- Real-time collaboration features
- Web interface for non-technical users
- Pandoc integration for extended format support

---

**Use this skill when:** You need to bridge Markdown-based writing workflows with Word-based review processes, especially in academic or collaborative writing contexts where preserving annotations and track changes is critical.
