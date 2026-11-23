"use client";

// The reading and editing surface: source | first target | second target, one row per paragraph, with the
// termbase terms highlighted in all three. In a translation, green = the approved equivalent,
// amber = another listed equivalent; in the source, red = a term whose approved equivalent is
// missing from a translation.

import { useMemo } from "react";
import { enforced, termUsage, type TermUse } from "@/lib/qa";
import { splitParagraphs } from "@/lib/textnorm";
import { LANG_TITLE as TITLE, TARGETS, type Lang, type Src, type TermHit } from "@/lib/types";
import { marked, paragraphOffsets, type Mark } from "./marks";
import type { LangRun } from "./run";


export default function AlignedGrid(props: {
  source: string;
  src: Src;
  terms: TermHit[];
  runs: Record<Lang, LangRun>;
  editing: Record<Lang, boolean>;
  onEdit: (lang: Lang, text: string) => void;
}) {
  const { source, terms, runs, editing, src } = props;
  const LANGS = TARGETS[src];
  const srcParas = useMemo(() => splitParagraphs(source), [source]);
  const srcOffs = useMemo(() => paragraphOffsets(source, srcParas), [source, srcParas]);

  const cols = LANGS.map((lang) => {
    const run = runs[lang];
    const done = run.status === "done";
    const text = done ? run.edited : run.live;
    const paras = splitParagraphs(text);
    return { lang, run, done, text, paras, offs: paragraphOffsets(text, paras), usage: done ? termUsage(text, lang, terms) : ([] as TermUse[]) };
  });
  // one row per paragraph while every finished translation mirrors the source's paragraphs
  const aligned = cols.every((c) => !c.done || c.paras.length === srcParas.length);

  const missing = (h: TermHit) => cols.filter((c) => c.done && enforced(h, c.lang) && c.usage.find((u) => u.hit.key === h.key)?.status === "missing").map((c) => c.lang);
  const srcMarks: Mark[] = terms.flatMap((h) => {
    const miss = missing(h);
    const eq = LANGS.map((l) => (h[l][0] ? `${l.toUpperCase()}: ${h[l][0][0]}` : "")).filter(Boolean).join(" · ");
    return h.spans.map(([s, e]) => ({
      s,
      e,
      cls: miss.length ? "term miss" : "term",
      title: miss.length ? `${eq} — approved equivalent not found in ${miss.map((l) => TITLE[l]).join(" and ")}` : eq,
    }));
  });
  const tgtMarks = (usage: TermUse[], lang: Lang): Mark[] =>
    usage.flatMap((u) =>
      u.spans.map(([s, e]) => ({
        s,
        e,
        cls: u.status === "preferred" ? "term ok" : "term alt",
        title:
          u.status === "preferred"
            ? `“${u.hit.surface}” — approved equivalent`
            : `“${u.hit.surface}” — a listed equivalent; preferred: “${u.hit[lang][0]?.[0] ?? ""}”`,
      })),
    );

  const rows = aligned ? srcParas.map((p, k) => k) : [0];
  const setPara = (c: (typeof cols)[number], k: number, value: string) => {
    const next = [...c.paras];
    next[k] = value.replace(/\s*\n+\s*/g, " ");
    props.onEdit(c.lang, next.join("\n\n"));
  };

  return (
    <div className="aligned" role="table" aria-label="Source and translations, paragraph by paragraph">
      <div className="aligned-row head" role="row">
        <div className="label" role="columnheader">
          {TITLE[src]}
        </div>
        {cols.map((c) => (
          <div key={c.lang} className="label" role="columnheader">
            {TITLE[c.lang]}
            {c.run.status === "running" && <span className="muted"> — {c.run.liveLabel}…</span>}
            {c.run.approved && <span className="badge ok" style={{ marginLeft: 8 }}>validated</span>}
          </div>
        ))}
      </div>
      {rows.map((k) => (
        <div key={k} className="aligned-row" role="row">
          <div className="cell src" lang={src} role="cell">
            {aligned ? marked(srcParas[k], srcMarks, srcOffs[k]) : marked(source, srcMarks)}
          </div>
          {cols.map((c) => {
            const body = aligned ? (c.paras[k] ?? "") : c.text;
            const from = aligned ? (c.offs[k] ?? 0) : 0;
            return (
              <div key={c.lang} className="cell" lang={c.lang} role="cell">
                {c.done && editing[c.lang] && !c.run.approved ? (
                  <textarea
                    className="cell-edit"
                    value={body}
                    rows={Math.max(2, Math.ceil(body.length / 52))}
                    onChange={(e) => (aligned ? setPara(c, k, e.target.value) : props.onEdit(c.lang, e.target.value))}
                    aria-label={`${TITLE[c.lang]}, paragraph ${k + 1}`}
                  />
                ) : body ? (
                  marked(body, tgtMarks(c.usage, c.lang), from)
                ) : (
                  <span className="muted small">{c.run.status === "running" ? "…" : k === 0 && c.run.status === "idle" ? "The translation appears here." : ""}</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {cols.some((c) => c.done) && (
        <p className="muted small" style={{ margin: 0 }}>
          <mark className="term">Term</mark> from the termbase · <mark className="term ok">approved equivalent</mark> ·{" "}
          <mark className="term alt">other listed equivalent</mark> · <mark className="term miss">equivalent not found</mark> (hover for details)
        </p>
      )}
    </div>
  );
}
