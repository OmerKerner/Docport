# AGENTS.md — Docport Build Instructions
> Agent swarm instructions for building a faithful 2-way translator
> between a multi-file Markdown workspace and a single Word .docx,
> preserving track changes, comments, figures, citations, and version history
> across the boundary between a researcher's AI workflow and a PI's Word workflow.

---

## 0. Read This First

### The problem this solves
A researcher works in Markdown + Git + AI agents. Their PI works in Word with
track changes and comment balloons. Currently, every round-trip through Pandoc
destroys comments and track-change metadata. This tool bridges both worlds
losslessly.

### Core invariants — never violate these
- **Markdown is the source of truth** for content. The `.docx` is always a
  derived artifact. Never edit `.docx` directly in the workflow; always edit
  Markdown and re-push.
- **Every comment and revision has a stable ID** that survives round-trips.
  The bridge state file (`paper.docport.json`) is the ledger of all IDs.
- **Anchors are content-addressed**, not offset-based. Comments are anchored
  to a short quoted string from the surrounding text, so they survive
  reformatting and paragraph reflow.
- **`docport pull` is non-destructive.** It never overwrites uncommitted
  Markdown changes. It always creates a Git commit before writing.
- **No `any` types.** TypeScript strict mode throughout.
- **All file I/O is async.** Never use synchronous fs calls.

### Tech stack (locked)
| Layer | Library | Version |
|---|---|---|
| CLI framework | commander.js | `^12` |
| OOXML read/write | `docx` (npm) | `^8.5` |
| OOXML low-level parse | `jszip` + `fast-xml-parser` | latest |
| Markdown parse | `remark` + `remark-gfm` | `^15` |
| Markdown stringify | `remark-stringify` | `^11` |
| CriticMarkup parse | custom Remark plugin (see §5) | — |
| Image rasterize | `sharp` | `^0.33` |
| Citation format | `citation-js` | `^0.7` |
| Git operations | `simple-git` | `^3.27` |
| Schema validation | `zod` | `^3.23` |
| Testing | Vitest | `^2` |
| Language | TypeScript 5.5 strict | `^5.5` |
| Runtime | Node.js 20+ | — |

---

## 1. Repository Layout

```
docport/
├── AGENTS.md                        ← this file
├── package.json
├── tsconfig.json
├── vitest.config.ts
│
├── src/
│   ├── cli.ts                       ← AGENT: cli — entry point, commander setup
│   │
│   ├── types/                       ← AGENT: shared-types
│   │   ├── manifest.ts
│   │   ├── docport-state.ts
│   │   ├── document.ts
│   │   ├── comment.ts
│   │   ├── revision.ts
│   │   └── index.ts
│   │
│   ├── manifest/                    ← AGENT: manifest
│   │   ├── ManifestReader.ts
│   │   └── ManifestValidator.ts
│   │
│   ├── markdown/                    ← AGENT: markdown
│   │   ├── MarkdownReader.ts        ← reads .md files → unified AST
│   │   ├── MarkdownWriter.ts        ← unified AST → .md files
│   │   ├── CriticMarkupPlugin.ts    ← remark plugin: parse/stringify CriticMarkup
│   │   ├── CommentAnchorPlugin.ts   ← remark plugin: parse/stringify HTML comment anchors
│   │   └── FigurePlugin.ts          ← remark plugin: resolve figure paths
│   │
│   ├── docx/                        ← AGENT: docx
│   │   ├── DocxBuilder.ts           ← unified AST + state → .docx buffer
│   │   ├── DocxParser.ts            ← .docx → unified AST + extracted annotations
│   │   ├── OoxmlCommentWriter.ts    ← writes w:comment XML
│   │   ├── OoxmlRevisionWriter.ts   ← writes w:ins / w:del XML
│   │   ├── OoxmlCommentParser.ts    ← reads w:comment XML
│   │   ├── OoxmlRevisionParser.ts   ← reads w:ins / w:del XML
│   │   └── ImageEmbedder.ts         ← figure paths → w:drawing
│   │
│   ├── bridge/                      ← AGENT: docport-core
│   │   ├── DocportState.ts           ← loads/saves paper.docport.json
│   │   ├── Pusher.ts                ← md → docx pipeline
│   │   ├── Puller.ts                ← docx → md pipeline
│   │   ├── Differ.ts                ← show pending annotations without pulling
│   │   ├── AnchorResolver.ts        ← match comment anchors to new text positions
│   │   └── ConflictResolver.ts      ← handle same-text edits from both sides
│   │
│   └── git/                         ← AGENT: git
│       └── GitManager.ts
│
├── tests/
│   ├── unit/
│   │   ├── CriticMarkupPlugin.test.ts
│   │   ├── CommentAnchorPlugin.test.ts
│   │   ├── OoxmlCommentParser.test.ts
│   │   ├── OoxmlCommentWriter.test.ts
│   │   ├── OoxmlRevisionParser.test.ts
│   │   ├── OoxmlRevisionWriter.test.ts
│   │   ├── AnchorResolver.test.ts
│   │   └── DocportState.test.ts
│   │
│   ├── integration/
│   │   ├── push-roundtrip.test.ts   ← md → docx → re-parse, assert structure
│   │   ├── pull-roundtrip.test.ts   ← docx → md → re-push, assert equivalence
│   │   ├── comment-roundtrip.test.ts
│   │   ├── revision-roundtrip.test.ts
│   │   └── multifile.test.ts        ← 3 chapters → 1 docx → pull back to 3 chapters
│   │
│   └── fixtures/
│       ├── simple.docx              ← generated in beforeAll
│       ├── with-comments.docx
│       ├── with-revisions.docx
│       ├── with-images.docx
│       └── chapters/
│           ├── 01-intro.md
│           ├── 02-methods.md
│           ├── 03-results.md
│           └── paper.manifest.json
│
└── docs/
    ├── markup-spec.md               ← CriticMarkup + anchor comment spec
    └── ooxml-notes.md               ← OOXML quirks discovered during implementation
```

