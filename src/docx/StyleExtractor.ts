import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

import type { StyleMetadata } from '../types/style-metadata.js';

interface ParsedStyle {
  styleId?: string;
  type?: string;
  name?: string;
}

export class StyleExtractor {
  async extract(docxBuffer: Buffer, sourceDocxName: string): Promise<StyleMetadata | null> {
    const zip = await JSZip.loadAsync(docxBuffer);
    const stylesFile = zip.file('word/styles.xml');
    if (!stylesFile) {
      return null;
    }

    const stylesXml = await stylesFile.async('text');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseAttributeValue: false,
      trimValues: false,
    });

    const stylesDoc = parser.parse(stylesXml) as Record<string, unknown>;
    const stylesRoot = stylesDoc['w:styles'] as Record<string, unknown> | undefined;
    const styleNodes = stylesRoot?.['w:style'];
    const styleArray = styleNodes
      ? (Array.isArray(styleNodes) ? styleNodes : [styleNodes])
      : [];

    const paragraphStyles = styleArray
      .map((styleNode) => this.parseStyle(styleNode))
      .filter((style): style is ParsedStyle => !!style.styleId && style.type === 'paragraph');

    const byId = new Map<string, ParsedStyle>();
    const byName = new Map<string, ParsedStyle>();
    for (const style of paragraphStyles) {
      if (style.styleId) {
        byId.set(style.styleId.toLowerCase(), style);
      }
      if (style.name) {
        byName.set(style.name.toLowerCase(), style);
      }
    }

    const pick = (...keys: string[]): { styleId: string; name?: string } | undefined => {
      for (const key of keys) {
        const hit = byId.get(key.toLowerCase()) ?? byName.get(key.toLowerCase());
        if (hit?.styleId) {
          return { styleId: hit.styleId, name: hit.name };
        }
      }
      return undefined;
    };

    const defaults = this.extractDefaults(stylesRoot);

    return {
      sourceDocxName,
      extractedAt: new Date().toISOString(),
      styleMap: {
        normal: pick('normal'),
        heading1: pick('heading1', 'heading 1'),
        heading2: pick('heading2', 'heading 2'),
        heading3: pick('heading3', 'heading 3'),
        heading4: pick('heading4', 'heading 4'),
        heading5: pick('heading5', 'heading 5'),
        heading6: pick('heading6', 'heading 6'),
        title: pick('title'),
      },
      defaults,
    };
  }

  private parseStyle(styleNode: unknown): ParsedStyle {
    if (!styleNode || typeof styleNode !== 'object') {
      return {};
    }
    const style = styleNode as Record<string, unknown>;
    const nameNode = style['w:name'] as Record<string, unknown> | undefined;
    return {
      styleId: typeof style['@_w:styleId'] === 'string' ? (style['@_w:styleId'] as string) : undefined,
      type: typeof style['@_w:type'] === 'string' ? (style['@_w:type'] as string) : undefined,
      name: typeof nameNode?.['@_w:val'] === 'string' ? (nameNode['@_w:val'] as string) : undefined,
    };
  }

  private extractDefaults(stylesRoot?: Record<string, unknown>): StyleMetadata['defaults'] {
    if (!stylesRoot) {
      return undefined;
    }

    const docDefaults = stylesRoot['w:docDefaults'] as Record<string, unknown> | undefined;
    const rPrDefault = docDefaults?.['w:rPrDefault'] as Record<string, unknown> | undefined;
    const rPr = rPrDefault?.['w:rPr'] as Record<string, unknown> | undefined;
    if (!rPr) {
      return undefined;
    }

    const rFonts = rPr['w:rFonts'] as Record<string, unknown> | undefined;
    const sz = rPr['w:sz'] as Record<string, unknown> | undefined;
    const sizeRaw = sz?.['@_w:val'];
    const sizeHalfPoints = typeof sizeRaw === 'string' && /^\d+$/.test(sizeRaw)
      ? parseInt(sizeRaw, 10)
      : undefined;

    return {
      asciiFont: typeof rFonts?.['@_w:ascii'] === 'string' ? (rFonts['@_w:ascii'] as string) : undefined,
      eastAsiaFont: typeof rFonts?.['@_w:eastAsia'] === 'string' ? (rFonts['@_w:eastAsia'] as string) : undefined,
      complexScriptFont: typeof rFonts?.['@_w:cs'] === 'string' ? (rFonts['@_w:cs'] as string) : undefined,
      sizeHalfPoints,
    };
  }
}
