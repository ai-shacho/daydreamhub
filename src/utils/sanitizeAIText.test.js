import { sanitizeAIText } from './sanitizeAIText';

describe('sanitizeAIText', () => {
  it('should remove all HTML tags from text', () => {
    const text = '<p>This is a <strong>strong</strong> sentence with <a href="#">a link</a>.</p>';
    const result = sanitizeAIText(text);
    expect(result).toBe('This is a strong sentence with a link.');
  });

  it('should return the same text if no HTML tags are present', () => {
    const text = 'This is a plain text.';
    const result = sanitizeAIText(text);
    expect(result).toBe('This is a plain text.');
  });

  it('should handle empty strings', () => {
    const text = '';
    const result = sanitizeAIText(text);
    expect(result).toBe('');
  });
});