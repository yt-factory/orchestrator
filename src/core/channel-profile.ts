import { z } from 'zod';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger';

// ============================================
// Channel Profile Schema
// ============================================

export const ChannelProfileSchema = z.object({
  channel_id: z.string(),
  channel_name: z.string(),
  tagline: z.string().max(200),
  niche: z.string(),
  primary_language: z.enum(['en', 'zh', 'es', 'ja', 'de']),
  secondary_languages: z.array(z.string()).default([]),

  audience: z.object({
    demographics: z.string(),
    knowledge_level: z.enum(['beginner', 'intermediate', 'advanced', 'mixed']),
    pain_points: z.array(z.string()).max(5),
    aspirations: z.array(z.string()).max(5)
  }),

  voice: z.object({
    tone: z.array(z.string()).max(5),
    vocabulary_level: z.enum(['simple', 'conversational', 'technical', 'academic']),
    example_phrases: z.array(z.string()).max(5),
    forbidden_words: z.array(z.string()).default([]),
    perspective: z.enum(['first_person', 'second_person', 'third_person', 'mixed'])
  }),

  quality: z.object({
    min_segment_count: z.number().default(5),
    max_filler_ratio: z.number().default(0.05),
    required_elements: z.array(z.string()).default([]),
    title_style: z.enum(['clickbait', 'informative', 'provocative', 'minimal']).default('informative'),
    min_confidence_score: z.number().min(1).max(10).default(7)
  }),

  content_formats: z.array(z.object({
    format_id: z.string(),
    name: z.string(),
    structure: z.string(),
    example_topics: z.array(z.string()).max(3)
  })).default([]),

  seo: z.object({
    target_regions: z.array(z.string()).default(['en']),
    keyword_style: z.enum(['trending', 'evergreen', 'mixed']).default('mixed'),
    title_patterns: z.array(z.string()).default([]),
    avoid_patterns: z.array(z.string()).default([])
  }).default({
    target_regions: ['en'],
    keyword_style: 'mixed' as const,
    title_patterns: [],
    avoid_patterns: []
  })
});

// ============================================
// Type Exports
// ============================================

export type ChannelProfile = z.infer<typeof ChannelProfileSchema>;

// ============================================
// Default Profile
// ============================================

const DEFAULT_PROFILE: ChannelProfile = {
  channel_id: 'default',
  channel_name: 'YT-Factory Default',
  tagline: 'Making technology accessible for everyone',
  niche: 'technology and education',
  primary_language: 'en',
  secondary_languages: [],
  audience: {
    demographics: '25-45 tech professionals and enthusiasts',
    knowledge_level: 'mixed',
    pain_points: [
      'Keeping up with rapidly changing technology',
      'Finding reliable and unbiased tech information',
      'Bridging the gap between theory and practice'
    ],
    aspirations: [
      'Stay ahead of industry trends',
      'Build practical skills with new tools',
      'Make informed technology decisions'
    ]
  },
  voice: {
    tone: ['informative', 'conversational', 'approachable'],
    vocabulary_level: 'conversational',
    example_phrases: [
      'Here is what you need to know',
      'Let me break this down',
      'The key takeaway is'
    ],
    forbidden_words: [],
    perspective: 'second_person'
  },
  quality: {
    min_segment_count: 5,
    max_filler_ratio: 0.05,
    required_elements: ['introduction', 'key_points', 'summary'],
    title_style: 'informative',
    min_confidence_score: 7
  },
  content_formats: [
    {
      format_id: 'tutorial',
      name: 'Step-by-Step Tutorial',
      structure: 'intro > problem > steps > recap',
      example_topics: ['How to set up X', 'Getting started with Y']
    },
    {
      format_id: 'explainer',
      name: 'Concept Explainer',
      structure: 'hook > context > deep-dive > takeaway',
      example_topics: ['What is X and why it matters', 'X explained in 10 minutes']
    }
  ],
  seo: {
    target_regions: ['en'],
    keyword_style: 'mixed',
    title_patterns: [
      '{Topic}: What You Need to Know in {Year}',
      'How to {Action} with {Tool} (Step-by-Step)'
    ],
    avoid_patterns: [
      'YOU WONT BELIEVE',
      'SHOCKING'
    ]
  }
};

// ============================================
// Channel Profile Manager
// ============================================

export class ChannelProfileManager {
  private readonly channelsDir: string;
  private readonly projectsDir: string;

  constructor(
    channelsDir: string = './channels',
    projectsDir: string = './active_projects'
  ) {
    this.channelsDir = channelsDir;
    this.projectsDir = projectsDir;
  }

  /**
   * Load a channel profile by channel ID.
   * Falls back to the default profile if the file is missing or invalid.
   */
  async load(channelId: string): Promise<ChannelProfile> {
    const profilePath = join(this.channelsDir, channelId, 'profile.json');

    try {
      const raw = await readFile(profilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const profile = ChannelProfileSchema.parse(parsed);

      logger.info('Channel profile loaded', {
        channelId,
        channelName: profile.channel_name,
        path: profilePath
      });

      return profile;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;

      if (err.code === 'ENOENT') {
        logger.warn('Channel profile not found, using default', {
          channelId,
          path: profilePath
        });
      } else {
        logger.error('Failed to load channel profile, using default', {
          channelId,
          path: profilePath,
          error: (error as Error).message
        });
      }

      return this.getDefaultProfile();
    }
  }

  /**
   * Load a channel profile for a specific project.
   * Checks for a project-level override first, then falls back to `load('default')`.
   */
  async loadForProject(projectId: string): Promise<ChannelProfile> {
    const projectProfilePath = join(
      this.projectsDir,
      projectId,
      'channel-profile.json'
    );

    try {
      const raw = await readFile(projectProfilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const profile = ChannelProfileSchema.parse(parsed);

      logger.info('Project-level channel profile loaded', {
        projectId,
        channelName: profile.channel_name,
        path: projectProfilePath
      });

      return profile;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;

      if (err.code !== 'ENOENT') {
        logger.warn('Invalid project channel profile, falling back to default', {
          projectId,
          path: projectProfilePath,
          error: (error as Error).message
        });
      }

      return this.load('default');
    }
  }

  /**
   * Returns the built-in default profile for a general tech/education channel.
   */
  getDefaultProfile(): ChannelProfile {
    return { ...DEFAULT_PROFILE };
  }
}
