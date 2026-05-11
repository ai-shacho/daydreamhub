export function sanitizeAIText(text: string): string {
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
