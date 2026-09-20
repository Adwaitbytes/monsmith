# Monsmith: Contract Report, studio IA cut, GitHub import, paid unlock

Date: 2026-09-21
Status: approved, in implementation

## Why

Feedback from Monad: the studio shows too many buttons and a new user cannot
tell what the product does. Importing a contract by address is good; importing a
whole GitHub repository would be better. A single click should produce an audit
covering every analysis the product offers. A half report shown free, with the
full report unlocked by a small payment, is the intended commercial shape.

Measured starting point: `app/studio/page.tsx` is 3,204 lines with 55 clickable
elements. The top bar alone carries 17 controls, nine of which are unlabelled
32px icons; two of those nine use the identical `Gauge` icon for different
panels. A first visit presents roughly 37 competing controls and no entry point.

## Decisions taken

1. Full-repo audit runs every analysis for every contract, always.
2. GitHub access is a GitHub App (per-repo install, `Contents: read`), not an
   OAuth App. Unauthenticated URL paste stays as the zero-friction path.
3. The paid unlock settles in MON over the existing q402 rail. First report per
   account is free.
4. The studio chrome cut is the full one: 17 top-bar controls down to 4.

## Architecture

### The Contract Report is the spine

One artifact assembled from engines that already exist: `/api/security`,
`lib/parallel/analyzer`, `lib/gasProfiler`, `lib/chainfit/report`. Everything
else points at it. Onboarding cards launch it, GitHub import feeds it, the right
rail displays it, the paywall redacts it.

`lib/report/types.ts` is the single contract between every track. Nothing else
in the system may define the report shape.

### Streaming, because "everything always" exceeds one request

`/api/chain-fit` compiles with solc and runs a full local EVM trace, capped at
60s. A twelve-contract repository is 50-100s of work. So the report is produced
by a streaming route, not a request/response:

    POST /api/report  -> text/event-stream, runtime nodejs, maxDuration 300
      event: section  { contractId, section, result }
      event: progress { done, total, label }
      event: complete { reportId }
      event: failed   { contractId, section, reason }

The rail fills progressively. Results persist to Neon under `reportId` so a
report has a permalink and survives reload.

Honesty guardrails:
- Skip `test/`, `mock/`, `script/`, `node_modules/`, `lib/forge-std/`, and
  interface-only sources. OpenZeppelin compiles as a dependency, is not audited
  as user code.
- Per-contract budget of 25s. A contract that exceeds it renders as "not
  measured" with the reason, rather than failing the report.
- Contract cap by tier (free 10, pro 50). Over the cap, audit the largest N by
  entrypoint count and say so in plain text in the report.

### GitHub import

Two sources behind one interface (`lib/github/source.ts`):
- `publicSource`: unauthenticated REST. No login, no redirect. Public repos.
- `installationSource`: GitHub App installation token. Private repos, repo
  picker, 5,000 requests/hour.

Install flow: `github.com/apps/<slug>/installations/new?state=<csrf>` ->
`/api/github/callback` -> `installation_id` stored against the Clerk user id in
Neon -> installation tokens minted on demand (RS256 App JWT via `jose`), cached
in memory by expiry.

Required environment: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`,
`GITHUB_APP_PRIVATE_KEY`. Absent, the studio still runs and the public path
still works, matching how `authConfigured()` and `analyticsConfigured()` already
degrade.

### Paid unlock

`redactReport(report, entitled)` in `lib/report/redact.ts` is the only place that
decides what a free viewer sees, and it runs server-side before serialization.
A free response never contains a paid field.

Free: health score and grade, parallel score and grade, true counts by severity,
the two lowest-severity findings in full, total deploy gas, one line per section.
Paid: every finding with file, line, excerpt and fix; per-function gas; the
chain-by-chain reprice; the conflict graph with storage slots; permalink.

`POST /api/report/[id]/unlock` reuses the q402 challenge/verify/settle pattern
already working in `app/api/agent/route.ts`.

### Studio IA

`page.tsx` is decomposed before the chrome is cut, because a 17-to-4 change
cannot be made safely in a 3,204-line component.

Top bar after the cut, four controls: logo plus breadcrumb, the command palette
hint, one primary action, the account menu. Network, theme, language and wallet
move into the account menu or the palette. Wallet connect fires just in time when
Deploy is pressed.

The six side-panel toggles are deleted. Their components become sections of one
always-present right rail (`ReportRail`), or palette-invoked overlays for the two
rarer ones (migration, interact). Actions that used to sit in chrome permanently
now appear inside the result they follow: Interact appears in the deploy success
card, Fix appears on a finding.

## Build order

1. Report engine, streaming route, Neon persistence
2. Studio decomposition, chrome cut, palette, rail, start cards
3. GitHub public path, then the App install flow and repo picker
4. Redaction and q402 unlock
