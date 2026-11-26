export interface ParsedBatchVideoItem {
  id: string;
  url: string;
  title?: string;
  description?: string;
}

function extractSingleUrlMatchAt(
  textSlice: string
): { url: string; consumedLength: number } | null {
  // 1. YouTube watch?v= (11-char ID, handles glued text right after ID)
  const ytWatchMatch =
    /^(https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/watch\?(?:[^\s"'<>]*?&)?v=([a-zA-Z0-9_-]{11}))/i.exec(
      textSlice
    );
  if (ytWatchMatch) {
    let consumed = ytWatchMatch[0].length;
    const remainder = textSlice.slice(consumed);
    const trailingParams = /^(?:&[a-zA-Z0-9_]+=[a-zA-Z0-9_.-]*)+/.exec(remainder);
    if (trailingParams) {
      consumed += trailingParams[0].length;
    }
    return {
      url: `https://www.youtube.com/watch?v=${ytWatchMatch[2]}`,
      consumedLength: consumed,
    };
  }

  // 2. YouTube youtu.be / shorts / live / embed (11-char ID)
  const ytShortMatch =
    /^(https?:\/\/(?:www\.|m\.|music\.)?(?:youtu\.be|youtube\.com\/(?:shorts|live|embed))\/([a-zA-Z0-9_-]{11}))/i.exec(
      textSlice
    );
  if (ytShortMatch) {
    let consumed = ytShortMatch[0].length;
    const remainder = textSlice.slice(consumed);
    const trailingQuery = /^\?[a-zA-Z0-9_=&.-]+/.exec(remainder);
    if (trailingQuery) {
      consumed += trailingQuery[0].length;
    }
    return {
      url: `https://www.youtube.com/watch?v=${ytShortMatch[2]}`,
      consumedLength: consumed,
    };
  }

  // 3. YouTube playlist?list= (34-char PL... ID first so glued titles don't merge)
  const ytPlaylistMatch =
    /^(https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/playlist\?list=(PL[a-zA-Z0-9_-]{32}|[a-zA-Z0-9_-]{13,42}))/i.exec(
      textSlice
    );
  if (ytPlaylistMatch) {
    return {
      url: `https://www.youtube.com/playlist?list=${ytPlaylistMatch[2]}`,
      consumedLength: ytPlaylistMatch[0].length,
    };
  }

  // 4. General HTTPS/HTTP URL up to whitespace
  const generalMatch = /^(https?:\/\/[^\s"'<>]+)/i.exec(textSlice);
  if (generalMatch) {
    let raw = generalMatch[1];
    const trimmedPunct = raw.replace(/[.,;!?)]+$/, '');
    raw = trimmedPunct || raw;
    return {
      url: raw,
      consumedLength: raw.length,
    };
  }

  return null;
}

function parseLeadingTitleAndDescription(
  rawSegment: string
): { title?: string; description?: string } {
  let segment = rawSegment.trim();
  if (!segment) return {};

  // Strip trailing "Link:" / "URL:" / "Tautan:" markers right before the URL
  segment = segment.replace(/(?:link|url|tautan)\s*:\s*$/i, '').trim();
  if (!segment) return {};

  // Check for "Deskripsi:" / "Description:" marker (even when glued to title without spaces)
  const descMatch = /(?:deskripsi|description)\s*:\s*/i.exec(segment);
  if (descMatch) {
    const rawTitle = segment.slice(0, descMatch.index).trim();
    const rawDesc = segment
      .slice(descMatch.index + descMatch[0].length)
      .trim();

    const cleanTitle = rawTitle.replace(/^[-•*\d.)\s]+/, '').trim().slice(0, 140);
    const cleanDesc = rawDesc.trim().slice(0, 2000);
    return {
      title: cleanTitle || undefined,
      description: cleanDesc || undefined,
    };
  }

  // If no explicit "Deskripsi:", treat concise single line (non-URL text) as optional title hint
  const lines = segment
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 1 && lines[0].length >= 2 && lines[0].length <= 140) {
    const cleaned = lines[0].replace(/^[-•*\d.)\s]+/, '').trim();
    return cleaned ? { title: cleaned } : {};
  }

  return {};
}

export function parseBatchVideoInput(rawInput: string): ParsedBatchVideoItem[] {
  const input = rawInput.trim();
  if (!input) return [];

  const results: ParsedBatchVideoItem[] = [];
  const seenUrls = new Set<string>();
  const startPattern = /https?:\/\//gi;

  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = startPattern.exec(input)) !== null) {
    const urlStart = match.index;
    if (urlStart < cursor) {
      continue;
    }

    const extracted = extractSingleUrlMatchAt(input.slice(urlStart));
    if (!extracted) {
      continue;
    }

    const leadingSegment = input.slice(cursor, urlStart);
    const meta = parseLeadingTitleAndDescription(leadingSegment);

    cursor = urlStart + extracted.consumedLength;
    startPattern.lastIndex = cursor;

    const dedupeKey = extracted.url.trim();
    if (seenUrls.has(dedupeKey)) {
      const existing = results.find((item) => item.url === dedupeKey);
      if (existing) {
        if (!existing.title && meta.title) existing.title = meta.title;
        if (!existing.description && meta.description) {
          existing.description = meta.description;
        }
      }
      continue;
    }
    seenUrls.add(dedupeKey);

    results.push({
      id: `batch-${results.length + 1}-${Math.random().toString(36).slice(2, 7)}`,
      url: dedupeKey,
      title: meta.title,
      description: meta.description,
    });
  }

  return results;
}
