/**
 * LLM Article Generation Module (Phase 1)
 * Hybrid theme system + multi-angle random rotation for diverse blog content.
 *
 * - Default: AI auto-determines theme (city/season/trending)
 * - Override: If admin sets "favorite_theme", prioritize it
 * - Angles: city, area_guide, travel_prep, travel_tips, local_experience (rotated randomly)
 */

import { getRandomAngle } from './imageUtils';

export interface GenerateArticleInput {
  city: string;
  favoriteTheme?: string | null; // from admin setting
  previousAngles?: string[];
}

export interface GenerateArticleResult {
  title: string;
  titleJa: string;
  excerpt: string;
  content: string;
  contentJa: string;
  selectedAngle: string;
  themeSource: 'ai' | 'manual';
  promptUsed: string;
}

const ANGLES = ['city', 'area_guide', 'travel_prep', 'travel_tips', 'local_experience'] as const;

function pickAngle(previousAngles: string[] = []): string {
  // Simple rotation to ensure diversity
  const available = ANGLES.filter(a => !previousAngles.includes(a));
  if (available.length === 0) return ANGLES[Math.floor(Math.random() * ANGLES.length)];
  return available[Math.floor(Math.random() * available.length)];
}

function buildPrompt(city: string, angle: string, favoriteTheme?: string): string {
  const base = `Write a high-quality, SEO-optimized travel blog post about ${city}.`;
  const anglePrompts: Record<string, string> = {
    city: `Focus on the overall vibe, best neighborhoods, and why ${city} is worth visiting right now.`,
    area_guide: `Provide a detailed area-by-area guide with hidden gems and local recommendations.`,
    travel_prep: `Cover practical preparation tips: what to pack, best time to visit, visa info, and transportation.`,
    travel_tips: `Share actionable on-the-ground tips: money-saving hacks, safety, etiquette, and local transport.`,
    local_experience: `Highlight authentic local experiences: food scenes, cultural activities, festivals, and day trips.`
  };

  let prompt = `${base} ${anglePrompts[angle] || ''}`;
  if (favoriteTheme) {
    prompt += ` Prioritize the theme: "${favoriteTheme}". Make it the central focus.`;
  }
  prompt += ` Write in engaging, conversational tone. Include 800-1200 words. Output in JSON: {title, title_ja, excerpt, content, content_ja}`;
  return prompt;
}

export async function generateBlogArticle(input: GenerateArticleInput, claudeClient: any): Promise<GenerateArticleResult> {
  const { city, favoriteTheme, previousAngles = [] } = input;

  const themeSource: 'ai' | 'manual' = favoriteTheme ? 'manual' : 'ai';
  const selectedAngle = favoriteTheme ? pickAngle(previousAngles) : pickAngle(previousAngles); // still rotate angles

  const prompt = buildPrompt(city, selectedAngle, favoriteTheme);

  // TODO: Call actual Claude API via existing claude.ts wrapper or direct
  // For Phase 1 skeleton, simulate structured output
  const mockResult: GenerateArticleResult = {
    title: `${city} ${selectedAngle.replace('_', ' ')} Guide 2026`,
    titleJa: `${city} ${selectedAngle} ガイド`,
    excerpt: `Discover the best of ${city} through our ${selectedAngle} perspective.`,
    content: `Full English content generated for angle: ${selectedAngle}...`,
    contentJa: `日本語コンテンツ（${selectedAngle}視点）`,
    selectedAngle,
    themeSource,
    promptUsed: prompt
  };

  return mockResult;
}
