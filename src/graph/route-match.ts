// Shared segment-matching used both to resolve a static-pass target string
// against the route inventory, and to fold a live crawl's concrete URLs
// (real project slugs, real post ids) back onto the same route patterns so
// the two graphs merge onto identical node identities instead of treating
// "/lumen/settings" and "/[project]/settings" as unrelated screens.
export function normalizeRoutePattern(pattern: string): string {
  return pattern
    .split("/")
    .map((seg) => (seg.startsWith("[") ? "*" : seg))
    .join("/");
}

/** Picks the MOST SPECIFIC matching pattern - the one with the most literal
 *  (non-wildcard) segments matching the input - not just the first candidate
 *  that matches at all. A naive "literal-only pass, then any-wildcard-ok
 *  pass" gets this wrong for patterns that mix literal and dynamic segments:
 *  "/sip/studio/new" (3 segments) matches BOTH "/[project]/studio/new"
 *  (2 literal segments: studio, new) and "/[project]/studio/[id]" (1
 *  literal segment: studio) - neither is "all literal," so a two-pass
 *  approach can't tell them apart and returns whichever happens to iterate
 *  first. Scoring by literal-segment count picks the right one every time,
 *  and still correctly prefers "/login" (1/1 literal) over "/[project]"
 *  (0/1 literal) for a one-segment path. */
export function matchPathToPattern(path: string, patterns: string[]): string | null {
  const segments = path.split("/").filter(Boolean);
  let best: { pattern: string; literalMatches: number } | null = null;

  for (const pattern of patterns) {
    const patternSegments = normalizeRoutePattern(pattern).split("/").filter(Boolean);
    if (patternSegments.length !== segments.length) continue;

    let matches = true;
    let literalMatches = 0;
    for (let i = 0; i < patternSegments.length; i++) {
      const seg = patternSegments[i];
      if (seg === "*") continue;
      if (seg !== segments[i]) {
        matches = false;
        break;
      }
      literalMatches++;
    }
    if (!matches) continue;
    if (!best || literalMatches > best.literalMatches) best = { pattern, literalMatches };
  }
  return best?.pattern ?? null;
}
