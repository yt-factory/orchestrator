import { ExtendedFAQItem, ScriptSegment } from '../core/manifest';
import { GeminiClient } from '../agents/gemini-client';
import { logger } from '../utils/logger';

// FAQ patterns with historical AIO success rates
const FAQ_PATTERNS: Record<
  string,
  { template: string; answerStyle: string; aioSuccessRate: number }
> = {
  how_to: {
    template: 'How do I {action}?',
    answerStyle: 'Step-by-step guide',
    aioSuccessRate: 0.45
  },
  what_is: {
    template: 'What is {concept}?',
    answerStyle: 'Clear definition + example',
    aioSuccessRate: 0.35
  },
  why_should: {
    template: 'Why should you {action}?',
    answerStyle: 'Benefits list',
    aioSuccessRate: 0.3
  },
  best_for: {
    template: 'What is the best {category} for {use_case}?',
    answerStyle: 'Recommendation with reasoning',
    aioSuccessRate: 0.4
  },
  when_to: {
    template: 'When should you {action}?',
    answerStyle: 'Situational advice',
    aioSuccessRate: 0.32
  },
  difference: {
    template: 'What is the difference between {a} and {b}?',
    answerStyle: 'Comparison table format',
    aioSuccessRate: 0.38
  }
};

// AIO feedback hints interface
interface AIOFeedbackHints {
  preferredFormats: string[];
  highSuccessPatterns: string[];
  topicsToEmphasize: string[];
  avoidPatterns: string[];
  avgSuccessRate: number;
}

/**
 * Generates FAQ content optimized for Google AI Overviews (AIO)
 */
export class FAQGenerator {
  private aioFeedback: AIOFeedbackHints | null = null;

  constructor(
    private geminiClient: GeminiClient,
    aioFeedback?: AIOFeedbackHints
  ) {
    if (aioFeedback) {
      this.aioFeedback = aioFeedback;
    }
  }

  /**
   * Update AIO feedback hints for improved generation
   */
  setAIOFeedback(feedback: AIOFeedbackHints): void {
    this.aioFeedback = feedback;
    logger.info('AIO feedback updated', {
      avgSuccessRate: feedback.avgSuccessRate,
      preferredFormatsCount: feedback.preferredFormats.length
    });
  }

  /**
   * Main FAQ generation method
   */
  async generateFAQs(
    projectId: string,
    content: string,
    topic: string,
    numFaqs: number = 5
  ): Promise<ExtendedFAQItem[]> {
    logger.info('Starting FAQ generation', { projectId, topic, numFaqs });

    // Step 1: Determine best FAQ patterns based on AIO feedback
    const prioritizedPatterns = this.prioritizePatterns();

    // Step 2: Generate FAQs using AI
    const faqs = await this.aiGenerateFAQs(
      projectId,
      content,
      topic,
      numFaqs,
      prioritizedPatterns
    );

    // Step 3: Add Schema.org markup
    const faqsWithSchema = faqs.map((faq) => ({
      ...faq,
      schema_markup: this.generateSingleFAQSchema(faq)
    }));

    logger.info('FAQ generation complete', {
      projectId,
      faqCount: faqsWithSchema.length
    });

    return faqsWithSchema;
  }

  /**
   * Prioritize FAQ patterns based on AIO feedback
   */
  private prioritizePatterns(): string[] {
    const allPatterns = Object.keys(FAQ_PATTERNS);

    if (!this.aioFeedback) {
      // Default: sort by base success rate
      return allPatterns.sort(
        (a, b) =>
          (FAQ_PATTERNS[b]?.aioSuccessRate || 0) -
          (FAQ_PATTERNS[a]?.aioSuccessRate || 0)
      );
    }

    // Use feedback to prioritize
    const prioritized: string[] = [];

    // First: patterns that match preferred formats
    for (const pattern of allPatterns) {
      if (this.aioFeedback.preferredFormats.includes(pattern)) {
        prioritized.push(pattern);
      }
    }

    // Then: patterns with high base success rate (not in avoid list)
    for (const pattern of allPatterns) {
      if (
        !prioritized.includes(pattern) &&
        !this.aioFeedback.avoidPatterns.includes(pattern)
      ) {
        prioritized.push(pattern);
      }
    }

    return prioritized;
  }

