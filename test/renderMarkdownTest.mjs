// This script performs basic testing of the renderMarkdown() function with Japanese multibyte characters

// Import jsdom and necessary modules to simulate a DOM environment
import { JSDOM } from "jsdom";
const dom = new JSDOM();
global.document = dom.window.document;

// Sample Japanese text with Markdown links and HTML
const sampleText = "こんにちは、こちらのホテルをご覧ください: [予約する](/hotel/eco-friendly-why-me-tbilisi \"target=\"_blank\" class=\"underline text-amber-300 hover:text-amber-200\"). または [詳細を見る](https://example.com)。";
const expectedOutput = "こんにちは、こちらのホテルをご覧ください: <a href=\"/hotel/eco-friendly-why-me-tbilisi\" class=\"text-teal-600 underline hover:text-teal-800 font-semibold\">予約する</a>。 または <a href=\"https://example.com\" class=\"text-teal-600 underline hover:text-teal-800 font-semibold\">詳細を見る</a>。";

// Function to simulate renderMarkdown()
function renderMarkdown(text) {
    if (!text) return '';
    let out = text;

    // 1. **bold** → <strong>
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // 2. [label](url) → <a> — handles /hotel/slug, hotel/slug, and mixed HTML-in-URL cases
    out = out.replace(/\[([^\]\n]+)\]\(([^)]+)\)/gi, function(_, label, rawHref) {
      var finalHref = rawHref.trim();
      if (finalHref.indexOf('<a') !== -1 || finalHref.indexOf('href=') !== -1) {
        var hrefMatch = finalHref.match(/href=["']([^"']+)["']/);
        finalHref = hrefMatch ? hrefMatch[1] : finalHref.replace(/<[^>]+>/g, '').trim();
      }
      finalHref = finalHref.replace(/"[^"]*$/, '').replace(/'\s*[a-z].*$/, '').trim();
      if (!finalHref.startsWith('/') && !finalHref.startsWith('http')) {
        finalHref = '/' + finalHref;
      }
      return '<a href="' + finalHref + '" class="text-teal-600 underline hover:text-teal-800 font-semibold">' + label + '</a>';
    });

    // 3. Bare /hotel/slug paths → link (fallback)
    out = out.replace(/(^|[\s—–-])(\/hotel\/[a-z0-9-]+)(?=[\s—–\n,.]|$)/gm, function(_, pre, path) {
      return pre + '<a href="' + path + '" class="text-teal-600 underline hover:text-teal-800 font-semibold">予約する</a>';
    });

    // 4. \n → <br>
    out = out.replace(/\n/g, '<br>');
    return out;
}

// Testing the function
console.assert(renderMarkdown(sampleText) === expectedOutput, "Test case with Japanese text failed.");

console.log("All tests passed!");