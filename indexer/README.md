# Monsmith attestation ledger (Envio HyperIndex)

Indexes every `Attested` event from `MonsmithAttestations`
(`0xfa57831Fcb96Effc1E36d41e44Cd0fb1aC16de77`, Monad mainnet, chain 143) through
HyperSync, from its deployment block 112388073.

Why an indexer: the contract keeps only the latest attestation per source, so
the history lives in the event log, and the public Monad RPC answers
`eth_getLogs` over at most 100 blocks while Monad makes about 216,000 blocks a
day.

Entities (see `schema.graphql`):

- `Attestation`: one row per event, with `reattested` set when a source is audited again
- `AuditedSource`: first and latest score per source hash
- `Deployment`: the latest attestation per deployed contract
- `AgentStats`: running totals for the agent

The app reads it at `/api/attestations` and shows it as the ledger on `/verify`.
Set `ENVIO_GRAPHQL_URL` to the hosted endpoint; with only `ENVIO_API_TOKEN` set,
the app reads HyperSync directly instead.

```sh
cp .env.example .env   # add ENVIO_API_TOKEN from https://envio.dev/app/api-tokens
pnpm install --ignore-workspace
pnpm codegen
pnpm test              # handler tests; the mainnet test runs when a token is set
pnpm dev               # local Postgres + Hasura (needs Docker)
```

Hosted: deploy this folder on Envio's hosted service (root directory `indexer`,
config `config.yaml`).
