"use client";

import { useState } from "react";
import type { Analysis, Example, Lang, TermHit } from "@/lib/types";

const SOURCE_LABEL: Record<string, string> = {
  gmt: "GMT usage",
  berner: "FH Berner",
  patek: "Patek",
  fhh: "FHH",
  wikidata: "Wikidata",
};

function termTitle(h: TermHit): string {
  const fmt = (lang: Lang) => (h[lang][0] ? `${lang.toUpperCase()}: ${h[lang][0][0]} (${SOURCE_LABEL[h[lang][0][1]] ?? h[lang][0][1]})` : "");
  return [fmt("en"), fmt("de")].filter(Boolean).join(" · ");
}

function Annotated({ text, a, selected, onSelect }: { text: string; a: Analysis; selected: number | null; onSelect: (i: number) => void }) {
  const marks = a.terms.flatMap((h) => h.spans.map(([s, e]) => ({ s, e, h }))).sort((x, y) => x.s - y.s);
  const paragraphs = new Map<number, Analysis["sentences"]>();
  for (const s of a.sentences) paragraphs.set(s.paragraph, [...(paragraphs.get(s.paragraph) ?? []), s]);
  return (
    <div className="annotated">
      {[...paragraphs.entries()].map(([p, sents]) => (
        <p key={p}>
          {sents.map((s) => {
            const pieces: React.ReactNode[] = [];
            let cur = s.start;
            for (const m of marks) {
              if (m.s < cur || m.e > s.end) continue;
              if (m.s > cur) pieces.push(text.slice(cur, m.s));
              pieces.push(
                <mark key={m.s} className="term" title={termTitle(m.h)}>
                  {text.slice(m.s, m.e)}
                </mark>,
              );
              cur = m.e;
            }
            pieces.push(text.slice(cur, s.end));
            return (
              <span key={s.index}>
                <span
                  className={"sent" + (selected === s.index ? " sel" : "")}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(s.index)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(s.index)}
                >
                  <sup>{s.index + 1}</sup>
                  {pieces}
                </span>{" "}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}

export function ExampleItem({ e, lang }: { e: Example; lang: Lang }) {
  return (
    <div className="ex">
      <div className="meta">
        <span className={"tag " + e.pool}>{e.pool === "style" ? "GMT house style" : "industry"}</span>
        {e.url ? (
          <a href={e.url} target="_blank" rel="noreferrer">
            {e.label}
          </a>
        ) : (
          <span>{e.label}</span>
        )}
        <span className="mono">BM25 {e.score.toFixed(1)}</span>
      </div>
      <div className="src">{e.fr}</div>
      <div className="tgt" lang={lang}>
        {e.tgt}
      </div>
    </div>
  );
}

function References({ a, sentence }: { a: Analysis; sentence: number | null }) {
  const pick = (lang: Lang) => a.references[lang].filter((e) => sentence === null || e.sentence === sentence);
  return (
    <div className="refs">
      {(["en", "de"] as Lang[]).map((lang) => {
        const list = pick(lang);
        return (
          <div key={lang}>
            <div className="label">
              {lang === "en" ? "English" : "German"} references<span className="count">{list.length}</span>
            </div>
            {list.length ? list.map((e, i) => <ExampleItem key={i} e={e} lang={lang} />) : <p className="muted small">No close sentence in the memory for this one.</p>}
          </div>
        );
      })}
    </div>
  );
}

function Terms({ terms }: { terms: TermHit[] }) {
  if (!terms.length) return <p className="muted small">No termbase entry in this text yet.</p>;
  return (
    <ul className="term-list">
      {terms.map((h) => (
        <li key={h.key} className="term">
          <div className="fr">
            {h.surface}
            {h.count > 1 && <span className="count">×{h.count}</span>}
            {h.surface.toLowerCase() !== h.fr.toLowerCase() && <span className="muted small"> · entry “{h.fr}”</span>}
          </div>
          {(["en", "de"] as Lang[]).map((lang) => {
            const t = h[lang];
            const homonyms = t.length > 1 && new Set(t.map((x) => x[3])).size > 1;
            return (
              <div key={lang} className="tg">
                <span className="lang">{lang.toUpperCase()}</span>
                {t.length ? (
                  t.slice(0, 4).map((x, i) => (
                    <span key={i} className={"chip" + (i === 0 ? " first" : "")} title={homonyms && x[3] ? x[3] : undefined}>
                      {x[0]} · {SOURCE_LABEL[x[1]] ?? x[1]}
                    </span>
                  ))
                ) : (
                  <span className="muted small">no entry</span>
                )}
              </div>
            );
          })}
        </li>
      ))}
    </ul>
  );
}

export default function AnalysisPanel({ text, analysis, loading }: { text: string; analysis: Analysis | null; loading: boolean }) {
  const [tab, setTab] = useState<"annotated" | "terms" | "refs">("annotated");
  const [sentence, setSentence] = useState<number | null>(null);
  const a = analysis;
  const nRefs = a ? a.references.en.length + a.references.de.length : 0;
  const sel = a && sentence !== null && sentence < a.sentences.length ? sentence : null;
  return (
    <section className="panel" aria-labelledby="anaLabel">
      <div className="panel-head">
        <span className="label" id="anaLabel">
          Evidence — found before any model call
        </span>
        <span className="muted small">
          {loading ? "Analysing…" : a ? `${a.terms.length} terms · ${nRefs} reference sentences · ${a.sentences.length} sentences` : ""}
        </span>
      </div>
      <div className="tabs" role="tablist">
        {(
          [
            ["annotated", "Annotated source", null],
            ["terms", "Technical terms", a?.terms.length ?? 0],
            ["refs", "All references", nRefs],
          ] as const
        ).map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
            {n !== null && <span className="count">{n}</span>}
          </button>
        ))}
      </div>
      {!a ? (
        <p className="muted small">Type or paste French text.</p>
      ) : tab === "annotated" ? (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            <mark className="term">Gold</mark> = termbase hit (hover for the approved EN/DE equivalents). Click a sentence to see the published
            sentences retrieved for it.
          </p>
          <Annotated text={text} a={a} selected={sel} onSelect={(i) => setSentence(i === sel ? null : i)} />
          <div className="label">{sel === null ? "Pick a sentence above to inspect its references" : `References retrieved for sentence ${sel + 1}`}</div>
          {sel !== null && <References a={a} sentence={sel} />}
        </>
      ) : tab === "terms" ? (
        <Terms terms={a.terms} />
      ) : (
        <div style={{ maxHeight: 520, overflow: "auto" }}>
          <References a={a} sentence={null} />
        </div>
      )}
    </section>
  );
}