---

## 2. Agent Roles and Build Order

| Role | Owns | Must wait for |
|---|---|---|
| `shared-types` | `src/types/` | nothing — start immediately |
| `manifest` | `src/manifest/` | `shared-types` |
| `markdown` | `src/markdown/` | `shared-types` |
| `docx` | `src/docx/` | `shared-types` |
| `git` | `src/git/` | `shared-types` |
| `docport-core` | `src/docport/` | all of the above |
| `cli` | `src/cli.ts` | `docport-core` |
| `testing` | `tests/` | all (read-only) |

---

## 3. Shared Types — `AGENT: shared-types`

**Complete this package first. Nothing else compiles until types are locked.**

### 3.1 `manifest.ts`

```typescript
import { z } from 'zod';

export const ManifestSchema = z.object({
  /**
   * Paper title — used as the docx document title and in the header.
   */
  title: z.string(),

  /**
   * All contributing authors in order. The first is the primary author.
   */
  authors: z.array(z.object({
    name: z.string(),
    affiliation: z.string().optional(),
    email: z.string().optional(),
  })),

  /**
   * Ordered list of chapter files, relative to the manifest directory.
   * Each chapter becomes a section in the docx, separated by a page break.
   * The bridge preserves this order and can pull back to the same files.
   */
  chapters: z.array(z.object({
    file: z.string(),            // e.g. "01-intro.md"
    /** If omitted, the first heading in the file is used. */
    title: z.string().optional(),
  })),

  /**
   * Path to the BibTeX file, relative to the manifest directory.
   * If omitted, no References section is generated.
   */
  bibliography: z.string().optional(),

  /** APA | MLA | Vancouver | Chicago — default APA */
  citationStyle: z.enum(['APA', 'MLA', 'Vancouver', 'Chicago']).default('APA'),

  /**
   * Path to a .docx reference file for Word styles (headings, fonts, margins).
   * If omitted, a sensible academic default is used.
   */
  referenceDoc: z.string().optional(),

  /**
   * Output .docx filename. Default: "<title>_<YYYY-MM-DD>.docx"
   */
  outputFile: z.string().optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;
```

### 3.2 `docport-state.ts`

This file lives alongside the manifest and is committed to Git.
It is the **only** persistent state between bridge operations.

```typescript
import { z } from 'zod';

export const CommentStateSchema = z.object({
  /** Stable UUID assigned on first import. Never changes across round-trips. */
  id: z.string().uuid(),
  /** Chapter file this comment belongs to, e.g. "02-methods.md" */
  chapter: z.string(),
  /**
   * Content-addressed anchor: a short quoted string (~40 chars) from the
   * text the comment is attached to. Used to re-locate the comment if the
   * paragraph moves. Chosen to be unique within the chapter.
   */
  anchorQuote: z.string(),
  author: z.string(),
  date: z.string(),            // ISO 8601
  body: z.string(),
  replies: z.array(z.object({
    id: z.string().uuid(),
    author: z.string(),
    date: z.string(),
    body: z.string(),
  })),
  resolved: z.boolean().default(false),
  /** The w:comment id used in the last exported docx. Re-used on re-push. */
  lastDocxId: z.number().optional(),
});

export const RevisionStateSchema = z.object({
  id: z.string().uuid(),
  chapter: z.string(),
  kind: z.enum(['insertion', 'deletion']),
  author: z.string(),
  date: z.string(),
  /**
   * The original text (for deletions) or the inserted text (for insertions).
   * Used to locate the revision in the markdown via string search.
   */
  text: z.string(),
  /** Context: the ~60 chars of unchanged text immediately preceding this revision. */
  precedingContext: z.string(),
  /** null = pending, true = accepted, false = rejected */
  decided: z.boolean().nullable().default(null),
  lastDocxId: z.number().optional(),
});

export const DocportStateSchema = z.object({
  schemaVersion: z.literal(1),
  /** Git commit hash of the markdown at the time of the last push. */
  lastPushCommit: z.string().nullable(),
  /** Git commit hash of the markdown at the time of the last pull. */
  lastPullCommit: z.string().nullable(),
  /** SHA-256 of the .docx file at the time of the last pull. */
  lastDocxHash: z.string().nullable(),
  comments: z.array(CommentStateSchema),
  revisions: z.array(RevisionStateSchema),
});

export type DocportState = z.infer<typeof DocportStateSchema>;
export type CommentState = z.infer<typeof CommentStateSchema>;
export type RevisionState = z.infer<typeof RevisionStateSchema>;

export const emptyDocportState = (): DocportState => ({
  schemaVersion: 1,
  lastPushCommit: null,
  lastPullCommit: null,
  lastDocxHash: null,
  comments: [],
  revisions: [],
});
```

### 3.3 `comment.ts`

```typescript
/**
 * A comment as it exists in the unified in-memory representation,
 * after being parsed from either Markdown or docx.
 */
export interface Comment {
  id: string;
  chapter: string;
  anchorQuote: string;
  author: string;
  date: Date;
  body: string;
  replies: CommentReply[];
  resolved: boolean;
}

export interface CommentReply {
  id: string;
  author: string;
  date: Date;
  body: string;
}
```

### 3.4 `revision.ts`

```typescript
export type RevisionKind = 'insertion' | 'deletion';

export interface Revision {
  id: string;
  chapter: string;
  kind: RevisionKind;
  author: string;
  date: Date;
  text: string;
  precedingContext: string;
  decided: boolean | null;
}
```

