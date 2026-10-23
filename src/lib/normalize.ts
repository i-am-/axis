// Place-name normalisation, shared by the index builder
// (scripts/build-places.ts) and the search on the page, so both fold a name
// the same way.

// letters that carry no combining mark to strip
const PLAIN: Record<string, string> = {
  ø: 'o', Ø: 'o', ł: 'l', Ł: 'l', đ: 'd', Đ: 'd', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe',
  ı: 'i', þ: 'th', Þ: 'th', ð: 'd', Ð: 'd',
};

// "Sant Julià de Lòria", "SANT-JULIA DE LORIA" and "sant julia de loria" are
// one key: case folded, accents stripped, punctuation turned into single
// spaces. Scripts without case or accents pass through unchanged.
export function normalize(s: string) {
  return s
    .replace(/[øØłŁđĐæÆœŒıþÞðÐ]/g, (c) => PLAIN[c])
    .normalize('NFKD').replace(/\p{Mn}/gu, '').normalize('NFC')
    .toUpperCase().toLowerCase()      // folds ß to ss and final ς to σ
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

// how much of a name a query must give: one character in scripts where a
// character is a syllable or a word, two elsewhere
export const minQueryLength = (q: string) =>
  /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/u.test(q) ? 1 : 2;

// a shard's file name: its leading characters as hex code points, "73-61"
export const shardName = (prefix: string) =>
  [...prefix].map((c) => c.codePointAt(0)!.toString(16)).join('-');
