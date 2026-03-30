# Docport

> Lossless 2-way translator between Markdown workspaces and Word .docx files, preserving track changes, comments, figures, and citations.

## The Problem

A researcher works in Markdown + Git + AI agents. Their PI works in Word with track changes and comment balloons. Currently, every round-trip through Pandoc destroys comments and track-change metadata.

**Docport bridges both worlds losslessly.**

## Features

- ✅ **Bidirectional translation**: Markdown ↔ .docx without data loss
- ✅ **Track changes**: CriticMarkup syntax (`{++insert++}`, `{--delete--}`) ↔ Word revisions
- ✅ **Comments**: HTML comment anchors ↔ Word comment balloons with threading
- ✅ **Content-addressed anchors**: Comments survive paragraph moves and reformatting
- ✅ **Version control**: Git integration ensures non-destructive pulls
- ✅ **Multi-file support**: Merge multiple Markdown chapters into one .docx
- ✅ **Citation management**: BibTeX → formatted references (APA, MLA, Chicago, Vancouver)
- ✅ **Stable IDs**: Every annotation has a UUID that survives round-trips

## Current Fidelity Notes

Docport preserves content and annotation metadata aggressively, but some pull-side mappings are best-effort:

- Comment/revision chapter assignment is signal-based (anchor quote / surrounding text), not native paragraph IDs.
- If Word contains malformed or incomplete field-code runs, Docport now preserves displayed text as fallback instead of dropping content.
- Figure cross-reference recovery is strongest for `REF` targets that resolve to `docport_` figure bookmarks.

If a reference cannot be resolved to a figure label, displayed Word text is preserved verbatim.

## Equations (LaTeX ↔ Word)

Docport now supports equation round-trip with a fidelity-first policy:

- Markdown syntax: inline `$...$` and block `$$...$$`.
- Push emits native Word math (`m:oMath`) when conversion is supported.
- Pull parses Word OMML equations back to LaTeX (subset-first).
- Unsupported/ambiguous equation forms are preserved best-effort and reported as explicit warnings.

Current supported conversion subset includes common forms such as:
- `\\frac{a}{b}`
- `x^{n}`, `x_{n}`
- `\\sqrt{x}`, `\\sqrt[n]{x}`
- `\\sum_{i=1}^{n} ...`
- `\\int_{a}^{b} ...`

## Installation

```bash
npm install -g docport
```

Or use locally:
```bash
git clone https://github.com/yourusername/docport
cd docport
npm install
npm link
```

## Quick Start

### 1. Initialize a paper

```bash
mkdir my-paper
cd my-paper
docport init --title "My Research Paper" --author "Jane Doe"
```

This creates:
- `paper.manifest.json` — paper configuration
- `paper.docport.json` — bridge state (tracked in Git)

### 2. Write your chapters

Create Markdown files:

**01-intro.md:**
```markdown
# Introduction

This research investigates {==important topic==}.
```

**02-methods.md:**
```markdown
# Methods

We used {++52++} participants.
```

Edit `paper.manifest.json`:
```json
{
  "title": "My Research Paper",
  "authors": [{ "name": "Jane Doe" }],
  "chapters": [
    { "file": "01-intro.md" },
    { "file": "02-methods.md" }
  ],
  "citationStyle": "APA"
}
```

### 3. Push to Word

```bash
docport push
```

Creates `My Research Paper_2026-03-25.docx` with:
- All chapters merged with page breaks
- Track changes for CriticMarkup syntax
- Proper formatting (headings, bold, italic, tables, figures)

### 4. PI reviews in Word

Your PI opens the .docx in Word and:
- Adds comment balloons
- Accepts/rejects track changes
- Makes new edits with Track Changes enabled

### 5. Pull back to Markdown

```bash
docport pull "My Research Paper_2026-03-25.docx"
```

Docport:
1. Creates a Git commit (non-destructive)
2. Extracts all comments → HTML comment anchors in Markdown
3. Extracts all revisions → CriticMarkup syntax
4. Detects accepted/rejected changes → removes CriticMarkup, keeps/drops text
5. Commits the changes

Your Markdown now has:
```markdown
<!-- @comment id:"uuid" author:"PI" date:"2026-03-25" -->
This research investigates important topic.
```

And `paper.docport.json` stores the full comment body and metadata.

## Commands

### `docport push [manifest]`
Export Markdown workspace to .docx

