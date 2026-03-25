import { describe, it, expect } from 'vitest';
import { ManifestReader } from '../../src/manifest/ManifestReader.js';
import { ManifestValidator } from '../../src/manifest/ManifestValidator.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = resolve(__dirname, '../fixtures');

describe('ManifestReader', () => {
  it('should load and validate a valid manifest', async () => {
    const reader = new ManifestReader();
    const manifestPath = resolve(fixturesDir, 'test-manifest.json');
    
    const manifest = await reader.loadManifest(manifestPath);
    
    expect(manifest.title).toBe('Test Paper');
    expect(manifest.authors).toHaveLength(1);
    expect(manifest.authors[0]?.name).toBe('John Doe');
    expect(manifest.chapters).toHaveLength(1);
    expect(manifest.citationStyle).toBe('APA');
    
    // Verify paths are resolved to absolute
    expect(manifest.chapters[0]?.file).toContain('01-intro.md');
    expect(manifest.chapters[0]?.file).toMatch(/^[A-Z]:\\/); // Windows absolute path
  });

  it('should throw error for non-existent file', async () => {
    const reader = new ManifestReader();
    const manifestPath = resolve(fixturesDir, 'nonexistent.json');
    
    await expect(reader.loadManifest(manifestPath)).rejects.toThrow('not found');
  });

  it('should throw error for invalid JSON', async () => {
    const reader = new ManifestReader();
    const manifestPath = resolve(fixturesDir, '01-intro.md'); // Not JSON
    
    await expect(reader.loadManifest(manifestPath)).rejects.toThrow('invalid JSON');
  });
});

describe('ManifestValidator', () => {
  it('should validate a manifest with existing files', async () => {
    const reader = new ManifestReader();
    const validator = new ManifestValidator();
    const manifestPath = resolve(fixturesDir, 'test-manifest.json');
    
    const manifest = await reader.loadManifest(manifestPath);
    const result = await validator.validate(manifest);
    
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('should detect missing chapter files', async () => {
    const validator = new ManifestValidator();
    const manifest = {
      title: 'Test',
      authors: [{ name: 'Author' }],
      chapters: [{ file: '/nonexistent/file.md' }],
      citationStyle: 'APA' as const,
    };
    
    const result = await validator.validate(manifest);
    
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.[0]).toContain('not found');
  });

  it('should detect duplicate chapter files', async () => {
    const validator = new ManifestValidator();
    const testFile = resolve(fixturesDir, '01-intro.md');
    const manifest = {
      title: 'Test',
      authors: [{ name: 'Author' }],
      chapters: [
        { file: testFile },
        { file: testFile }, // duplicate
      ],
      citationStyle: 'APA' as const,
    };
    
    const result = await validator.validate(manifest);
    
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.some(e => e.includes('Duplicate'))).toBe(true);
  });

  it('should detect empty chapters array', async () => {
    const validator = new ManifestValidator();
    const manifest = {
      title: 'Test',
      authors: [{ name: 'Author' }],
      chapters: [],
      citationStyle: 'APA' as const,
    };
    
    const result = await validator.validate(manifest);
    
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.some(e => e.includes('at least one chapter'))).toBe(true);
  });

  it('should detect empty title', async () => {
    const validator = new ManifestValidator();
    const testFile = resolve(fixturesDir, '01-intro.md');
    const manifest = {
      title: '   ',
      authors: [{ name: 'Author' }],
      chapters: [{ file: testFile }],
      citationStyle: 'APA' as const,
    };
    
    const result = await validator.validate(manifest);
    
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.some(e => e.includes('title cannot be empty'))).toBe(true);
  });

  it('should detect empty authors array', async () => {
    const validator = new ManifestValidator();
    const testFile = resolve(fixturesDir, '01-intro.md');
    const manifest = {
      title: 'Test',
      authors: [],
      chapters: [{ file: testFile }],
      citationStyle: 'APA' as const,
    };
    
    const result = await validator.validate(manifest);
    
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.some(e => e.includes('at least one author'))).toBe(true);
  });
});
