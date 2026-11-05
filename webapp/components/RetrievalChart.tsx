"use client";

import { useState } from "react";
import { RETRIEVAL, type Metric } from "@/lib/results";

// Fixed categorical order (validated palette, slots 1-4): identity follows the method.
const METHODS = [
  { id: "bm25", label: "BM25 (current)", color: "var(--s1)" },
  { id: "hybrid", label: "Hybrid (RRF)", color: "var(--s2)" },
  { id: "bm25>dense", label: "BM25 → dense re-rank", color: "var(--s3)" },
  { id: "dense", label: "Dense only", color: "var(--s4)" },
] as const;

const METRICS: { id: Metric; label: string; help: string }[] = [
  { id: "terms", label: "Terminology in context", help: "share of the sentence’s multi-word glossary terms whose approved translation appears in a retrieved example" },
  { id: "tgt_uni", label: "Reference vocabulary", help: "share of the published translation’s content words present in the retrieved examples" },
  { id: "tgt_bi", label: "Reference phrasing", help: "same, for word pairs (bigrams)" },
];

const POOL_LABEL: Record<string, string> = {
  "en/style": "English — GMT editorial memory",
  "en/domain": "English — industry memory",
  "de/domain": "German — industry memory",
};

export default function RetrievalChart({ model }: { model: string }) {
  const [metric, setMetric] = useState<Metric>("terms");
  const [hover, setHover] = useState<string | null>(null);
  const reports = RETRIEVAL.filter((r) => r.model === model);
  const max = Math.max(...reports.flatMap((r) => r.results.map((x) => x[metric])));
  const scale = (v: number) => (v / (Math.ceil(max * 10) / 10)) * 100;
  const m = METRICS.find((x) => x.id === metric)!;
  return (
    <figure className="viz-root" style={{ margin: 0, display: "grid", gap: 12 }}>
      <div className="row">
        <div className="seg" role="group" aria-label="Metric">
          {METRICS.map((x) => (
            <button key={x.id} aria-pressed={metric === x.id} onClick={() => setMetric(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="row small" style={{ gap: 12 }} aria-label="Legend">
          {METHODS.map((x) => (
            <span key={x.id} className="row" style={{ gap: 5 }}>
              <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, background: x.color, display: "inline-block" }} />
              {x.label}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="muted small">
        {m.label}: {m.help}. Top 3 examples, {reports[0]?.queries ?? 600} held-out sentences per memory (articles never seen by the index), embedder{" "}
        <span className="mono">{model.split("/").pop()}</span>.
      </figcaption>
      <div className="card-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        {reports.map((r) => (
          <div key={r.pool} className="card" style={{ gap: 8 }}>
            <div className="small" style={{ fontWeight: 600 }}>
              {POOL_LABEL[r.pool] ?? r.pool}
              <span className="muted" style={{ fontWeight: 400 }}>
                {" "}
                · {r.memory_size.toLocaleString()} sentences
              </span>
            </div>
            {METHODS.map((x) => {
              const row = r.results.find((y) => y.method === x.id);
              if (!row) return null;
              const v = row[metric];
              const key = r.pool + x.id;
              return (
                <div
                  key={x.id}
                  onMouseEnter={() => setHover(key)}
                  onMouseLeave={() => setHover(null)}
                  title={`${x.label}: ${(v * 100).toFixed(1)}%`}
                  style={{ display: "grid", gridTemplateColumns: "118px minmax(0,1fr) 48px", alignItems: "center", gap: 8, padding: "3px 0" }}
                >
                  <span className="small muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {x.label.replace(" (current)", "")}
                  </span>
                  <div style={{ height: 14, background: "var(--panel-2)", borderRadius: 4, position: "relative" }}>
                    <div
                      style={{
                        width: `${scale(v)}%`,
                        height: "100%",
                        background: x.color,
                        borderRadius: "0 4px 4px 0",
                        opacity: hover && hover !== key ? 0.45 : 1,
                        transition: "opacity .15s",
                      }}
                    />
                  </div>
                  <span className="mono num" style={{ color: "var(--ink)" }}>
                    {(v * 100).toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <style>{`
        .viz-root { --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; }
        @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .viz-root { --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; } }
        :root[data-theme="dark"] .viz-root { --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; }
      `}</style>
    </figure>
  );
}