### 3.5 `document.ts`

```typescript
import type { Root } from 'mdast';

/**
 * A chapter's content after parsing — a remark AST with all
 * CriticMarkup and comment anchors already parsed into typed nodes.
 */
export interface ParsedChapter {
  file: string;
  ast: Root;
  comments: import('./comment').Comment[];
  revisions: import('./revision').Revision[];
}

/**
 * The full document as it passes through the bridge pipeline.
 */
export interface DocportDocument {
  manifest: import('./manifest').Manifest;
  chapters: ParsedChapter[];
  state: import('./docport-state').DocportState;
}
```

---

## 4. Annotation Markup Specification

This section defines the text representation that lives in `.md` files.
The AI agent reads and writes these formats. The bridge converts them to/from OOXML.

### 4.1 Track changes — CriticMarkup

Use the standard CriticMarkup syntax:

| Operation | Markdown syntax | Word OOXML |
|---|---|---|
| Insertion | `{++inserted text++}` | `<w:ins w:author="..." w:date="...">` |
| Deletion | `{--deleted text--}` | `<w:del w:author="..." w:date="...">` |
| Substitution | `{~~old~>new~~}` | `<w:del>` immediately followed by `<w:ins>` |
| Highlight | `{==highlighted==}` | `<w:highlight>` (yellow) |
| Comment inline | `{>>comment text<<}` | `<w:comment>` balloon (no anchor highlight) |

Author and date are stored in `paper.docport.json` and injected by the bridge
at push time. The markdown itself only stores the text change, not metadata.

**Example markdown with pending PI revisions:**
```markdown
The experiment used {--48--}{++52++} participants
(mean age {~~24.3 ± 3.1~>25.1 ± 2.8~~} years).
All {++written++} consent was obtained prior to testing.
```

### 4.2 Comments — HTML comment anchors

Word comments are stored as HTML comments in markdown. They anchor to the
text immediately following the comment tag.

```
<!-- @comment id:"3f8a..." author:"PI" date:"2025-03-20" -->
The results indicate a strong correlation
```

The comment body is stored in `paper.docport.json` under the same `id`.
The anchor is the first ~40 characters of text after the tag (trimmed,
punctuation stripped). This design keeps the markdown readable while
preserving enough state for the bridge to reconstruct the Word balloon.

**Reply example** — replies are nested in `paper.docport.json`, not in markdown:
```json
{
  "id": "3f8a...",
  "anchorQuote": "results indicate a strong correlation",
  "author": "PI",
  "body": "Need to report the r value here.",
  "replies": [
    { "id": "9c2b...", "author": "You", "body": "Added, see line 47." }
  ]
}
```

### 4.3 Figures

Standard Markdown image syntax. The bridge embeds the file as a `w:drawing`:

```markdown
![Figure 1: Effect of treatment on response time](figures/fig1.png)
```

For generated Plotly figures (from your AI agent workflow), save as `.svg` or
`.png` in the `figures/` directory. The bridge rasterizes SVG to PNG via
`sharp` before embedding in the docx.

### 4.4 Citations

Use Pandoc-style citation keys, resolved against `paper.bib`:

```markdown
This confirms earlier findings [@smith2019; @jones2021].
```

The bridge uses `citation-js` to format inline text and the References section
according to the style specified in the manifest.

---

## 5. Markdown Layer — `AGENT: markdown`

### 5.1 `CriticMarkupPlugin.ts`

A unified/remark plugin that extends the Markdown parser to handle CriticMarkup.

```typescript
import type { Plugin } from 'unified';
import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * Custom mdast node types added by this plugin.
 * Registered in mdast-util types via module augmentation.
 */
export interface CriticInsertion { type: 'criticInsertion'; value: string; }
export interface CriticDeletion  { type: 'criticDeletion';  value: string; }
export interface CriticSubstitution {
  type: 'criticSubstitution';
  oldValue: string;
  newValue: string;
}
export interface CriticHighlight { type: 'criticHighlight'; value: string; }
export interface CriticComment   { type: 'criticComment';   value: string; }

/**
 * Remark plugin — parse phase.
 * Tokenises {++…++}, {--…--}, {~~…~>…~~}, {==…==}, {>>…<<} in text nodes.
 */
export const remarkCriticMarkup: Plugin<[], Root> = function () {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      // Tokenise the text content into segments, replacing CriticMarkup
      // patterns with typed AST nodes. Use a regex-based scanner.
      // The scanner must handle nested brackets and empty values correctly.
      const segments = tokenizeCriticMarkup(node.value);
      if (segments.length === 1 && segments[0]!.type === 'text') return;
      parent!.children.splice(index!, 1, ...segments);
    });
  };
};

/**
 * Remark plugin — stringify phase.
 * Converts CriticMarkup AST nodes back to their text representation.
 */
export const remarkCriticMarkupStringify: Plugin<[], Root> = function () {
  // Register compilers for each CriticMarkup node type
  // criticInsertion → {++value++}
  // criticDeletion  → {--value--}
  // etc.
};
```

Implement `tokenizeCriticMarkup(text: string)` using a state-machine scanner
(not a single mega-regex) to handle edge cases: escaped braces, empty contents,
nested curly braces in content.

### 5.2 `CommentAnchorPlugin.ts`

A remark plugin that parses `<!-- @comment id:"..." author:"..." date:"..." -->`
HTML comments into typed AST nodes.

```typescript
export interface CommentAnchorNode {
  type: 'commentAnchor';
  id: string;
  author: string;
  date: string;
  /** The anchorQuote is computed from the following sibling text, not stored in the tag. */
}
```

