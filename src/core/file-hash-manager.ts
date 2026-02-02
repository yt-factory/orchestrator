import crypto from 'crypto';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';

// ============================================
// Types
// ============================================

interface ProcessedFile {
  hash: string;
  fileSize: number;
  filePath: string;
  projectId: string;
  processedAt: string;
}

interface DuplicateCheckResult {
  isProcessed: boolean;
  existingProject?: ProcessedFile;
  checkMethod: 'size_mismatch' | 'hash_match' | 'hash_mismatch' | 'new_file';
}

// ============================================
// File Hash Manager
// ============================================

export class FileHashManager {
  private readonly hashFilePath: string;
  private processedFiles: Map<string, ProcessedFile> = new Map();
  private sizeIndex: Map<number, string[]> = new Map();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(dataDir: string = './data') {
    this.hashFilePath = path.join(dataDir, 'processed_hashes.json');
  }

  /**
   * Initialize the hash manager by loading persisted data
   * Uses a promise-based lock to prevent concurrent initialization
   */
  async init(): Promise<void> {
    // Fast path: already initialized
    if (this.initialized) return;

    // If initialization is in progress, wait for it
    if (this.initPromise) {
      return this.initPromise;
    }

    // Start initialization and store the promise
    this.initPromise = this._doInit();
    try {
      await this.initPromise;
    } finally {
      // Clear the promise after completion (success or failure)
      this.initPromise = null;
    }
  }

  /**
   * Internal initialization logic
   */
  private async _doInit(): Promise<void> {
    // Double-check after acquiring the "lock"
    if (this.initialized) return;

    try {
      // Ensure data directory exists
      await mkdir(path.dirname(this.hashFilePath), { recursive: true });

      const data = await readFile(this.hashFilePath, 'utf-8');
      const entries: ProcessedFile[] = JSON.parse(data);

      for (const entry of entries) {
        this.processedFiles.set(entry.hash, entry);

        // Build size index for fast lookups
        const sizes = this.sizeIndex.get(entry.fileSize) || [];
        sizes.push(entry.hash);
        this.sizeIndex.set(entry.fileSize, sizes);
      }

      logger.info('File hash manager initialized', {
        cachedHashes: this.processedFiles.size,
        uniqueSizes: this.sizeIndex.size
      });
    } catch (error) {
      // File doesn't exist or is invalid - start fresh
      logger.info('No existing hash cache, starting fresh');
    }

    this.initialized = true;
  }

  /**
   * Fast duplicate check using size-first comparison strategy
   *
   * 1. Check if file size exists in index (very fast)
   * 2. If size matches potential duplicates, compute hash (slower but necessary)
   * 3. Compare hash against known processed files
   */
  async isAlreadyProcessed(filePath: string): Promise<DuplicateCheckResult> {
    if (!this.initialized) {
      await this.init();
    }

    try {
      // Step 1: Get file stats
      const stats = await stat(filePath);
      const fileSize = stats.size;

      // Step 2: Quick check - if size not in index, definitely new file
      const potentialMatches = this.sizeIndex.get(fileSize);

      if (!potentialMatches || potentialMatches.length === 0) {
        logger.debug('File size not in index, new file', {
          filePath: path.basename(filePath),
          fileSize
        });

        return {
          isProcessed: false,
          checkMethod: 'size_mismatch'
        };
      }

      // Step 3: Size matches, need to compute hash for definitive check
      const hash = await this.calculateFileHash(filePath);

      const existing = this.processedFiles.get(hash);
      if (existing) {
        logger.info('File already processed (hash match)', {
          filePath: path.basename(filePath),
          hash: hash.substring(0, 8),
          existingProjectId: existing.projectId
        });

        return {
          isProcessed: true,
          existingProject: existing,
          checkMethod: 'hash_match'
        };
      }

      // Size matched but content different
      logger.debug('File size matched but content differs', {
        filePath: path.basename(filePath),
        fileSize,
        potentialMatchCount: potentialMatches.length
      });

      return {
        isProcessed: false,
        checkMethod: 'hash_mismatch'
      };
    } catch (error) {
      logger.warn('Error checking file hash', {
        filePath,
        error: (error as Error).message
      });

      // On error, assume new file to avoid blocking
      return {
        isProcessed: false,
        checkMethod: 'new_file'
      };
    }
  }

