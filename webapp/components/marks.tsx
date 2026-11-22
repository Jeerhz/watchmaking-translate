// Text with highlighted ranges, and the paragraph offsets needed to place them.

import type { ReactNode } from "react";

export interface Mark {
  s: number;
  e: number;
  cls: string;
  title?: string;
  onClick?: () => void;
}

/** `text` with the marks that fall inside [from, from + text.length) rendered as <mark>. */
export function marked(text: string, marks: Mark[], from = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let cur = 0;
  const inside = marks
    .map((m) => ({ ...m, s: m.s - from, e: m.e - from }))
    .filter((m) => m.s >= 0 && m.e <= text.length && m.e > m.s)
    .sort((a, b) => a.s - b.s);
  for (const m of inside) {
    if (m.s < cur) continue; // overlapping: first one wins
    if (m.s > cur) out.push(text.slice(cur, m.s));
    out.push(
      <mark key={m.s} className={m.cls} title={m.title} onClick={m.onClick} style={m.onClick ? { cursor: "pointer" } : undefined}>
        {text.slice(m.s, m.e)}
      </mark>,
    );
    cur = m.e;
  }
  out.push(text.slice(cur));
  return out;
}

/** Where each paragraph (as split by splitParagraphs) starts in the full text. */
export function paragraphOffsets(text: string, paragraphs: string[]): number[] {
  const offs: number[] = [];
  let cursor = 0;
  for (const p of paragraphs) {
    const at = text.indexOf(p, cursor);
    offs.push(at < 0 ? cursor : at);
    cursor = (at < 0 ? cursor : at) + p.length;
  }
  return offs;
}
