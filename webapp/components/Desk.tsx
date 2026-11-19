"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Analysis, Effort, Lang } from "@/lib/types";
import AnalysisPanel from "./AnalysisPanel";
import LangColumn from "./LangColumn";
import { emptyOpen, emptyRun, runLanguage, runOpenLanguage, type LangRun, type OpenRun } from "./run";

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
  const [swiss, setSwiss] = useState(true); // GMT prints Swiss German
  const [runs, setRuns] = useState<Record<Lang, LangRun>>({ en: emptyRun(), de: emptyRun() });
  const [openCfg, setOpenCfg] = useState<{ configured: boolean; label: string } | null>(null);
  const [useOpen, setUseOpen] = useState(true);
  const [opens, setOpens] = useState<Record<Lang, OpenRun> | null>(null);
  const [deeplCfg, setDeeplCfg] = useState<{ configured: boolean; label: string } | null>(null);
  const [useDeepl, setUseDeepl] = useState(true);
  const [deepls, setDeepls] = useState<Record<Lang, OpenRun> | null>(null);
  const [runSource, setRunSource] = useState<{ text: string; analysis: Analysis } | null>(null);
  const [stats, setStats] = useState<{ terms: number; sentences: Record<string, number> } | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const running =
    runs.en.status === "running" || runs.de.status === "running" || opens?.en.status === "running" ||
    opens?.de.status === "running" ||
    deepls?.en.status === "running" ||
    deepls?.de.status === "running";

  useEffect(() => {
    try {
      const saved = localStorage.getItem("gmt-desk-draft");
      if (saved?.trim()) setText(saved);
    } catch {}
    fetch("/api/analyze")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => undefined);
    fetch("/api/open-mt")
      .then((r) => (r.ok ? r.json() : null))
      .then(setOpenCfg)
      .catch(() => undefined);
    fetch("/api/deepl")
      .then((r) => (r.ok ? r.json() : null))
      .then(setDeeplCfg)
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
    const withOpen = Boolean(openCfg?.configured && useOpen);
    setOpens(withOpen ? { en: emptyOpen(), de: emptyOpen() } : null);
    const openPatch = (lang: Lang) => (fn: (r: OpenRun) => OpenRun) => setOpens((all) => (all ? { ...all, [lang]: fn(all[lang]) } : all));
    const withDeepl = Boolean(deeplCfg?.configured && useDeepl);
    setDeepls(withDeepl ? { en: emptyOpen(), de: emptyOpen() } : null);
    const deeplPatch = (lang: Lang) => (fn: (r: OpenRun) => OpenRun) => setDeepls((all) => (all ? { ...all, [lang]: fn(all[lang]) } : all));
    await Promise.all([
      ...(["en", "de"] as Lang[]).map((lang) => runLanguage({ lang, text: src, terms: a.terms, effort, swiss, signal, patch: patchFor(lang) })),
      // the open model runs alongside, one language after the other (one ZeroGPU Space)
      withOpen
        ? (async () => {
            for (const lang of ["en", "de"] as Lang[]) await runOpenLanguage({ lang, text: src, swiss, signal, patch: openPatch(lang) });
          })()
        : Promise.resolve(),
      // DeepL: both languages in parallel
      ...(withDeepl
        ? (["en", "de"] as Lang[]).map((lang) => runOpenLanguage({ lang, text: src, swiss, signal, patch: deeplPatch(lang), engine: "deepl" }))
        : []),
    ]);
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
              open_model: opens?.[l].status === "done" ? { model: openCfg?.label, text: opens[l].text, ms: opens[l].ms } : null,
              deepl: deepls?.[l].status === "done" ? { model: deeplCfg?.label, text: deepls[l].text, ms: deepls[l].ms, billed_characters: deepls[l].chars } : null,
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

  const anyDone =
    runs.en.status === "done" || runs.de.status === "done" || deepls?.en.status === "done" || opens?.en.status === "done";
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
              <input type="checkbox" checked={swiss} onChange={(e) => setSwiss(e.target.checked)} disabled={running} /> Swiss German (ss, «») — GMT house style
            </label>
            {openCfg?.configured && (
              <label className="check" title={openCfg.label}>
                <input type="checkbox" checked={useOpen} onChange={(e) => setUseOpen(e.target.checked)} disabled={running} /> Compare with our fine-tuned
                model
              </label>
            )}
            {deeplCfg?.configured && (
              <label className="check" title={deeplCfg.label}>
                <input type="checkbox" checked={useDeepl} onChange={(e) => setUseDeepl(e.target.checked)} disabled={running} /> Compare with DeepL
              </label>
            )}
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
            open={opens?.[lang] ?? null}
            openLabel={openCfg?.label ?? ""}
            deepl={deepls?.[lang] ?? null}
            deeplLabel={deeplCfg?.label ?? ""}
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
