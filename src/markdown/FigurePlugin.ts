import type { Root, Image } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import { access } from 'fs/promises';
import { resolve, dirname, isAbsolute } from 'path';

/**
 * Options for the figure plugin.
 */
export interface FigurePluginOptions {
  /** Base directory for resolving relative paths (usually the markdown file's directory) */
  baseDir: string;
  /** Whether to throw an error if an image file doesn't exist */
  strict?: boolean;
}

/**
 * Resolve and validate image paths in markdown.
 * Handles both ![alt](path) syntax and <img> HTML tags.
 */
export const remarkFigure: Plugin<[FigurePluginOptions], Root> = (options) => {
  const { baseDir, strict = true } = options;

  return async (tree: Root) => {
    const imageNodes: Array<{ node: Image; path: string }> = [];

    // Collect all image nodes
    visit(tree, 'image', (node: Image) => {
      if (node.url) {
        imageNodes.push({ node, path: node.url });
      }
    });

    // Also handle HTML img tags (represented as 'html' nodes in mdast)
    visit(tree, 'html', (node: any) => {
      if (typeof node.value === 'string') {
        const imgMatch = node.value.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (imgMatch && imgMatch[1]) {
          // Store the path for validation, but we don't modify HTML nodes
          imageNodes.push({ node: node as Image, path: imgMatch[1] });
        }
      }
    });

    // Validate and resolve each image path
    for (const { node, path } of imageNodes) {
      // Skip URLs (http://, https://, data:, etc.)
      if (/^[a-z]+:/i.test(path)) {
        continue;
      }

      // Resolve relative paths
      const absolutePath = isAbsolute(path) 
        ? path 
        : resolve(baseDir, path);

      // Validate file exists
      try {
        await access(absolutePath);
        
        // Update the node's URL to the resolved path for later processing
        // (The DocxBuilder will use this resolved path)
        if (node.type === 'image') {
          node.url = absolutePath;
        }
      } catch (err) {
        if (strict) {
          throw new Error(
            `Image file not found: ${path}\nResolved to: ${absolutePath}\nBase directory: ${baseDir}`
          );
        } else {
          // In non-strict mode, log a warning but continue
          console.warn(`Warning: Image file not found: ${path}`);
        }
      }
    }
  };
};

/**
 * Helper to extract the directory from a file path.
 * Used by MarkdownReader to determine the base directory for relative paths.
 */
export function getImageBaseDir(markdownFilePath: string): string {
  return dirname(markdownFilePath);
}
