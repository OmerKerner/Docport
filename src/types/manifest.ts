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
