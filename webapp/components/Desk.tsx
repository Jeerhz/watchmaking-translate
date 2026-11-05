"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Analysis, Effort, Lang } from "@/lib/types";
import AnalysisPanel from "./AnalysisPanel";
import LangColumn from "./LangColumn";
import { emptyRun, runLanguage, type LangRun } from "./run";

const SAMPLES: Record<string, string> = {
  "Novelty review": `La nouvelle référence se distingue par un boîtier de 39 mm en or gris 18 carats, dont la lunette lisse et les cornes facettées dialoguent avec un cadran guilloché bleu nuit. À 6 h, une petite seconde décentrée équilibre la composition, tandis que l’indication de la phase de lune occupe le haut du cadran.

Animée par un calibre manufacture à remontage automatique, la montre bat à 28 800 alt/h (4 Hz) et offre une réserve de marche de 70 heures. Son spiral en silicium et son échappement à ancre suisse la rendent insensible aux champs magnétiques. Un fond saphir dévoile la masse oscillante en or rose, décorée de Côtes de Genève.

Étanche à 50 m, elle est présentée sur un bracelet en alligator et sera produite en série limitée de 150 exemplaires, au prix de 38 500 francs suisses.`,
  "Haute horlogerie feature": `Dans l’atelier des complications, chaque mouvement à répétition minutes passe entre les mains d’un seul horloger, du premier assemblage au réglage final des timbres. Il faut parfois plusieurs semaines pour obtenir la sonorité recherchée : un son clair, puissant, dont la résonance se prolonge sans jamais se brouiller.

Le tourbillon, inventé par Abraham-Louis Breguet en 1801, compense les effets de la gravité sur l’organe réglant en faisant tourner la cage de l’échappement sur elle-même, en général une fois par minute. Ici, la cage en titane ne pèse que 0,3 gramme. Les ponts, anglés et polis à la main, laissent apparaître le rouage à travers un cadran squeletté.`,
};

const EFFORTS: { id: Effort; label: string }[] = [
  { id: "high", label: "High (faster)" },
  { id: "xhigh", label: "Extra high (production)" },
  { id: "max", label: "Max" },
];

