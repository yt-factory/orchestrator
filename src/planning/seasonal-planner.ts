import { ContentPlan } from '../core/manifest';
import { logger } from '../utils/logger';

// Seasonal strategy configuration
const SEASONAL_STRATEGY: Record<
  'Q1' | 'Q2' | 'Q3' | 'Q4',
  {
    focus: string;
    videoFrequency: 'high' | 'medium' | 'strategic';
    contentType: 'evergreen' | 'trending' | 'commercial' | 'mixed';
    monetization: 'secondary' | 'building' | 'active' | 'maximum';
    cpmExpectation: 'low' | 'medium' | 'medium-high' | 'peak';
    baseCpmMultiplier: number;
  }
> = {
  Q1: {
    focus: 'content_building',
    videoFrequency: 'high',
    contentType: 'evergreen',
    monetization: 'secondary',
    cpmExpectation: 'low',
    baseCpmMultiplier: 0.7
  },
  Q2: {
    focus: 'audience_growth',
    videoFrequency: 'medium',
    contentType: 'trending',
    monetization: 'building',
    cpmExpectation: 'medium',
    baseCpmMultiplier: 0.9
  },
  Q3: {
    focus: 'optimization',
    videoFrequency: 'medium',
    contentType: 'mixed',
    monetization: 'active',
    cpmExpectation: 'medium-high',
    baseCpmMultiplier: 1.0
  },
  Q4: {
    focus: 'monetization',
    videoFrequency: 'strategic',
    contentType: 'commercial',
    monetization: 'maximum',
    cpmExpectation: 'peak',
    baseCpmMultiplier: 1.5
  }
};

// Q4 peak events with CPM multipliers
const Q4_PEAK_EVENTS: Record<
  string,
  { startDate: string; endDate: string; cpmMultiplier: number }
> = {
  'Black Friday': {
    startDate: '11-20',
    endDate: '11-30',
    cpmMultiplier: 2.5
  },
  'Cyber Monday': {
    startDate: '12-01',
    endDate: '12-03',
    cpmMultiplier: 2.0
  },
  'Christmas': {
    startDate: '12-15',
    endDate: '12-25',
    cpmMultiplier: 2.0
  },
  'New Year': {
    startDate: '12-28',
    endDate: '01-05',
    cpmMultiplier: 1.8
  }
};

// Topic optimization angles by season
const SEASONAL_ANGLES: Record<
  'Q1' | 'Q2' | 'Q3' | 'Q4',
  Record<string, string[]>
> = {
  Q1: {
    tech: ['new year tech setup', 'productivity tools', 'goal tracking apps'],
    business: ['yearly planning', 'tax preparation', 'budget optimization'],
    lifestyle: ['new year resolutions', 'fitness goals', 'habit building'],
    default: ['getting started', 'beginner guides', 'fundamentals']
  },
  Q2: {
    tech: ['spring cleaning digital', 'new releases', 'upgrade guides'],
    business: ['Q2 strategies', 'summer planning', 'team productivity'],
    lifestyle: ['spring fitness', 'outdoor activities', 'travel prep'],
    default: ['trends', 'what\'s new', 'updates']
  },
  Q3: {
    tech: ['back to school tech', 'fall setup', 'productivity boost'],
    business: ['Q4 preparation', 'holiday strategy', 'year-end planning'],
    lifestyle: ['back to routine', 'fall goals', 'preparation'],
    default: ['advanced techniques', 'optimization', 'improvements']
  },
  Q4: {
    tech: ['gift guides', 'deals roundup', 'holiday tech'],
    business: ['year in review', 'next year planning', 'holiday sales'],
    lifestyle: ['holiday preparation', 'gift ideas', 'celebrations'],
    default: ['best of year', 'top picks', 'recommendations']
  }
};

/**
 * Plans content calendar based on seasonal monetization patterns
 */
export class SeasonalPlanner {
  /**
   * Get the current quarter
   */
  getCurrentQuarter(): 'Q1' | 'Q2' | 'Q3' | 'Q4' {
    const month = new Date().getMonth() + 1;
    if (month <= 3) return 'Q1';
    if (month <= 6) return 'Q2';
    if (month <= 9) return 'Q3';
    return 'Q4';
  }

  /**
   * Get current quarter's strategy
   */
  getCurrentStrategy(): (typeof SEASONAL_STRATEGY)['Q1'] & { quarter: string } {
    const quarter = this.getCurrentQuarter();
    return { ...SEASONAL_STRATEGY[quarter], quarter };
  }

  /**
   * Plan content calendar for a date range
   */
  planContentCalendar(
    topics: string[],
    startDate: Date,
    endDate: Date,
    contentType?: string
  ): ContentPlan[] {
    const plans: ContentPlan[] = [];
    const currentDate = new Date(startDate);

    let topicIndex = 0;

    while (currentDate <= endDate && topicIndex < topics.length) {
      const quarter = this.getQuarterForDate(currentDate);
      const strategy = SEASONAL_STRATEGY[quarter];

      // Calculate frequency based on strategy
      const daysToNext = this.getDaysToNextVideo(strategy.videoFrequency);

      // Get seasonal angle
      const angle = this.getSeasonalAngle(
        topics[topicIndex] ?? '',
        quarter,
        contentType
      );

      // Calculate CPM multiplier
      const cpmMultiplier = this.getCpmMultiplierForDate(
        currentDate,
        quarter
      );

      // Determine priority
      const priority = this.calculatePriority(currentDate, cpmMultiplier);

      plans.push({
        topic: topics[topicIndex] ?? '',
        scheduled_date: currentDate.toISOString(),
        quarter,
        content_type: strategy.contentType,
        priority,
        seasonal_angle: angle,
        estimated_cpm_multiplier: cpmMultiplier
      });

      // Move to next date
      currentDate.setDate(currentDate.getDate() + daysToNext);
      topicIndex++;
    }

    logger.info('Content calendar planned', {
      totalPlans: plans.length,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });

    return plans;
  }

