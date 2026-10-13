# Two wallets, two jobs: the Dynamic identity flip

The smallest example of the difference between an agent's signing identity and the developer's own wallet, without learning the rest of Monsmith.

- **The developer's wallet** is human-controlled. It deploys, pays and approves.
- **The agent's wallet** is a Dynamic server wallet, `TWO_OF_TWO`. One key share is on the server and one is with Dynamic, both are needed to sign, so the full key never sits on one machine.
- **Whoever owns the ERC-8004 identity NFT is the agent.**

[`AgentGate.sol`](../../contracts/examples/AgentGate.sol) has one function, `act()`, which only the current owner of one agent identity can call. It reads `ownerOf(agentId)` on every call, so moving the identity moves the power to act.

## The flip, on Monad mainnet

Run on 14 Oct 2026 with [`scripts/dynamic-identity-flip.mjs`](../../scripts/dynamic-identity-flip.mjs). It uses a fresh demo agent, so Monsmith's own identity (#10332) was never touched.

| Step | What happened | Proof |
| --- | --- | --- |
| 1 | The developer wallet `0x4C0c…9247` registers agent **#10402** | [tx](https://monadscan.com/tx/0x6f5cbebe79dd85172ef9880a0c4ea319da6b8b9d883faabcd1de0016c02c1b55) |
| 1 | It deploys AgentGate `0xd9ff…a14f` for that agent | [tx](https://monadscan.com/tx/0xc9f0caedbf344b41eb09864d0f69529b5e6366e960c17abe2a65422eb0dadf1f) |
| 2 | The developer calls `act()`: allowed | [tx](https://monadscan.com/tx/0x175208fec6b36fc99dc74fefb63166d3957afcedb1861652ef979fedd9efb7dd) |
| 2 | The Dynamic wallet `0x37E6…a683` calls `act()`: refused, `NotTheAgent` | simulated, no gas spent |
| 3 | The identity NFT moves to the Dynamic wallet | [tx](https://monadscan.com/tx/0xc12860eb13d9aba38493cf1a7c64e645ec29023dd41f29fbdd017bcea1751055) |
| 4 | The Dynamic wallet calls `act()`: allowed, signed by MPC | [tx](https://monadscan.com/tx/0x93b084015cb0d7b0a81c0066e68336268a286bceb028cfbb2a77910843e4ecf6) |
| 4 | The developer calls `act()` on the gate it deployed: refused, `NotTheAgent` | simulated, no gas spent |

Watching your own wallet get locked out of a contract you deployed is the lesson. The developer did not stop being the developer. It stopped being the agent.

## Run it

Locally, free, on the same EVM Monsmith's gas profiler uses:

```sh
node --import tsx --import ./tests/register.mjs --test tests/agent-gate.test.ts
```

On Monad mainnet, with a developer key and a Dynamic server wallet in `.env.local` (created by [`scripts/dynamic-agent-wallet.mjs`](../../scripts/dynamic-agent-wallet.mjs)):

```sh
node scripts/dynamic-identity-flip.mjs
```

Monsmith itself works this way. Its identity #10332 is owned by its Dynamic wallet, and [`MonsmithAttestations`](../../contracts/attest/MonsmithAttestations.sol) checks `ownerOf` on every write, so the attestations follow the identity, not a key.
