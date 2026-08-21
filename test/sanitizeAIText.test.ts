/**
 * The concierge's output cleaner.
 *
 * This file used to carry its own copy of sanitizeAIText, pasted in above the
 * assertions, and two more copies sat unused in src/utils. The one the guest
 * actually sees was a fourth, written inline in the chat route — untested, and
 * unreachable from here. The failing assertion below was measuring a copy that
 * no longer ran anywhere.
 *
 * There is one implementation now and this imports it.
 */

import { describe, it, expect } from '@jest/globals';
import { sanitizeAIText } from '../src/lib/sanitizeAIText';

describe('sanitizeAIText', () => {
  it('turns an anchor into a markdown link', () => {
    expect(sanitizeAIText('<a href="/hotel/example">Book Now</a>')).toBe('[Book Now](/hotel/example)');
  });

  it('rescues a link whose opening tag was lost', () => {
    // What the model emits when the <a href=" is truncated away. Left alone the
    // guest reads `/hotel/example" target="_blank" class="underline">Book Now`.
    const result = sanitizeAIText('/hotel/example" target="_blank" class="underline">Book Now');
    expect(result).toBe('[Book Now](/hotel/example)');
    expect(result).not.toContain('target=');
    expect(result).not.toContain('class=');
  });

  it('leaves a well-formed markdown link alone', () => {
    expect(sanitizeAIText('[Book Now](/hotel/example)')).toBe('[Book Now](/hotel/example)');
  });

  it('pulls the real url out of a markdown link stuffed with html', () => {
    expect(sanitizeAIText('[Book Now](/hotel/example" target="_blank")')).toBe('[Book Now](/hotel/example)');
  });

  it('decodes html entities', () => {
    expect(sanitizeAIText('&lt;div&gt;Test&lt;/div&gt;')).toBe('<div>Test</div>');
  });

  it('converts bold to markdown', () => {
    expect(sanitizeAIText('<strong>Important</strong>')).toBe('**Important**');
  });

  // Carried over from src/utils/sanitizeAIText.test.js, which could not run at
  // all — a .js file using ESM import with no babel config — and was testing a
  // copy of the function that nothing imported.
  it('strips every remaining html tag', () => {
    const result = sanitizeAIText('<p>This is a <em>plain</em> sentence.</p>');
    expect(result).not.toContain('<p>');
    expect(result).toContain('sentence.');
  });

  it('leaves text with no html untouched', () => {
    expect(sanitizeAIText('Just a normal sentence.')).toBe('Just a normal sentence.');
  });

  it('handles an empty string', () => {
    expect(sanitizeAIText('')).toBe('');
  });
});