On stringify, writes the HTML comment back in exactly the canonical form.
On parse, extracts the JSON-ish attributes from the comment body (use a simple
key-value regex, not `JSON.parse`, because the comment syntax may have unquoted
values or whitespace variation).

### 5.3 `MarkdownReader.ts`

```typescript
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import { remarkCriticMarkup } from './CriticMarkupPlugin';
import { remarkCommentAnchor } from './CommentAnchorPlugin';
import type { ParsedChapter } from '../types';

export class MarkdownReader {
  private processor = remark()
    .use(remarkGfm)
    .use(remarkCriticMarkup)
    .use(remarkCommentAnchor);

  /**
   * Parse a single chapter file into an AST with all annotations extracted.
   * Comments are extracted from the AST into the returned `comments` array.
   * Revisions are extracted into the `revisions` array.
   * Both are removed from the AST so the DocxBuilder gets clean prose.
   */
  async readChapter(
    filePath: string,
    state: DocportState
  ): Promise<ParsedChapter> {
    const source = await fs.readFile(filePath, 'utf-8');
    const ast = this.processor.parse(source);
    const comments = extractComments(ast, state, path.basename(filePath));
    const revisions = extractRevisions(ast, state, path.basename(filePath));
    return {
      file: path.basename(filePath),
      ast,
      comments,
      revisions,
    };
  }
}
```

**`extractComments(ast, state, chapter)`**: Walk the AST for `commentAnchor`
nodes. For each, look up the full comment body in `state.comments` by `id`.
Compute `anchorQuote` from the text of the immediately following sibling.
Return a `Comment[]`. Remove the `commentAnchor` nodes from the AST.

**`extractRevisions(ast, state, chapter)`**: Walk the AST for `criticInsertion`,
`criticDeletion`, and `criticSubstitution` nodes. Look up the corresponding
`RevisionState` entry by matching `text` and `precedingContext`. Return a
`Revision[]`. Leave the CriticMarkup nodes in the AST — the DocxBuilder will
use them to generate `w:ins`/`w:del` elements.

### 5.4 `MarkdownWriter.ts`

```typescript
export class MarkdownWriter {
  /**
   * Write an updated chapter back to disk.
   * Comments are re-inserted as HTML comment anchors.
   * Revisions are written as CriticMarkup.
   * The output is stable: re-parsing then re-writing produces identical output.
   */
  async writeChapter(chapter: ParsedChapter, outputPath: string): Promise<void>;

  /**
   * Insert a new comment anchor into the AST at the position matching anchorQuote.
   * Returns the updated AST. Throws if anchorQuote is not found.
   */
  insertCommentAnchor(ast: Root, comment: Comment): Root;

  /**
   * Insert a CriticMarkup revision into the AST at the position matching
   * revision.precedingContext + revision.text.
   * Returns the updated AST. Throws if position is not found.
   */
  insertRevision(ast: Root, revision: Revision): Root;

  /**
   * Remove a revision from the AST (after accept/reject decision).
   * For accept: unwrap the inserted text, drop the deleted text.
   * For reject: drop the inserted text, unwrap the deleted text.
   */
  finalizeRevision(ast: Root, revision: Revision, accept: boolean): Root;
}
```

---

## 6. OOXML / Docx Layer — `AGENT: docx`

This is the most technically demanding package. Read the entire section before
writing any code. Consult `docs/ooxml-notes.md` for quirks.

### 6.1 `DocxBuilder.ts`

Converts the full `DocportDocument` into a `.docx` buffer.

```typescript
import { Document, Packer, Paragraph, TextRun, SectionType } from 'docx';
import type { DocportDocument } from '../types';

export class DocxBuilder {
  /**
   * Build a .docx buffer from the full bridge document.
   * Chapters are separated by page breaks.
   * Comments are written to word/comments.xml via OoxmlCommentWriter.
   * Revisions are written as w:ins/w:del within the paragraph runs.
   */
  async build(doc: DocportDocument): Promise<Buffer> {
    const allParagraphs = await this.buildAllParagraphs(doc);
    const commentsPart = OoxmlCommentWriter.build(doc);

    const docxDoc = new Document({
      features: { updateFields: true },
      comments: commentsPart,
      sections: [
        {
          properties: { type: SectionType.CONTINUOUS },
          children: allParagraphs,
        },
      ],
    });

    return Packer.toBuffer(docxDoc);
  }

  private async buildAllParagraphs(doc: DocportDocument): Promise<Paragraph[]> {
    const paragraphs: Paragraph[] = [];
    for (const chapter of doc.chapters) {
      paragraphs.push(...(await this.chapterToParagraphs(chapter, doc)));
      paragraphs.push(pageBreakParagraph());
    }
    return paragraphs;
  }
```

**AST → `docx` library mapping:**

| mdast node type | docx library construct |
|---|---|
| `heading` (depth 1-3) | `Paragraph` with `HeadingLevel.HEADING_1/2/3` |
| `paragraph` | `Paragraph` |
| `strong` | `TextRun({ bold: true })` |
| `emphasis` | `TextRun({ italics: true })` |
| `inlineCode` | `TextRun({ font: 'Courier New', size: 20 })` |
| `code` (block) | `Paragraph` with `style: 'CodeBlock'` |
| `listItem` | `Paragraph` with `NumberingLevel` |
| `table` | `Table` with `TableRow` / `TableCell` |
| `image` | `Paragraph` containing `ImageRun` (rasterize SVG first) |
| `criticInsertion` | `TextRun` wrapped in `InsertedRun` |
| `criticDeletion` | `TextRun` wrapped in `DeletedRun` |
| `criticSubstitution` | `DeletedRun` immediately followed by `InsertedRun` |

