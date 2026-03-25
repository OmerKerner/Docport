/**
 * Type-safe wrapper for the docx library with ESM compatibility fixes.
 * The docx library has known issues with TypeScript ESM module resolution.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Dynamic import workaround for docx library ESM compatibility
export async function getDocx(): Promise<typeof import('docx')> {
  const docxModule = await import('docx');
  return docxModule as any;
}

// Re-export commonly used types
export type { 
  IPropertiesOptions,
  ISectionOptions  
} from 'docx';
