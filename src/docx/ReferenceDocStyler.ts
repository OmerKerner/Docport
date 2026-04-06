import JSZip from 'jszip';
import { readFile } from 'fs/promises';

const STYLE_RELATED_PARTS = [
  'word/styles.xml',
  'word/stylesWithEffects.xml',
  'word/theme/theme1.xml',
  'word/fontTable.xml',
  'word/settings.xml',
  'word/numbering.xml',
] as const;

/**
 * Applies style/theme-related OOXML parts from a reference .docx onto a generated .docx.
 * This keeps Word visual formatting (fonts, spacing, heading styles) aligned with the source template.
 */
export async function applyReferenceDocStyles(
  generatedDocx: Buffer,
  referenceDocPath: string,
): Promise<Buffer> {
  const [generatedZip, referenceBuffer] = await Promise.all([
    JSZip.loadAsync(generatedDocx),
    readFile(referenceDocPath),
  ]);
  const referenceZip = await JSZip.loadAsync(referenceBuffer);

  for (const part of STYLE_RELATED_PARTS) {
    const sourcePart = referenceZip.file(part);
    if (!sourcePart) {
      continue;
    }
    const payload = await sourcePart.async('nodebuffer');
    generatedZip.file(part, payload);
  }

  return generatedZip.generateAsync({ type: 'nodebuffer' });
}
