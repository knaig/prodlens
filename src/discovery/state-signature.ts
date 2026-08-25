// Spec: FR-RE-1, NFR-1 - see spec/traceability.md
// A screen's identity for dedup during the live crawl. URL path is the
// primary signal (this app is server-rendered, URL-driven); a light DOM hash
// is layered on top so two different SPA states behind the same URL (e.g. a
// modal) aren't treated as identical.
import { createHash } from "node:crypto";

export function computeStateSignature(url: string, domSample: string): string {
  const u = new URL(url);
  const path = u.pathname + u.search;
  const hash = createHash("sha1").update(domSample).digest("hex").slice(0, 12);
  return `${path}#${hash}`;
}