For comment anchors: before the paragraph containing the anchor, emit a
`CommentRangeStart`. After the anchored text, emit `CommentRangeEnd` +
`CommentReference`. Use the `id` from `CommentState.lastDocxId` (assign
sequential ints starting from 0 if not set).

### 6.2 `OoxmlCommentWriter.ts`

The `docx` npm library's comment support is limited. Write the
`word/comments.xml` content directly as XML using `fast-xml-parser`'s builder,
then inject it into the zip via JSZip before returning the buffer.

```typescript
export class OoxmlCommentWriter {
  /**
   * Generate the full word/comments.xml content for all comments.
   * Each Comment in doc generates one <w:comment> element.
   * Replies are nested as <w:comment> children (OOXML paragraph format).
   */
  static buildXml(comments: Comment[], revisions: Revision[]): string {
    // Build XML string manually. Use template literals for clarity.
    // Key structure:
    // <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    // <w:comments xmlns:w="...">
    //   <w:comment w:id="0" w:author="PI" w:date="2025-03-20T10:00:00Z">
    //     <w:p>
    //       <w:r><w:t>Comment body text here</w:t></w:r>
    //     </w:p>
    //   </w:comment>
    // </w:comments>
  }
}
```

**Critical detail**: Word validates comment IDs are sequential integers starting
from 0. Track the next available ID in `DocportState` and pre-assign all IDs
before building. If a comment already has a `lastDocxId`, reuse it. If new,
assign the next integer and store it back in state.

### 6.3 `OoxmlCommentParser.ts`

Parse `word/comments.xml` and `word/document.xml` from a returned `.docx` to
extract comments the PI has added.

```typescript
export class OoxmlCommentParser {
  /**
   * Extract all comments from a .docx buffer.
   * Returns a map of docx comment ID → raw comment data.
   * Anchor text is extracted from the surrounding w:t runs in document.xml
   * by finding the w:commentRangeStart / w:commentRangeEnd markers.
   */
  static async parse(docxBuffer: Buffer): Promise<RawComment[]> {
    const zip = await JSZip.loadAsync(docxBuffer);
    const commentsXml = await zip.file('word/comments.xml')?.async('string');
    const documentXml = await zip.file('word/document.xml')?.async('string');

    if (!commentsXml || !documentXml) throw new Error('Invalid .docx: missing comments.xml or document.xml');

    const parsedComments = parseCommentsXml(commentsXml);
    const anchors = parseCommentAnchors(documentXml);

    return parsedComments.map(c => ({
      ...c,
      anchorText: anchors.get(c.id) ?? '',
    }));
  }
}

export interface RawComment {
  docxId: number;
  author: string;
  date: string;
  body: string;
  anchorText: string;         // text between commentRangeStart and commentRangeEnd
  replies: RawCommentReply[];
}
```

**Parsing `word/comments.xml`**: Use `fast-xml-parser` with
`{ ignoreAttributes: false, attributeNamePrefix: '@_' }`. Walk the
`w:comments.w:comment` array. Extract `@_w:id`, `@_w:author`, `@_w:date`.
Concatenate all `w:t` text runs within the comment as the body.

**Parsing anchor text from `word/document.xml`**: Find all
`<w:commentRangeStart w:id="N"/>` and `<w:commentRangeEnd w:id="N"/>` markers.
Collect all `w:t` text runs between each start/end pair as the anchor text.
Trim and normalize whitespace. Take the first 60 chars as `anchorQuote`.

### 6.4 `OoxmlRevisionParser.ts`

```typescript
export class OoxmlRevisionParser {
  /**
   * Extract all pending track changes from document.xml.
   * Returns insertions and deletions with their author, date, and text.
   * Does NOT return changes that have already been accepted/rejected in Word.
   */
  static async parse(docxBuffer: Buffer): Promise<RawRevision[]> {
    const zip = await JSZip.loadAsync(docxBuffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) throw new Error('Invalid .docx');
    return parseRevisions(documentXml);
  }
}

export interface RawRevision {
  docxId: number;
  kind: 'insertion' | 'deletion';
  author: string;
  date: string;
  text: string;
  /** The ~60 chars of unchanged w:t runs immediately preceding this change. */
  precedingContext: string;
}
```

Walk `document.xml` as an XML tree. For each `<w:ins>` element, collect the
`w:t` text within it. For each `<w:del>`, collect `w:delText` runs. Capture
the `w:r/w:t` content immediately preceding each `w:ins`/`w:del` as
`precedingContext`.

### 6.5 `OoxmlRevisionWriter.ts`

When pushing markdown with CriticMarkup revisions, generate the `w:ins`/`w:del`
XML inline in `document.xml`. The `docx` npm library's `InsertedRun` and
`DeletedRun` classes handle most cases:

```typescript
import { InsertedRun, DeletedRun, TextRun } from 'docx';

// For a criticInsertion node:
new InsertedRun({
  id: revision.lastDocxId!,
  author: revision.author,
  date: new Date(revision.date),
  children: [new TextRun(revision.text)],
});

// For a criticDeletion node:
new DeletedRun({
  id: revision.lastDocxId!,
  author: revision.author,
  date: new Date(revision.date),
  children: [new DeletedText(revision.text)],
});
```

### 6.6 `DocxParser.ts`

High-level orchestrator that parses a `.docx` back into chapter-split prose.