  /**
   * AI-powered FAQ generation
   */
  private async aiGenerateFAQs(
    projectId: string,
    content: string,
    topic: string,
    numFaqs: number,
    prioritizedPatterns: string[]
  ): Promise<ExtendedFAQItem[]> {
    const patternExamples = prioritizedPatterns
      .slice(0, 4)
      .map((p) => FAQ_PATTERNS[p]?.template || p)
      .join('\n- ');

    const aioGuidance = this.aioFeedback
      ? `
AIO OPTIMIZATION HINTS:
- Preferred patterns: ${this.aioFeedback.highSuccessPatterns.join(', ')}
- Topics to emphasize: ${this.aioFeedback.topicsToEmphasize.join(', ')}
- Avoid: ${this.aioFeedback.avoidPatterns.join(', ')}
`
      : '';

    const prompt = `
Generate ${numFaqs} FAQs for Google AI Overviews optimization.

TOPIC: ${topic}

CONTENT SUMMARY:
${content.slice(0, 3000)}

PREFERRED FAQ PATTERNS:
- ${patternExamples}

${aioGuidance}

REQUIREMENTS:
1. Questions should match search intent (what people actually search for)
2. Answers must be concise (under 200 characters) but complete
3. Include 1-3 related entities per FAQ (tools, concepts, technologies)
4. Questions should be self-contained (understandable without context)

Output as JSON array:
[
  {
    "question": "Full question ending with ?",
    "answer": "Concise, direct answer (max 200 chars)",
    "related_entities": ["entity1", "entity2"]
  }
]
`;

    try {
      const result = await this.geminiClient.generate(prompt, {
        projectId,
        priority: 'medium'
      });

      const parsed = JSON.parse(result.text);
      return parsed.map((item: any) => ({
        question: item.question,
        answer: item.answer.slice(0, 200),
        related_entities: (item.related_entities || []).slice(0, 3)
      }));
    } catch (error) {
      logger.error('FAQ AI generation failed', {
        projectId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Generate Schema.org FAQPage markup for a single FAQ
   */
  private generateSingleFAQSchema(faq: ExtendedFAQItem): Record<string, unknown> {
    return {
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer
      }
    };
  }

  /**
   * Generate complete Schema.org FAQPage structured data
   */
  generateSchemaMarkup(faqs: ExtendedFAQItem[]): Record<string, unknown> {
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer
        }
      }))
    };
  }

  /**
   * Convert chapter titles to FAQ questions
   */
  convertTitlesToQuestions(chapters: string[]): string[] {
    const questions: string[] = [];

    for (const chapter of chapters) {
      const question = this.titleToQuestion(chapter);
      if (question) {
        questions.push(question);
      }
    }

    return questions;
  }

  /**
   * Convert a single title to question format
   */
  private titleToQuestion(title: string): string {
    const lowerTitle = title.toLowerCase().trim();

    // Already a question
    if (lowerTitle.endsWith('?')) {
      return title;
    }

    // "Setting up X" → "How do I set up X?"
    if (lowerTitle.startsWith('setting up')) {
      return `How do I ${lowerTitle.replace('setting up', 'set up')}?`;
    }

    // "Getting started with X" → "How do I get started with X?"
    if (lowerTitle.startsWith('getting started')) {
      return `How do I ${lowerTitle}?`;
    }

    // "Understanding X" → "What is X?"
    if (lowerTitle.startsWith('understanding')) {
      return `What is ${lowerTitle.replace('understanding', '').trim()}?`;
    }

    // "Introduction to X" → "What is X?"
    if (lowerTitle.startsWith('introduction to')) {
      return `What is ${lowerTitle.replace('introduction to', '').trim()}?`;
    }

    // "X vs Y" → "What is the difference between X and Y?"
    if (lowerTitle.includes(' vs ') || lowerTitle.includes(' versus ')) {
      const parts = lowerTitle.split(/\s+(?:vs|versus)\s+/);
      if (parts.length === 2) {
        return `What is the difference between ${parts[0]} and ${parts[1]}?`;
      }
    }

    // "Why X" → "Why should you X?"
    if (lowerTitle.startsWith('why ')) {
      return `Why should you ${lowerTitle.replace('why ', '')}?`;
    }

    // "When to X" → "When should you X?"
    if (lowerTitle.startsWith('when to')) {
      return `When should you ${lowerTitle.replace('when to ', '')}?`;
    }

    // "Best X" or "Top X" → "What is the best X?"
    if (lowerTitle.startsWith('best ') || lowerTitle.startsWith('top ')) {
      return `What is the ${lowerTitle}?`;
    }

    // Default: "How to do X?"
    return `How do I ${lowerTitle}?`;
  }

  /**
   * Extract entities from FAQ content for knowledge graph linking
   */
  async extractEntitiesFromFAQs(
    projectId: string,
    faqs: ExtendedFAQItem[]
  ): Promise<
    Array<{ name: string; type: string; description?: string }>
  > {
    const allEntities = faqs.flatMap((faq) => faq.related_entities);
    const uniqueEntities = [...new Set(allEntities)];

    if (uniqueEntities.length === 0) {
      return [];
    }

    const prompt = `
Classify these entities and provide brief descriptions:

ENTITIES: ${uniqueEntities.join(', ')}

Output as JSON array:
[
  {
    "name": "entity name",
    "type": "tool|concept|person|company|technology",
    "description": "brief description (max 100 chars)"
  }
]
`;

    try {
      const result = await this.geminiClient.generate(prompt, {
        projectId,
        priority: 'low'
      });

      return JSON.parse(result.text);
    } catch (error) {
      logger.warn('Entity extraction failed', {
        projectId,
        error: (error as Error).message
      });
      // Return basic entities without classification
      return uniqueEntities.map((name) => ({
        name,
        type: 'concept'
      }));
    }
  }
}
