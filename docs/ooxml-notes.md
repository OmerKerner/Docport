# OOXML Implementation Notes

This document captures quirks, gotchas, and implementation details discovered while building Docport's OOXML layer.

## Known Issues with `docx` npm Library

### ESM / TypeScript Compatibility

The `docx` library (v8.5.0) has **known compatibility issues** with:
- TypeScript `"moduleResolution": "NodeNext"`
- ESM module resolution

**Symptoms:**
```
error TS4111: Property 'Document' comes from an index signature, so it must be accessed with ['Document'].
error TS2305: Module '"docx"' has no exported member 'IPropertiesOptions'.
```

**Why this happens:**
- The library's package.json uses `"type": "commonjs"` 
- Named exports are not properly declared for ESM consumption
- TypeScript's NodeNext resolution cannot find the types

**Workaround used in Docport:**
```typescript
// Instead of: import { Document, Packer } from 'docx';
// Use dynamic import or type assertions
import docxLib from 'docx';
const { Document, Packer } = docxLib as any; // Temporary workaround
```

**Status:** Runtime works correctly. This is purely a TypeScript type-checking issue. Tracking: https://github.com/dolanmiu/docx/issues/...

---

## Comment ID Requirements

### Sequential IDs Starting from 0

**Discovery:** Word validates that comment IDs in `word/comments.xml` are:
1. Sequential integers
2. Starting from 0
3. No gaps in the sequence

**Error if violated:**
> "This document contains unreadable content. Do you want to recover the contents?"

**Implementation:**
- Docport maintains `lastDocxId` for each comment in `paper.docport.json`
- On push, assigns IDs 0, 1, 2, ... in the order comments appear
- On re-push, **reuses** existing IDs if the comment still exists
- New comments get the next available ID

**Code:**
```typescript
nextDocxId(): number {
  const allIds = [
    ...this.state.comments.map(c => c.lastDocxId ?? -1),
    ...this.state.revisions.map(r => r.lastDocxId ?? -1)
  ].filter(id => id >= 0);
  
  return allIds.length === 0 ? 0 : Math.max(...allIds) + 1;
}
```

---

## Comment Range Markers

### commentRangeStart and commentRangeEnd

**Structure in document.xml:**
```xml
<w:p>
  <w:commentRangeStart w:id="0"/>
  <w:r><w:t>This text is commented.</w:t></w:r>
  <w:commentRangeEnd w:id="0"/>
  <w:r><w:commentReference w:id="0"/></w:r>
</w:p>
```

**Quirks:**
1. `commentRangeStart` and `commentRangeEnd` can span multiple paragraphs
2. `commentReference` must appear **after** `commentRangeEnd`
3. The range markers are **siblings** of `<w:r>` (run) elements, not parents
4. Empty ranges are valid (start and end in same position)

**Parsing strategy:**
- Walk the XML tree linearly
- When you see `commentRangeStart`, begin collecting text
- When you see `commentRangeEnd`, stop and save the collected text as `anchorText`
- Handle nested ranges (comments on comments) by tracking a stack

**Anchor text extraction:**
```typescript
function extractCommentAnchorText(documentXml: string, commentId: number): string {
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(documentXml);
  
  let collecting = false;
  let text = '';
  
  // Walk all w:r runs in document order
  for (const run of getAllRuns(doc)) {
    if (run['w:commentRangeStart']?.['@_w:id'] === commentId) {
      collecting = true;
    }
    if (collecting && run['w:t']) {
      text += run['w:t'];
    }
    if (run['w:commentRangeEnd']?.['@_w:id'] === commentId) {
      break;
    }
  }
  
  return text.trim().substring(0, 60); // First 60 chars as anchorQuote
}
```

---

## Track Changes (Revisions)

### w:ins and w:del Elements

**Insertion structure:**
```xml
<w:ins w:id="0" w:author="PI" w:date="2026-03-25T10:30:00Z">
  <w:r>
    <w:t>inserted text</w:t>
  </w:r>
</w:ins>
```

**Deletion structure:**
```xml
<w:del w:id="0" w:author="PI" w:date="2026-03-25T10:30:00Z">
  <w:r>
    <w:delText>deleted text</w:delText>
  </w:r>
</w:del>
```

