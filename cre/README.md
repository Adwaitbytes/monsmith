# Monsmith attestation verifier (Chainlink CRE)

A Chainlink DON's second opinion on every audit Monsmith attests on Monad mainnet.

Monsmith publishes each audit to `MonsmithAttestations`
(`0xfa57831Fcb96Effc1E36d41e44Cd0fb1aC16de77`) under its ERC-8004 identity
(agent #10332). That is one party's word. This workflow makes it two:

1. **EVM log trigger** on `Attested` events from that contract, on `monad-mainnet`.
2. **EVM read** of the attestation that is current at finalized depth
   (`ofSource`). An event a re-audit has already replaced gets no verdict.
3. **HTTP, every node, identical consensus**: each node asks the public verifier
   (`https://www.monsmith.com/api/verify?source=<hash>`) whether the published
   report still hashes to what was attested, and the nodes must agree on
   `intact` or `altered`. A verifier that cannot answer produces no verdict
   rather than an accusation.
4. **EVM write** of the signed verdict `(sourceHash, score, reportHash, reportMatches)`
   through the Keystone forwarder to `MonsmithVerdicts` on Monad mainnet.

A contract that wants more than Monsmith's word calls
`MonsmithVerdicts.isConfirmed(sourceHash, minScore)`. It answers yes only for the
attestation that is current on chain, so a re-audit is never vouched for by the
verdict on the audit before it.

The receiver contract is `contracts/cre/MonsmithVerdicts.sol` in the main
repository, tested in `test/MonsmithVerdicts.test.cjs`.

## Run it

```sh
cd attestation-verifier && bun install && bun test && cd ..

# Replay a real Monsmith attestation from Monad mainnet (The DAO, score 39):
cre workflow simulate attestation-verifier --non-interactive --trigger-index 0 \
  --evm-tx-hash 0x89ef26f578557606b3f960182ab4879cbe3caa9d51cec7cbb5be1c6fdafc41c3 \
  --evm-event-index 0 -T staging-settings

# Deliver the verdict for real: deploy the receiver wired to CRE's simulation
# forwarder on Monad mainnet, put its address in config.staging.json as
# verdictsAddress, set CRE_ETH_PRIVATE_KEY in .env, and add --broadcast.
node ../scripts/deploy-verdicts.mjs simulation
```

`bindings`: `cre generate-bindings evm -l typescript` from the ABIs in
`contracts/evm/src/abi/`.
