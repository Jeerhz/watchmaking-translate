"use client";

// The Translator: one system per run, read and edited paragraph by paragraph.
// Comparing systems lives on /compare; what each component contributes, on /scoreboard.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cost, pruneTerms } from "@/lib/client";
import type { Analysis, Effort, Lang } from "@/lib/types";
import AlignedGrid from "./AlignedGrid";
import AnalysisPanel, { type Dropped } from "./AnalysisPanel";
import LangColumn from "./LangColumn";
import { emptyRun, runLanguage, SYSTEMS, type LangRun, type SystemId } from "./run";

const SAMPLES: Record<string, string> = {
  "Novelty review": `La nouvelle référence se distingue par un boîtier de 39 mm en or gris 18 carats, dont la lunette lisse et les cornes facettées dialoguent avec un cadran guilloché bleu nuit. À 6 h, une petite seconde décentrée équilibre la composition, tandis que l’indication de la phase de lune occupe le haut du cadran.

Animée par un calibre manufacture à remontage automatique, la montre bat à 28 800 alt/h (4 Hz) et offre une réserve de marche de 70 heures. Son spiral en silicium et son échappement à ancre suisse la rendent insensible aux champs magnétiques. Un fond saphir dévoile la masse oscillante en or rose, décorée de Côtes de Genève.

Étanche à 50 m, elle est présentée sur un bracelet en alligator et sera produite en série limitée de 150 exemplaires, au prix de 38 500 francs suisses.`,
  "Haute horlogerie feature": `Dans l’atelier des complications, chaque mouvement à répétition minutes passe entre les mains d’un seul horloger, du premier assemblage au réglage final des timbres. Il faut parfois plusieurs semaines pour obtenir la sonorité recherchée : un son clair, puissant, dont la résonance se prolonge sans jamais se brouiller.

Le tourbillon, inventé par Abraham-Louis Breguet en 1801, compense les effets de la gravité sur l’organe réglant en faisant tourner la cage de l’échappement sur elle-même, en général une fois par minute. Ici, la cage en titane ne pèse que 0,3 gramme. Les ponts, anglés et polis à la main, laissent apparaître le rouage à travers un cadran squeletté.`,
};

/** Two ways to run: fast and cheap for a first read, or thorough for the text that will be printed. */
type Preset = "quick" | "publication";
const PRESETS: Record<Preset, { label: string; effort: Effort; help: string }> = {
  quick: { label: "Quick draft", effort: "high", help: "DeepL drafts, Claude’s editor corrects it — about 20 s for 250 words" },
  publication: { label: "Publication", effort: "xhigh", help: "Claude drafts with more thinking, then the editor — slower, for copy that will be printed" },
};
const EDITED: SystemId[] = ["claude", "deepl-claude", "fusion", "claude-legacy"];
const LANGS: Lang[] = ["en", "de"];

