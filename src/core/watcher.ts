import chokidar, { type FSWatcher } from 'chokidar';
import { readFile, rename, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import { logger } from '../utils/logger';

interface FileMetadata {
  path: string;
  content: string;
  wordCount: number;
  estimatedReadingTimeMinutes: number;
  detectedLanguage: 'en' | 'zh';
}

interface WatcherConfig {
  incomingDir: string;
  processedDir: string;
  stabilityDelayMs: number;
}

interface WatcherEvents {
  onFileReady: (metadata: FileMetadata) => Promise<void>;
  onError: (error: Error, filePath?: string) => void;
}

export class FolderWatcher {
  private watcher: FSWatcher | null = null;
  private pendingFiles: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private config: WatcherConfig,
    private events: WatcherEvents
  ) {}

  async start(): Promise<void> {
    // 确保 processed 目录存在
    await mkdir(this.config.processedDir, { recursive: true });

    this.watcher = chokidar.watch(this.config.incomingDir, {
      ignored: [
        /(^|[\/\\])\../, // 忽略隐藏文件
        '**/processed/**' // 忽略 processed 子目录
      ],
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: this.config.stabilityDelayMs,
        pollInterval: 100
      }
    });

    this.watcher.on('add', (filePath: string) => this.handleFileAdd(filePath));
    this.watcher.on('error', (error: unknown) => this.events.onError(error instanceof Error ? error : new Error(String(error))));

    logger.info('FolderWatcher started', {
      dir: this.config.incomingDir,
      stabilityDelayMs: this.config.stabilityDelayMs
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    // 清理所有 pending timers
    for (const timer of this.pendingFiles.values()) {
      clearTimeout(timer);
    }
    this.pendingFiles.clear();

    logger.info('FolderWatcher stopped');
  }

  private async handleFileAdd(filePath: string): Promise<void> {
    const ext = filePath.toLowerCase();
    if (!ext.endsWith('.md') && !ext.endsWith('.txt') && !ext.endsWith('.markdown')) {
      return;
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const metadata = this.analyzeContent(filePath, content);

      logger.info('File detected', {
        path: filePath,
        wordCount: metadata.wordCount,
        language: metadata.detectedLanguage
      });

      // IMPORTANT: Move file to processed BEFORE calling onFileReady
      // This prevents duplicate detection if processing fails and file stays in incoming
      const newPath = join(this.config.processedDir, basename(filePath));
      await rename(filePath, newPath);

      // Update metadata path to reflect new location
      metadata.path = newPath;

      logger.info('File moved to processed', {
        from: filePath,
        to: newPath
      });

      // Now process (if this fails, file is already moved so no duplicates)
      await this.events.onFileReady(metadata);

      logger.info('File processing triggered', {
        path: newPath,
        wordCount: metadata.wordCount
      });
    } catch (error) {
      this.events.onError(error as Error, filePath);
    }
  }

  private analyzeContent(path: string, content: string): FileMetadata {
    const detectedLanguage = this.detectLanguage(content);
    const wordCount = this.countWords(content, detectedLanguage);
    const estimatedReadingTimeMinutes = this.calculateReadingTime(wordCount, detectedLanguage);

    return {
      path,
      content,
      wordCount,
      estimatedReadingTimeMinutes,
      detectedLanguage
    };
  }

  private detectLanguage(content: string): 'en' | 'zh' {
    // 简单检测：中文字符占比 > 30% 则认为是中文
    const chineseChars = content.match(/[\u4e00-\u9fa5]/g) || [];
    const ratio = chineseChars.length / content.length;
    return ratio > 0.3 ? 'zh' : 'en';
  }

  private countWords(content: string, language: 'en' | 'zh'): number {
    if (language === 'zh') {
      // 中文按字符计数
      return (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    }
    // 英文按单词计数
    return content.split(/\s+/).filter(Boolean).length;
  }

  private calculateReadingTime(wordCount: number, language: 'en' | 'zh'): number {
    // 英文: ~200 words/min, 中文: ~300 characters/min
    const wpm = language === 'en' ? 200 : 300;
    return Math.ceil(wordCount / wpm);
  }
}

export type { FileMetadata, WatcherConfig, WatcherEvents };
