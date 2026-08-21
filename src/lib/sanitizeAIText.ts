// Cleaning up what the concierge model emits before a guest reads it.
//
// The model is asked for Markdown and mostly obliges, but it also produces
// half-formed HTML: an anchor whose opening tag was truncated, a Markdown link
// with a whole <a> tag stuffed into the URL, attributes left stranded after the
// tag they belonged to. Rendered as-is, a guest sees `/hotel/example" target=`
// glued to the label.
//
// This lived inside the chat route, and two dead copies of an older version sat
// in src/utils with the only tests pointing at those — so the copy that runs in
// production had no tests at all, and the tested copy could not fail in a way
// anyone would notice. One copy now, here, and the tests point at it.
export function sanitizeAIText(text: string): string {
  if (!text) return text;

  // 0. Catch ALL Markdown links with HTML-like content in the URL part
  text = text.replace(/\[([^\]]+)\]\(([^)]*?(?:<|"|'|\starget=|\sclass=)[^)]*)\)/g, (_, label, dirtyUrl) => {
    const hotelMatch = dirtyUrl.match(/\/hotel\/[\w-]+/);
    if (hotelMatch) return `[${label}](${hotelMatch[0]})`;
    const httpMatch = dirtyUrl.match(/https?:\/\/[^"'<>\s]+/);
    if (httpMatch) return `[${label}](${httpMatch[0]})`;
    const cleanUrl = dirtyUrl.replace(/[<"'].*$/, '').trim();
    return `[${label}](${cleanUrl})`;
  });

  // 0b. Handle [label](<a href="url" ...>) — AI mixing Markdown links with HTML anchors in URL
  text = text.replace(/\[([^\]]+)\]\(<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>\)/gi, (_, label, href) => `[${label}](${href})`);
  text = text.replace(/\[([^\]]+)\]\(<a[^>]*href="([^"]+)"[^>]*>\)/gi, (_, label, href) => `[${label}](${href})`);

  // 0c. Handle bare /hotel/slug" target="_blank" class="...">Label pattern
  // This fires when <a href=" was already stripped but the rest of the attribute string remains
  //
  // The lookbehind is the point: without it this also matched a perfectly good
  // <a href="/hotel/x">Label</a>, rewrote the part from the slug onwards, and
  // left the tag's own opening stranded — the guest read
  // `<a href="[Label](/hotel/x)`. Rule 1 below is what handles that case, and
  // it never got the chance because this one ran first.
  text = text.replace(/(?<!href=["'])(\/hotel\/[\w-]+)"[^>]*>(.*?)(?=\s*\n|$)/gi, (_, slug, afterText) => {
    const label = afterText.replace(/<[^>]+>/g, '').trim() || 'Book Now';
    return `[${label}](${slug})`;
  });

  // 1. Convert complete <a href="...">label</a> → Markdown [label](href)
  text = text.replace(/<a\s[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const cleanLabel = label.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || href;
    return `[${cleanLabel}](${href})`;
  });

  // 1b. Handle unclosed <a href="..."> tags (no </a>)
  text = text.replace(/<a\s[^>]*?href="([^"]*)"[^>]*>/gi, (_, href) => `[リンク](${href})`);

  // 2. Strip orphaned HTML attribute fragments
  text = text.replace(/[^\s"(]*"?\s*target="_blank"[^>]*>(.*?)(?=\n|$)/gi, (_, after) => after.trim());
  text = text.replace(/"?\s*target="_blank"/gi, '');
  text = text.replace(/\s*class="(?:underline|text-amber|hover:|text-teal|font-)[^"]*"/gi, '');
  text = text.replace(/"\s*>/g, ' ');

  // 3. Convert <strong>/<b> → **text**
  text = text.replace(/<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
  // 4. Convert <em>/<i> → *text*
  text = text.replace(/<(?:em|i)>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*');
  // 5. Convert <br> → newline
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // 6. Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  // 7. Decode common HTML entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  return text.trim();
}
