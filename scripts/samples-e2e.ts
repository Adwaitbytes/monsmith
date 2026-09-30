// Runs the real report pipeline on every reference contract in public/samples
// and prints each one's score and section status, so a change to the pipeline
// can be checked against the contracts the start screen offers.
//
// usage: node --import tsx --import ./tests/register.mjs scripts/samples-e2e.ts [id]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import dotenv from "dotenv";
import type { RepoReport, Section } from "../lib/report/types.ts";
dotenv.config({ path: ".env.local", quiet: true });
const { buildRepoReport } = await import("../lib/report/build.ts");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
const targets: Record<string, string> = {
  "the-dao": "contracts/TheDAO.sol",
  "weth9": "contracts/WETH9.sol",
  "compound-comp": "contracts/Comp.sol",
  "uniswap-v2": "contracts/UniswapV2Pair.sol",
  "uniswap-v3": "contracts/UniswapV3Pool.sol",
};
const only = process.argv[2];
for (const [id, main] of Object.entries(targets)) {
  if (only && only !== id) continue;
  const root = `public/samples/${id}`;
  const files: Record<string, string> = {};
  for (const f of walk(root)) files[`${id}/${relative(root, f)}`] = readFileSync(f, "utf8");
  const t0 = Date.now();
  let final: RepoReport | null = null;
  for await (const ev of buildRepoReport({ files, origin: { kind: "workspace" }, cap: 10, only: [`${id}/${main}`] })) {
    if (ev.type === "complete") final = ev.report;
    if (ev.type === "error") console.log(id, "ERROR", ev.message);
  }
  const c = (final as RepoReport | null)?.contracts[0];
  const sections = c === undefined ? [] : (Object.entries(c.sections) as Array<[string, Section<unknown>]>);
  const sec = Object.fromEntries(sections.map(([kind, section]) => [kind, section.status === "failed" ? `failed: ${section.failure.reason.slice(0, 120)}` : section.status]));
  console.log(JSON.stringify({ id, secs: Math.round((Date.now() - t0) / 1000), health: final?.health, counts: final?.counts, contracts: final?.contracts.map((contract) => contract.name), sec }));
}