**Key differences:**
- Insertions use `<w:t>` (normal text runs)
- Deletions use `<w:delText>` (special deletion text element)
- Both can contain multiple `<w:r>` runs with formatting

**Accepted/rejected detection:**
- If a revision was in `paper.docport.json` but is **not** in the parsed .docx, it was accepted or rejected
- To distinguish:
  - **Accepted insertion**: Text present, no `<w:ins>` wrapper
  - **Rejected insertion**: Text absent entirely
  - **Accepted deletion**: Text absent entirely
  - **Rejected deletion**: Text present, no `<w:del>` wrapper

**Precedingcontext:**
To locate where a revision should be re-inserted during pull, Docport stores ~60 chars of **unchanged text** immediately before the revision:

```typescript
// During push, when writing w:ins:
const precedingContext = getPreviousTextRuns(currentPosition, 60);
state.upsertRevision({
  ...revision,
  precedingContext
});
```

---

## w:rsid Attributes

### Revision Session IDs

Word adds `w:rsid` (revision session ID) attributes to track editing sessions:

```xml
<w:p w:rsidR="00AB12CD" w:rsidRDefault="00AB12CD">
```

**What they mean:**
- `w:rsidR`: When this element was last revised
- `w:rsidRDefault`: Default revision ID for runs in this paragraph
- `w:rsidP`: When paragraph properties were revised

**Docport's approach:**
- **Ignore rsid on parse**: We don't need editing session history
- **Omit rsid on write**: The `docx` library generates them automatically
- Word regenerates rsid values when the document is edited, so they're not stable across sessions

---

## Namespaces

### XML Namespace Prefixes

Common OOXML namespaces:
```xml
xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
```

**Parser configuration:**
```typescript
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  ignoreNameSpace: false, // Keep namespace prefixes
});
```

**Quirk:** Some elements use different prefixes in different parts of the spec:
- `w:` for main document structure
- `wp:` for drawing anchors
- `a:` for drawing content (shapes, images)

---

## Page Breaks

### Chapter Boundary Detection

To split a multi-chapter .docx back into separate Markdown files, Docport detects page breaks.

**Page break in OOXML:**
```xml
<!-- Method 1: Page break run -->
<w:p>
  <w:r>
    <w:br w:type="page"/>
  </w:r>
</w:p>

<!-- Method 2: Section break (new page) -->
<w:p>
  <w:pPr>
    <w:sectPr>
      <w:type w:val="nextPage"/>
    </w:sectPr>
  </w:pPr>
</w:p>
```

**Detection algorithm:**
```typescript
function isPageBreak(paragraph: any): boolean {
  // Check for w:br with type="page"
  const runs = paragraph['w:r'] ?? [];
  for (const run of runs) {
    if (run['w:br']?.['@_w:type'] === 'page') {
      return true;
    }
  }
  
  // Check for section break
  const sectPr = paragraph['w:pPr']?.['w:sectPr'];
  if (sectPr?.['w:type']?.['@_w:val'] === 'nextPage') {
    return true;
  }
  
  return false;
}
```

**Chapter splitting:**
1. Parse all paragraphs from document.xml
2. Split on page breaks
3. Assign each section to a chapter by index
4. Error if section count ≠ chapter count in manifest

---

## Images and Drawings

### Embedded Images

**Image structure:**
```xml
<w:p>
  <w:r>
    <w:drawing>
      <wp:inline>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic>
              <pic:blipFill>
                <a:blip r:embed="rId5"/>
              </pic:blipFill>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>
</w:p>
```

**Relationship in word/_rels/document.xml.rels:**
```xml
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
```

**Embedding images with `docx` library:**
```typescript
import { ImageRun } from 'docx';
import sharp from 'sharp';

const imageBuffer = await fs.readFile(imagePath);

// Rasterize if SVG
const finalBuffer = imagePath.endsWith('.svg')
  ? await sharp(imageBuffer).png().toBuffer()
  : imageBuffer;

const imageRun = new ImageRun({
  data: finalBuffer,
  transformation: {
    width: 400,
    height: 300,
  },
});
```

**Image extraction during parse:**
- Unzip the .docx
- Read `word/_rels/document.xml.rels` to find image relationships
- Extract image files from `word/media/` directory
- Map `r:embed` IDs to image paths

---

## Tables

### Table Structure

