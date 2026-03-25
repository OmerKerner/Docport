import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { Manifest, ManifestSchema } from '../types/index.js';
import { ZodError } from 'zod';

export class ManifestReader {
  /**
   * Load and validate a manifest file from disk.
   * 
   * @param manifestPath - Absolute or relative path to the paper.manifest.json file
   * @returns Validated Manifest object with all paths resolved to absolute paths
   * @throws Error if file doesn't exist, is malformed JSON, or fails validation
   */
  async loadManifest(manifestPath: string): Promise<Manifest> {
    // Resolve to absolute path
    const absoluteManifestPath = resolve(manifestPath);
    const manifestDir = dirname(absoluteManifestPath);

    // Read the file
    let fileContent: string;
    try {
      fileContent = await readFile(absoluteManifestPath, 'utf-8');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`Manifest file not found: ${absoluteManifestPath}`);
      }
      throw new Error(`Failed to read manifest file: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Parse JSON
    let rawData: unknown;
    try {
      rawData = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(`Manifest file contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Validate against schema
    let manifest: Manifest;
    try {
      manifest = ManifestSchema.parse(rawData);
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map(issue => 
          `  - ${issue.path.join('.')}: ${issue.message}`
        ).join('\n');
        throw new Error(`Manifest validation failed:\n${issues}`);
      }
      throw new Error(`Manifest validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Resolve all relative paths to absolute paths based on manifest directory
    const resolvedManifest: Manifest = {
      ...manifest,
      chapters: manifest.chapters.map(chapter => ({
        ...chapter,
        file: resolve(manifestDir, chapter.file),
      })),
      bibliography: manifest.bibliography 
        ? resolve(manifestDir, manifest.bibliography)
        : undefined,
      referenceDoc: manifest.referenceDoc
        ? resolve(manifestDir, manifest.referenceDoc)
        : undefined,
    };

    return resolvedManifest;
  }
}
