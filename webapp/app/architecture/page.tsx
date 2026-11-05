import type { Metadata } from "next";
import RetrievalChart from "@/components/RetrievalChart";
import { RETRIEVAL } from "@/lib/results";

export const metadata: Metadata = { title: "Architecture — GMT Translation Desk" };

const STAGES: { n: string; title: string; kind: "data" | "model" | "rule" | "human"; body: string }[] = [
  { n: "1", title: "Term detection", kind: "rule", body: "Longest-match lookup of 4,932 French keys in the merged termbase; returns every approved EN/DE equivalent ranked by authority." },
  { n: "2", title: "Reference retrieval", kind: "data", body: "BM25 over the French side of the translation memory, sentence by sentence: 2 GMT + 1 industry example per sentence for English, 3 industry examples for German." },
  { n: "3", title: "Translator draft", kind: "model", body: "Claude Opus 5.5 with the house style guide, the glossary block, the examples and the previous paragraphs as context." },
  { n: "4", title: "Editorial review", kind: "model", body: "A second call plays GMT’s chief sub-editor: checks accuracy, terminology, house style and fluency, and returns the final text plus every change with its reason (strict JSON)." },
  { n: "5", title: "Automatic QA", kind: "rule", body: "Deterministic checks: approved terms present, every figure preserved, references and ™/® kept, paragraphs mirrored, no French left, house typography." },
  { n: "6", title: "Correction", kind: "model", body: "Only when QA flags something: the editor rules on each flag — fix it with the smallest edit, or keep the text and explain the false alarm." },
  { n: "7", title: "Human validation", kind: "human", body: "An editor reads the diff, edits in place (QA re-runs on the edits), and validates. The job record keeps every intermediate state." },
];

const KIND_LABEL = { data: "retrieval", model: "Claude call", rule: "deterministic", human: "editor" } as const;
const KIND_BADGE = { data: "info", model: "info", rule: "ok", human: "warn" } as const;

const SOURCES: [string, string, string, string][] = [
  ["WorldTempus (GMT Publishing)", "fr · en", "461k aligned segments (≈23k articles)", "House style — EN examples"],
  ["FH Berner professional dictionary", "fr · en · de", "5,574 terms · 11.6k segments", "Reference termbase; examples"],
  ["Fondation Haute Horlogerie", "fr · en", "17.6k segments", "Termbase (low priority); EN industry examples"],
  ["Patek Philippe glossary", "fr · en", "315 terms", "Termbase"],
  ["Brand sites (JLC, AP, A. Lange & Söhne)", "fr · en · de", "41k segments", "Industry examples, the German register"],
  ["Rolex editorial (archived)", "fr · en · de", "22k segments", "Industry examples"],
  ["Wikidata horology labels", "fr · en · de", "176 terms", "Termbase (lowest priority)"],
  ["EPO patents, IPC G04", "fr · en · de", "74k claims", "Not used for prompting (legal register)"],
];

function bestBy(model: string, pool: string, metric: "terms" | "tgt_uni") {
  const r = RETRIEVAL.find((x) => x.model === model && x.pool === pool);
  const row = (m: string) => r?.results.find((x) => x.method === m)?.[metric] ?? 0;
  return { bm25: row("bm25"), hybrid: row("hybrid"), dense: row("dense") };
}