export default function Desk() {
  const [text, setText] = useState(SAMPLES["Novelty review"]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [effort, setEffort] = useState<Effort>("high");
  const [swiss, setSwiss] = useState(false);
  const [runs, setRuns] = useState<Record<Lang, LangRun>>({ en: emptyRun(), de: emptyRun() });
  const [runSource, setRunSource] = useState<{ text: string; analysis: Analysis } | null>(null);
  const [stats, setStats] = useState<{ terms: number; sentences: Record<string, number> } | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const running = runs.en.status === "running" || runs.de.status === "running";

  useEffect(() => {
    try {
      const saved = localStorage.getItem("gmt-desk-draft");
      if (saved?.trim()) setText(saved);
    } catch {}
    fetch("/api/analyze")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => undefined);
  }, []);

  const analyse = useCallback(async (t: string): Promise<Analysis | null> => {
    const res = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t }) });
    if (res.status === 401) {
      window.location.assign("/login?next=/");
      return null;
    }
    return res.ok ? ((await res.json()) as Analysis) : null;
  }, []);

  useEffect(() => {
    const id = setTimeout(async () => {
      setAnalysing(true);
      const a = await analyse(text).catch(() => null);
      setAnalysis(a);
      setAnalysing(false);
    }, 350);
    try {
      localStorage.setItem("gmt-desk-draft", text);
    } catch {}
    return () => clearTimeout(id);
  }, [text, analyse]);

  const patchFor = (lang: Lang) => (fn: (r: LangRun) => LangRun) => setRuns((all) => ({ ...all, [lang]: fn(all[lang]) }));

  async function translate() {
    const src = text.trim();
    if (!src) return;
    const a = await analyse(src);
    if (!a) return;
    setRunSource({ text: src, analysis: a });
    ctl.current = new AbortController();
    const signal = ctl.current.signal;
    await Promise.all(
      (["en", "de"] as Lang[]).map((lang) => runLanguage({ lang, text: src, terms: a.terms, effort, swiss, signal, patch: patchFor(lang) })),
    );
    ctl.current = null;
  }

  function download() {
    if (!runSource) return;
    const record = {
      created: new Date().toISOString(),
      settings: { model: "claude-opus-5-5", effort, swiss },
      source: runSource.text,
      terms: runSource.analysis.terms.map((h) => ({ fr: h.surface, en: h.en[0]?.[0] ?? null, de: h.de[0]?.[0] ?? null })),
      references: runSource.analysis.references,
      translations: Object.fromEntries(
        (["en", "de"] as Lang[]).map((l) => {
          const r = runs[l];
          return [
            l,
            {
              draft: r.draft,
              reviewed: r.reviewed,
              final: r.final,
              validated_text: r.approved ? r.edited : null,
              validation: r.approved ?? null,
              editor_changes: r.changes,
              correction_changes: r.fixChanges,
              qa_verdicts: r.verdicts,
              qa_final: r.qaFinal,
              usage: r.usage,
            },
          ];
        }),
      ),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `gmt-translation-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const anyDone = runs.en.status === "done" || runs.de.status === "done";
  const memSize = stats ? Object.values(stats.sentences).reduce((a, b) => a + b, 0) : 0;

  return (
    <main className="page">
      <div>
        <h1>French watchmaking copy → English &amp; German</h1>
        <p className="lede">
          Each run shows the whole chain: the technical terms detected, the published sentences used as references, the translator’s draft, the
          chief sub-editor’s corrections, automatic QA checks, and your validation.
          {stats && (
            <span className="mono">
              {" "}
              {stats.terms.toLocaleString()} termbase keys · {memSize.toLocaleString()} reference sentences.
            </span>
          )}
        </p>
      </div>

      <div className="desk-top">
        <section className="panel" aria-labelledby="srcLabel">
          <div className="panel-head">
            <span className="label" id="srcLabel">
              French source
            </span>
            <div className="row" style={{ gap: 6 }}>
              {Object.keys(SAMPLES).map((k) => (
                <button key={k} className="btn ghost small" type="button" onClick={() => setText(SAMPLES[k])} disabled={running}>
                  {k}
                </button>
              ))}
            </div>
          </div>
          <textarea className="source" lang="fr" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} aria-label="French source text" />
          <div className="row">
            <label className="check">
              Effort
              <select value={effort} onChange={(e) => setEffort(e.target.value as Effort)} disabled={running}>
                {EFFORTS.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={swiss} onChange={(e) => setSwiss(e.target.checked)} disabled={running} /> Swiss German (ss)
            </label>
          </div>
          <div className="row">
            <button className="btn" onClick={translate} disabled={running || !text.trim()}>
              Translate into English &amp; German
            </button>
            {running && (
              <button className="btn ghost" onClick={() => ctl.current?.abort()}>
                Stop
              </button>
            )}
            {anyDone && !running && (
              <button className="btn ghost" onClick={download}>
                Download job record
              </button>
            )}
            <span className="muted small">{analysis ? `${analysis.words} words` : ""}</span>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Claude Opus 5.5 runs the steps per language — draft, editorial review, QA, and a correction pass only when QA flags something. A
            250-word text takes about 25 seconds at “high” (≈ $0.08 per language); higher effort thinks longer.
          </p>
        </section>
        <AnalysisPanel text={text} analysis={analysis} loading={analysing} />
      </div>

      <div className="outputs">
        {(["en", "de"] as Lang[]).map((lang) => (
          <LangColumn
            key={lang}
            lang={lang}
            run={runs[lang]}
            source={runSource?.text ?? text}
            terms={runSource?.analysis.terms ?? []}
            swiss={swiss}
            onEdit={(t) => patchFor(lang)((r) => ({ ...r, edited: t }))}
            onApprove={(by) =>
              patchFor(lang)((r) => ({
                ...r,
                approved: { by, at: new Date().toISOString(), edited: r.edited !== r.final },
                steps: { ...r.steps, validate: "done" },
              }))
            }
            onReopen={() => patchFor(lang)((r) => ({ ...r, approved: undefined, steps: { ...r.steps, validate: "active" } }))}
          />
        ))}
      </div>
    </main>
  );
}