  /**
   * Get quarter for a specific date
   */
  private getQuarterForDate(date: Date): 'Q1' | 'Q2' | 'Q3' | 'Q4' {
    const month = date.getMonth() + 1;
    if (month <= 3) return 'Q1';
    if (month <= 6) return 'Q2';
    if (month <= 9) return 'Q3';
    return 'Q4';
  }

  /**
   * Get days to next video based on frequency
   */
  private getDaysToNextVideo(
    frequency: 'high' | 'medium' | 'strategic'
  ): number {
    switch (frequency) {
      case 'high':
        return 2; // Every 2 days
      case 'medium':
        return 4; // Every 4 days
      case 'strategic':
        return 7; // Weekly, timed for events
    }
  }

  /**
   * Optimize topic with seasonal angle
   */
  optimizeForSeason(topic: string, contentType?: string): {
    originalTopic: string;
    seasonalAngle: string;
    suggestedTitle: string;
    cpmMultiplier: number;
  } {
    const quarter = this.getCurrentQuarter();
    const angle = this.getSeasonalAngle(topic, quarter, contentType);
    const multiplier = this.getCpmMultiplierForDate(new Date(), quarter);

    return {
      originalTopic: topic,
      seasonalAngle: angle,
      suggestedTitle: `${angle}: ${topic}`,
      cpmMultiplier: multiplier
    };
  }

  /**
   * Get seasonal angle for a topic
   */
  private getSeasonalAngle(
    topic: string,
    quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4',
    contentType?: string
  ): string {
    const angles = SEASONAL_ANGLES[quarter];
    const type = contentType?.toLowerCase() || 'default';

    const availableAngles = angles[type] || angles['default'] || ['general'];
    const randomIndex = Math.floor(Math.random() * availableAngles.length);

    return availableAngles[randomIndex] ?? 'general';
  }

  /**
   * Get CPM multiplier for a specific date
   */
  private getCpmMultiplierForDate(
    date: Date,
    quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4'
  ): number {
    const baseMultiplier = SEASONAL_STRATEGY[quarter].baseCpmMultiplier;

    // Check for Q4 peak events
    if (quarter === 'Q4') {
      const dateStr = this.formatDateForComparison(date);

      for (const [eventName, event] of Object.entries(Q4_PEAK_EVENTS)) {
        if (this.isDateInRange(dateStr, event.startDate, event.endDate)) {
          logger.debug('Date falls within peak event', {
            date: dateStr,
            event: eventName,
            multiplier: event.cpmMultiplier
          });
          return event.cpmMultiplier;
        }
      }
    }

    return baseMultiplier;
  }

  /**
   * Format date for comparison (MM-DD format)
   */
  private formatDateForComparison(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}-${day}`;
  }

  /**
   * Check if date is in range (handles year boundary)
   */
  private isDateInRange(
    dateStr: string,
    startStr: string,
    endStr: string
  ): boolean {
    // Simple comparison for same-year ranges
    if (startStr <= endStr) {
      return dateStr >= startStr && dateStr <= endStr;
    }
    // Handle year boundary (e.g., New Year: 12-28 to 01-05)
    return dateStr >= startStr || dateStr <= endStr;
  }

  /**
   * Calculate content priority based on timing
   */
  private calculatePriority(
    date: Date,
    cpmMultiplier: number
  ): 'high' | 'medium' | 'low' {
    if (cpmMultiplier >= 2.0) return 'high';
    if (cpmMultiplier >= 1.0) return 'medium';
    return 'low';
  }

  /**
   * Get upcoming peak events
   */
  getUpcomingPeakEvents(
    daysAhead: number = 30
  ): Array<{ name: string; startDate: string; cpmMultiplier: number }> {
    const today = new Date();
    const futureDate = new Date(today);
    futureDate.setDate(today.getDate() + daysAhead);

    const events: Array<{
      name: string;
      startDate: string;
      cpmMultiplier: number;
    }> = [];

    for (const [name, event] of Object.entries(Q4_PEAK_EVENTS)) {
      events.push({
        name,
        startDate: event.startDate,
        cpmMultiplier: event.cpmMultiplier
      });
    }

    return events;
  }

  /**
   * Get content recommendations for current period
   */
  getContentRecommendations(): {
    focusArea: string;
    recommendedContentType: string;
    monetizationStrategy: string;
    keyTips: string[];
  } {
    const strategy = this.getCurrentStrategy();

    const tips: Record<string, string[]> = {
      Q1: [
        'Build your content library with evergreen topics',
        'Focus on tutorials and how-to content',
        'CPMs are lowest - optimize for views over revenue',
        'Establish regular upload schedule'
      ],
      Q2: [
        'Capitalize on trending topics',
        'Build subscriber base for Q4',
        'Test different content formats',
        'Engage with audience for feedback'
      ],
      Q3: [
        'Optimize best-performing content',
        'Prepare Q4 content backlog',
        'Focus on retention optimization',
        'Build email list for product launches'
      ],
      Q4: [
        'Maximize commercial content',
        'Time uploads around shopping events',
        'Include affiliate/sponsor content',
        'Focus on high-converting topics'
      ]
    };

    return {
      focusArea: strategy.focus,
      recommendedContentType: strategy.contentType,
      monetizationStrategy: strategy.monetization,
      keyTips: tips[strategy.quarter] || []
    };
  }
}
