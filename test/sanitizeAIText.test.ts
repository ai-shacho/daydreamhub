import { describe, test, expect } from '@jest/globals';

function sanitizeAIText(text: string): string {
  if (!text) return text;

  // Directly clean <a> tags and turn them into Markdown links
  text = text.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, (_, href, label) => {
    const cleanLabel = label.replace(/<[^>]+>/g, '').trim();
    return `[${cleanLabel || href}](${href})`;
  });

  // Catch variations of HTML in Markdown URLs or as fragments
  text = text.replace(/\[([^\]]+)\]\(<a[^>]*href="([^\"]+)"[^>]*>[\s\S]*?<\/a>\)/gi, (_, label, href) => `[${label.trim()}](${href})`);
  text = text.replace(/\[([^\]]+)\]\(<a[^>]*href="([^\"]+)"[^>]*>\)/gi, (_, label, href) => `[${label.trim()}](${href})`);
  text = text.replace(/[\s"]*target="[_blank]*[\s"]+>.*(?=\n|$)/gi, (_, after) => after.trim());  
  text = text.replace(/[\s"]*target="[\s"]*"?[^>]+"?\s*[^>]*>/gi, '');
  text = text.replace(/\s*class="[^"]*(?:underline|text-teal|hover:|[a-z-]+)"[^>]*>/gi, '');
  text = text.replace(/">/g, ' ');

  // Convert strong or b to bold
  text = text.replace(/<(?:strong|b)>(.*?)<\/(?:strong|b)>/gi, '**$1**');

  // Convert em or i to italics
  text = text.replace(/<(?:em|i)>(.*?)<\/(?:em|i)>/gi, '*$1*');

  // Convert <br> to newlines
  text = text.replace(/<br\/*>/gi, '\n');

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  return text.trim();
}

describe('sanitizeAIText', () => {
  test('should convert HTML <a> tags to markdown links', () => {
    const input = '<a href="/hotel/example">Book Now</a>';
    const result = sanitizeAIText(input);
    expect(result).toBe('[Book Now](/hotel/example)');
  });

  test('should remove orphan HTML attributes', () => {
    const input = '/hotel/example" target="_blank" class="underline">Book Now'
    const result = sanitizeAIText(input);
    expect(result).toBe('Book Now');
  });

  test('should preserve simple markdown links', () => {
    const input = '[Book Now](/hotel/example)';
    const result = sanitizeAIText(input);
    expect(result).toBe('[Book Now](/hotel/example)');
  });

  test('should handle HTML entities', () => {
    const input = '&lt;div&gt;Test&lt;/div&gt;';
    const result = sanitizeAIText(input);
    expect(result).toBe('<div>Test</div>');
  });

  test('should convert bold HTML to markdown', () => {
    const input = '<strong>Important</strong>'; 
    const result = sanitizeAIText(input);
    expect(result).toBe('**Important**');
  });
});