  /**
   * Mark a file as processed
   */
  async markAsProcessed(
    filePath: string,
    hash: string,
    projectId: string
  ): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }

    let fileSize = 0;
    try {
      const stats = await stat(filePath);
      fileSize = stats.size;
    } catch {
      // File may have been moved, get size from content if available
    }

    const entry: ProcessedFile = {
      hash,
      fileSize,
      filePath,
      projectId,
      processedAt: new Date().toISOString()
    };

    this.processedFiles.set(hash, entry);

    // Update size index
    const sizes = this.sizeIndex.get(fileSize) || [];
    if (!sizes.includes(hash)) {
      sizes.push(hash);
      this.sizeIndex.set(fileSize, sizes);
    }

    await this.save();

    logger.debug('File marked as processed', {
      filePath: path.basename(filePath),
      hash: hash.substring(0, 8),
      projectId
    });
  }

  /**
   * Calculate MD5 hash of file content
   */
  async calculateFileHash(filePath: string): Promise<string> {
    const content = await readFile(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Get hash for a file (convenience method)
   */
  async getFileHash(filePath: string): Promise<{ hash: string; size: number }> {
    const [hash, stats] = await Promise.all([
      this.calculateFileHash(filePath),
      stat(filePath)
    ]);

    return { hash, size: stats.size };
  }

  /**
   * Clean up old entries to prevent unbounded growth
   */
  async cleanup(maxAgeDays: number = 30, maxEntries: number = 1000): Promise<number> {
    if (!this.initialized) {
      await this.init();
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);

    let removed = 0;

    // Remove entries older than cutoff
    for (const [hash, entry] of this.processedFiles) {
      if (new Date(entry.processedAt) < cutoff) {
        this.processedFiles.delete(hash);

        // Update size index
        const sizes = this.sizeIndex.get(entry.fileSize);
        if (sizes) {
          const idx = sizes.indexOf(hash);
          if (idx > -1) sizes.splice(idx, 1);
          if (sizes.length === 0) this.sizeIndex.delete(entry.fileSize);
        }

        removed++;
      }
    }

    // If still over limit, remove oldest entries
    if (this.processedFiles.size > maxEntries) {
      const entries = Array.from(this.processedFiles.entries())
        .sort((a, b) =>
          new Date(a[1].processedAt).getTime() - new Date(b[1].processedAt).getTime()
        );

      const toRemove = entries.slice(0, this.processedFiles.size - maxEntries);

      for (const [hash, entry] of toRemove) {
        this.processedFiles.delete(hash);

        const sizes = this.sizeIndex.get(entry.fileSize);
        if (sizes) {
          const idx = sizes.indexOf(hash);
          if (idx > -1) sizes.splice(idx, 1);
          if (sizes.length === 0) this.sizeIndex.delete(entry.fileSize);
        }

        removed++;
      }
    }

    if (removed > 0) {
      await this.save();
      logger.info('Hash cache cleanup completed', { removedEntries: removed });
    }

    return removed;
  }

  /**
   * Get statistics about the hash cache
   */
  getStats(): {
    totalEntries: number;
    uniqueSizes: number;
    oldestEntry: string | null;
    newestEntry: string | null;
  } {
    const entries = Array.from(this.processedFiles.values());

    if (entries.length === 0) {
      return {
        totalEntries: 0,
        uniqueSizes: 0,
        oldestEntry: null,
        newestEntry: null
      };
    }

    const sorted = entries.sort(
      (a, b) => new Date(a.processedAt).getTime() - new Date(b.processedAt).getTime()
    );

    return {
      totalEntries: entries.length,
      uniqueSizes: this.sizeIndex.size,
      oldestEntry: sorted[0]?.processedAt ?? null,
      newestEntry: sorted[sorted.length - 1]?.processedAt ?? null
    };
  }

  /**
   * Persist the hash cache to disk
   */
  private async save(): Promise<void> {
    const entries = Array.from(this.processedFiles.values());

    // Sort by processedAt desc and keep only recent entries
    const recentEntries = entries
      .sort((a, b) =>
        new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime()
      )
      .slice(0, 1000);

    await mkdir(path.dirname(this.hashFilePath), { recursive: true });
    await writeFile(this.hashFilePath, JSON.stringify(recentEntries, null, 2));
  }
}

// Export singleton instance
export const fileHashManager = new FileHashManager();

// Export types
export type { ProcessedFile, DuplicateCheckResult };