export default function Desk() {
  const router = useRouter();
  const [text, setText] = useState(SAMPLES["Novelty review"]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [preset, setPreset] = useState<Preset>("publication");
  const [system, setSystem] = useState<SystemId>("claude");
  const [swiss, setSwiss] = useState(true); // GMT prints Swiss German
  const [runs, setRuns] = useState<Record<Lang, LangRun>>({ en: emptyRun(), de: emptyRun() });
  const [editing, setEditing] = useState<Record<Lang, boolean>>({ en: false, de: false });
  const [have, setHave] = useState<{ deepl: boolean; open: boolean }>({ deepl: false, open: false });
  const [ran, setRan] = useState<{ text: string; analysis: Analysis; dropped: Dropped[]; effort: Effort } | null>(null);
  const [pruning, setPruning] = useState(false);
  const [stats, setStats] = useState<{ terms: number; sentences: Record<string, number> } | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const running = pruning || runs.en.status === "running" || runs.de.status === "running";
  const effort = PRESETS[preset].effort;

  useEffect(() => {
    try {
      const saved = localStorage.getItem("gmt-desk-draft");
      if (saved?.trim()) setText(saved);
    } catch {}
    const json = (r: Response) => (r.ok ? r.json() : null);
    fetch("/api/analyze").then(json).then(setStats).catch(() => undefined);
    Promise.all([fetch("/api/deepl").then(json), fetch("/api/open-mt").then(json)])
      .then(([d, o]) => setHave({ deepl: Boolean(d?.configured), open: Boolean(o?.configured) }))
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

  function choosePreset(p: Preset) {
    setPreset(p);
    setSystem(p === "quick" && have.deepl ? "deepl-claude" : "claude");
  }

  const patchFor = (lang: Lang) => (fn: (r: LangRun) => LangRun) => setRuns((all) => ({ ...all, [lang]: fn(all[lang]) }));

  async function translate() {
    const src = text.trim();
    if (!src) return;
    const a = await analyse(src);
    if (!a) return;
    ctl.current = new AbortController();
    const signal = ctl.current.signal;
    setEditing({ en: false, de: false });
    setRuns({ en: emptyRun(system), de: emptyRun(system) });
    setRan({ text: src, analysis: a, dropped: [], effort });

    // Claude first removes the termbase matches that are ordinary words in this text
    let dropped: Dropped[] = [];
    let sharedUsd = 0;
    if (EDITED.includes(system) && a.terms.length) {
      setPruning(true);
      try {
        const pr = await pruneTerms(src, signal);
        dropped = pr.drop;
        sharedUsd = pr.usage ? cost([pr.usage]) / LANGS.length : 0;
      } catch {
        setPruning(false);
        return;
      }
      setPruning(false);
      setRan({ text: src, analysis: a, dropped, effort });
    }
    const gone = new Set(dropped.map((d) => d.key));
    const terms = a.terms.filter((h) => !gone.has(h.key));
    const one = (lang: Lang) =>
      runLanguage({ lang, text: src, terms, dropTerms: [...gone], effort, swiss, signal, patch: patchFor(lang), system, sharedUsd, origin: "desk" });
    if (system === "open") for (const lang of LANGS) await one(lang); // one GPU: a language at a time
    else await Promise.all(LANGS.map(one));
    ctl.current = null;
  }

  function download() {
    if (!ran) return;
    const record = {
      created: new Date().toISOString(),
      settings: { system, effort: ran.effort, swiss },
      source: ran.text,
      terms: ran.analysis.terms.map((h) => ({ fr: h.surface, en: h.en[0]?.[0] ?? null, de: h.de[0]?.[0] ?? null })),
      pruned_terms: ran.dropped,
      references: ran.analysis.references,
      translations: Object.fromEntries(
        LANGS.map((l) => {
          const r = runs[l];
          return [
            l,
            {
              draft: r.draft,
              final: r.final,
              validated_text: r.approved ? r.edited : null,
              validation: r.approved ?? null,
              diagnosed_errors: r.errors,
              edits: r.changes,
              qa_verdicts: r.verdicts,
              qa_final: r.qaFinal,
              trace: r.trace,
              usage: r.usage,
            },
          ];
        }),
      ),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
    const el = document.createElement("a");
    el.href = url;
    el.download = `gmt-translation-${Date.now()}.json`;
    el.click();
    URL.revokeObjectURL(url);
  }

  function toCompare() {
    try {
      localStorage.setItem("gmt-compare-text", text);
    } catch {}
    router.push("/compare");
  }

  const anyDone = runs.en.status === "done" || runs.de.status === "done";
  const started = runs.en.status !== "idle" || runs.de.status !== "idle";
  const gone = new Set((ran?.dropped ?? []).map((d) => d.key));
  const keptTerms = (ran?.analysis.terms ?? []).filter((h) => !gone.has(h.key));
  const usable = SYSTEMS.filter((s) => s.id !== "claude-legacy" && (!s.needs || have[s.needs]));
  const memSize = stats ? Object.values(stats.sentences).reduce((x, y) => x + y, 0) : 0;

  return (
    <main className="page">
      <h1 className="page-title">French → English &amp; German</h1>

      <div className="desk-top">
        <section className="panel" aria-labelledby="srcLabel">
          <div className="panel-head">
            <span className="label" id="srcLabel">
              French source{analysis ? ` · ${analysis.words} words` : ""}
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
            <div className="seg" role="group" aria-label="Quality">
              {(Object.keys(PRESETS) as Preset[]).map((p) => (
                <button key={p} type="button" aria-pressed={preset === p} title={PRESETS[p].help} onClick={() => choosePreset(p)} disabled={running}>
                  {PRESETS[p].label}
                </button>
              ))}
            </div>
            <label className="check">
              System
              <select value={system} onChange={(e) => setSystem(e.target.value as SystemId)} disabled={running}>
                {usable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={swiss} onChange={(e) => setSwiss(e.target.checked)} disabled={running} /> Swiss German (ss, «»)
            </label>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {SYSTEMS.find((s) => s.id === system)?.help}.
          </p>
          <div className="row">
            <button className="btn" onClick={translate} disabled={running || !text.trim()}>
              Translate
            </button>
            {running && (
              <button className="btn ghost" onClick={() => ctl.current?.abort()}>
                Stop
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button className="btn ghost small" onClick={toCompare} disabled={running || !text.trim()} title="Run several systems on this text and judge them blind">
              Compare systems on this text →
            </button>
            {anyDone && !running && (
              <button className="btn ghost small" onClick={download}>
                Download record
              </button>
            )}
          </div>
        </section>
        <AnalysisPanel
          text={text}
          analysis={analysis}
          loading={analysing || pruning}
          dropped={ran && ran.text === text.trim() ? ran.dropped : []}
          stats={stats ? `${stats.terms.toLocaleString()} termbase keys · ${memSize.toLocaleString()} reference sentences` : ""}
        />
      </div>

      {started && ran && (
        <>
          <section className="panel" aria-label="Translation">
            <AlignedGrid source={ran.text} terms={keptTerms} runs={runs} editing={editing} onEdit={(lang, t) => patchFor(lang)((r) => ({ ...r, edited: t }))} />
          </section>
          <div className="outputs">
            {LANGS.map((lang) => (
              <LangColumn
                key={lang}
                lang={lang}
                run={runs[lang]}
                source={ran.text}
                terms={keptTerms}
                swiss={swiss}
                effort={ran.effort}
                editing={editing[lang]}
                onEditing={(on) => setEditing((e) => ({ ...e, [lang]: on }))}
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
        </>
      )}
    </main>
  );
}
