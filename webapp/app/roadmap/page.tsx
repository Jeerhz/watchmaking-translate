import type { Metadata } from "next";

export const metadata: Metadata = { title: "Improving it — GMT Translation Desk" };

const WMT26_EN_DE: [string, string, number, string][] = [
  ["Wayfinder", "agentic pool on Gemini (+ others)", 79.1, "top cluster"],
  ["TRIVE", "generate → fuse → verify → correct", 78.5, "top cluster"],
  ["Gemini 3.1 Pro", "frontier API", 78.2, "top cluster"],
  ["GPT-5.5", "frontier API", 77.1, "top cluster"],
  ["Human post-edit", "reference", 73.0, ""],
  ["Lumen", "fine-tuned Qwen 14B + 4B (best constrained)", 72.0, ""],
  ["Gemma 4 31B", "open weights, Apache 2.0", 67.8, ""],
  ["DeepSeek V4 Pro", "open weights", 66.7, ""],
  ["Mistral Medium 3.5", "open weights", 65.5, ""],
  ["gpt-oss-120b", "open weights", 58.5, ""],
  ["Google Translate", "classic MT", 57.1, ""],
  ["Qwen3.6-27B", "open weights", 51.1, ""],
  ["Tower+ 9B", "MT-specialised, non-commercial", 47.5, ""],
];

const PHASES: [string, string, string[]][] = [
  [
    "Now – 2 weeks",
    "Measure before changing anything",
    [
      "Freeze a test set: 50 held-out GMT articles (EN) + the magazine pairs once the PDFs are aligned (first German GMT data).",
      "Automatic gates on every change: chrF, term accuracy, figure/reference checks (already in the QA module), MetricX-24 or xCOMET for regression tracking.",
      "A monthly blind review by GMT editors on ~100 segments (ESA or MQM). It is the only real judge of the house voice.",
    ],
  ],
  [
    "Weeks 2 – 6",
    "Cheap, high-yield upgrades",
    [
      "Feedback loop: every validated translation from this desk goes back into the memory, and its (draft → validated) pair is stored for later tuning.",
      "Term-aware retrieval and coverage re-ranking (see Architecture): show each approved term in a real GMT sentence.",
      "Mine the GMT corpus automatically for house usage (FR term → EN variant frequencies), extending the hand-built “GMT usage” layer from 10 to hundreds of terms.",
      "Constrain the editor: MQM-style error list, “no change” as the default, and track the edit rate to catch over-editing.",
    ],
  ],
  [
    "Months 2 – 3",
    "Agentic comparison",
    [
      "Generate 3 candidates per paragraph (Claude Opus 5.5, Gemini 3.1 Pro, GPT-5.5), let a judge from a different family pick the best or minimally merge, then run the QA checks and a conservative post-check.",
      "Show the candidates and the judge’s reasons side by side in the desk, so editors can see when models disagree — usually where a term or nuance is hard.",
      "Keep it only if the editors’ blind review prefers it.",
    ],
  ],
  [
    "Months 3 – 6",
    "Fine-tuning experiment",
    [
      "LoRA fine-tune of an open model (Gemma 4 31B, Apache 2.0) on the 190k GMT FR→EN sentence pairs, with the glossary in the prompt so it learns to obey the termbase.",
      "Then preference-tune on the editors’ corrections collected by the desk (draft rejected, validated text preferred).",
      "Enter it as one more candidate in the agentic pool. Promote it only if it wins blind reviews. German waits for in-house German data.",
    ],
  ],
];

