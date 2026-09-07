/**
 * How parallel are the contracts actually deployed on Monad?
 *
 * Runs the parallel analyser over every verified contract Sourcify holds for
 * Monad mainnet and reports what share of them contain state that forces their
 * own transactions to run one at a time.
 *
 * The claim this exists to support is that a chain executing 10,000
 * transactions a second does not mean the contracts on it do. That is an
 * empirical statement about a population, so it is answered by measuring the
 * population rather than by reasoning about it.
 *
 * Deliberately sequential with a delay. An earlier concurrent run lost 70% of
 * the sample to rate limiting, and a biased sample is worse than a smaller one.
 *
 * Run: node scripts/corpus-parallelism.mjs
 */

import { analyzeParallelPotential } from "./lib/parallelAnalyzer.ts";

const CHAIN = "143";
const listed = [];
let after;
while (listed.length < 700) {
  const r = await fetch(`https://sourcify.dev/server/v2/contracts/${CHAIN}?limit=200${after ? `&afterMatchId=${after}` : ""}`);
  const j = await r.json();
  if (!j.results?.length) break;
  listed.push(...j.results);
  after = j.results[j.results.length - 1].matchId;
}
console.log(`listed: ${listed.length} verified contracts on Monad mainnet`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
let ok = 0, noEntry = 0, notSolidity = 0; const http = new Map();

// Sequential with a small delay: the earlier run lost 70% of the sample to
// rate limiting, and a biased sample is worse than a smaller one.
for (const { address } of listed) {
  try {
    const r = await fetch(`https://sourcify.dev/server/v2/contract/${CHAIN}/${address}?fields=sources,compilation`);
    if (!r.ok) { http.set(r.status, (http.get(r.status) ?? 0) + 1); await sleep(r.status === 429 ? 1500 : 120); continue; }
    const d = await r.json();
    if (d.compilation?.language !== "Solidity") { notSolidity++; await sleep(80); continue; }
    const flat = Object.values(d.sources ?? {}).map((s) => s?.content ?? "").join("\n");
    if (flat.length < 50) { notSolidity++; await sleep(80); continue; }
    ok++;
    const a = analyzeParallelPotential(flat, d.compilation?.name);
    if (a.totalFunctions === 0) { noEntry++; await sleep(80); continue; }
    rows.push({
      name: d.compilation?.name ?? address.slice(0, 10), addr: address,
      entrypoints: a.totalFunctions, blocked: a.metrics.pairsBlocked,
      total: a.metrics.pairsTotal, score: a.score,
      globals: a.hotspots.filter((h) => h.scope === "global" && h.blockedPairs > 0).map((h) => h.variable),
    });
    await sleep(80);
  } catch { await sleep(200); }
}

const n = rows.length;
const pct = (x) => ((x / n) * 100).toFixed(1);
const serial = rows.filter((r) => r.blocked > 0);
// A pair blocked only by an ownership slot is real but rarely exercised, so it
// is counted separately rather than folded into the headline.
const ownerOnly = serial.filter((r) => r.globals.length > 0 && r.globals.every((g) => /owner|admin|_paused|pending/i.test(g)));
const substantive = serial.filter((r) => !ownerOnly.includes(r));

console.log(`\nfetched ok ${ok} | scorable ${n} | no entrypoints ${noEntry} | non-solidity ${notSolidity}`);
console.log("http errors:", [...http.entries()].map(([k, v]) => `${k}x${v}`).join(" ") || "none");
console.log(`\n=== ${n} verified Monad mainnet contracts ===`);
console.log(`at least one always-serialising pair : ${serial.length}  (${pct(serial.length)}%)`);
console.log(`  of which only owner/admin slots    : ${ownerOnly.length}  (${pct(ownerOnly.length)}%)`);
console.log(`  contending on operational state    : ${substantive.length}  (${pct(substantive.length)}%)`);
console.log(`fully parallel                       : ${n - serial.length}  (${pct(n - serial.length)}%)`);
const s = rows.map((r) => r.score).sort((a, b) => a - b);
console.log(`score: median ${s[Math.floor(s.length/2)]}  p25 ${s[Math.floor(s.length*0.25)]}  min ${s[0]}`);
console.log(`scoring below 100                    : ${rows.filter(r=>r.score<100).length}  (${pct(rows.filter(r=>r.score<100).length)}%)`);
console.log(`scoring below 70                     : ${rows.filter(r=>r.score<70).length}  (${pct(rows.filter(r=>r.score<70).length)}%)`);
