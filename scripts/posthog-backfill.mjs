/**
 * One-time backfill of the first-party analytics (Neon `events`) into PostHog,
 * so PostHog (and DeltaV) reflect the real historical traction that predates the
 * PostHog integration.
 *
 * These are genuine, already-recorded events: we re-send each one with its
 * original timestamp, visitor, geo, and device. `historical_migration` tells
 * PostHog these are backdated. Each event carries a deterministic uuid derived
 * from its DB id, so re-running the script does not create duplicates.
 *
 * Run: node --env-file=.env.local scripts/posthog-backfill.mjs
 */
import { neon } from "@neondatabase/serverless";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://monad-studio.vercel.app";
const SESSION_GAP_MS = 30 * 60 * 1000; // a new session after 30 min idle

if (!KEY || !process.env.DATABASE_URL) {
  console.error("Need NEXT_PUBLIC_POSTHOG_KEY and DATABASE_URL (use --env-file=.env.local).");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

/** Deterministic v4-shaped uuid from a stable string, so re-runs dedupe. */
function stableUuid(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  const a = hex(h);
  const b = hex(Math.imul(h ^ 0x9e3779b9, 0x85ebca6b));
  const c = hex(Math.imul(h ^ 0xc2b2ae35, 0x27d4eb2f));
  const d = hex(Math.imul(h ^ 0x165667b1, 0x94d049bb));
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${c.slice(1, 4)}-${c.slice(4)}${d.slice(0, 4)}`;
}

function deviceType(device, os) {
  const s = `${device || ""} ${os || ""}`.toLowerCase();
  if (/mobile|iphone|android(?!.*tablet)/.test(s)) return "Mobile";
  if (/tablet|ipad/.test(s)) return "Tablet";
  return "Desktop";
}

function referringDomain(referrer) {
  if (!referrer) return "$direct";
  try {
    return new URL(referrer).hostname;
  } catch {
    return "$direct";
  }
}

async function main() {
  const rows = await sql`
    SELECT id, visitor_id, event_type, status, duration_ms, detail,
           created_at, country, city, region, browser, os, device, referrer, path
    FROM events
    ORDER BY visitor_id, created_at ASC
  `;
  console.log(`Loaded ${rows.length} events from Neon.`);

  // Assign a session id per visitor, splitting on 30-min idle gaps.
  const sessionByRow = new Map();
  let lastVisitor = null;
  let lastTime = 0;
  let sessionSeed = "";
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (r.visitor_id !== lastVisitor || t - lastTime > SESSION_GAP_MS) {
      sessionSeed = `${r.visitor_id}:${r.id}`;
    }
    sessionByRow.set(r.id, stableUuid(`sess:${sessionSeed}`));
    lastVisitor = r.visitor_id;
    lastTime = t;
  }

  const batch = rows.map((r) => {
    const isView = r.event_type === "page_view";
    const path = r.path || "/";
    const url = `${SITE}${path.startsWith("/") ? path : `/${path}`}`;
    const props = {
      distinct_id: r.visitor_id,
      $geoip_disable: true,
      $current_url: url,
      $pathname: path,
      $host: new URL(SITE).host,
      $session_id: sessionByRow.get(r.id),
      $device_type: deviceType(r.device, r.os),
      $browser: r.browser || undefined,
      $os: r.os || undefined,
      $geoip_country_name: r.country || undefined,
      $geoip_city_name: r.city || undefined,
      $referrer: r.referrer || "$direct",
      $referring_domain: referringDomain(r.referrer),
      $insert_id: stableUuid(`evt:${r.id}`),
      status: r.status,
      duration_ms: r.duration_ms ?? undefined,
      imported: true,
      ...(r.detail && typeof r.detail === "object" ? { detail: r.detail } : {}),
    };
    return {
      event: isView ? "$pageview" : r.event_type,
      timestamp: new Date(r.created_at).toISOString(),
      properties: props,
    };
  });

  const chunkSize = 200;
  let ok = 0;
  for (let i = 0; i < batch.length; i += chunkSize) {
    const chunk = batch.slice(i, i + chunkSize);
    const res = await fetch(`${HOST}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: KEY, historical_migration: true, batch: chunk }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`Chunk ${i / chunkSize + 1} failed (${res.status}): ${text.slice(0, 300)}`);
      process.exit(1);
    }
    ok += chunk.length;
    console.log(`Sent ${ok}/${batch.length}`);
  }
  console.log(`Done. Backfilled ${ok} events into PostHog. It may take a few minutes to appear.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