export default function Roadmap() {
  return (
    <main className="page prose-page">
      <div>
        <h1>How to make it better</h1>
        <p className="lede">
          What the 2025–2026 evidence says about specialised translation, what fits GMT’s case, and a staged plan: measure first, then cheap upgrades,
          then multi-model comparison, then fine-tuning.
        </p>
      </div>

      <div className="callout gold">
        <b>In short.</b> Keep a frontier model with retrieval and the termbase as the backbone. Invest first in measurement and in the editors’ feedback
        loop. Add a multi-model comparison step, the pattern behind the 2026 winners. Treat fine-tuning and self-hosting as an experiment that feeds that
        comparison, not as a replacement. At GMT’s volume, the API cost is small next to the value of an editor’s time.
      </div>

      <h2>State of the art (WMT 2026)</h2>
      <div className="prose">
        <p>
          The 2026 Conference on Machine Translation published human evaluations for 23 language pairs, including English→German. Three findings matter
          for GMT:
        </p>
        <ol>
          <li>
            <b>Every top-cluster system is a prompted or agentic frontier model.</b> The two best are agentic: they build a pool of candidates from several
            models, then pick, fuse, verify and correct.
          </li>
          <li>
            <b>The best fine-tuned small model is about 6–7 points below that cluster. The best open-weights model is about 10 points below.</b> Fine-tuning
            narrows the gap but doesn’t close it.
          </li>
          <li>
            <b>Automatic metrics are no longer trusted on their own.</b> In 2025 a system trained against COMET-style rewards won on metrics and lost with
            humans. In 2026 the organisers stopped publishing automatic scores. Many general LLMs also over-generated or hallucinated on a dedicated test
            suite, while pipelines with verification steps stayed under 5%.
          </li>
        </ol>
        <p>
          French was not part of either campaign. There is no public human evaluation for FR→EN/DE, so GMT needs its own test set (phase 1 below). Claude was
          not run as an official WMT26 baseline. In WMT25 (Czech→German), Claude 4 was in the second cluster with GPT-4.1, just behind Gemini 2.5 Pro, and
          above the human reference.
        </p>
      </div>
      <div className="table-wrap panel" style={{ padding: 0 }}>
        <table>
          <caption className="muted small" style={{ textAlign: "left", padding: "10px 12px" }}>
            WMT26 English→German, human contrastive ESA score (0–100). Kocmi et al., WMT 2026 findings.
          </caption>
          <thead>
            <tr>
              <th>System</th>
              <th>Type</th>
              <th className="num">Score</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {WMT26_EN_DE.map(([name, kind, score, note]) => (
              <tr key={name}>
                <td style={{ fontWeight: note ? 600 : 400 }}>{name}</td>
                <td className="muted">{kind}</td>
                <td className="num mono">{score.toFixed(1)}</td>
                <td>{note && <span className="badge info">{note}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Specialised domains: what actually moves quality</h2>
      <div className="card-grid">
        <div className="card">
          <h3>Terminology lists help — when they are right</h3>
          <p>
            WMT25’s terminology task found that correct dictionaries reliably raise term accuracy (98–99% for the best systems on sentences). Better systems
            benefit more. At document level it drops to 70–80%. General metrics barely see term errors, so measure term accuracy separately. The desk’s QA
            report does exactly that.
          </p>
        </div>
        <div className="card">
          <h3>Retrieved examples beat glossaries alone</h3>
          <p>
            For domain translation, retrieved demonstrations consistently beat terminology lists or model-generated background (Li et al., 2025). Example
            quality matters more than quantity, and one bad example can hurt (Vilar et al.; Agrawal et al., 2023). Hence the focus on GMT’s own sentences
            and on term-aware retrieval.
          </p>
        </div>
        <div className="card">
          <h3>Refinement works, open-ended loops don’t</h3>
          <p>
            Draft → critique → refine improves human-judged quality (TEaR, Briakou et al.), even when string metrics drop. But LLM post-editors can introduce
            hallucinated edits. Retry loops were inert or harmful in WMT26 reports, and a model judging its own family is biased. So we keep one bounded
            review, deterministic checks, and a correction pass that may decline to change anything.
          </p>
        </div>
      </div>

      <h2>Agentic comparison</h2>
      <div className="prose">
        <p>
          The pattern with the strongest 2026 evidence: <b>several candidates, a judge, a minimal rewrite, a conservative check.</b> For GMT that means:
        </p>
        <ol>
          <li>Translate each paragraph with 2–3 strong models from different families, all given the same glossary, examples and style guide.</li>
          <li>
            A judge from another family compares them against the source and the evidence, and picks one or merges minimally. Its output is an MQM-style
            list of errors per candidate, which is also a useful signal for the editor.
          </li>
          <li>The existing QA checks and correction pass then run on the winner, and the editor validates it.</li>
        </ol>
        <p>
          Avoid ranking candidates with one neural metric (COMET, MetricX). Systems optimised that way win on the metric and lose with humans. Cost roughly
          triples, which at GMT’s volume stays in the tens of dollars a month.
        </p>
      </div>

      <h2>Fine-tuning and self-hosting</h2>
      <div className="card-grid">
        <div className="card">
          <h3>What can be fine-tuned</h3>
          <ul>
            <li>
              <b>Claude:</b> no fine-tuning for current models (we found no offering; the last tunable Claude on Bedrock reached end of life in 2026).
            </li>
            <li>
              <b>OpenAI:</b> fine-tuning is being wound down and is closed to new users.
            </li>
            <li>
              <b>Google Vertex AI:</b> supervised tuning for Gemini 3.5 Flash / Flash-Lite and 2.5 Pro, not 3.1 Pro.
            </li>
            <li>
              <b>Open weights:</b> full control. Gemma 4 31B (Apache 2.0) is the strongest open model in WMT26 en→de.
            </li>
          </ul>
        </div>
        <div className="card">
          <h3>What the data says</h3>
          <ul>
            <li>
              Fine-tuning an 8B model on one company’s translation memory: worse than the base model at 1–2k segments, about +13 BLEU / +25 COMET at 207k
              (Vieira et al., 2024). GMT has 190k FR→EN pairs, the right order of magnitude.
            </li>
            <li>A tuned model learns the house voice in its weights rather than from a few examples, so it is a strong candidate for the comparison pool.</li>
            <li>It will not learn terms that are rare in the data. Keep the glossary in the prompt.</li>
          </ul>
        </div>
        <div className="card">
          <h3>Self-hosting</h3>
          <ul>
            <li>
              A 27–31B model needs one 80 GB GPU in BF16, or a 48 GB card in FP8. Serve it with vLLM or SGLang (Hugging Face TGI is in maintenance mode).
            </li>
            <li>A dedicated GPU costs roughly $1,500–2,000 a month, far more than API usage at a few hundred articles a month.</li>
            <li>Worth it for confidentiality requirements, or as the training and serving stack of the fine-tune experiment.</li>
            <li>
              Licences to avoid: Hunyuan-MT (excludes the EU, UK and South Korea), Tower+ 9B (non-commercial), TranslateGemma (2K-token input, too short
              for our prompts).
            </li>
          </ul>
        </div>
      </div>

      <h2>Recommendation</h2>
      <div className="table-wrap panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Question</th>
              <th>Answer for GMT</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Fine-tune or prompt + retrieval?</td>
              <td>Prompt + retrieval on a frontier model as the backbone. Fine-tune an open model as an experiment, entered as a candidate.</td>
            </tr>
            <tr>
              <td>Self-host or API?</td>
              <td>API. Self-host only for the fine-tune experiment or a confidentiality requirement.</td>
            </tr>
            <tr>
              <td>Semantic search in addition to BM25?</td>
              <td>No for now. Our measurement shows BM25 retrieves terminology better. Do term-aware retrieval and coverage re-ranking instead.</td>
            </tr>
            <tr>
              <td>Agentic comparison?</td>
              <td>Yes, after the test set exists: multi-model candidates, a cross-family judge, minimal merge, deterministic checks.</td>
            </tr>
            <tr>
              <td>German?</td>
              <td>The weakest link: no GMT German data yet. Aligning the 10 magazines is the single most valuable data task.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Plan</h2>
      <div>
        {PHASES.map(([when, title, items]) => (
          <div key={when} className="phase">
            <div>
              <div className="label">{when}</div>
              <h3>{title}</h3>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {items.map((x) => (
                <li key={x} style={{ marginBottom: 4 }}>
                  {x}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <h2>Sources</h2>
      <ol className="sources">
        <li>Kocmi et al., WMT 2026 General MT findings — aclanthology.org/2026.wmt-main.48</li>
        <li>Kocmi et al., WMT 2025 General MT findings — aclanthology.org/2025.wmt-1.22</li>
        <li>Semenov et al., WMT 2025 Terminology task findings — aclanthology.org/2025.wmt-1.30</li>
        <li>Lavie et al., WMT 2025 Automated evaluation findings — aclanthology.org/2025.wmt-1.24</li>
        <li>Agrawal et al., Findings ACL 2023 (in-context example selection for MT) — aclanthology.org/2023.findings-acl.564</li>
        <li>Vilar et al., ACL 2023 (prompting for translation, example quality) — arxiv.org/abs/2211.09102</li>
        <li>Zebaze, Sagot &amp; Bawden, 2024 (similarity-search example selection) — arxiv.org/abs/2408.00397</li>
        <li>Rios et al., EAMT 2026 (TM retrieval for LLM translation, medical domain) — aclanthology.org/2026.eamt-1.34</li>
        <li>Li et al., 2025 (domain knowledge vs retrieved demonstrations) — arxiv.org/abs/2503.05010</li>
        <li>Vieira et al., 2024 (fine-tuning on a company translation memory) — arxiv.org/abs/2409.03454</li>
        <li>Xu et al., ALMA (ICLR 2024) and CPO / ALMA-R (ICML 2024) — arxiv.org/abs/2309.11674, arxiv.org/abs/2401.08417</li>
        <li>TEaR, Findings NAACL 2025 (translate, estimate, refine) — arxiv.org/abs/2402.16379</li>
        <li>Briakou et al., 2024 (step-by-step translation) — arxiv.org/abs/2409.06790</li>
        <li>Raunak et al., Findings EMNLP 2023 (GPT-4 as post-editor) — arxiv.org/abs/2305.14878</li>
        <li>Kovacs, Deutsch &amp; Freitag, WMT 2024 (metric bias in MBR decoding) — aclanthology.org/2024.wmt-1.109</li>
        <li>Juraska et al., MetricX-24 — arxiv.org/abs/2410.03983; Guerreiro et al., xCOMET — arxiv.org/abs/2310.10482</li>
        <li>Model cards and licences: Gemma 4 (Apache 2.0), TranslateGemma, Tower+, Hunyuan-MT-7B; Vertex AI, OpenAI and Bedrock tuning docs (retrieved Nov 2026)</li>
      </ol>
    </main>
  );
}
