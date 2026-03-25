/**
 * Type-safe wrapper for the docx library with ESM compatibility fixes.
 * The docx library has known issues with TypeScript ESM module resolution.
 */

// Dynamic import workaround for docx library ESM compatibility
export async function getDocx(): Promise<typeof import('docx')> {
  const docxModule = await import('docx');
  return docxModule;
}
