#!/bin/bash
# Step 1: Fetch all blog post slugs and scrape content to local JSON files
WORKDIR="/Users/byaoluajnicreo/Desktop/daydreamhub"
OUTDIR="$WORKDIR/scripts/blog-cache"
mkdir -p "$OUTDIR"

# Get slugs from DB
echo "Getting slugs..."
npx wrangler d1 execute daydreamhub-db --remote \
  --command "SELECT id, slug FROM blog_posts WHERE length(content) = 0 OR content IS NULL ORDER BY id" \
  --cwd "$WORKDIR" 2>/dev/null | python3 -c "
import sys, json, re
text = sys.stdin.read()
m = re.search(r'\[.*\]', text, re.DOTALL)
if m:
    data = json.loads(m.group())
    for r in data[0]['results']:
        print(r['id'], r['slug'])
" > "$OUTDIR/slugs.txt"

COUNT=$(wc -l < "$OUTDIR/slugs.txt")
echo "Fetching $COUNT posts..."

DONE=0
while IFS=' ' read -r ID SLUG; do
    OUTFILE="$OUTDIR/${ID}.html"
    if [ -f "$OUTFILE" ] && [ -s "$OUTFILE" ]; then
        DONE=$((DONE+1))
        continue
    fi
    curl -sk --max-time 10 -A "Mozilla/5.0" \
        "https://daydreamhub.pages.dev/blog/$SLUG" > "$OUTFILE" 2>/dev/null
    DONE=$((DONE+1))
    if [ $((DONE % 20)) -eq 0 ]; then
        echo "Progress: $DONE/$COUNT"
    fi
    sleep 0.1
done < "$OUTDIR/slugs.txt"

echo "Fetch complete: $DONE files in $OUTDIR"
