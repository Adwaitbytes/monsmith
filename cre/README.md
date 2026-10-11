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

## On Monad mainnet

- MonsmithVerdicts: `0x37c8ced74d81b7c6aa8515b0cc0798bb6d4bd2bc`, wired to CRE's simulation forwarder `0x9eF6468C5f37b976E57d52054c693269479A784d`
- First verdict, from `cre workflow simulate --broadcast` on The DAO's attestation: [`0x0b1b6e7b…c94b`](https://monadvision.com/tx/0x0b1b6e7bd92ea0a220abdc582a542caefb9bd3ceb8eb91d5e8436186c9fec94b). The nodes agreed the report is intact; `isConfirmed(sourceHash, 30)` returns true.
- Second verdict, on a fresh audit published from the studio (MyToken, score 85, attestation [`0x1a295209…bcfc`](https://monadvision.com/tx/0x1a295209f50c6a47ea6ca0cc26db496ac814ff78631288c92c63f97e6420bcfc)): [`0x830d99a0…a015`](https://monadvision.com/tx/0x830d99a07aa5915e284e7bf9baa670efe0a7b84adeb55aae6be77a3576cca015). The nodes agreed the report is intact; `isConfirmed(sourceHash, 80)` returns true.

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
