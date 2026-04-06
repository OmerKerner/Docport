import { describe, it, expect } from 'vitest';
import { ManifestReader } from '../../src/manifest/ManifestReader.js';
import { ManifestValidator } from '../../src/manifest/ManifestValidator.js';
import { resolve, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = resolve(__dirname, '../fixtures');

describe('Manifest Integration', () => {
  it('should load and validate a complete manifest with all optional fields', async () => {
    const reader = new ManifestReader();
    const validator = new ManifestValidator();
    const manifestPath = resolve(fixturesDir, 'complete-manifest.json');
    
    // Load manifest
    const manifest = await reader.loadManifest(manifestPath);
    
    // Verify structure
    expect(manifest.title).toBe('Complete Test Paper');
    expect(manifest.authors).toHaveLength(2);
    expect(manifest.chapters).toHaveLength(2);
    expect(manifest.citationStyle).toBe('MLA');
    
    // Verify paths are absolute
    expect(isAbsolute(manifest.chapters[0]?.file ?? '')).toBe(true);
    expect(isAbsolute(manifest.chapters[1]?.file ?? '')).toBe(true);
    expect(isAbsolute(manifest.bibliography ?? '')).toBe(true);
    
    // Validate all files exist
    const result = await validator.validate(manifest);
    
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('should handle the complete workflow: read -> validate -> detect issues', async () => {
    const reader = new ManifestReader();
    const validator = new ManifestValidator();
    
    // Create a manifest with issues
    const manifest = {
      title: 'Test Paper',
      authors: [
        { name: 'Author 1' },
        { name: '   ' }, // Empty name
      ],
      chapters: [
        { file: resolve(fixturesDir, '01-intro.md') },
        { file: resolve(fixturesDir, '__missing__/chapter.md') }, // Missing file
      ],
      bibliography: resolve(fixturesDir, '__missing__/refs.bib'), // Missing file
      citationStyle: 'APA' as const,
    };
    
    const result = await validator.validate(manifest);
    
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.length).toBeGreaterThan(0);
    
    // Should detect empty author name
    expect(result.errors?.some(e => e.includes('empty name'))).toBe(true);
    
    // Should detect missing chapter file
    expect(result.errors?.some(e => e.includes('Chapter file not found'))).toBe(true);
    
    // Should detect missing bibliography
    expect(result.errors?.some(e => e.includes('Bibliography file not found'))).toBe(true);
  });

  it('should provide helpful error messages for schema validation failures', async () => {
    const reader = new ManifestReader();
    
    // Create invalid manifest JSON
    const invalidManifest = JSON.stringify({
      title: 'Test',
      // Missing required 'authors' field
      chapters: [],
      citationStyle: 'InvalidStyle', // Invalid enum value
    });
    
    // Write to temp file in fixtures
    const fs = await import('fs/promises');
    const invalidPath = resolve(fixturesDir, 'invalid-manifest.json');
    await fs.writeFile(invalidPath, invalidManifest, 'utf-8');
    
    try {
      await reader.loadManifest(invalidPath);
      expect.fail('Should have thrown validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).toContain('Manifest validation failed');
        expect(error.message).toContain('authors'); // Missing field
      }
    } finally {
      // Cleanup
      await fs.unlink(invalidPath);
    }
  });
});
