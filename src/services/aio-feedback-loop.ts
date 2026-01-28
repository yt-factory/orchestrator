import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { logger } from '../utils/logger';

// AIO learning data structure
interface AIOLearning {
  totalVideosAnalyzed: number;
  lastUpdated: string;
  patterns: {
    [pattern: string]: {
      attempts: number;
      successes: number;
      successRate: number;
    };
  };
  topics: {
    [topic: string]: {
      attempts: number;
      successes: number;
      successRate: number;
    };
  };
  answerFormats: {
    [format: string]: {
      attempts: number;
      successes: number;
      successRate: number;
    };
  };
  questionTypes: {
    [type: string]: {
      attempts: number;
      successes: number;
      successRate: number;
    };
  };
}

// FAQ generation hints derived from learning
interface FAQGenerationHints {
  preferredFormats: string[];
  highSuccessPatterns: string[];
  topicsToEmphasize: string[];
  avoidPatterns: string[];
  avgSuccessRate: number;
}

// Raw AIO performance data from analytics
interface AIOPerformanceData {
  videoId: string;
  faqItems: Array<{
    question: string;
    answer: string;
    appearedInAIO: boolean;
    impressions?: number;
    clicks?: number;
  }>;
  overallAIOVisibility: boolean;
  timestamp: string;
}

const DEFAULT_LEARNING: AIOLearning = {
  totalVideosAnalyzed: 0,
  lastUpdated: new Date().toISOString(),
  patterns: {},
  topics: {},
  answerFormats: {},
  questionTypes: {}
};

/**
 * Tracks AIO performance and provides learning-based hints for FAQ generation
 */
export class AIOFeedbackLoop {
  private learningFile: string;
  private learning: AIOLearning = DEFAULT_LEARNING;
  private loaded = false;

  constructor(learningFile: string = './data/aio_learning.json') {
    this.learningFile = learningFile;
  }

  /**
   * Initialize by loading existing learning data
   */
  async initialize(): Promise<void> {
    if (this.loaded) return;
    await this.loadLearning();
    this.loaded = true;
  }

  /**
   * Fetch AIO performance data and update learning
   * Note: Actual YouTube Analytics integration requires mcp-gateway implementation
   */
  async fetchAndLearn(videoIds: string[]): Promise<AIOLearning> {
    logger.info('Fetching AIO performance data', {
      videoCount: videoIds.length
    });

    // TODO: Implement actual YouTube Analytics API call via mcp-gateway
    // For now, this is a placeholder that simulates the data structure
    const performanceData = await this.fetchPerformanceData(videoIds);

    // Process each video's performance
    for (const data of performanceData) {
      this.processVideoPerformance(data);
    }

    // Update timestamp
    this.learning.lastUpdated = new Date().toISOString();

    // Persist learning
    await this.saveLearning();

    logger.info('AIO learning updated', {
      totalVideos: this.learning.totalVideosAnalyzed,
      patternCount: Object.keys(this.learning.patterns).length
    });

    return this.learning;
  }

  /**
   * Get FAQ generation hints based on learned patterns
   */
  getFaqGenerationHints(): FAQGenerationHints {
    const hints: FAQGenerationHints = {
      preferredFormats: [],
      highSuccessPatterns: [],
      topicsToEmphasize: [],
      avoidPatterns: [],
      avgSuccessRate: 0
    };

    // Extract high-success question types (>30% success rate)
    const HIGH_SUCCESS_THRESHOLD = 0.3;
    const LOW_SUCCESS_THRESHOLD = 0.1;

    // Analyze question types
    for (const [type, stats] of Object.entries(this.learning.questionTypes)) {
      if (stats.attempts >= 5) {
        // Minimum sample size
        if (stats.successRate >= HIGH_SUCCESS_THRESHOLD) {
          hints.preferredFormats.push(type);
          hints.highSuccessPatterns.push(type);
        } else if (stats.successRate < LOW_SUCCESS_THRESHOLD) {
          hints.avoidPatterns.push(type);
        }
      }
    }

    // Analyze topics
    for (const [topic, stats] of Object.entries(this.learning.topics)) {
      if (stats.attempts >= 3 && stats.successRate >= HIGH_SUCCESS_THRESHOLD) {
        hints.topicsToEmphasize.push(topic);
      }
    }

    // Analyze answer formats
    for (const [format, stats] of Object.entries(this.learning.answerFormats)) {
      if (stats.attempts >= 5 && stats.successRate >= HIGH_SUCCESS_THRESHOLD) {
        if (!hints.preferredFormats.includes(format)) {
          hints.preferredFormats.push(format);
        }
      }
    }

    // Calculate overall average success rate
    let totalAttempts = 0;
    let totalSuccesses = 0;
    for (const stats of Object.values(this.learning.patterns)) {
      totalAttempts += stats.attempts;
      totalSuccesses += stats.successes;
    }
    hints.avgSuccessRate =
      totalAttempts > 0 ? totalSuccesses / totalAttempts : 0;

    logger.debug('FAQ generation hints generated', {
      preferredFormatsCount: hints.preferredFormats.length,
      avoidPatternsCount: hints.avoidPatterns.length,
      avgSuccessRate: hints.avgSuccessRate
    });

    return hints;
  }

