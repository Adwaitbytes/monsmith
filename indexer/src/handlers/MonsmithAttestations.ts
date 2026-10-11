import { indexer } from "envio";

const ZERO = "0x0000000000000000000000000000000000000000";
const STATS = "monsmith";

indexer.onEvent(
  {
    contract: "MonsmithAttestations",
    event: "Attested",
    fields: { transaction: ["hash"], block: ["timestamp"] },
  },
  async ({ event, context }) => {
    const { sourceHash, chainId, target, score, critical, high, reportHash, reportURI } = event.params;
    const id = `${event.block.number}_${event.logIndex}`;
    const timestamp = event.block.timestamp;

    const [source, stats] = await Promise.all([context.AuditedSource.get(sourceHash), context.AgentStats.get(STATS)]);

    context.Attestation.set({
      id,
      sourceHash,
      auditedChainId: chainId,
      target,
      score: Number(score),
      critical: Number(critical),
      high: Number(high),
      reportHash,
      reportURI,
      reattested: source !== undefined,
      blockNumber: event.block.number,
      timestamp,
      txHash: event.transaction.hash,
    });

    context.AuditedSource.set({
      id: sourceHash,
      latest_id: id,
      firstScore: source?.firstScore ?? Number(score),
      latestScore: Number(score),
      attestations: (source?.attestations ?? 0) + 1,
    });

    let newDeployment = false;
    if (target.toLowerCase() !== ZERO) {
      const key = `${chainId}_${target.toLowerCase()}`;
      newDeployment = (await context.Deployment.get(key)) === undefined;
      context.Deployment.set({ id: key, auditedChainId: chainId, target, latest_id: id, sourceHash });
    }

    context.AgentStats.set({
      id: STATS,
      attestations: (stats?.attestations ?? 0) + 1,
      sources: (stats?.sources ?? 0) + (source === undefined ? 1 : 0),
      deployments: (stats?.deployments ?? 0) + (newDeployment ? 1 : 0),
      scoreSum: (stats?.scoreSum ?? 0) + Number(score),
      criticalFound: (stats?.criticalFound ?? 0) + Number(critical),
      highFound: (stats?.highFound ?? 0) + Number(high),
      lastAttestedAt: timestamp,
    });
  },
);