Options:
- `--dry-run` — Print plan without writing
- `--force` — Push even with unresolved conflicts
- `--output <path>` — Override output .docx filename

### `docport pull <docx> [manifest]`
Import PI annotations from .docx back to Markdown

Options:
- `--continue` — Resume after resolving conflict markers
- `--no-commit` — Don't auto-commit after pull

### `docport diff <docx> [manifest]`
Show pending annotations without pulling (preview mode)

### `docport init [dir]`
Create paper.manifest.json and paper.docport.json

Options:
- `--title <title>` — Paper title
- `--author <name>` — Author name (repeatable)

### `docport status [manifest]`
Show current state: comments, revisions, last push/pull

## CriticMarkup Syntax

Docport uses [CriticMarkup](http://criticmarkup.com/) for track changes:

| Syntax | Meaning | Word equivalent |
|--------|---------|-----------------|
| `{++inserted text++}` | Insertion | Track Changes insertion |
| `{--deleted text--}` | Deletion | Track Changes deletion |
| `{~~old~>new~~}` | Substitution | Deletion + insertion |
| `{==highlighted==}` | Highlight | Yellow highlight |
| `{>>comment<<}` | Inline comment | Comment balloon |

Example:
```markdown
The experiment used {--48--}{++52++} participants
(mean age {~~24.3 ± 3.1~>25.1 ± 2.8~~} years).
```

## Comment Anchors

Comments are stored as HTML comments with metadata:

```markdown
<!-- @comment id:"3f8a..." author:"PI" date:"2026-03-25" -->
The results indicate a strong correlation.
```

The comment body and replies are stored in `paper.docport.json`. The anchor attaches to the text immediately following the comment tag.

## Architecture

```
Markdown files          paper.docport.json (state)
    ↓                            ↓
MarkdownReader  ←→  DocportState  ←→  GitManager
    ↓                            ↓
Remark AST + annotations    Bridge logic
    ↓                            ↓
DocxBuilder     →   .docx file   ←   DocxParser
```

Layers:
- **types** — TypeScript types and Zod schemas
- **manifest** — Paper configuration reader
- **markdown** — Remark-based parser with CriticMarkup plugin
- **docx** — OOXML reader/writer for Word documents
- **git** — Version control integration
- **bridge** — Push/pull/diff orchestration
- **cli** — Commander.js interface

## Core Invariants

1. **Markdown is the source of truth**. The .docx is always a derived artifact.
2. **Every comment and revision has a stable UUID** that survives round-trips.
3. **Anchors are content-addressed**, not offset-based. Comments survive paragraph moves.
4. **Pull is non-destructive**. Always creates a Git commit before writing.
5. **No `any` types**. TypeScript strict mode throughout.
6. **All file I/O is async**.

## Workflow Example

### Researcher workflow (Markdown + Git)

```bash
# Write in Markdown
echo "# Introduction\n\nThis is my paper." > 01-intro.md

# Push to Word for PI review
docport push

# Send My_Research_Paper_2026-03-25.docx to PI
```

### PI workflow (Word)

1. Open .docx in Microsoft Word
2. Insert comment: "Please cite Smith (2024)"
3. Enable Track Changes
4. Edit text: Change "my paper" to "our research"
5. Save and send back

### Researcher workflow (continued)

```bash
# Pull PI annotations
docport pull My_Research_Paper_2026-03-25.docx

# Git shows the changes
git diff

# See comment in Markdown
cat 01-intro.md
# Shows: <!-- @comment id:"..." author:"PI" -->

# See comment body
docport status

# Address the comment
echo "\n\nSmith (2024) showed..." >> 01-intro.md

# Push updated version
docport push
```

## Known Issues

- The `docx` npm library (v8.5.0) has TypeScript/ESM compatibility issues with `moduleResolution: NodeNext`. The code works correctly at runtime, but TypeScript reports type errors. This is an upstream issue.
- Word requires comment IDs to be sequential integers starting from 0. Docport manages this automatically.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and architecture details.

## License

MIT

## Credits

Built with:
- [remark](https://github.com/remarkjs/remark) — Markdown processing
- [docx](https://github.com/dolanmiu/docx) — .docx generation
- [commander.js](https://github.com/tj/commander.js) — CLI framework
- [zod](https://github.com/colinhacks/zod) — Schema validation
- [simple-git](https://github.com/steveukx/git-js) — Git integration