```typescript
export class DocxParser {
  /**
   * Parse a PI-returned .docx into the bridge's internal representation.
   * 
   * Chapter boundaries are detected by page-break paragraphs.
   * The number and order of chapters must match the manifest.
   * 
   * Returns:
   * - chapters: the prose content split back into chapter ASTs (clean, no annotations)
   * - newComments: comments not in the current bridge state (PI added these)
   * - newRevisions: revisions not in the current bridge state (PI made these)
   * - decidedRevisions: revisions that were in state but are now accepted/rejected in Word
   */
  async parse(
    docxBuffer: Buffer,
    manifest: Manifest,
    state: DocportState
  ): Promise<DocxParseResult> { ... }
}
```

Chapter-splitting algorithm:
1. Walk paragraphs in document order.
2. A paragraph whose runs contain `<w:pageBreak/>` (or `<w:br w:type="page"/>`)
   signals a chapter boundary.
3. Assign paragraphs to chapters by index, matching against `manifest.chapters`.
4. Convert each chapter's paragraphs back to a remark AST using a reverse mapping
   (Paragraph with Heading style → `heading`, etc.).

---

## 7. Bridge Core — `AGENT: docport-core`

### 7.1 `DocportState.ts`

```typescript
export class DocportState {
  private state: DocportStateType;
  private filePath: string;

  static async load(manifestDir: string): Promise<DocportState> { ... }
  static create(manifestDir: string): DocportState { ... }

  async save(): Promise<void> { ... }

  getComment(id: string): CommentState | undefined { ... }
  getRevision(id: string): RevisionState | undefined { ... }

  upsertComment(comment: CommentState): void { ... }
  upsertRevision(revision: RevisionState): void { ... }

  /** Assign the next available integer docx ID for a new comment/revision. */
  nextDocxId(): number { ... }

  /** Compute a stable anchorQuote from surrounding text. */
  static computeAnchorQuote(surroundingText: string): string {
    // Take the first sentence or 40 chars, whichever is shorter.
    // Strip leading punctuation. Normalize whitespace.
    // Must be unique within the chapter — caller checks and extends if needed.
  }
}
```

### 7.2 `Pusher.ts` — `docport push`

Full push pipeline: Markdown → `.docx`.

```typescript
export class Pusher {
  /**
   * Push the current markdown workspace to a .docx file.
   * 
   * Steps:
   * 1. Load manifest and bridge state.
   * 2. For each chapter: parse markdown → AST, extract comments/revisions.
   * 3. Verify all comment IDs in AST are in bridge state (fail if not).
   * 4. Assign docx IDs to any new revisions from the markdown (CriticMarkup
   *    the agent or user added since the last push).
   * 5. Build the docx buffer.
   * 6. Write to manifest.outputFile (or default filename).
   * 7. Update state: lastPushCommit = current git HEAD.
   * 8. Save bridge state.
   * 9. Print summary: N comments included, M revisions included.
   */
  async run(manifestPath: string, options: PushOptions): Promise<void> { ... }
}

export interface PushOptions {
  /** If true, force push even if there are unresolved conflicts. */
  force?: boolean;
  /** Dry run: print what would be written but don't write. */
  dryRun?: boolean;
}
```

### 7.3 `Puller.ts` — `docport pull`

Full pull pipeline: `.docx` → Markdown.

```typescript
export class Puller {
  /**
   * Pull annotations from a PI-returned .docx back into the markdown workspace.
   * 
   * Steps:
   * 1. Load manifest and bridge state.
   * 2. Verify the provided .docx has the expected SHA-256 (warn if not).
   * 3. Git commit any uncommitted markdown changes with message "auto: pre-pull snapshot".
   * 4. Parse the .docx:
   *    a. Extract all w:comment elements.
   *    b. Extract all w:ins/w:del elements.
   *    c. Detect any accepted/rejected revisions (changes that were pending
   *       in state but are no longer pending in the docx).
   * 5. For each NEW comment (not in state):
   *    a. Assign a new UUID.
   *    b. Find the anchorQuote in the correct chapter markdown via AnchorResolver.
   *    c. Insert a <!-- @comment --> tag into the chapter AST.
   *    d. Add to bridge state.
   * 6. For each NEW revision (not in state):
   *    a. Assign a new UUID.
   *    b. Find the precedingContext in the chapter markdown.
   *    c. Insert CriticMarkup into the chapter AST.
   *    d. Add to bridge state.
   * 7. For each DECIDED revision (was pending, now accepted/rejected):
   *    a. Call MarkdownWriter.finalizeRevision() to remove the CriticMarkup.
   *    b. Update bridge state: decided = true/false.
   * 8. Write all modified chapter files.
   * 9. Update bridge state: lastPullCommit = new git HEAD, lastDocxHash = sha256(docx).
   * 10. Save bridge state.
   * 11. Git commit with message "bridge: pull from <docxFilename>".
   * 12. Print summary.
   */
  async run(docxPath: string, manifestPath: string, options: PullOptions): Promise<void> { ... }
}
```

### 7.4 `AnchorResolver.ts`

The most algorithmically subtle component. Locates where a comment or revision
should be inserted in the current markdown, given that text may have changed
since the docx was exported.

```typescript
export class AnchorResolver {
  /**
   * Find the position in a chapter's AST where an anchorQuote should be placed.
   * 
   * Strategy (in order of preference):
   * 1. Exact match: find anchorQuote as a substring in the AST's text nodes.
   * 2. Fuzzy match: use Levenshtein distance with threshold 0.15
   *    (allows for minor edits to the anchored text since push).
   * 3. Semantic match: if fuzzy fails, search for the longest common subsequence
   *    of tokens between anchorQuote and all text nodes.
   * 4. Fail loudly: throw AnchorNotFoundError with the anchorQuote and the
   *    closest match found, so the CLI can report it to the user.
   * 
   * Returns the AST node index and character offset where the anchor tag
   * should be inserted.
   */
  static resolve(
    ast: Root,
    anchorQuote: string
  ): { nodeIndex: number; charOffset: number } { ... }
}

export class AnchorNotFoundError extends Error {
  constructor(
    public readonly anchorQuote: string,
    public readonly closestMatch: string,
    public readonly similarity: number
  ) {
    super(
      `Cannot locate anchor: "${anchorQuote}"\n` +
      `Closest match (${(similarity * 100).toFixed(0)}%): "${closestMatch}"\n` +
      `Manual resolution required. Edit paper.docport.json to update the anchorQuote.`
    );
  }
}
```

