// Runs before `next build`: makes sure data/bundle.json.gz exists.
// The bundle holds GMT / FH / brand texts, so it is gitignored and kept in the private
// Hugging Face dataset (uploaded by `uv run trad-gmt export-web --app --push`).
// CLI deploys upload the local copy; Git-triggered builds download it with HF_TOKEN.
// Without it the build fails, so Vercel keeps the previous production deployment.
import { createWriteStream, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "bundle.json.gz");
const repo = process.env.BUNDLE_REPO ?? "AdleBenSalem/watchmaking-fr-en-de";
const path = process.env.BUNDLE_PATH ?? "webapp/bundle.json.gz";

const isGzip = (file) => {
  const head = readFileSync(file).subarray(0, 2);
  return head[0] === 0x1f && head[1] === 0x8b;
};

if (existsSync(out) && isGzip(out)) {
  console.log(`bundle: using local ${out}`);
  process.exit(0);
}

const token = process.env.HF_TOKEN;
if (!token) {
  console.error(
    `bundle: ${out} is missing and HF_TOKEN is not set.\n` +
      `  Build it with \`uv run trad-gmt export-web --app\`, or set HF_TOKEN (read access to ${repo}).`,
  );
  process.exit(1);
}

const url = `https://huggingface.co/datasets/${repo}/resolve/main/${path}`;
const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
if (!res.ok || !res.body) {
  console.error(`bundle: download failed (${res.status} ${res.statusText}) from ${url}`);
  process.exit(1);
}
await mkdir(dirname(out), { recursive: true });
const tmp = `${out}.part`;
await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
if (!isGzip(tmp)) {
  rmSync(tmp);
  console.error(`bundle: ${url} is not a gzip file`);
  process.exit(1);
}
renameSync(tmp, out);
console.log(`bundle: downloaded ${repo}/${path}`);
