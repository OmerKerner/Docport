import { z } from 'zod';

const ParagraphStyleSchema = z.object({
  styleId: z.string(),
  name: z.string().optional(),
});

const RunStyleDefaultsSchema = z.object({
  asciiFont: z.string().optional(),
  eastAsiaFont: z.string().optional(),
  complexScriptFont: z.string().optional(),
  sizeHalfPoints: z.number().int().positive().optional(),
});

export const StyleMetadataSchema = z.object({
  sourceDocxName: z.string(),
  extractedAt: z.string(),
  styleMap: z.object({
    normal: ParagraphStyleSchema.optional(),
    heading1: ParagraphStyleSchema.optional(),
    heading2: ParagraphStyleSchema.optional(),
    heading3: ParagraphStyleSchema.optional(),
    heading4: ParagraphStyleSchema.optional(),
    heading5: ParagraphStyleSchema.optional(),
    heading6: ParagraphStyleSchema.optional(),
    title: ParagraphStyleSchema.optional(),
  }),
  defaults: RunStyleDefaultsSchema.optional(),
});

export type StyleMetadata = z.infer<typeof StyleMetadataSchema>;
