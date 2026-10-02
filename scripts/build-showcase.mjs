// Builds the prepared report and optimization for each starter contract.
//
// The five contracts on the start screen are the same for everyone, so running
// the audit and the optimizer for each click spends model credit to produce an
// answer we already have. This runs both once, through the real pipeline on a
// running server, and saves the result next to the sources in
// public/samples/<id>/showcase.json, which the studio plays back on click.
// Both reports are stored and marked unlocked, so their share links and
// downloads work for anyone.
//
// Run against a local server started with the strongest models, for example:
//   OPENROUTER_MODEL=anthropic/claude-sonnet-5.5 OPTIMIZER_MODEL=anthropic/claude-sonnet-5.5 \
//   REPORTS_PAYWALL= RATE_LIMIT=off npx next dev -p 3000
// usage: BASE=http://localhost:3000 node scripts/build-showcase.mjs [id ...]

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";

dotenv.config({ path: ".env.local", quiet: true });

const BASE = process.env.BASE ?? "http://localhost:3000";
const VISITOR = "showcase";
const MAIN = {
    "the-dao": "contracts/TheDAO.sol",
    "uniswap-v2": "contracts/UniswapV2Pair.sol",
    "uniswap-v3": "contracts/UniswapV3Pool.sol",
    weth9: "contracts/WETH9.sol",
    "compound-comp": "contracts/Comp.sol",
};

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

function filesFor(id) {
    const root = `public/samples/${id}`;
    const files = {};
    for (const path of walk(root)) {
        if (path.endsWith(".sol")) files[`${id}/${relative(root, path)}`] = readFileSync(path, "utf8");
    }
    return files;
}

async function stream(path, body) {
    const response = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-visitor-id": VISITOR },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${path} ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const text = await response.text();
    return text
        .split("\n\n")
        .map((frame) => frame.replace(/^data: /, "").trim())
        .filter((payload) => payload.length > 0)
        .map((payload) => JSON.parse(payload));
}

async function build(id) {
    const started = Date.now();
    const files = filesFor(id);
    const path = `${id}/${MAIN[id]}`;

    const reportEvents = await stream("/api/report", { files, origin: { kind: "workspace" }, visitorId: VISITOR, only: [path] });
    const report = reportEvents.find((event) => event.type === "complete")?.report;
    if (report === undefined) throw new Error(`${id}: the report did not complete`);

    const optimizeEvents = await stream("/api/optimize", { reportId: report.reportId, path, files });
    const failure = optimizeEvents.find((event) => event.type === "error");
    const optimization = optimizeEvents.find((event) => event.type === "done")?.result;
    if (optimization === undefined) throw new Error(`${id}: optimize failed: ${failure?.message ?? "no result"}`);

    const fetched = await fetch(`${BASE}/api/report/${optimization.reportId}`, { headers: { "x-visitor-id": VISITOR } });
    const optimizedReport = (await fetched.json()).report;
    if (optimizedReport === undefined) throw new Error(`${id}: the optimized report could not be read`);

    if (sql !== null) {
        for (const reportId of [report.reportId, optimizedReport.reportId]) {
            await sql`
                INSERT INTO report_unlocks (report_id, visitor_id, provider)
                VALUES (${reportId}, ${VISITOR}, 'showcase')
                ON CONFLICT (report_id) DO UPDATE SET provider = 'showcase'
            `;
        }
    }

    writeFileSync(
        `public/samples/${id}/showcase.json`,
        JSON.stringify({ path, source: files[path], report, optimization, optimizedReport }),
    );
    const before = optimization.before;
    const after = optimization.after;
    return `${id}: ${before.score}${before.grade} -> ${after.score}${after.grade}, ${optimization.changes.length} changes, ${Math.round((Date.now() - started) / 1000)}s`;
}

const ids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(MAIN);
const results = await Promise.allSettled(ids.map((id) => build(id)));
for (const [index, result] of results.entries()) {
    console.log(result.status === "fulfilled" ? result.value : `${ids[index]}: FAILED ${result.reason?.message ?? result.reason}`);
}