### 7.5 `ConflictResolver.ts`

Handles the case where both the researcher and the PI edited the same text.

```typescript
export class ConflictResolver {
  /**
   * Detect conflicts between PI revisions (from docx) and local changes (from git diff).
   * 
   * A conflict occurs when:
   * - A PI revision's precedingContext no longer exists in the current markdown
   *   because the researcher also edited that paragraph.
   * 
   * Conflict representation in markdown:
   * 
   * <<<<<<< yours
   * The experiment used 48 participants.
   * =======
   * The experiment used {++52++} participants.
   * >>>>>>> PI (via docport pull 2025-03-24)
   * 
   * The user must resolve manually, then run `docport pull --continue`.
   */
  static detectConflicts(
    localAst: Root,
    piRevisions: Revision[]
  ): ConflictRegion[] { ... }

  static writeConflictMarkers(ast: Root, conflict: ConflictRegion): Root { ... }
}
```

### 7.6 `Differ.ts` — `docport diff`

Show what annotations are in a `.docx` without pulling.

```typescript
export class Differ {
  /**
   * Compare a .docx against the current bridge state and print:
   * - New comments by PI (not in state)
   * - New revisions by PI (not in state)
   * - Decided revisions (pending in state, resolved in docx)
   * - Unchanged items
   * 
   * Does not modify any files.
   */
  async run(docxPath: string, manifestPath: string): Promise<void> { ... }
}
```

---

## 8. Git Layer — `AGENT: git`

```typescript
import simpleGit, { SimpleGit } from 'simple-git';

export class GitManager {
  private git: SimpleGit;

  constructor(workingDir: string) {
    this.git = simpleGit(workingDir);
  }

  async ensureRepo(): Promise<void> { ... }

  async currentCommitHash(): Promise<string> { ... }

  async hasUncommittedChanges(): Promise<boolean> { ... }

  async commitAll(message: string): Promise<string> {
    await this.git.add('.');
    const result = await this.git.commit(message);
    return result.commit;
  }

  async sha256File(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
```

---

## 9. CLI — `AGENT: cli`

### 9.1 Commands

```
docport push [options] [manifest]
  --dry-run          Print what would be written, don't write
  --force            Push even with unresolved conflicts
  --output <path>    Override output .docx path

docport pull [options] <docx> [manifest]
  --continue         Resume after resolving conflict markers
  --no-commit        Don't auto-commit after pull

docport diff <docx> [manifest]
  Show pending annotations without pulling

docport init [options] [dir]
  --title <t>        Paper title
  --author <a>       Author name (repeatable)
  Create paper.manifest.json and paper.docport.json in dir

docport accept-all
  Accept all pending PI revisions in markdown (remove CriticMarkup, keep text)

docport reject-all
  Reject all pending PI revisions in markdown

docport status
  Show current state: N pending comments, M pending revisions, last push/pull
```

### 9.2 `cli.ts` skeleton

```typescript
import { Command } from 'commander';
import { Pusher } from './bridge/Pusher';
import { Puller } from './bridge/Puller';
import { Differ } from './bridge/Differ';

const program = new Command()
  .name('docport')
  .description('2-way Markdown ↔ .docx port for research papers')
  .version('0.1.0');

program
  .command('push [manifest]')
  .description('Export markdown workspace to .docx')
  .option('--dry-run', 'Print plan without writing')
  .option('--force', 'Ignore conflict warnings')
  .option('--output <path>', 'Override output .docx path')
  .action(async (manifest = 'paper.manifest.json', opts) => {
    try {
      await new Pusher().run(manifest, opts);
    } catch (err) {
      console.error(String(err));
      process.exit(1);
    }
  });

// ... pull, diff, init, accept-all, reject-all, status
```

---

## 10. Testing — `AGENT: testing`

### 10.1 Unit tests

#### `CriticMarkupPlugin.test.ts`
Round-trip parse→stringify for all five CriticMarkup types. Edge cases:
- Empty content: `{+++++}` (empty insertion)
- Nested braces: `{++code with {braces}++}`
- Adjacent marks: `{--old--}{++new++}` touching without space
- Multiline: CriticMarkup spanning two sentences

#### `CommentAnchorPlugin.test.ts`
- Parse canonical form → typed node
- Parse with extra whitespace in attributes
- Stringify → canonical form (sorted attributes, double quotes)
- Round-trip stability

#### `OoxmlCommentParser.test.ts`
Use `fixtures/with-comments.docx`. Assert:
- Correct number of comments extracted
- Author, date, body match what was written
- Anchor text matches the text between `commentRangeStart`/`commentRangeEnd`
- Reply threading preserved

#### `OoxmlCommentWriter.test.ts`
Write a document with 2 comments via `DocxBuilder`. Re-parse the output with
`OoxmlCommentParser`. Assert round-trip fidelity. Open in Word (manual test).

#### `OoxmlRevisionParser.test.ts`
Use `fixtures/with-revisions.docx`. Assert:
- 1 insertion and 1 deletion extracted
- `precedingContext` is correct
- `decided` is correctly null (not yet accepted/rejected)

