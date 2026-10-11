import { describe, it } from "vitest";
import { createTestIndexer } from "envio";

const SOURCE = "0x1111111111111111111111111111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222222222222222222222222222";
const TARGET = "0x00000000000000000000000000000000000000aa" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

const attested = (sourceHash: string, target: `0x${string}`, score: bigint, critical: bigint, high: bigint) => ({
  contract: "MonsmithAttestations" as const,
  event: "Attested" as const,
  params: {
    sourceHash,
    chainId: 143n,
    target,
    score,
    critical,
    high,
    reportHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
    reportURI: "https://www.monsmith.com/report/r1",
  },
});

describe("Monsmith attestation ledger", () => {
  it("keeps every attestation, the latest word per source and deployment, and running totals", async (t) => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        143: {
          simulate: [
            attested(SOURCE, TARGET, 39n, 1n, 2n),
            attested(OTHER, ZERO, 79n, 0n, 0n),
            attested(SOURCE, TARGET, 82n, 0n, 0n),
          ],
        },
      },
    });

    const all = await indexer.Attestation.getAll();
    t.expect(all.length).toBe(3);
    t.expect(all.filter((row) => row.reattested).length).toBe(1);

    const source = await indexer.AuditedSource.getOrThrow(SOURCE);
    t.expect(source.firstScore).toBe(39);
    t.expect(source.latestScore).toBe(82);
    t.expect(source.attestations).toBe(2);

    // Source audited before deployment is not a deployment.
    const deployment = await indexer.Deployment.getOrThrow(`143_${TARGET}`);
    t.expect(deployment.sourceHash).toBe(SOURCE);
    t.expect((await indexer.Deployment.getAll()).length).toBe(1);

    const stats = await indexer.AgentStats.getOrThrow("monsmith");
    t.expect(stats).toMatchObject({ attestations: 3, sources: 2, deployments: 1, scoreSum: 200, criticalFound: 1, highFound: 2 });
  });

  it("indexes the real attestations on Monad mainnet", async (t) => {
    if (process.env.ENVIO_API_TOKEN === undefined || process.env.ENVIO_API_TOKEN.startsWith("<")) {
      t.skip();
      return;
    }
    const indexer = createTestIndexer();
    const result = await indexer.process({ chains: { 143: {} } });
    t.expect(result.changes[0]?.eventsProcessed ?? 0).toBeGreaterThan(0);
  }, 120_000);
});