```xml
<w:tbl>
  <w:tblPr><!-- Table properties --></w:tblPr>
  <w:tblGrid><!-- Column widths --></w:tblGrid>
  <w:tr>
    <w:tc>
      <w:p><w:r><w:t>Cell 1</w:t></w:r></w:p>
    </w:tc>
    <w:tc>
      <w:p><w:r><w:t>Cell 2</w:t></w:r></w:p>
    </w:tc>
  </w:tr>
</w:tbl>
```

**Quirk:** Each table cell (`<w:tc>`) **must** contain at least one paragraph (`<w:p>`), even if empty.

**Markdown → OOXML mapping:**
```markdown
| Header 1 | Header 2 |
|----------|----------|
| Cell A   | Cell B   |
```

→

```typescript
new Table({
  rows: [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph('Header 1')] }),
        new TableCell({ children: [new Paragraph('Header 2')] }),
      ],
    }),
    // ...
  ],
});
```

---

## Paragraph Styles

### Heading Levels

```xml
<w:p>
  <w:pPr>
    <w:pStyle w:val="Heading1"/>
  </w:pPr>
  <w:r><w:t>Chapter Title</w:t></w:r>
</w:p>
```

**Mapping:**
- Markdown `# Heading` → `<w:pStyle w:val="Heading1"/>`
- Markdown `## Heading` → `<w:pStyle w:val="Heading2"/>`
- Markdown `### Heading` → `<w:pStyle w:val="Heading3"/>`

**Using `docx` library:**
```typescript
new Paragraph({
  text: 'Chapter Title',
  heading: HeadingLevel.HEADING_1,
});
```

---

## Future Work

### Unimplemented OOXML Features

- **Footnotes and endnotes**: Use `word/footnotes.xml`
- **Custom XML parts**: For advanced metadata storage
- **Content controls**: Structured fields (e.g., date pickers)
- **Smart tags**: Semantic annotations
- **Embedded objects**: Excel tables, PowerPoint slides
- **Figure REF fields**: v2 parser now reads `w:fldSimple` and complex `w:fldChar`/`w:instrText` fields and maps resolvable `REF` targets to markdown figure references. Writer-side generation still favors bookmark + hyperlink fallback for compatibility.

### Field-Code Fallback Behavior

Word files in the wild can include malformed or partially edited field structures (for example: `begin` without `end`, or missing `separate` runs).

Docport behavior:
- Prefer semantic mapping when field instructions are parseable and targets resolve.
- If not resolvable, preserve displayed field text as plain markdown text.
- Never silently drop displayed content from malformed field sequences.

### Potential Enhancements

1. **Reference doc support**: Load custom styles from a .docx template
2. **Citation integration**: Use `citation-js` to format BibTeX → OOXML bibliography
3. **Change tracking metadata**: Preserve Word's full revision history (beyond just pending changes)
4. **Collaborative editing**: Detect and merge changes from multiple editors

---

## Debugging Tips

### Inspecting .docx Files

```bash
# Unzip the .docx
unzip paper.docx -d paper-extracted

# View document structure
cat paper-extracted/word/document.xml | xmllint --format -

# View comments
cat paper-extracted/word/comments.xml | xmllint --format -

# View relationships
cat paper-extracted/word/_rels/document.xml.rels | xmllint --format -
```

### Testing in Word

Always test generated .docx files by:
1. Opening in Microsoft Word (not Google Docs or LibreOffice)
2. Checking "Review" tab → "Track Changes" pane
3. Verifying comments appear with correct authors
4. Accepting/rejecting changes and verifying state updates

### Common Errors

**"This document contains unreadable content"**
- Usually means invalid comment IDs (not sequential)
- Or malformed XML in comments.xml

**Comments don't appear**
- Check `word/comments.xml` exists in the zip
- Verify `commentRangeStart`/`End` markers are in document.xml
- Ensure `commentReference` is after `commentRangeEnd`

**Track changes don't show**
- Verify `<w:ins>` and `<w:del>` are present
- Check Track Changes is enabled in Word (Review → Track Changes → ON)
- Ensure `w:author` and `w:date` attributes are present

---

## References

- [Office Open XML specification](http://officeopenxml.com/)
- [ECMA-376 standard](https://www.ecma-international.org/publications-and-standards/standards/ecma-376/)
- [docx library documentation](https://docx.js.org/)
- [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)
