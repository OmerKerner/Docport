# CriticMarkup and Comment Anchor Specification

This document defines the text representation for track changes and comments in Docport's Markdown files.

## CriticMarkup Syntax

Docport implements the [CriticMarkup](http://criticmarkup.com/) standard with slight extensions.

### 1. Insertion

**Syntax:** `{++inserted text++}`

**Word OOXML:** `<w:ins w:author="..." w:date="...">`

**Example:**
```markdown
The experiment used {++52++} participants.
```

**Rendering:**
- In Markdown: Visible as `{++text++}`
- In Word: Green underlined text with "Inserted" in Track Changes
- After acceptance: Plain text "52" (markup removed)

### 2. Deletion

**Syntax:** `{--deleted text--}`

**Word OOXML:** `<w:del w:author="..." w:date="...">`

**Example:**
```markdown
The experiment used {--48--} participants.
```

**Rendering:**
- In Markdown: Visible as `{--text--}`
- In Word: Red strikethrough text with "Deleted" in Track Changes
- After acceptance: Text removed entirely

### 3. Substitution

**Syntax:** `{~~old text~>new text~~}`

**Word OOXML:** `<w:del>` immediately followed by `<w:ins>`

**Example:**
```markdown
The mean age was {~~24.3 ± 3.1~>25.1 ± 2.8~~} years.
```

**Rendering:**
- In Markdown: Visible as `{~~old~>new~~}`
- In Word: Red strikethrough "old", green underline "new"
- After acceptance: Plain text "25.1 ± 2.8"
- After rejection: Plain text "24.3 ± 3.1"

### 4. Highlight

**Syntax:** `{==highlighted text==}`

**Word OOXML:** `<w:highlight w:val="yellow">`

**Example:**
```markdown
This is {==very important==}.
```

**Rendering:**
- In Markdown: Visible as `{==text==}`
- In Word: Yellow highlighted text (not track changes, just formatting)

### 5. Inline Comment (Non-standard extension)

**Syntax:** `{>>comment text<<}`

**Word OOXML:** `<w:comment>` balloon (no specific anchor range)

**Example:**
```markdown
The results were significant{>>But what about outliers?<<}.
```

**Rendering:**
- In Markdown: Visible as `{>>text<<}`
- In Word: Comment balloon at cursor position
- **Note:** For threaded comments with metadata, use HTML comment anchors instead (see below)

## HTML Comment Anchors

For proper comment threading, author tracking, and content-addressed anchors, Docport uses HTML comment tags.

### Syntax

```markdown
<!-- @comment id:"uuid" author:"Author Name" date:"YYYY-MM-DD" -->
The text this comment is anchored to appears here.
```

### Attributes

| Attribute | Required | Format | Description |
|-----------|----------|--------|-------------|
| `id` | Yes | UUID v4 | Stable identifier across round-trips |
| `author` | Yes | String | Comment author's name |
| `date` | Yes | ISO 8601 date | When comment was created |

### Anchor Quote

The **anchor quote** is computed from the text immediately following the comment tag:
- First 40 characters (or first sentence, whichever is shorter)
- Whitespace normalized (multiple spaces → single space)
- Leading punctuation stripped
- Stored in `paper.docport.json` for anchor resolution

Example:
```markdown
<!-- @comment id:"3f8a..." author:"PI" date:"2026-03-25" -->
The results indicate a strong correlation between variables X and Y.
```

Anchor quote stored: `"The results indicate a strong correlat"`

### Comment Body

The full comment body and replies are **not** stored in the Markdown file. They are stored in `paper.docport.json`:

```json
{
  "comments": [
    {
      "id": "3f8a...",
      "chapter": "03-results.md",
      "anchorQuote": "The results indicate a strong correlat",
      "author": "PI",
      "date": "2026-03-25",
      "body": "Please cite the previous work by Smith et al. (2023) here.",
      "replies": [
        {
          "id": "7b2c...",
          "author": "Researcher",
          "date": "2026-03-26",
          "body": "Added the citation in the next paragraph."
        }
      ],
      "resolved": false,
      "lastDocxId": 0
    }
  ]
}
```

### Why Separate Storage?

This design keeps Markdown files **readable** while preserving all metadata:
- The anchor tag is small and unobtrusive
- Comment bodies can be arbitrarily long
- Reply threading is preserved
- Resolved status is tracked
- Stable IDs survive text edits

## Anchor Resolution Algorithm

When pulling from .docx, Docport must find where to insert comment anchors in possibly-changed Markdown.

### Strategy (in order of preference)

1. **Exact match**: Search for the `anchorQuote` as a substring in the chapter
2. **Fuzzy match**: Use Levenshtein distance with threshold 0.15 (allows minor edits)
3. **Semantic match**: Find longest common subsequence of tokens
4. **Fail with error**: Report closest match and similarity percentage

### Example: Paragraph Moved

**Original (at push time):**
```markdown
# Methods
We used 48 participants.

# Results
The results were significant.
```

**After researcher edit:**
```markdown
# Results
The results were significant.

# Methods
We used 48 participants.
```

**PI comment anchored to:** `"The results were significant"`

**Pull behavior:** Exact match found in new location → anchor inserted correctly despite paragraph move.

## Metadata Storage: paper.docport.json

The bridge state file is the single source of truth for:
- Comment IDs, bodies, authors, dates, replies
- Revision IDs, text, context, authors, dates, acceptance status
- Git commit hashes (lastPushCommit, lastPullCommit)
- Docx file hash (lastDocxHash)
- Sequential docx IDs (for Word's internal requirements)

**Example state file:**

```json
{
  "schemaVersion": 1,
  "lastPushCommit": "a1b2c3d4...",
  "lastPullCommit": "e5f6g7h8...",
  "lastDocxHash": "9i0j1k2l...",
  "comments": [
    {
      "id": "3f8a9b2c-...",
      "chapter": "03-results.md",
      "anchorQuote": "The results indicate a strong correlat",
      "author": "PI",
      "date": "2026-03-25T10:30:00Z",
      "body": "Please cite Smith et al.",
      "replies": [],
      "resolved": false,
      "lastDocxId": 0
    }
  ],
  "revisions": [
    {
      "id": "7d4e5f6g-...",
      "chapter": "02-methods.md",
      "kind": "insertion",
      "author": "PI",
      "date": "2026-03-25T11:00:00Z",
      "text": "52",
      "precedingContext": "The experiment used ",
      "decided": null,
      "lastDocxId": 0
    }
  ]
}
```

## Edge Cases

### 1. Empty CriticMarkup

**Valid:**
```markdown
{+++++}   <!-- Empty insertion -->
{------}   <!-- Empty deletion -->
{~~~~>~~}  <!-- Empty substitution -->
```

**Behavior:** Preserved in round-trip, but generates empty OOXML elements.

### 2. Nested Braces

**Example:**
```markdown
{++code with {braces} inside++}
```

**Parser behavior:** State machine tokenizer handles correctly (not regex-based).

### 3. Adjacent Markup

**Example:**
```markdown
{--old--}{++new++}
```

**Rendering:** Correctly generates consecutive `<w:del>` and `<w:ins>` in Word.

### 4. Multiline CriticMarkup

**Example:**
```markdown
{++This is a long insertion
that spans multiple lines
in the markdown file.++}
```

**Behavior:** Supported. OOXML preserves line breaks as `<w:br/>`.

### 5. Duplicate Anchor Quotes

If two comments in the same chapter have identical anchorQuotes, the resolver will match the **first occurrence**. To avoid this:
- Docport extends the anchorQuote automatically if a collision is detected during push
- Example: `"The results indicate"` → `"The results indicate a strong corre"`

## OOXML Mapping Reference

| Markdown | OOXML Element | Attributes |
|----------|---------------|------------|
| `{++text++}` | `<w:ins>` | `w:id`, `w:author`, `w:date` |
| `{--text--}` | `<w:del>` | `w:id`, `w:author`, `w:date` |
| `{~~old~>new~~}` | `<w:del>` + `<w:ins>` | Sequential IDs |
| `{==text==}` | `<w:highlight w:val="yellow">` | None |
| `<!-- @comment -->` | `<w:commentRangeStart>`, `<w:commentRangeEnd>`, `<w:commentReference>` | `w:id` |

## Figure Labels and Cross-References (v1)

### Figure labels in Markdown

Use an image followed by a suffix label:

```markdown
![Pipeline](figures/pipeline.png){#fig:pipeline}
```

Docport parses `{#fig:...}` and stores it on the image node as figure metadata.

### Inline figure references in Markdown

Use:

```markdown
As shown in @fig:pipeline, the method converges.
```

Docport parses `@fig:...` as a structured inline reference node, then stringifies it back identically.

### Word mapping in v1

- Labeled figures are wrapped in Word bookmarks named `docport_fig:label`.
- Inline references are emitted as internal hyperlinks targeting those bookmarks.
- The visible reference text stays `@fig:label` for stable roundtrip.

This is a robust fallback: Word links are clickable, and Docport can recover references on pull.
True live `REF` field code generation is intentionally deferred to a future upgrade.

## Implementation Notes

### CriticMarkup Parser

- **Not regex-based**: Uses a state-machine tokenizer to handle nested braces
- **Plugin architecture**: Extends remark via unified plugin interface
- **Round-trip stable**: parse → stringify produces identical output

### Comment Anchor Parser

- **HTML comment parsing**: Simple key-value regex (not JSON.parse)
- **Canonical form**: Always writes `id:"..."` with double quotes
- **Attribute order**: Sorted alphabetically for deterministic output

### Word ID Requirements

Word validates:
- Comment IDs must be sequential integers starting from 0
- Revision IDs must be unique integers (not necessarily sequential)
- IDs cannot be reused after deletion

Docport manages this by:
- Maintaining `lastDocxId` in state for each annotation
- Assigning new IDs via `DocportState.nextDocxId()`
- Reusing existing IDs on re-push (stability)

## See Also

- [CriticMarkup official spec](http://criticmarkup.com/)
- [OOXML specification](http://officeopenxml.com/)
- [Remark plugin documentation](https://github.com/remarkjs/remark)
