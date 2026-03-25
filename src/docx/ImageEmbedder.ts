import * as docx from 'docx';
import sharp from 'sharp';
import { readFile, access } from 'fs/promises';
import { resolve } from 'path';

const { ImageRun } = docx;

export class ImageEmbedder {
  /**
   * Embeds an image as a w:drawing element.
   * Handles relative paths, rasterizes SVG/PNG/JPG using sharp.
   */
  static async embed(imagePath: string, baseDir?: string): Promise<ImageRun> {
    const fullPath = baseDir ? resolve(baseDir, imagePath) : resolve(imagePath);
    
    // Validate file exists
    try {
      await access(fullPath);
    } catch {
      throw new Error(`Image file not found: ${fullPath}`);
    }

    // Read the image file
    const buffer = await readFile(fullPath);
    
    // Use sharp to process the image and get metadata
    const image = sharp(buffer);
    const metadata = await image.metadata();
    
    // Rasterize if necessary (SVG) or just get the buffer
    let processedBuffer: Buffer;
    if (metadata.format === 'svg') {
      processedBuffer = await image.png().toBuffer();
    } else {
      processedBuffer = buffer;
    }

    // Calculate dimensions (maintain aspect ratio, max 600px wide)
    const maxWidth = 600;
    let width = metadata.width || maxWidth;
    let height = metadata.height || (width * 0.75);
    
    if (width > maxWidth) {
      const scale = maxWidth / width;
      width = maxWidth;
      height = Math.round(height * scale);
    }

    return new ImageRun({
      data: processedBuffer,
      transformation: {
        width,
        height,
      },
    });
  }
}
