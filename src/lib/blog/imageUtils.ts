/**
 * Blog Image Acquisition Utility (Phase 1)
 * Fetches relevant travel images for auto-generated blog posts.
 * Supports multiple angles: city, area_guide, travel_prep, tips, local_experience
 */

export interface ImageFetchOptions {
  city: string;
  angle: string;
  count?: number;
}

const ANGLE_IMAGE_KEYWORDS: Record<string, string[]> = {
  city: ['cityscape', 'skyline', 'urban', 'downtown'],
  area_guide: ['neighborhood', 'street', 'local area', 'district'],
  travel_prep: ['luggage', 'passport', 'travel planning', 'preparation'],
  travel_tips: ['tips', 'advice', 'guide', 'hacks'],
  local_experience: ['culture', 'food', 'experience', 'local life', 'festival']
};

export async function fetchBlogImage(options: ImageFetchOptions): Promise<string | null> {
  const { city, angle } = options;
  const keywords = ANGLE_IMAGE_KEYWORDS[angle] || ['travel'];
  const query = `${city} ${keywords[Math.floor(Math.random() * keywords.length)]} travel`;

  // TODO: Integrate with Unsplash API, Pexels, or Cloudflare Images
  // For now, return placeholder or existing candidate image logic
  // In production, use fetch to Unsplash with API key from env

  console.log(`[BlogImage] Would fetch image for: ${query}`);
  return `https://source.unsplash.com/featured/?${encodeURIComponent(query)}`;
}

export function getRandomAngle(): string {
  const angles = ['city', 'area_guide', 'travel_prep', 'travel_tips', 'local_experience'];
  return angles[Math.floor(Math.random() * angles.length)];
}
