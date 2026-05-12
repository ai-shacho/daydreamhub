// A utility function to sanitize AI responses by removing HTML tags.
// This will ensure no HTML tags are visible in the AI's text output.

/**
 * Sanitizes a given text by removing HTML tags.
 * @param {string} text - The text to sanitize.
 * @returns {string} - The sanitized text with HTML tags removed.
 */
function sanitizeAIText(text) {
  return text.replace(/<[^>]*>?/gm, '');
}

export const sanitizeAIText = sanitizeAIText;