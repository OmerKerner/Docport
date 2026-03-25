import { access } from 'fs/promises';
import { constants } from 'fs';
import { Manifest } from '../types/index.js';

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export class ManifestValidator {
  /**
   * Validate that a manifest's referenced files exist and detect logical issues.
   * 
   * @param manifest - The manifest object to validate (should have absolute paths)
   * @returns ValidationResult indicating success or listing all errors found
   */
  async validate(manifest: Manifest): Promise<ValidationResult> {
    const errors: string[] = [];

    // Check for duplicate chapter files
    const chapterFiles = manifest.chapters.map(ch => ch.file);
    const duplicates = chapterFiles.filter((file, index) => 
      chapterFiles.indexOf(file) !== index
    );
    if (duplicates.length > 0) {
      const uniqueDuplicates = Array.from(new Set(duplicates));
      errors.push(`Duplicate chapter files detected: ${uniqueDuplicates.join(', ')}`);
    }

    // Check that all chapter files exist
    const chapterChecks = manifest.chapters.map(async (chapter, index) => {
      try {
        await access(chapter.file, constants.R_OK);
      } catch {
        errors.push(`Chapter file not found (index ${index}): ${chapter.file}`);
      }
    });

    // Check bibliography file if specified
    const bibliographyCheck = manifest.bibliography 
      ? (async () => {
          try {
            await access(manifest.bibliography!, constants.R_OK);
          } catch {
            errors.push(`Bibliography file not found: ${manifest.bibliography}`);
          }
        })()
      : Promise.resolve();

    // Check reference doc file if specified
    const referenceDocCheck = manifest.referenceDoc
      ? (async () => {
          try {
            await access(manifest.referenceDoc!, constants.R_OK);
          } catch {
            errors.push(`Reference document file not found: ${manifest.referenceDoc}`);
          }
        })()
      : Promise.resolve();

    // Wait for all file checks to complete
    await Promise.all([
      ...chapterChecks,
      bibliographyCheck,
      referenceDocCheck,
    ]);

    // Additional validation: check for empty chapters array
    if (manifest.chapters.length === 0) {
      errors.push('Manifest must contain at least one chapter');
    }

    // Additional validation: check for empty title
    if (manifest.title.trim().length === 0) {
      errors.push('Manifest title cannot be empty');
    }

    // Additional validation: check for empty authors array
    if (manifest.authors.length === 0) {
      errors.push('Manifest must contain at least one author');
    }

    // Additional validation: check that author names are not empty
    manifest.authors.forEach((author, index) => {
      if (author.name.trim().length === 0) {
        errors.push(`Author at index ${index} has an empty name`);
      }
    });

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true };
  }
}