#### `AnchorResolver.test.ts`
- Exact match: anchorQuote appears verbatim
- Fuzzy match: anchorQuote with 2 chars changed (should still resolve)
- Fail: anchorQuote completely not in text (expect `AnchorNotFoundError`)

#### `DocportState.test.ts`
- `load()` on missing file returns `emptyDocportState()`
- `save()` then `load()` round-trips
- `nextDocxId()` increments correctly across multiple calls
- `computeAnchorQuote()` produces stable output

### 10.2 Integration tests

#### `push-roundtrip.test.ts`
1. Write 3 `.md` files with headings, paragraphs, bold text, a table, and an
   image reference.
2. Write `paper.manifest.json` pointing to them.
3. `Pusher.run()` → produces `.docx` buffer.
4. `DocxParser.parse()` on the buffer → check chapter count and heading text.

#### `pull-roundtrip.test.ts`
1. Push the fixture chapters to `.docx`.
2. Programmatically add a comment to the `.docx` (via JSZip + OoxmlCommentWriter).
3. `Puller.run()` → check that the comment appears as `<!-- @comment -->` in
   the correct chapter file.
4. Push again → the comment survives as a `w:comment` in the new `.docx`.

#### `comment-roundtrip.test.ts`
Full cycle: add comment in markdown → push → comment appears in docx →
PI replies (simulate by editing the fixture docx directly via JSZip) →
pull → reply appears in `paper.docport.json`.

#### `revision-roundtrip.test.ts`
Full cycle: add `{++insertion++}` in markdown → push → appears as `w:ins` in
docx → PI accepts in docx (simulate by removing the `w:ins` wrapper but keeping
the text) → pull → `finalizeRevision()` called → CriticMarkup gone, text kept.

#### `multifile.test.ts`
3 chapter `.md` files → push → 1 `.docx` with correct page breaks → pull →
3 `.md` files with content matching original. Assert chapter boundary detection
is exact.

### 10.3 Fixtures

Generate all fixtures programmatically in `tests/fixtures/generate.ts`:

```typescript
// Creates:
// - simple.docx: 2 paragraphs, 1 heading, 1 table, 1 image
// - with-comments.docx: simple + 2 comments with 1 reply each
// - with-revisions.docx: simple + 1 insertion + 1 deletion
// - with-images.docx: simple + 2 embedded PNG images
// - chapters/: 3 .md files + paper.manifest.json
```

Run `vitest --reporter=verbose` to see individual test names.

---

## 11. `paper.manifest.json` — User-facing schema

This is what the researcher actually writes to configure their paper:

```json
{
  "title": "Effect of Treatment X on Response Time in Healthy Adults",
  "authors": [
    { "name": "Jane Smith", "affiliation": "University of Example", "email": "j.smith@example.ac.il" },
    { "name": "Prof. PI Name", "affiliation": "University of Example" }
  ],
  "chapters": [
    { "file": "01-abstract.md" },
    { "file": "02-introduction.md" },
    { "file": "03-methods.md" },
    { "file": "04-results.md" },
    { "file": "05-discussion.md" }
  ],
  "bibliography": "references.bib",
  "citationStyle": "APA",
  "referenceDoc": "styles/academic-template.docx",
  "outputFile": "smith2025_treatmentX.docx"
}
```

## 12. Typical Workflows

### Sending to PI

```bash
# In your paper directory (contains paper.manifest.json)
docport push
# → smith2025_treatmentX.docx created
# Email/share this file with PI
```

### Receiving PI feedback

```bash
# PI has returned smith2025_treatmentX_reviewed.docx
docport diff smith2025_treatmentX_reviewed.docx
# → Shows: 3 new comments, 2 revisions (1 insertion, 1 deletion)

docport pull smith2025_treatmentX_reviewed.docx
# → Pulls all annotations into markdown
# → 03-methods.md now has <!-- @comment --> tags and CriticMarkup
# → paper.docport.json updated
# → Git commit created automatically

# Work with your AI agent on the markdown as usual
# The agent can read and respond to comments via the HTML comment tags
```

### Resolving revisions

```bash
# After reviewing the PI's track changes in markdown:
docport accept-all    # accept all PI insertions/deletions
# or
docport reject-all    # reject all

# Or use your AI agent to decide per-revision:
# "Accept all grammar fixes but reject the change to sample size in methods"
```

### Next push (after AI agent edits)

```bash
# The agent may have added its own CriticMarkup for its own suggestions
docport push --output smith2025_v2.docx
# → New docx with:
#   - Resolved PI revisions (accepted/rejected)
#   - New agent-suggested revisions as w:ins/w:del
#   - Ongoing comment threads preserved
```

---

## 13. Definition of Done

- [ ] `tsc --noEmit` passes with zero errors
- [ ] All unit tests pass
- [ ] All integration tests pass, including `multifile.test.ts`
- [ ] Manual test: push a 3-chapter paper, open in Word, verify comments show
      as balloons, track changes show as coloured markup, figures are embedded
- [ ] Manual test: add a comment in Word, pull, verify it appears in the
      correct `.md` file with correct author
- [ ] `docport diff` works without modifying any files
- [ ] `paper.docport.json` round-trips stably (re-running push then pull on
      unchanged files produces identical `paper.docport.json`)
- [ ] `README.md` documents installation, all commands, and the annotation
      markup spec for AI agents

## 14. Out of Scope for v0.1

- LaTeX / `.tex` output
- PDF output (use Word's own PDF export)
- Real-time sync (bridge is a pull-when-ready model)
- Web UI (CLI only)
- Citation lookup / literature search (handled by the AI agent in the markdown)
- Collaborative editing between multiple researchers (Git branches are the tool)
- ODT / LibreOffice support