  /**
   * Manually record FAQ performance (for testing or manual data entry)
   */
  recordPerformance(
    questionType: string,
    topic: string,
    answerFormat: string,
    appearedInAIO: boolean
  ): void {
    // Update question type stats
    this.updateStats(this.learning.questionTypes, questionType, appearedInAIO);

    // Update topic stats
    this.updateStats(this.learning.topics, topic, appearedInAIO);

    // Update answer format stats
    this.updateStats(this.learning.answerFormats, answerFormat, appearedInAIO);

    // Update pattern (combination)
    const patternKey = `${questionType}|${answerFormat}`;
    this.updateStats(this.learning.patterns, patternKey, appearedInAIO);
  }

  /**
   * Get current learning state
   */
  getLearningState(): AIOLearning {
    return { ...this.learning };
  }

  /**
   * Reset learning data
   */
  async resetLearning(): Promise<void> {
    this.learning = { ...DEFAULT_LEARNING };
    await this.saveLearning();
    logger.info('AIO learning data reset');
  }

  /**
   * Process a single video's performance data
   */
  private processVideoPerformance(data: AIOPerformanceData): void {
    this.learning.totalVideosAnalyzed++;

    for (const faq of data.faqItems) {
      const questionType = this.classifyQuestionType(faq.question);
      const topic = this.extractTopic(faq.question);
      const answerFormat = this.classifyAnswerFormat(faq.answer);

      this.recordPerformance(
        questionType,
        topic,
        answerFormat,
        faq.appearedInAIO
      );
    }
  }

  /**
   * Classify question type from question text
   */
  private classifyQuestionType(question: string): string {
    const lowerQuestion = question.toLowerCase();

    if (lowerQuestion.startsWith('how do i') || lowerQuestion.startsWith('how to')) {
      return 'how_to';
    }
    if (lowerQuestion.startsWith('what is') || lowerQuestion.startsWith('what are')) {
      return 'what_is';
    }
    if (lowerQuestion.startsWith('why')) {
      return 'why_should';
    }
    if (lowerQuestion.startsWith('when')) {
      return 'when_to';
    }
    if (lowerQuestion.includes('best') || lowerQuestion.includes('top')) {
      return 'best_for';
    }
    if (lowerQuestion.includes('difference') || lowerQuestion.includes(' vs ')) {
      return 'difference';
    }

    return 'general';
  }

  /**
   * Extract topic from question
   */
  private extractTopic(question: string): string {
    // Simple extraction - get key noun phrases
    const words = question
      .toLowerCase()
      .replace(/[?.,!]/g, '')
      .split(' ')
      .filter((w) => w.length > 3)
      .filter(
        (w) =>
          ![
            'what',
            'when',
            'where',
            'which',
            'that',
            'this',
            'these',
            'those',
            'should',
            'could',
            'would',
            'have',
            'does',
            'your',
            'between'
          ].includes(w)
      );

    return words.slice(0, 3).join('_') || 'general';
  }

  /**
   * Classify answer format
   */
  private classifyAnswerFormat(answer: string): string {
    if (answer.includes('1.') || answer.includes('•') || answer.includes('-')) {
      return 'list';
    }
    if (answer.match(/^\d/)) {
      return 'number_lead';
    }
    if (answer.length < 100) {
      return 'concise';
    }
    return 'detailed';
  }

  /**
   * Update stats for a category
   */
  private updateStats(
    category: Record<string, { attempts: number; successes: number; successRate: number }>,
    key: string,
    success: boolean
  ): void {
    if (!category[key]) {
      category[key] = { attempts: 0, successes: 0, successRate: 0 };
    }

    category[key].attempts++;
    if (success) {
      category[key].successes++;
    }
    category[key].successRate =
      category[key].successes / category[key].attempts;
  }

  /**
   * Load learning data from disk
   */
  private async loadLearning(): Promise<void> {
    try {
      const content = await readFile(this.learningFile, 'utf-8');
      this.learning = JSON.parse(content);
      logger.info('AIO learning data loaded', {
        totalVideos: this.learning.totalVideosAnalyzed,
        lastUpdated: this.learning.lastUpdated
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to load AIO learning data', {
          error: (error as Error).message
        });
      }
      this.learning = { ...DEFAULT_LEARNING };
    }
  }

  /**
   * Save learning data to disk
   */
  private async saveLearning(): Promise<void> {
    try {
      await mkdir(dirname(this.learningFile), { recursive: true });
      await writeFile(
        this.learningFile,
        JSON.stringify(this.learning, null, 2)
      );
    } catch (error) {
      logger.error('Failed to save AIO learning data', {
        error: (error as Error).message
      });
    }
  }

  /**
   * Placeholder for actual YouTube Analytics API integration
   * This would be implemented via mcp-gateway
   */
  private async fetchPerformanceData(
    videoIds: string[]
  ): Promise<AIOPerformanceData[]> {
    // TODO: Implement actual API call to mcp-gateway
    // This is a placeholder that returns empty data
    logger.debug(
      'fetchPerformanceData placeholder called - implement via mcp-gateway',
      { videoIds }
    );

    return [];
  }
}
