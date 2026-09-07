/**
 * Runs the parallel analyser over well-known production DeFi contracts.
 *
 * The question this answers is whether the analysis holds up on real code
 * rather than on templates: Uniswap V3 flattens to 96 files, the V3 factory to
 * 390, and Seaport to 1 MB. Sources come from Sourcify, so the input is exactly
 * what is deployed and verified on Ethereum mainnet.
 *
 * The result worth looking at is the spread. A tool that graded everything well
 * would be useless; this separates UniswapV3Pool, where a reentrancy lock packed
 * into slot0 serialises every entrypoint against every other, from Seaport,
 * where no pair collides at all.
 *
 * Run: node scripts/analyse-defi-suite.mjs
 */

import { analyzeParallelPotential } from "./lib/parallelAnalyzer.ts";

const TARGETS = [
  ["UniswapV3Pool",              "1", "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"],
  ["UniswapV3Factory",           "1", "0x1F98431c8aD98523631AE4a59f267346ea31F984"],
  ["NonfungiblePositionManager", "1", "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
  ["SwapRouter02",               "1", "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"],
  ["UniswapV2Pair",              "1", "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc"],
  ["Seaport 1.6",                "1", "0x0000000000000068F116a894984e2DB1123eB395"],
];

console.log("contract                      files   KB   ms   eps  score  blocked/total  top serialising slot");
for (const [label, chain, addr] of TARGETS) {
  try {
    const r = await fetch(`https://sourcify.dev/server/v2/contract/${chain}/${addr}?fields=sources,compilation`);
    if (!r.ok) { console.log(`${label.padEnd(28)} not verified on sourcify (${r.status})`); continue; }
    const d = await r.json();
    const files = Object.keys(d.sources ?? {}).length;
    const flat = Object.values(d.sources ?? {}).map(s => s?.content ?? "").join("\n");
    const t0 = Date.now();
    const a = analyzeParallelPotential(flat, d.compilation?.name);
    const ms = Date.now() - t0;
    const top = a.hotspots.filter(h=>h.scope==="global"&&h.blockedPairs>0)[0];
    console.log(
      (d.compilation?.name ?? label).slice(0,28).padEnd(28),
      String(files).padStart(5),
      String(Math.round(flat.length/1024)).padStart(5),
      String(ms).padStart(4),
      String(a.totalFunctions).padStart(5),
      `${a.score}${a.grade}`.padStart(6),
      `${a.metrics.pairsBlocked}/${a.metrics.pairsTotal}`.padStart(14),
      "  " + (top ? `${top.variable} (${top.blockedPairs} pairs)` : "none")
    );
  } catch (e) { console.log(`${label.padEnd(28)} ERROR ${e.message.slice(0, 50)}`); }
}
