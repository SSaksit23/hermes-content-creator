/**
 * Output sanitizer: strips inline source citations from generated content.
 *
 * The prompt in prompts.js explicitly forbids inline URL citations, but the
 * model occasionally still emits them. This module is the belt-and-braces
 * safety net so the user-facing output never contains:
 *   - Markdown links:           [label](https://example.com)
 *   - Bare URLs:                https://example.com
 *   - Parenthetical citations:  (source: chinadaily.com)
 *
 * Used in two flavours:
 *   - `sanitizeText(text)`   for the non-streaming JSON path.
 *   - `createStreamSanitizer({ flush })` for NDJSON streaming, which buffers
 *     a tail window so a Markdown link split across two SSE chunks still
 *     gets stripped before it reaches the client.
 */

const MARKDOWN_LINK_RE = /\[([^\]\n]*?)\]\((?:https?:\/\/|www\.)[^\s)]+\)/g;
const BARE_URL_RE = /\bhttps?:\/\/[^\s)<>\]]+/g;
const PAREN_SOURCE_RE =
  /\s*[\(（]\s*(?:source|src|cite|ref|จาก|ที่มา|来源|出处|参考|参见|参考資料|参照)\s*[:：]?[^()（）]*[\)）]/gi;

export function sanitizeText(text) {
  if (!text) return text;
  let out = text;
  // Drop entire `[label](url)` — label is part of the citation, not real prose.
  // Also swallow an optional outer `(...)` wrapper, e.g. `([ChinaDaily](https://...))`,
  // and any leading whitespace so we don't leave a dangling space before punctuation.
  out = out.replace(
    /\s*[\(（]?\s*\[[^\]\n]*?\]\((?:https?:\/\/|www\.)[^\s)]+\)\s*[\)）]?/g,
    "",
  );
  // Strip any remaining bare URLs.
  out = out.replace(BARE_URL_RE, "");
  // Strip parenthetical "(source: ...)" attributions in any of the supported languages.
  out = out.replace(PAREN_SOURCE_RE, "");
  //   "ข้อความ ()."  ->  "ข้อความ."
  out = out.replace(/[\(（]\s*[\)）]/g, "");
  //   "ข้อความ  ."  ->  "ข้อความ."
  out = out.replace(/\s+([,.;:!?。，；：！？])/g, "$1");
  //   collapse runs of internal spaces (but keep newlines intact)
  out = out.replace(/[ \t]{2,}/g, " ");
  return out;
}

/**
 * Streaming sanitizer. The tricky part is that a Markdown link like
 * `[label](https://example.com)` can arrive split across two `delta` chunks,
 * e.g. delta1 ends with `[label](https://exa` and delta2 starts with
 * `mple.com) more text`. To handle this we keep a small tail buffer; we
 * only flush characters once we are sure no in-progress citation could be
 * extended into them.
 *
 * Strategy: hold back everything from the last `[` or `http` (whichever is
 * earliest and unclosed) onwards, capped at TAIL_MAX so we never stall the
 * stream indefinitely on bad model output.
 *
 * @param {{ flush: (text: string) => void }} opts
 * @returns {{ push: (delta: string) => void, end: () => void }}
 */
export function createStreamSanitizer({ flush }) {
  const TAIL_MAX = 512;
  let buf = "";

  function findHoldStart(s) {
    let earliest = -1;
    // Unclosed Markdown link: last `[` with no matching `)` after it.
    const lastOpenBracket = s.lastIndexOf("[");
    if (lastOpenBracket !== -1) {
      const tail = s.slice(lastOpenBracket);
      const closed = /\]\([^)]*\)/.test(tail);
      if (!closed) earliest = lastOpenBracket;
    }
    // Bare URL fragment that hasn't terminated yet.
    const httpIdx = Math.max(s.lastIndexOf("http://"), s.lastIndexOf("https://"));
    if (httpIdx !== -1) {
      const tail = s.slice(httpIdx);
      const terminated = /https?:\/\/\S+?[\s)<>\]]/.test(tail);
      if (!terminated) {
        if (earliest === -1 || httpIdx < earliest) earliest = httpIdx;
      }
    }
    // Walk backwards to include a citation wrapper like " ([" so the leading
    // "(" and the space before it don't get flushed before the link arrives.
    if (earliest > 0) {
      let i = earliest;
      while (i > 0 && /[\s\(（]/.test(s[i - 1])) i--;
      earliest = i;
    }
    return earliest;
  }

  return {
    push(delta) {
      if (!delta) return;
      buf += delta;

      let holdFrom = findHoldStart(buf);
      // Cap how long we'll wait — if the model wrote 512+ chars without closing
      // a link, just give up and flush so the user isn't staring at a frozen UI.
      if (holdFrom !== -1 && buf.length - holdFrom > TAIL_MAX) {
        holdFrom = -1;
      }

      const safeUpTo = holdFrom === -1 ? buf.length : holdFrom;
      if (safeUpTo > 0) {
        const safe = buf.slice(0, safeUpTo);
        buf = buf.slice(safeUpTo);
        const cleaned = sanitizeText(safe);
        if (cleaned) flush(cleaned);
      }
    },
    end() {
      if (buf.length === 0) return;
      const cleaned = sanitizeText(buf);
      buf = "";
      if (cleaned) flush(cleaned);
    },
  };
}
