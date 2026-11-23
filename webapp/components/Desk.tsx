"use client";

// The Translator: one system per run, read and edited paragraph by paragraph.
// Comparing systems lives on /compare; what each component contributes, on /scoreboard.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cost, pruneTerms } from "@/lib/client";
import { LANG_NAME, SOURCES, TARGETS, perLang, type Analysis, type Effort, type Lang, type Src } from "@/lib/types";
import AlignedGrid from "./AlignedGrid";
import AnalysisPanel, { type Dropped } from "./AnalysisPanel";
import LangColumn from "./LangColumn";
import { emptyRun, runLanguage, SYSTEMS, worksFrom, type LangRun, type SystemId } from "./run";

const SAMPLES_FR: Record<string, string> = {
  "Novelty review": `La nouvelle référence se distingue par un boîtier de 39 mm en or gris 18 carats, dont la lunette lisse et les cornes facettées dialoguent avec un cadran guilloché bleu nuit. À 6 h, une petite seconde décentrée équilibre la composition, tandis que l’indication de la phase de lune occupe le haut du cadran.

Animée par un calibre manufacture à remontage automatique, la montre bat à 28 800 alt/h (4 Hz) et offre une réserve de marche de 70 heures. Son spiral en silicium et son échappement à ancre suisse la rendent insensible aux champs magnétiques. Un fond saphir dévoile la masse oscillante en or rose, décorée de Côtes de Genève.

Étanche à 50 m, elle est présentée sur un bracelet en alligator et sera produite en série limitée de 150 exemplaires, au prix de 38 500 francs suisses.`,
  "Haute horlogerie feature": `Dans l’atelier des complications, chaque mouvement à répétition minutes passe entre les mains d’un seul horloger, du premier assemblage au réglage final des timbres. Il faut parfois plusieurs semaines pour obtenir la sonorité recherchée : un son clair, puissant, dont la résonance se prolonge sans jamais se brouiller.

Le tourbillon, inventé par Abraham-Louis Breguet en 1801, compense les effets de la gravité sur l’organe réglant en faisant tourner la cage de l’échappement sur elle-même, en général une fois par minute. Ici, la cage en titane ne pèse que 0,3 gramme. Les ponts, anglés et polis à la main, laissent apparaître le rouage à travers un cadran squeletté.`,
};

const SAMPLES_EN: Record<string, string> = {
  "Novelty review": `The new reference stands out with its 39 mm case in 18-carat white gold, whose smooth bezel and faceted lugs set off a midnight-blue guilloché dial. At 6 o’clock, an off-centre small seconds balances the composition, while the moon-phase display occupies the top of the dial.

Driven by a self-winding in-house calibre, the watch beats at 28,800 vibrations per hour (4 Hz) and offers a 70-hour power reserve. Its silicon balance spring and Swiss lever escapement make it impervious to magnetic fields. A sapphire caseback reveals the rose gold oscillating weight, decorated with Côtes de Genève.

Water-resistant to 50 metres, it comes on an alligator strap and will be produced in a limited edition of 150 pieces, priced at CHF 38,500.`,
  "Haute horlogerie feature": `In the complications workshop, each minute repeater movement passes through the hands of a single watchmaker, from first assembly to the final tuning of the gongs. It can take several weeks to obtain the sound he is looking for: clear and powerful, with a resonance that lingers without ever blurring.

The tourbillon, invented by Abraham-Louis Breguet in 1801, compensates for the effects of gravity on the regulating organ by rotating the escapement carriage on itself, generally once a minute. Here, the titanium carriage weighs just 0.3 grams. The bridges, bevelled and polished by hand, reveal the going train through an openworked dial.`,
};
const SAMPLES: Record<Src, Record<string, string>> = { fr: SAMPLES_FR, en: SAMPLES_EN };
const DRAFT_KEY: Record<Src, string> = { fr: "gmt-desk-draft", en: "gmt-desk-draft-en" };
const SRC_KEY = "gmt-desk-source";

/** Two ways to run: fast and cheap for a first read, or thorough for the text that will be printed. */
type Preset = "quick" | "publication";
const PRESETS: Record<Preset, { label: string; effort: Effort; help: string }> = {
  quick: { label: "Quick draft", effort: "high", help: "DeepL drafts, Claude’s editor corrects it — about 20 s for 250 words" },
  publication: { label: "Publication", effort: "xhigh", help: "Claude drafts with more thinking, then the editor — slower, for copy that will be printed" },
};
const EDITED: SystemId[] = ["claude", "deepl-claude", "fusion", "claude-legacy"];

