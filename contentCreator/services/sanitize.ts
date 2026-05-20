/**
 * Client-side mirror of server/src/sanitize.js#sanitizeText.
 *
 * Kept on the client purely as a safety net for cached rows in Supabase
 * that were generated BEFORE the server-side sanitizer was added. New rows
 * coming through the proxy are already clean.
 */

const MARKDOWN_LINK_WITH_OPTIONAL_PARENS_RE =
    /\s*[\(（]?\s*\[[^\]\n]*?\]\((?:https?:\/\/|www\.)[^\s)]+\)\s*[\)）]?/g;
const BARE_URL_RE = /\bhttps?:\/\/[^\s)<>\]]+/g;
const PAREN_SOURCE_RE =
    /\s*[\(（]\s*(?:source|src|cite|ref|จาก|ที่มา|来源|出处|参考|参见|参考資料|参照)\s*[:：]?[^()（）]*[\)）]/gi;

export function sanitizeText(text: string): string {
    if (!text) return text;
    let out = text;
    out = out.replace(MARKDOWN_LINK_WITH_OPTIONAL_PARENS_RE, '');
    out = out.replace(BARE_URL_RE, '');
    out = out.replace(PAREN_SOURCE_RE, '');
    out = out.replace(/[\(（]\s*[\)）]/g, '');
    out = out.replace(/\s+([,.;:!?。，；：！？])/g, '$1');
    out = out.replace(/[ \t]{2,}/g, ' ');
    return out;
}