export default function Architecture() {
  const models = [...new Set(RETRIEVAL.map((r) => r.model))];
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const e5 = models[0];
  const t = bestBy(e5, "en/style", "terms");
  const v = bestBy(e5, "en/style", "tgt_uni");
  const de = bestBy(e5, "de/domain", "terms");
  const lab = models.find((m) => m.includes("LaBSE")) ?? e5;
  const lt = bestBy(lab, "en/style", "terms");
  const lv = bestBy(lab, "en/style", "tgt_uni");
  return (
    <main className="page prose-page">
      <div>
        <h1>How the translation system works</h1>
        <p className="lede">
          A retrieval-augmented, terminology-constrained pipeline around a frontier model, with deterministic checks and a human at the end. Every piece of
          evidence the model sees is shown to the editor, so every choice can be traced.
        </p>
      </div>

      <section className="panel" aria-labelledby="flow">
        <h2 id="flow" style={{ marginTop: 0 }}>
          The pipeline, step by step
        </h2>
        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {STAGES.map((s, i) => (
            <li key={s.n} style={{ display: "grid", gridTemplateColumns: "34px minmax(0,1fr)", gap: 12, alignItems: "start" }}>
              <div style={{ display: "grid", justifyItems: "center", height: "100%" }}>
                <span
                  style={{
                    width: 30, height: 30, borderRadius: 999, display: "grid", placeItems: "center", fontWeight: 600,
                    background: s.kind === "model" ? "var(--steel)" : "var(--panel-2)", color: s.kind === "model" ? "var(--panel)" : "var(--ink)",
                    border: "1px solid var(--line)",
                  }}
                >
                  {s.n}
                </span>
                {i < STAGES.length - 1 && <span aria-hidden style={{ width: 2, flex: 1, minHeight: 14, background: "var(--line)" }} />}
              </div>
              <div style={{ paddingBottom: 8 }}>
                <div className="row" style={{ gap: 8 }}>
                  <h3>{s.title}</h3>
                  <span className={"badge " + KIND_BADGE[s.kind]}>{KIND_LABEL[s.kind]}</span>
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 15 }}>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="muted small" style={{ margin: 0 }}>
          Steps 1–2 run in ~100 ms with no model call (you see them update as you type). English and German run in parallel; texts over ~1,200 words
          are split by paragraph and each part receives the end of the previous translated part as context.
        </p>
      </section>

      <h2>The logic behind each choice</h2>
      <div className="card-grid">
        <div className="card">
          <h3>Terminology by authority</h3>
          <p>
            When sources disagree, the first listed equivalent wins: <b>GMT usage</b> (house choices measured on GMT’s own translations — “lugs”, “white
            gold”, “self-winding”) › <b>FH Berner</b> › Patek Philippe › FHH › Wikidata. Homonyms (<i>pont</i>, <i>roue</i>) keep a short definition so the
            model picks the right sense; untranslated copies and spec-sheet lists are filtered out.
          </p>
        </div>
        <div className="card">
          <h3>Examples teach the voice</h3>
          <p>
            Glossaries fix words; examples fix phrasing. For English, 70% of the example budget is reserved for GMT’s editorial translations (press releases
            excluded), so the model imitates how GMT actually writes. German has no GMT data yet, so it learns from brand sites and the Berner dictionary.
          </p>
        </div>
        <div className="card">
          <h3>Two passes, two roles</h3>
          <p>
            Translating and editing are different jobs. The reviewer sees the source, the draft and the same evidence, and must justify each change — which
            makes its work auditable and lets us measure how much it edits.
          </p>
        </div>
        <div className="card">
          <h3>Rules where rules work</h3>
          <p>
            Figures, references, paragraph structure and approved terms are checked by code, not by the model. The checks are deliberately strict; the
            correction pass lets the editor overrule false alarms (a German compound, an intentional synonym) and says why.
          </p>
        </div>
        <div className="card">
          <h3>Quality over speed</h3>
          <p>
            Claude Opus 5.5 at high or extra-high effort, adaptive reasoning on, server-side fallback if a request is declined. A 250-word text measured
            ≈ $0.17 for both languages at high effort, in about 25 seconds — negligible next to an editor’s time.
          </p>
        </div>
        <div className="card">
          <h3>Same prompts everywhere</h3>
          <p>
            The prompt templates, style guides and glossary live in the Python package (<span className="mono">trad_gmt.mt</span>) and are exported into
            this app, so the batch CLI, the evaluation harness and the desk send identical instructions.
          </p>
        </div>
      </div>

      <h2>Data</h2>
      <div className="table-wrap panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Languages</th>
              <th>Size</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((r) => (
              <tr key={r[0]}>
                {r.map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        525,845 training segments in total, split by document into train / validation / test so no article leaks into evaluation. The CLI uses the full
        memory (190k GMT editorial sentences for English); this web desk loads a 144k-sentence sample with GMT Magazine sentences prioritised. The data
        stays server-side: the browser only receives the handful of references retrieved for the text being translated.
      </p>

      <h2 id="retrieval">Semantic search in addition to BM25?</h2>
      <div className="prose">
        <p>
          The intuition is attractive: embeddings find sentences that <i>mean</i> the same thing even when they share no words. But for a translation memory
          the useful property of an example is different — it should show the model <b>the exact technical terms and the house phrasing</b> it is about to
          need. That is lexical by nature, and BM25 is good at it. Rather than argue, we measured it.
        </p>
        <p>
          For held-out sentences from articles the index has never seen, we retrieved the top 3 examples with four methods and compared the retrieved{" "}
          <b>target-side</b> sentences with GMT’s published translation. No model call is involved, so the test is free to repeat (
          <span className="mono">uv run trad-gmt retrieval-eval</span>).
        </p>
      </div>
      <section className="panel">
        {models.map((m) => (
          <RetrievalChart key={m} model={m} />
        ))}
      </section>
      <div className="callout">
        <b>Verdict: keep BM25 as the retriever; do not add dense retrieval for now.</b> With the e5 embedder on GMT’s editorial memory, BM25 shows the approved terminology in
        context for {pct(t.bm25)} of terms, against {pct(t.hybrid)} for the hybrid and {pct(t.dense)} for dense retrieval alone; vocabulary recall is{" "}
        {pct(v.bm25)} vs {pct(v.hybrid)} (hybrid). In German the gap on terminology is wider ({pct(de.bm25)} vs {pct(de.hybrid)}). With the stronger LaBSE embedder
        the hybrid gains about one point of vocabulary recall ({pct(lv.hybrid)} vs {pct(lv.bm25)}) but still loses terminology ({pct(lt.hybrid)} vs{" "}
        {pct(lt.bm25)}). Embeddings pull in sentences that are thematically close but use different terms — the wrong kind of “similar” for
        terminology-critical translation.
        Literature agrees: for high-resource pairs into English and German, embedding retrieval brings at most small, inconsistent gains over BM25
        (Zebaze et al. 2024; Rios et al., EAMT 2026).
      </div>
      <div className="prose">
        <p>What would help more than embeddings, and is cheap:</p>
        <ul>
          <li>
            <b>Term-aware retrieval.</b> BM25 still misses the approved term in context for roughly half of the multi-word terms. Add one example per
            detected glossary term — a GMT sentence containing both the French term and its approved translation.
          </li>
          <li>
            <b>Coverage re-ranking</b> (Agrawal et al., 2023): take BM25’s top 50 and greedily pick examples that cover the source n-grams not covered yet, so
            three examples don’t repeat the same phrase.
          </li>
          <li>
            <b>Embeddings for one job only:</b> fallback when BM25 returns nothing useful (very short or idiomatic sentences), and later, de-duplicating the
            memory.
          </li>
        </ul>
      </div>

      <h2>Deployment</h2>
      <div className="card-grid">
        <div className="card">
          <h3>This desk</h3>
          <ul>
            <li>Next.js on Vercel; one serverless route per step (analyse, draft, review, correct), streamed to the browser.</li>
            <li>Termbase + BM25 index built in memory from a 20 MB bundle on cold start (~1 s), then reused.</li>
            <li>Claude API key held as a Vercel secret; the site sits behind an access code.</li>
          </ul>
        </div>
        <div className="card">
          <h3>Batch / production</h3>
          <ul>
            <li>
              <span className="mono">uv run trad-gmt translate</span> — same prompts, full memory, effort <i>xhigh</i>.
            </li>
            <li>
              <span className="mono">uv run trad-gmt evaluate</span> — chrF vs GMT’s published translations + term adherence on held-out articles.
            </li>
            <li>Runs unchanged on Amazon Bedrock, Google Vertex AI or Microsoft Foundry if data residency requires it.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