export default function Desk() {
  const router = useRouter();
  const [src, setSrc] = useState<Src>("fr");
  const [text, setText] = useState(SAMPLES.fr["Novelty review"]);
  const [ready, setReady] = useState(false); // saved text restored: from here on, changes are saved
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [preset, setPreset] = useState<Preset>("publication");
  const [system, setSystem] = useState<SystemId>("claude");
  const [swiss, setSwiss] = useState(true); // GMT prints Swiss German
  const [runs, setRuns] = useState<Record<Lang, LangRun>>(perLang(() => emptyRun()));
  const [editing, setEditing] = useState<Record<Lang, boolean>>(perLang(() => false));
  const [have, setHave] = useState<{ deepl: boolean; open: boolean }>({ deepl: false, open: false });
  const [ran, setRan] = useState<{ text: string; src: Src; analysis: Analysis; dropped: Dropped[]; effort: Effort } | null>(null);
  const [pruning, setPruning] = useState(false);
  const [stats, setStats] = useState<{ terms: number; sentences: Record<string, number> } | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const langs = TARGETS[ran?.src ?? src]; // the languages on screen are those of the last run
  const running = pruning || langs.some((l) => runs[l].status === "running");
  const effort = PRESETS[preset].effort;

  useEffect(() => {
    try {
      const from: Src = localStorage.getItem(SRC_KEY) === "en" ? "en" : "fr";
      const saved = localStorage.getItem(DRAFT_KEY[from]);
      setSrc(from);
      setText(saved?.trim() ? saved : SAMPLES[from]["Novelty review"]);
    } catch {}
    setReady(true);
    const json = (r: Response) => (r.ok ? r.json() : null);
    fetch("/api/analyze").then(json).then(setStats).catch(() => undefined);
    Promise.all([fetch("/api/deepl").then(json), fetch("/api/open-mt").then(json)])
      .then(([d, o]) => setHave({ deepl: Boolean(d?.configured), open: Boolean(o?.configured) }))
      .catch(() => undefined);
  }, []);

  const analyse = useCallback(async (t: string, from: Src): Promise<Analysis | null> => {
    const res = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t, src: from }) });
    if (res.status === 401) {
      window.location.assign("/login?next=/");
      return null;
    }
    return res.ok ? ((await res.json()) as Analysis) : null;
  }, []);

  useEffect(() => {
    const id = setTimeout(async () => {
      setAnalysing(true);
      const a = await analyse(text, src).catch(() => null);
      setAnalysis(a);
      setAnalysing(false);
    }, 350);
    if (ready) {
      try {
        localStorage.setItem(DRAFT_KEY[src], text);
        localStorage.setItem(SRC_KEY, src);
      } catch {}
    }
    return () => clearTimeout(id);
  }, [text, src, ready, analyse]);

  /** Switch the source language: each language keeps its own text. */
  function chooseSource(next: Src) {
    if (next === src) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(DRAFT_KEY[next]);
    } catch {}
    setAnalysis(null);
    setSrc(next);
    setText(saved?.trim() ? saved : SAMPLES[next]["Novelty review"]);
    if (!worksFrom(system, next)) setSystem("claude");
  }

  function choosePreset(p: Preset) {
    setPreset(p);
    setSystem(p === "quick" && have.deepl ? "deepl-claude" : "claude");
  }

  const patchFor = (lang: Lang) => (fn: (r: LangRun) => LangRun) => setRuns((all) => ({ ...all, [lang]: fn(all[lang]) }));

  async function translate() {
    const body = text.trim();
    if (!body) return;
    const targets = TARGETS[src];
    const a = await analyse(body, src);
    if (!a) return;
    ctl.current = new AbortController();
    const signal = ctl.current.signal;
    setEditing(perLang(() => false));
    setRuns(perLang(() => emptyRun(system)));
    setRan({ text: body, src, analysis: a, dropped: [], effort });

    // Claude first removes the termbase matches that are ordinary words in this text
    let dropped: Dropped[] = [];
    let sharedUsd = 0;
    if (EDITED.includes(system) && a.terms.length) {
      setPruning(true);
      try {
        const pr = await pruneTerms(body, signal, src);
        dropped = pr.drop;
        sharedUsd = pr.usage ? cost([pr.usage]) / targets.length : 0;
      } catch {
        setPruning(false);
        return;
      }
      setPruning(false);
      setRan({ text: body, src, analysis: a, dropped, effort });
    }
    const gone = new Set(dropped.map((d) => d.key));
    const terms = a.terms.filter((h) => !gone.has(h.key));
    const one = (lang: Lang) =>
      runLanguage({ lang, src, text: body, terms, dropTerms: [...gone], effort, swiss, signal, patch: patchFor(lang), system, sharedUsd, origin: "desk" });
    if (system === "open") for (const lang of targets) await one(lang); // one GPU: a language at a time
    else await Promise.all(targets.map(one));
    ctl.current = null;
  }

  function download() {
    if (!ran) return;
    const record = {
      created: new Date().toISOString(),
      settings: { system, effort: ran.effort, swiss, source_language: ran.src },
      source: ran.text,
      terms: ran.analysis.terms.map((h) => ({ source: h.surface, ...Object.fromEntries(TARGETS[ran.src].map((l) => [l, h[l][0]?.[0] ?? null])) })),
      pruned_terms: ran.dropped,
      references: ran.analysis.references,
      translations: Object.fromEntries(
        TARGETS[ran.src].map((l) => {
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
      localStorage.setItem("gmt-compare-source", src);
    } catch {}
    router.push("/compare");
  }

  const anyDone = langs.some((l) => runs[l].status === "done");
  const started = langs.some((l) => runs[l].status !== "idle");
  const gone = new Set((ran?.dropped ?? []).map((d) => d.key));
  const keptTerms = (ran?.analysis.terms ?? []).filter((h) => !gone.has(h.key));
  const usable = SYSTEMS.filter((s) => s.id !== "claude-legacy" && (!s.needs || have[s.needs]) && worksFrom(s.id, src));
  const [first, second] = TARGETS[src];
  const memSize = stats ? Object.values(stats.sentences).reduce((x, y) => x + y, 0) : 0;

  return (
    <main className="page">
      <h1 className="page-title">
        {LANG_NAME[src]} → {LANG_NAME[first]} &amp; {LANG_NAME[second]}
      </h1>

      <div className="desk-top">
        <section className="panel" aria-labelledby="srcLabel">
          <div className="panel-head">
            <div className="row" style={{ gap: 10 }}>
              <div className="seg" role="group" aria-label="Source language">
                {SOURCES.map((l) => (
                  <button key={l} type="button" aria-pressed={src === l} onClick={() => chooseSource(l)} disabled={running} title={`Translate from ${LANG_NAME[l]} into ${TARGETS[l].map((t) => LANG_NAME[t]).join(" and ")}`}>
                    {LANG_NAME[l]}
                  </button>
                ))}
              </div>
              <span className="label" id="srcLabel">
                source{analysis ? ` · ${analysis.words} words` : ""}
              </span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {Object.keys(SAMPLES[src]).map((k) => (
                <button key={k} className="btn ghost small" type="button" onClick={() => setText(SAMPLES[src][k])} disabled={running}>
                  {k}
                </button>
              ))}
            </div>
          </div>
          <textarea className="source" lang={src} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} aria-label={`${LANG_NAME[src]} source text`} />
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
            {src === "en" && " From English, the termbase is read from its English side and DeepL runs without the GMT glossary; this direction has not been measured yet."}
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
          dropped={ran && ran.text === text.trim() && ran.src === src ? ran.dropped : []}
          stats={stats ? `${stats.terms.toLocaleString()} termbase keys · ${memSize.toLocaleString()} reference sentences` : ""}
        />
      </div>

      {started && ran && (
        <>
          <section className="panel" aria-label="Translation">
            <AlignedGrid source={ran.text} src={ran.src} terms={keptTerms} runs={runs} editing={editing} onEdit={(lang, t) => patchFor(lang)((r) => ({ ...r, edited: t }))} />
          </section>
          <div className="outputs">
            {langs.map((lang) => (
              <LangColumn
                key={lang}
                lang={lang}
                src={ran.src}
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
