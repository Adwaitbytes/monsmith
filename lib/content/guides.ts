/**
 * Long-form developer guides, served at /learn/[slug].
 *
 * Each guide targets one search intent (a question people actually type), is
 * written to be quoted by answer engines, and links out to the glossary and
 * back into the product. Content is data, not markdown, so it renders on the
 * server with real headings, lists, and code that crawlers can index.
 */

import { FOUNDER, MONAD } from "../seo";

export type Block =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; lang: string; code: string }
  | { type: "callout"; text: string }
  | { type: "table"; head: string[]; rows: string[][] };

export type HowToStep = { name: string; text: string };

export type Guide = {
  slug: string;
  title: string;
  /** Under 60 chars, for the <title> tag. Falls back to title. */
  seoTitle?: string;
  description: string;
  keywords: string[];
  category: "Monad" | "Solidity" | "Security" | "Tooling" | "Gas";
  level: "Beginner" | "Intermediate" | "Advanced";
  published: string;
  updated: string;
  readMinutes: number;
  blocks: Block[];
  faq: { q: string; a: string }[];
  related: string[];
  terms: string[];
  howTo?: { name: string; steps: HowToStep[] };
};

const AUTHOR = FOUNDER.name;

export const GUIDES: Guide[] = [
  /* ------------------------------------------------------------ Monad */
  {
    slug: "what-is-monad",
    title: "What is Monad? The parallel EVM blockchain explained for developers",
    seoTitle: "What is Monad? Parallel EVM Explained for Developers",
    description:
      "Monad is an EVM-compatible Layer 1 with optimistic parallel execution, 300 ms blocks, 600 ms finality, and a 10,000 TPS target. Here is what changes for Solidity developers and what stays the same.",
    keywords: ["what is Monad", "Monad blockchain", "Monad explained", "parallel EVM", "Monad chain ID", "Monad vs Ethereum"],
    category: "Monad",
    level: "Beginner",
    published: "2026-01-12",
    updated: "2026-09-10",
    readMinutes: 7,
    terms: ["monad", "parallel-evm", "monadbft", "optimistic-parallel-execution", "finality", "tps"],
    related: ["monad-vs-ethereum", "monad-testnet-guide", "parallel-execution-solidity"],
    blocks: [
      { type: "p", text: "Monad is a Layer 1 blockchain that runs the Ethereum Virtual Machine with a completely rebuilt engine underneath. Your Solidity contracts, your Hardhat scripts, your MetaMask: all of it works unchanged. What changes is the speed at which the chain processes what you send it." },
      { type: "callout", text: `The numbers: ${MONAD.blockTimeMs} ms block time, ${MONAD.finalityMs} ms deterministic finality, a ${MONAD.tps} transactions-per-second design target, mainnet chain ID ${MONAD.mainnetChainId}, testnet chain ID ${MONAD.testnetChainId}, native token ${MONAD.symbol}.` },
      { type: "h2", text: "Why Monad exists" },
      { type: "p", text: "Ethereum executes the transactions in a block one at a time, on a single thread, and then does consensus, then executes the next block. That serial pipeline caps throughput at a few dozen transactions per second no matter how fast the hardware is. Most scaling work moved to Layer 2 rollups, which inherit Ethereum's security but add bridges, sequencers, and minutes-to-days of settlement." },
      { type: "p", text: "Monad's bet is that the base layer itself can be fast if four pieces are redesigned together: consensus, execution, state storage, and the way they overlap in time." },
      { type: "h2", text: "The four pieces" },
      { type: "h3", text: "1. MonadBFT consensus" },
      { type: "p", text: "A pipelined, HotStuff-derived Byzantine fault tolerant protocol. Validators agree on the order of transactions in a block while the previous block is still being voted on. That pipelining is what allows sub-second blocks with deterministic finality." },
      { type: "h3", text: "2. Asynchronous execution" },
      { type: "p", text: "Consensus decides order first; execution happens afterwards, off the critical path. Validators do not have to finish running every transaction before agreeing on the next block, so execution gets a full block interval of time rather than a small slice of it." },
      { type: "h3", text: "3. Optimistic parallel execution" },
      { type: "p", text: "Transactions in a block are run concurrently across CPU cores on the assumption they do not conflict. Each one records what storage it read and wrote. Results are then committed in the block's original order, and any transaction whose reads were invalidated by an earlier write is re-executed. The end state is bit-for-bit identical to serial execution." },
      { type: "h3", text: "4. MonadDb" },
      { type: "p", text: "A custom state database built for the access patterns of the EVM, with asynchronous I/O so that many storage reads can be in flight at once. Parallel execution is pointless if every SLOAD waits on disk one at a time." },
      { type: "h2", text: "What stays the same for Solidity developers" },
      { type: "ul", items: [
        "Solidity, Vyper, and the standard compiler outputs (bytecode, ABI) are unchanged.",
        "Hardhat, Foundry, Remix, ethers.js, viem, and wagmi work as-is with the Monad RPC.",
        "Wallets add Monad like any EVM network: RPC URL, chain ID, symbol, explorer.",
        "OpenZeppelin and other Solidity libraries deploy unchanged.",
      ] },
      { type: "h2", text: "What is different, and matters" },
      { type: "table", head: ["Property", "Ethereum mainnet", "Monad"], rows: [
        ["Block time", "~12 s", `${MONAD.blockTimeMs} ms`],
        ["Finality", "~13 min", `${MONAD.finalityMs} ms`],
        ["Execution", "Serial", "Optimistic parallel"],
        ["Max contract size", "24 KB", `${MONAD.maxCodeSizeKb} KB`],
        ["Max init code size", "48 KB", `${MONAD.maxInitCodeSizeKb} KB`],
        ["Block gas limit", "~36M", MONAD.blockGasLimit],
        ["Fee charged on", "Gas used", "Gas limit"],
      ] },
      { type: "p", text: "Two of those rows change how you write code. The contract size limit removes the reason many teams split logic across proxies and libraries. And because Monad charges on the gas limit rather than gas used, an inflated limit is money left on the table; the deploy tooling you use should estimate tightly." },
      { type: "h2", text: "Writing for parallel execution" },
      { type: "p", text: "Nothing forces you to think about parallelism; a contract that would be serial on Ethereum is still correct on Monad. But a contract whose functions all touch the same storage slot (a global counter, a single total, one shared array) will serialise every transaction that calls it, and you leave most of the chain's throughput unused. Designing storage so that unrelated users touch unrelated slots is the skill that separates a contract that merely runs on Monad from one that benefits from it." },
      { type: "p", text: "Monsmith's parallel profiler was built for exactly this: paste a contract and it draws the dependency graph between functions and storage, scores each function, and tells you which pattern to change." },
      { type: "h2", text: "How to try it" },
      { type: "ol", items: [
        "Open the Monsmith studio at monsmith.com/studio; no account or wallet is needed to compile and analyse.",
        "Paste any Solidity contract or start from the ERC-20 template.",
        "Run the audit and the parallel profiler.",
        `Connect a wallet on Monad testnet (chain ID ${MONAD.testnetChainId}), get free MON from ${MONAD.faucet}, and deploy.`,
      ] },
    ],
    faq: [
      { q: "Is Monad EVM compatible?", a: "Yes. Monad is EVM bytecode compatible and exposes the standard Ethereum JSON-RPC, so Solidity contracts, Hardhat, Foundry, MetaMask, and existing libraries work unchanged." },
      { q: "What is Monad's chain ID?", a: `Monad mainnet is chain ID ${MONAD.mainnetChainId}. Monad testnet is chain ID ${MONAD.testnetChainId}.` },
      { q: "How fast is Monad?", a: `Monad produces a block every ${MONAD.blockTimeMs} milliseconds and reaches deterministic finality in about ${MONAD.finalityMs} milliseconds, with a design target of ${MONAD.tps} transactions per second.` },
      { q: "Is Monad a Layer 2?", a: "No. Monad is an independent Layer 1 blockchain with its own consensus (MonadBFT) and validator set. It does not settle to Ethereum." },
    ],
  },
  {
    slug: "how-to-deploy-a-smart-contract-on-monad",
    title: "How to deploy a smart contract on Monad (step by step, from the browser)",
    seoTitle: "How to Deploy a Smart Contract on Monad (Step by Step)",
    description:
      "Deploy a Solidity smart contract to Monad testnet in under ten minutes using only a browser: add the network to MetaMask, get test MON, compile in Monsmith, and deploy with one click.",
    keywords: ["deploy smart contract Monad", "Monad deploy contract", "Monad testnet deploy", "how to deploy on Monad", "Monad Remix", "Monad MetaMask"],
    category: "Monad",
    level: "Beginner",
    published: "2026-01-20",
    updated: "2026-09-10",
    readMinutes: 8,
    terms: ["deployment", "monad-testnet", "faucet", "wallet", "constructor", "abi"],
    related: ["monad-testnet-guide", "what-is-monad", "solidity-online-compiler"],
    howTo: {
      name: "Deploy a smart contract on Monad testnet",
      steps: [
        { name: "Add Monad testnet to your wallet", text: `In MetaMask choose Add network and enter RPC URL ${MONAD.testnetRpc}, chain ID ${MONAD.testnetChainId}, currency symbol ${MONAD.symbol}, and block explorer ${MONAD.testnetExplorer}.` },
        { name: "Get test MON", text: `Visit ${MONAD.faucet}, paste your wallet address, and request test tokens. They arrive within seconds.` },
        { name: "Open Monsmith", text: "Go to monsmith.com/studio. Paste your Solidity contract or pick a template such as ERC-20." },
        { name: "Compile", text: "Press Compile. Fix any errors shown inline. The ABI and bytecode appear when compilation succeeds." },
        { name: "Audit and profile", text: "Run the security audit and the parallel profiler. Address anything flagged as high risk before deploying." },
        { name: "Deploy", text: "Connect your wallet, fill in constructor arguments, and press Deploy. Confirm the transaction in MetaMask." },
        { name: "Verify on the explorer", text: "Open the contract address on the Monad testnet explorer to confirm the code is live, then call its functions from the deploy console." },
      ],
    },
    blocks: [
      { type: "p", text: "Deploying to Monad is the same motion as deploying to any EVM chain, with one pleasant difference: it is fast and nearly free. This guide uses Monsmith so the whole thing happens in a browser tab, but every step maps directly onto Hardhat or Foundry if you prefer a local toolchain." },
      { type: "h2", text: "Before you start" },
      { type: "ul", items: [
        "A browser wallet such as MetaMask, Rabby, or Phantom.",
        "A Solidity contract, or the willingness to use a template.",
        "Nothing else. No Node.js, no compiler install, no RPC key.",
      ] },
      { type: "h2", text: "Step 1: Add Monad testnet to your wallet" },
      { type: "table", head: ["Field", "Value"], rows: [
        ["Network name", "Monad Testnet"],
        ["RPC URL", MONAD.testnetRpc],
        ["Chain ID", String(MONAD.testnetChainId)],
        ["Currency symbol", MONAD.symbol],
        ["Block explorer", MONAD.testnetExplorer],
      ] },
      { type: "p", text: "Monsmith will prompt your wallet to add and switch to this network automatically when you press Deploy, so you can also skip this and let the tool do it." },
      { type: "h2", text: "Step 2: Get test MON from the faucet" },
      { type: "p", text: `Open ${MONAD.faucet}, paste your address, and request tokens. Deploying a typical ERC-20 costs a small fraction of one MON, so a single faucet claim covers dozens of deployments.` },
      { type: "h2", text: "Step 3: Write or paste your contract" },
      { type: "p", text: "Open monsmith.com/studio. The editor is Monaco (the same engine as VS Code) with Solidity highlighting and autocomplete. OpenZeppelin imports resolve without any package install. If you are starting from scratch, the ERC-20 template is a good first contract:" },
      { type: "code", lang: "solidity", code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MyToken is ERC20, Ownable {
    constructor(uint256 initialSupply)
        ERC20("My Token", "MTK")
        Ownable(msg.sender)
    {
        _mint(msg.sender, initialSupply);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}` },
      { type: "h2", text: "Step 4: Compile" },
      { type: "p", text: "Press Compile. Errors show inline at the offending line. On success you get the ABI and bytecode, and the deploy console builds a form for the constructor arguments from the ABI, so you never hand-encode anything." },
      { type: "h2", text: "Step 5: Audit and profile before you deploy" },
      { type: "p", text: "This is the step most guides skip and the one that saves you. Run the security audit: it checks for reentrancy, missing access control, unchecked calls, and other known bug classes, and scores the risk. Then run the parallel profiler to see whether your contract's functions can execute concurrently on Monad or whether shared storage will serialise them." },
      { type: "h2", text: "Step 6: Deploy" },
      { type: "p", text: "Connect your wallet, enter constructor arguments (for the token above, an initial supply such as 1000000000000000000000000 for one million tokens with 18 decimals), and press Deploy. MetaMask shows the transaction; confirm it. Monad's 300 ms blocks mean the contract address appears almost immediately." },
      { type: "h2", text: "Step 7: Verify and interact" },
      { type: "p", text: "Click the explorer link to view the deployed contract. Back in Monsmith, the deploy console lists every function from the ABI so you can call `mint`, `transfer`, or `balanceOf` directly and watch the results." },
      { type: "h2", text: "Going to mainnet" },
      { type: "p", text: `The steps are identical with the mainnet RPC (${MONAD.mainnetRpc}, chain ID ${MONAD.mainnetChainId}) and real MON. Before you do: get an independent audit for anything that holds value, and use Chain Fit at monsmith.com/compare to see exactly what deployment and each function call will cost.` },
    ],
    faq: [
      { q: "Can I deploy to Monad without a wallet?", a: "No. Deployment is a signed transaction, so a wallet is required. Writing, compiling, auditing, and profiling in Monsmith need no wallet." },
      { q: "How much does it cost to deploy a contract on Monad?", a: "On testnet it is free (faucet MON). On mainnet a typical ERC-20 deployment costs a tiny fraction of what it costs on Ethereum; Chain Fit at monsmith.com/compare shows the live figure." },
      { q: "Can I use Remix to deploy on Monad?", a: "Yes, Remix works with Monad through MetaMask. Monsmith adds an AI audit, a parallel profiler, and Chain Fit on top of the same browser workflow." },
    ],
  },
  {
    slug: "monad-testnet-guide",
    title: "Monad testnet guide: chain ID, RPC URL, faucet, explorer, and wallet setup",
    seoTitle: "Monad Testnet: Chain ID, RPC, Faucet & Wallet Setup",
    description:
      "Everything you need to connect to Monad testnet: chain ID 10143, the RPC URL, the faucet, the block explorer, and how to add it to MetaMask, Hardhat, and Foundry.",
    keywords: ["Monad testnet", "Monad chain ID", "Monad RPC URL", "Monad faucet", "Monad testnet MetaMask", "Monad explorer", "10143"],
    category: "Monad",
    level: "Beginner",
    published: "2026-01-25",
    updated: "2026-09-10",
    readMinutes: 5,
    terms: ["monad-testnet", "rpc", "faucet", "wallet", "testnet"],
    related: ["how-to-deploy-a-smart-contract-on-monad", "what-is-monad"],
    blocks: [
      { type: "p", text: "Copy-paste reference for Monad's networks, followed by the exact configuration for the tools people actually use." },
      { type: "h2", text: "Monad testnet" },
      { type: "table", head: ["Field", "Value"], rows: [
        ["Chain ID", String(MONAD.testnetChainId)],
        ["RPC URL", MONAD.testnetRpc],
        ["Currency", MONAD.symbol],
        ["Explorer", MONAD.testnetExplorer],
        ["Faucet", MONAD.faucet],
      ] },
      { type: "h2", text: "Monad mainnet" },
      { type: "table", head: ["Field", "Value"], rows: [
        ["Chain ID", String(MONAD.mainnetChainId)],
        ["RPC URL", MONAD.mainnetRpc],
        ["Currency", MONAD.symbol],
        ["Explorer", MONAD.mainnetExplorer],
        ["Block time", `${MONAD.blockTimeMs} ms`],
        ["Finality", `${MONAD.finalityMs} ms`],
      ] },
      { type: "h2", text: "MetaMask" },
      { type: "p", text: "Settings, Networks, Add a network manually. Enter the testnet values above. Or open monsmith.com/studio and press Deploy: Monsmith asks MetaMask to add and switch networks for you." },
      { type: "h2", text: "Hardhat" },
      { type: "code", lang: "typescript", code: `// hardhat.config.ts
export default {
  solidity: "0.8.24",
  networks: {
    monadTestnet: {
      url: "${MONAD.testnetRpc}",
      chainId: ${MONAD.testnetChainId},
      accounts: [process.env.PRIVATE_KEY!],
    },
  },
};` },
      { type: "h2", text: "Foundry" },
      { type: "code", lang: "bash", code: `forge create src/MyToken.sol:MyToken \\
  --rpc-url ${MONAD.testnetRpc} \\
  --private-key $PRIVATE_KEY \\
  --constructor-args 1000000000000000000000000` },
      { type: "h2", text: "viem" },
      { type: "code", lang: "typescript", code: `import { defineChain } from "viem";

export const monadTestnet = defineChain({
  id: ${MONAD.testnetChainId},
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "${MONAD.symbol}", decimals: 18 },
  rpcUrls: { default: { http: ["${MONAD.testnetRpc}"] } },
  blockExplorers: { default: { name: "Monad Explorer", url: "${MONAD.testnetExplorer}" } },
  testnet: true,
});` },
      { type: "h2", text: "Things that trip people up" },
      { type: "ul", items: [
        "Fees are charged on the gas limit, not gas used. Let your tooling estimate tightly instead of padding the limit by 50 percent.",
        `Contracts can be up to ${MONAD.maxCodeSizeKb} KB, so a contract that failed Ethereum's 24 KB limit deploys fine here.`,
        "Blocks are 300 ms. If your script waits for a fixed number of confirmations, it will feel instant; if it polls every 12 seconds out of Ethereum habit, it will feel slow for no reason.",
      ] },
    ],
    faq: [
      { q: "What is the Monad testnet chain ID?", a: `The Monad testnet chain ID is ${MONAD.testnetChainId}. Mainnet is ${MONAD.mainnetChainId}.` },
      { q: "What is the Monad testnet RPC URL?", a: `${MONAD.testnetRpc}. The mainnet RPC is ${MONAD.mainnetRpc}.` },
      { q: "Where do I get Monad testnet tokens?", a: `From the official faucet at ${MONAD.faucet}. Test MON has no value and is rate limited per address.` },
    ],
  },
  {
    slug: "monad-vs-ethereum",
    title: "Monad vs Ethereum for smart contract developers: speed, gas, finality, and what changes in your code",
    seoTitle: "Monad vs Ethereum: What Changes for Solidity Developers",
    description:
      "A developer-focused comparison of Monad and Ethereum: block time, finality, gas cost, contract size limits, parallel execution, and the handful of things you should change when you move a contract over.",
    keywords: ["Monad vs Ethereum", "Monad Ethereum comparison", "Monad gas vs Ethereum", "Monad vs Solana", "Monad vs Base", "EVM chain comparison"],
    category: "Monad",
    level: "Intermediate",
    published: "2026-02-02",
    updated: "2026-09-10",
    readMinutes: 8,
    terms: ["monad", "evm", "finality", "tps", "gas-price", "layer-1", "bytecode"],
    related: ["what-is-monad", "monad-gas-fees-explained", "parallel-execution-solidity"],
    blocks: [
      { type: "p", text: "Ethereum is the reference EVM: the most battle-tested, the deepest liquidity, the slowest. Monad is the same virtual machine on an engine built for throughput. Choosing between them is mostly a question of what your application needs from the chain in the first second after a user clicks." },
      { type: "h2", text: "Side by side" },
      { type: "table", head: ["", "Ethereum mainnet", "Monad"], rows: [
        ["Consensus", "Gasper (PoS)", "MonadBFT (PoS)"],
        ["Block time", "~12 s", `${MONAD.blockTimeMs} ms`],
        ["Finality", "~13 min", `${MONAD.finalityMs} ms`],
        ["Execution", "Serial", "Optimistic parallel"],
        ["Throughput", "~15 to 30 TPS", `${MONAD.tps} TPS target`],
        ["Max contract size", "24 KB", `${MONAD.maxCodeSizeKb} KB`],
        ["Typical transfer fee", "Dollars to cents", "Fractions of a cent"],
        ["Fee charged on", "Gas used", "Gas limit"],
        ["Tooling", "Everything", "Everything (same tooling)"],
      ] },
      { type: "h2", text: "What is identical" },
      { type: "p", text: "The bytecode, the opcodes, the ABI, the JSON-RPC surface, the wallets, the libraries. A contract compiled for Ethereum deploys on Monad without recompiling. This is the whole point of an EVM-compatible chain, and Monad is stricter about it than most." },
      { type: "h2", text: "Where it actually differs in your code" },
      { type: "h3", text: "Block timing assumptions" },
      { type: "p", text: "Contracts that use `block.number` as a clock will run 40 times faster on Monad. Anything like \"lock for 100 blocks\" should be expressed in `block.timestamp` seconds instead, on both chains." },
      { type: "h3", text: "Contract size" },
      { type: "p", text: `Ethereum's 24 KB runtime limit forces large contracts into proxy-and-library architectures. Monad's ${MONAD.maxCodeSizeKb} KB limit means many of those can be a single contract again, which is simpler to audit and cheaper to call.` },
      { type: "h3", text: "Gas limit is billed" },
      { type: "p", text: "On Ethereum an overestimated gas limit costs nothing extra. On Monad you pay for the limit, so tooling that pads estimates wastes money. Monsmith's Chain Fit shows both the measured gas and what the limit-based charge would be." },
      { type: "h3", text: "Storage contention" },
      { type: "p", text: "Correctness is unaffected, but a contract whose every function writes the same slot will run serially and gain nothing from parallel execution. See the guide on writing Solidity for parallel execution." },
      { type: "h2", text: "When to choose which" },
      { type: "ul", items: [
        "Choose Ethereum when your application's value comes from composability with existing Ethereum-native liquidity and protocols, and latency is not the product.",
        "Choose Monad when the experience depends on sub-second response: games, order books, payments, social, anything a user interacts with repeatedly in a session.",
        "Measure before you decide. Chain Fit at monsmith.com/compare runs your actual contract and prices every function on each chain with live gas prices.",
      ] },
    ],
    faq: [
      { q: "Is Monad faster than Ethereum?", a: `Yes, by a large margin: ${MONAD.blockTimeMs} ms blocks and ${MONAD.finalityMs} ms finality on Monad versus roughly 12 second blocks and 13 minute finality on Ethereum, with a ${MONAD.tps} TPS design target versus a few dozen.` },
      { q: "Do I need to rewrite my Solidity for Monad?", a: "No. The bytecode is compatible. You may want to revisit block-number timing assumptions and storage layout to benefit from parallel execution, but nothing is required." },
      { q: "Is Monad cheaper than Ethereum?", a: "Substantially. Higher throughput keeps the base fee low. The exact figure for your contract depends on its gas use; Chain Fit measures it." },
    ],
  },
  {
    slug: "monad-gas-fees-explained",
    title: "Monad gas fees explained: how fees are calculated, why the gas limit matters, and how to pay less",
    seoTitle: "Monad Gas Fees Explained: Gas Limit Billing & Costs",
    description:
      "Monad charges transaction fees on the gas limit, not the gas used. Here is what that means, how it compares to Ethereum, and how to keep deployment and call costs low.",
    keywords: ["Monad gas fees", "Monad gas limit", "Monad transaction fee", "Monad gas price", "how much does Monad cost", "Monad fee calculation"],
    category: "Gas",
    level: "Intermediate",
    published: "2026-02-10",
    updated: "2026-09-10",
    readMinutes: 6,
    terms: ["gas", "gas-limit", "gas-price", "mon-token", "revert"],
    related: ["smart-contract-gas-optimization", "monad-vs-ethereum", "what-is-monad"],
    blocks: [
      { type: "p", text: "On almost every EVM chain, a transaction fee equals the gas actually consumed multiplied by the gas price. Monad changes one word: the fee equals the gas limit multiplied by the gas price. It is a small rule with real consequences for how you configure tooling." },
      { type: "h2", text: "Why Monad bills the limit" },
      { type: "p", text: "Parallel execution has to reserve capacity for the worst case before it knows the actual case. If a block's transactions each claim a large gas limit but use little, the scheduler has still had to plan around the limit. Charging for the reservation keeps declared limits honest, which keeps the block full of real work." },
      { type: "h2", text: "What it means in practice" },
      { type: "ul", items: [
        "Padding gas estimates by a fixed percentage, an Ethereum habit, now costs exactly that percentage extra on every transaction.",
        "Accurate estimation matters more than on any other chain. `eth_estimateGas` is your friend; blanket limits are not.",
        "A reverting transaction is charged the full limit, so validating inputs client-side before sending is worth doing.",
      ] },
      { type: "h2", text: "The fee formula" },
      { type: "code", lang: "text", code: `fee (MON) = gasLimit × (baseFee + priorityFee)

Ethereum for comparison:
fee (ETH) = gasUsed  × (baseFee + priorityFee)` },
      { type: "h2", text: "Block and transaction limits" },
      { type: "table", head: ["Limit", "Value"], rows: [
        ["Block gas limit", MONAD.blockGasLimit],
        ["Per-transaction gas limit", MONAD.txGasLimit],
        ["Max runtime bytecode", `${MONAD.maxCodeSizeKb} KB`],
        ["Max init code", `${MONAD.maxInitCodeSizeKb} KB`],
      ] },
      { type: "h2", text: "Measuring your own contract" },
      { type: "p", text: "Chain Fit at monsmith.com/compare executes your contract in a real EVM, records the gas each function uses, then reprices that execution under Monad's schedule and gas-limit rule alongside Ethereum, Base, Arbitrum, and others using live gas prices. It is the fastest way to see what deployment and each call will actually cost in dollars." },
    ],
    faq: [
      { q: "Does Monad charge for gas used or gas limit?", a: "Gas limit. The transaction fee on Monad is the gas limit multiplied by the gas price, so an overestimated limit costs more." },
      { q: "Are Monad fees cheaper than Ethereum?", a: "Yes. Monad's throughput keeps the base fee very low, so typical transfers and calls cost fractions of a cent even though the limit is billed." },
      { q: "What is the block gas limit on Monad?", a: `${MONAD.blockGasLimit} gas per block, with a ${MONAD.txGasLimit} per-transaction cap.` },
    ],
  },

  /* ---------------------------------------------------------- Solidity */
  {
    slug: "parallel-execution-solidity",
    title: "How to write Solidity that runs in parallel on Monad",
    seoTitle: "Writing Solidity for Parallel Execution on Monad",
    description:
      "Practical patterns for parallel-friendly Solidity: avoid shared counters, partition storage by user, keep hot paths off global state, and measure contention with a dependency graph.",
    keywords: ["parallel execution Solidity", "Monad parallel contracts", "storage contention", "parallel EVM optimization", "Monad smart contract optimization"],
    category: "Monad",
    level: "Advanced",
    published: "2026-02-18",
    updated: "2026-09-10",
    readMinutes: 9,
    terms: ["parallel-evm", "optimistic-parallel-execution", "storage-slot", "dependency-graph"],
    related: ["what-is-monad", "smart-contract-gas-optimization", "monad-vs-ethereum"],
    blocks: [
      { type: "p", text: "Monad executes the transactions in a block in parallel and re-runs any that conflicted. Your contract is correct either way. The question is how often it conflicts, because every conflict is a transaction that ran twice and a core that sat idle. This guide is about writing contracts that rarely conflict." },
      { type: "h2", text: "The one rule" },
      { type: "callout", text: "Two transactions can run in parallel if neither writes a storage slot the other reads or writes. Everything below is a consequence of that sentence." },
      { type: "h2", text: "Pattern 1: No global hot slots" },
      { type: "p", text: "A single `totalTransactions` counter incremented by every call is a serialisation point: every transaction writes it, so no two can overlap. If you need the number, derive it from events off-chain or shard it." },
      { type: "code", lang: "solidity", code: `// Serialises everything
uint256 public totalMints;
function mint() external { totalMints++; ... }

// Parallel-friendly: per-user state, count off-chain from Mint events
mapping(address => uint256) public minted;
event Mint(address indexed by, uint256 id);
function mint() external { minted[msg.sender]++; emit Mint(msg.sender, ...); }` },
      { type: "h2", text: "Pattern 2: Partition by actor" },
      { type: "p", text: "Mappings keyed by `msg.sender`, by token ID, by market, or by pool put unrelated activity in unrelated slots. An ERC-20 transfer touches two balances; thousands of transfers between different pairs are fully independent." },
      { type: "h2", text: "Pattern 3: Keep aggregates lazy" },
      { type: "p", text: "Where a running total is truly needed on-chain (total supply, total staked), accept that writes to it serialise, and keep it off the hottest path. Mint and burn update supply; transfer does not need to touch it." },
      { type: "h2", text: "Pattern 4: Beware the shared array" },
      { type: "p", text: "`push` writes the length slot. Every push conflicts with every other push. Prefer mappings with a per-key index, or emit an event and let an indexer keep the list." },
      { type: "h2", text: "Pattern 5: External calls carry their callee's slots" },
      { type: "p", text: "If every function calls into one router contract that updates a shared fee accumulator, you have inherited that contract's contention. Look at the whole call graph, not just your own storage." },
      { type: "h2", text: "Measuring it" },
      { type: "p", text: "Guessing is unreliable. Monsmith's parallel profiler reads your contract, builds the dependency graph between functions and the storage slots they touch, scores each function from fully parallel to fully serial, and lists the specific variables causing conflicts. Run it before and after a refactor and the score tells you whether the change helped." },
      { type: "h2", text: "What not to do" },
      { type: "ul", items: [
        "Do not break correctness for parallelism. A conflicting transaction is re-executed, not lost.",
        "Do not micro-optimise a contract with ten calls a day. Contention only matters under load.",
        "Do not assume Ethereum gas tricks apply. Packing several values into one slot saves gas but concentrates writes on that slot.",
      ] },
    ],
    faq: [
      { q: "Does my Solidity need changes to run on Monad?", a: "No changes are required for correctness. Changes to storage layout can increase how much of Monad's parallel throughput your contract benefits from." },
      { q: "What causes transactions to conflict on Monad?", a: "A transaction conflicts when it reads a storage slot that an earlier transaction in the same block wrote. Global counters, shared arrays, and single aggregate variables are the usual causes." },
      { q: "How do I measure storage contention?", a: "Use Monsmith's parallel profiler at monsmith.com/studio. It draws the dependency graph and scores each function." },
    ],
  },
  {
    slug: "what-is-a-smart-contract",
    title: "What is a smart contract? A plain-English explanation with a real example",
    seoTitle: "What Is a Smart Contract? Plain-English Guide + Example",
    description:
      "A smart contract is a program on a blockchain that runs exactly as written when someone sends it a transaction. Here is how they work, what they are used for, and a real ten-line example you can deploy.",
    keywords: ["what is a smart contract", "smart contract explained", "smart contract example", "how do smart contracts work", "smart contract definition", "smart contracts for beginners"],
    category: "Solidity",
    level: "Beginner",
    published: "2026-01-05",
    updated: "2026-09-10",
    readMinutes: 6,
    terms: ["smart-contract", "solidity", "evm", "deployment", "gas"],
    related: ["how-to-learn-solidity", "how-to-deploy-a-smart-contract-on-monad", "what-is-monad"],
    blocks: [
      { type: "p", text: "A smart contract is a small program that lives on a blockchain. Anyone can send it a transaction; it runs the matching function, updates its own stored data, and possibly moves tokens. No company operates it, nobody can switch it off, and everyone can read its code and its state." },
      { type: "h2", text: "The vending machine analogy, and where it breaks" },
      { type: "p", text: "The classic description is a vending machine: put in a coin, press a button, get a snack, no shopkeeper. That captures the automation. It misses the second property, which is that the machine's rules and its entire transaction history are public and verifiable by anyone. A smart contract is a vending machine with glass walls and a ledger bolted to the side." },
      { type: "h2", text: "How they actually work" },
      { type: "ol", items: [
        "A developer writes the contract in a language such as Solidity and compiles it to bytecode.",
        "They deploy it: a transaction that stores the bytecode at a new address on the chain.",
        "Users send transactions to that address. Each carries a function selector and arguments.",
        "Every node on the network runs the function and agrees on the resulting state.",
        "The contract's storage is updated, events are emitted, and the transaction is included in a block.",
      ] },
      { type: "h2", text: "A real example" },
      { type: "code", lang: "solidity", code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Guestbook {
    mapping(address => string) public message;
    event Signed(address indexed who, string message);

    function sign(string calldata text) external {
        message[msg.sender] = text;
        emit Signed(msg.sender, text);
    }
}` },
      { type: "p", text: "Anyone can call `sign`. Each address gets one message slot, which only that address can change. Reading `message(addr)` is free; writing costs gas. That is a complete, deployable smart contract. You can paste it into monsmith.com/studio, compile it, and put it on Monad testnet in about two minutes." },
      { type: "h2", text: "What they are used for" },
      { type: "ul", items: [
        "Tokens: ERC-20 currencies and stablecoins, ERC-721 NFTs.",
        "Decentralised finance: exchanges, lending, derivatives, all as contracts.",
        "Games and social apps where items and identity are owned by users.",
        "Escrow, payroll, vesting, and other agreements that pay out on conditions.",
        "Governance: proposals and votes recorded and executed on-chain.",
      ] },
      { type: "h2", text: "What makes them hard" },
      { type: "p", text: "Deployed code cannot be edited. A bug in a normal app gets patched; a bug in a contract that holds funds gets exploited. That is why the discipline around smart contracts is heavier than around ordinary software: audits, formal verification, extensive testnet use, and tooling that finds problems before deployment. It is also why Monsmith runs a security audit on every contract before it lets you press Deploy." },
    ],
    faq: [
      { q: "Are smart contracts legal contracts?", a: "Not by default. A smart contract is code that executes automatically. Whether it also constitutes a legally binding agreement depends on jurisdiction and on what the parties agreed off-chain." },
      { q: "What language are smart contracts written in?", a: "On Ethereum, Monad, and other EVM chains, mostly Solidity, with Vyper as an alternative. Other ecosystems use Rust (Solana), Move (Aptos, Sui), or others." },
      { q: "Can a smart contract be changed after deployment?", a: "The deployed bytecode cannot. Developers use proxy patterns to point an address at new logic, but that must be designed in before deployment." },
    ],
  },
  {
    slug: "how-to-learn-solidity",
    title: "How to learn Solidity in 2026: a practical path from zero to deployed contract",
    seoTitle: "How to Learn Solidity in 2026: Zero to Deployed Contract",
    description:
      "A no-fluff roadmap for learning Solidity: the concepts in order, the mistakes to expect, the tools to use, and a first project you can deploy to Monad testnet this week.",
    keywords: ["learn Solidity", "Solidity tutorial", "Solidity for beginners", "how to learn smart contract development", "Solidity roadmap 2026", "Solidity course"],
    category: "Solidity",
    level: "Beginner",
    published: "2026-01-08",
    updated: "2026-09-10",
    readMinutes: 8,
    terms: ["solidity", "modifier", "event", "openzeppelin", "function-selector"],
    related: ["what-is-a-smart-contract", "solidity-online-compiler", "smart-contract-security-checklist"],
    blocks: [
      { type: "p", text: "Solidity is a small language with a large blast radius. The syntax takes a weekend; the judgement about what not to do takes longer. This path front-loads the judgement." },
      { type: "h2", text: "Week 1: the mental model" },
      { type: "ul", items: [
        "Understand what a transaction is, what gas is, and why storage writes are expensive.",
        "Learn the difference between `storage`, `memory`, and `calldata`.",
        "Write a contract with one mapping, one function that writes it, one event. Compile it in a browser IDE. Deploy it to a testnet. Call it. Read the event on the explorer.",
      ] },
      { type: "p", text: "Do this in a browser, not a local toolchain. Setup friction is the number one reason people stop on day one. Monsmith and Remix both compile in the tab." },
      { type: "h2", text: "Week 2: the standard building blocks" },
      { type: "ul", items: [
        "Modifiers and access control (`onlyOwner`).",
        "Inheritance and interfaces.",
        "OpenZeppelin: read the ERC-20 source top to bottom. It is short and it is what everyone uses.",
        "Build your own token by inheriting ERC-20. Add a mint function guarded by ownership. Deploy it.",
      ] },
      { type: "h2", text: "Week 3: how contracts get hacked" },
      { type: "p", text: "Before you write anything that holds value, study the failure modes: reentrancy, missing access control, unchecked external calls, integer assumptions, front-running, oracle manipulation. Rewrite a vulnerable contract to be safe. Run it through an automated audit and see what it catches and what it misses." },
      { type: "h2", text: "Week 4: a real project" },
      { type: "p", text: "Pick something with two or three contracts that talk to each other: an NFT with a marketplace, a staking pool, an escrow. Write tests. Deploy to Monad testnet. Get a friend to try to break it." },
      { type: "h2", text: "Tools, in the order you will need them" },
      { type: "table", head: ["Stage", "Tool", "Why"], rows: [
        ["Day 1", "Monsmith or Remix", "Zero setup, compile and deploy in the browser"],
        ["Week 2", "OpenZeppelin", "Audited building blocks"],
        ["Week 3", "Monsmith audit", "Automated first-pass security review"],
        ["Week 4", "Hardhat or Foundry", "Local tests, scripts, CI"],
        ["Ongoing", "Chain Fit", "Know what your contract costs on each chain"],
      ] },
      { type: "h2", text: "Habits that separate good Solidity developers" },
      { type: "ul", items: [
        "Checks, effects, interactions, in that order, every function.",
        "Custom errors over revert strings; events for every state change.",
        "Smallest possible privilege for every function.",
        "Measure gas rather than guess. Measure storage contention if you deploy to a parallel chain.",
      ] },
    ],
    faq: [
      { q: "How long does it take to learn Solidity?", a: "The syntax takes about a week for someone who already programs. Being trusted with a contract that holds real value takes months of studying exploits and writing tests." },
      { q: "Do I need to know JavaScript to learn Solidity?", a: "Not to write contracts. You will want JavaScript or TypeScript later for tests, scripts, and front-ends." },
      { q: "Where can I write Solidity without installing anything?", a: "In a browser IDE. Monsmith (monsmith.com/studio) compiles, audits, profiles, and deploys to Monad in the browser with no account required." },
    ],
  },
  {
    slug: "solidity-online-compiler",
    title: "Solidity online compiler: compile and deploy smart contracts in your browser with no setup",
    seoTitle: "Solidity Online Compiler: Compile in the Browser, No Setup",
    description:
      "Compile Solidity online in seconds. Monsmith is a browser Solidity compiler and IDE with OpenZeppelin imports, inline errors, ABI and bytecode output, AI auditing, and one-click deployment to Monad.",
    keywords: ["Solidity online compiler", "online Solidity IDE", "compile Solidity online", "Solidity compiler browser", "Solidity playground", "Remix alternative"],
    category: "Tooling",
    level: "Beginner",
    published: "2026-02-22",
    updated: "2026-09-10",
    readMinutes: 4,
    terms: ["solidity", "bytecode", "abi", "openzeppelin", "ide"],
    related: ["best-smart-contract-ide", "monsmith-vs-remix", "how-to-deploy-a-smart-contract-on-monad"],
    blocks: [
      { type: "p", text: "You do not need Node.js, solc, or a package manager to compile Solidity. A browser compiler runs the real Solidity compiler as WebAssembly or on a server and hands back the same ABI and bytecode a local toolchain would." },
      { type: "h2", text: "Compile Solidity online in three steps" },
      { type: "ol", items: [
        "Open monsmith.com/studio.",
        "Paste your contract. `import \"@openzeppelin/contracts/...\"` works without installing anything.",
        "Press Compile. Errors appear inline; on success you get ABI, bytecode, and a deploy form.",
      ] },
      { type: "h2", text: "What Monsmith's compiler supports" },
      { type: "ul", items: [
        "Solidity 0.8.x with the optimizer on (200 runs by default).",
        "Multi-file projects and OpenZeppelin resolution.",
        "Detailed error and warning messages with the offending line highlighted.",
        "ABI and bytecode you can copy, plus contract size against Monad's 128 KB limit.",
      ] },
      { type: "h2", text: "Beyond compiling" },
      { type: "p", text: "Compiling is the easy part. What most online compilers do not do is tell you whether the contract is safe or what it costs. Monsmith runs a security audit, a parallel execution profiler for Monad, and Chain Fit, which executes your contract and prices it across EVM chains with live gas data. All of that is in the same tab, no account needed." },
      { type: "h2", text: "When to move to a local toolchain" },
      { type: "p", text: "When you need a test suite, CI, deployment scripts across many networks, or fork testing against mainnet state, Hardhat or Foundry is the right tool. The browser compiler remains the fastest way to try an idea, teach, or check a single contract." },
    ],
    faq: [
      { q: "Is there a free Solidity compiler online?", a: "Yes. Monsmith at monsmith.com compiles Solidity in the browser for free with no account. Remix is another free option." },
      { q: "Can I use OpenZeppelin in an online compiler?", a: "In Monsmith, yes. OpenZeppelin imports resolve automatically without a package install." },
      { q: "Can I deploy from an online compiler?", a: "Yes. Connect a browser wallet such as MetaMask and Monsmith deploys to Monad testnet in one click." },
    ],
  },
  {
    slug: "erc20-vs-erc721-vs-erc1155",
    title: "ERC-20 vs ERC-721 vs ERC-1155: which token standard should you use?",
    seoTitle: "ERC-20 vs ERC-721 vs ERC-1155: Which Token Standard?",
    description:
      "The three main EVM token standards compared: fungible ERC-20, non-fungible ERC-721, and multi-token ERC-1155. What each is for, how they differ in gas and interface, and how to pick.",
    keywords: ["ERC20 vs ERC721", "ERC721 vs ERC1155", "token standards explained", "ERC-1155", "which token standard", "NFT standard"],
    category: "Solidity",
    level: "Beginner",
    published: "2026-03-01",
    updated: "2026-09-10",
    readMinutes: 5,
    terms: ["erc-20", "erc-721", "erc-1155", "nft", "openzeppelin"],
    related: ["how-to-learn-solidity", "how-to-deploy-a-smart-contract-on-monad"],
    blocks: [
      { type: "table", head: ["", "ERC-20", "ERC-721", "ERC-1155"], rows: [
        ["Fungible", "Yes", "No", "Both"],
        ["Unit", "Amount", "Token ID", "ID + amount"],
        ["Batch transfer", "No", "No", "Yes"],
        ["Typical use", "Currency, governance", "Collectibles, passes", "Game items, editions"],
        ["Metadata", "None", "Per token", "Per ID"],
      ] },
      { type: "h2", text: "ERC-20: interchangeable units" },
      { type: "p", text: "Every unit equals every other unit. Balances are a mapping from address to amount. Use it for currencies, stablecoins, governance tokens, points. Monsmith's ERC-20 tutorial deploys one to Monad testnet." },
      { type: "h2", text: "ERC-721: one of a kind" },
      { type: "p", text: "Each token has a unique ID and an owner. Metadata (image, attributes) is a URI per token. Use it for anything where identity matters: art, membership, deeds, unique game characters." },
      { type: "h2", text: "ERC-1155: many types in one contract" },
      { type: "p", text: "One contract manages many token IDs, each with its own supply. ID 1 might have a supply of a million (gold coins); ID 2 a supply of one (a legendary sword). Batch transfers move several IDs in one transaction, which is much cheaper. Use it for games and for editions." },
      { type: "h2", text: "On Monad specifically" },
      { type: "p", text: "All three deploy unchanged. For parallel execution, ERC-20 and ERC-721 transfers between different parties are independent and run concurrently. ERC-1155 batch operations touch more slots per transaction, so the per-transaction work is larger but there are fewer transactions." },
    ],
    faq: [
      { q: "Can an NFT be ERC-1155?", a: "Yes. An ERC-1155 ID with a supply of one behaves as a non-fungible token." },
      { q: "Which is cheaper, ERC-721 or ERC-1155?", a: "For single mints they are similar. For minting or transferring many items at once, ERC-1155's batch functions are significantly cheaper." },
    ],
  },

  /* ---------------------------------------------------------- Security */
  {
    slug: "smart-contract-security-checklist",
    title: "Smart contract security checklist: 20 checks before you deploy",
    seoTitle: "Smart Contract Security Checklist: 20 Pre-Deploy Checks",
    description:
      "A practical pre-deployment security checklist for Solidity smart contracts covering reentrancy, access control, external calls, arithmetic, upgrades, and operational safety.",
    keywords: ["smart contract security checklist", "Solidity security", "smart contract vulnerabilities", "reentrancy", "smart contract best practices", "pre-deployment checklist"],
    category: "Security",
    level: "Intermediate",
    published: "2026-02-05",
    updated: "2026-09-10",
    readMinutes: 8,
    terms: ["reentrancy", "checks-effects-interactions", "access-control", "audit", "fallback-function", "private-key", "upgradeable-contract", "revert"],
    related: ["ai-smart-contract-audit", "how-to-learn-solidity", "smart-contract-gas-optimization"],
    blocks: [
      { type: "p", text: "Deployed code cannot be patched. This list is the minimum to walk through before pressing Deploy on anything that holds value. Monsmith's audit automates the mechanical items; the judgement items are yours." },
      { type: "h2", text: "External calls" },
      { type: "ol", items: [
        "Every function follows checks, effects, interactions: validate, update state, then call out.",
        "Functions that transfer value use a reentrancy guard or are provably safe without one.",
        "Return values of low-level `call` are checked; `transfer` and `send` are not relied on for gas semantics.",
        "The contract never assumes a callee is not a contract.",
      ] },
      { type: "h2", text: "Access control" },
      { type: "ol", items: [
        "Every state-changing function has an explicit permission model, even if it is \"anyone\".",
        "Ownership transfer is two-step or otherwise protected against typos.",
        "Privileged functions are minimal, and a compromised key's blast radius is understood.",
        "`tx.origin` is never used for authorisation.",
      ] },
      { type: "h2", text: "Arithmetic and data" },
      { type: "ol", items: [
        "Solidity 0.8 checked arithmetic is on; any `unchecked` block is justified in a comment.",
        "Division happens after multiplication to limit precision loss.",
        "Timestamps and block numbers are used only where miner influence does not matter, and block-based durations are avoided on fast chains.",
        "Randomness never comes from block data.",
      ] },
      { type: "h2", text: "Design" },
      { type: "ol", items: [
        "Every state change emits an event.",
        "Loops over unbounded arrays cannot be forced to run out of gas by a user.",
        "Front-running is considered for any function whose outcome depends on ordering.",
        "External price or data sources are validated; a single oracle is not a single point of failure.",
      ] },
      { type: "h2", text: "Upgrades and operations" },
      { type: "ol", items: [
        "If upgradeable: storage layout is append-only and the upgrade authority is a multisig or timelock.",
        "A pause or circuit breaker exists for contracts holding significant value.",
        "Private keys never appear in source, config, or a browser tab. Deploy through a wallet.",
        "The exact deployed bytecode is verified on the explorer against the audited source.",
      ] },
      { type: "h2", text: "Running the mechanical checks" },
      { type: "p", text: "Paste the contract into monsmith.com/studio and run the audit. It flags reentrancy, missing access control, unchecked calls, dangerous patterns, and gives a risk score with specific suggestions. Treat a clean automated result as the beginning of the review, not the end." },
    ],
    faq: [
      { q: "What is the most common smart contract vulnerability?", a: "Access control mistakes and reentrancy account for a large share of losses. Both are mechanical to detect and cheap to fix before deployment." },
      { q: "Is an automated audit enough?", a: "No. Automated tools catch known patterns. Business logic errors, economic attacks, and novel issues need human review. Use automation to clear the floor so reviewers spend time on judgement." },
    ],
  },
  {
    slug: "ai-smart-contract-audit",
    title: "AI smart contract audit: what automated auditing catches, what it misses, and how to use it well",
    seoTitle: "AI Smart Contract Audit: What It Catches and Misses",
    description:
      "How AI-assisted smart contract auditing works, the vulnerability classes it reliably finds, where it falls short, and how to combine it with static analysis and human review.",
    keywords: ["AI smart contract audit", "automated smart contract audit", "smart contract audit tool", "Solidity vulnerability scanner", "free smart contract audit", "AI Solidity audit"],
    category: "Security",
    level: "Intermediate",
    published: "2026-03-08",
    updated: "2026-09-10",
    readMinutes: 6,
    terms: ["audit", "static-analysis", "reentrancy", "access-control"],
    related: ["smart-contract-security-checklist", "best-smart-contract-ide"],
    blocks: [
      { type: "p", text: "Three kinds of automated review exist. Static analysis pattern-matches source or bytecode against known bad shapes. Dynamic analysis executes the contract, often with fuzzed inputs, and watches for violations. AI review reads the code the way a reviewer would, reasoning about intent, and is good at the things pattern matching is bad at, and vice versa." },
      { type: "h2", text: "What AI auditing reliably catches" },
      { type: "ul", items: [
        "Reentrancy, including cross-function variants that simple pattern matchers miss.",
        "Missing or inconsistent access control (a mint anyone can call).",
        "Unchecked external call results and unsafe low-level calls.",
        "Mismatches between a function's name or comment and what it does.",
        "Obvious logic errors: wrong comparison direction, off-by-one in loops, state updated after a call.",
      ] },
      { type: "h2", text: "What it misses" },
      { type: "ul", items: [
        "Economic attacks that depend on market conditions or multi-block sequences.",
        "Problems that only appear in the interaction between several contracts it cannot see.",
        "Anything requiring knowledge of your business rules that is not in the code.",
        "Novel vulnerability classes with no precedent in its training.",
      ] },
      { type: "h2", text: "Using it well" },
      { type: "ol", items: [
        "Run it early and often, on every compile, not once at the end. Cheap feedback changes how you write.",
        "Fix everything it flags as high risk before spending human review time.",
        "Read its explanations. The reasoning is often more useful than the verdict.",
        "Feed it context: a comment explaining an invariant lets it check the invariant.",
        "Pair it with execution: run the contract in a real EVM and confirm the fixes behave.",
      ] },
      { type: "h2", text: "Monsmith's audit" },
      { type: "p", text: "Monsmith runs an AI-assisted audit in the browser on every contract, scores overall risk, lists findings by severity with the line in question, and proposes concrete fixes. It is free and needs no account. It is designed to be the first pass that clears mechanical issues, so that a human audit, which anything holding real value should still get, can concentrate on judgement." },
    ],
    faq: [
      { q: "Is there a free AI smart contract audit?", a: "Yes. Monsmith at monsmith.com runs an AI-assisted audit on any Solidity contract in the browser for free." },
      { q: "Can AI replace a human smart contract audit?", a: "No. AI review is a fast, cheap first pass that catches known classes of bugs. Contracts that hold significant value still need human review for logic and economic risks." },
    ],
  },

  {
    slug: "kimi-k3-writes-the-threat-model",
    title: "How Kimi K3 writes the threat model behind every Monsmith audit",
    seoTitle: "Kimi K3 Writes Monsmith's Threat Models",
    description:
      "Monsmith audits a contract against a threat model derived from that contract's own assets and invariants. Kimi K3 writes it. Here is why that pass matters most, what Kimi produced for The DAO, and how it is kept fast.",
    keywords: ["Kimi K3", "Kimi smart contract", "Moonshot AI audit", "AI threat model", "smart contract threat modeling", "Monsmith Kimi"],
    category: "Security",
    level: "Advanced",
    published: "2026-10-11",
    updated: "2026-10-11",
    readMinutes: 5,
    terms: ["audit", "reentrancy", "access-control"],
    related: ["qwen-3-8-max-cross-examines-audit-findings", "ai-smart-contract-audit"],
    blocks: [
      { type: "p", text: "Most automated audits ask every contract the same questions: is there reentrancy, is there an unchecked call, is there tx.origin. A vault, a governor and a token get the same checklist. Monsmith does not start from a checklist. It starts by asking what this contract holds, who can touch it, and what must stay true, and then derives what an attacker would try. That threat model decides what the rest of the audit looks for, and Kimi K3 writes it." },
      { type: "h2", text: "Where Kimi sits" },
      { type: "ol", items: [
        "Describe: what the contract does, its assets, actors, invariants and external calls. Fast models.",
        "Threat model: for each asset and invariant, how an attacker would break it in this contract. Kimi K3.",
        "Hunt: concrete attacks tied to lines, tested against Kimi's threats. Claude Sonnet 5.5.",
        "Review: every finding cross-examined, rejected only with a cited line. Qwen 3.8 Max.",
      ] },
      { type: "p", text: "Three model families, each doing the step it is best at, and none checking its own work. If the threat model misses an angle, the hunt is less likely to look there, so this is the pass where a model that reasons about intent before mechanics earns its place." },
      { type: "h2", text: "What it produced for The DAO" },
      { type: "p", text: "The DAO is the start contract in Monsmith's studio. In a run on 11 October 2026, Kimi K3 derived six threats from its description:" },
      { type: "ol", items: [
        "Recursive splitDAO re-entry drains the entire ether pool.",
        "Re-entrant reward payout double-counts or inflates reward claims.",
        "Curator hijack via tx.origin phishing.",
        "Reward dilution via just-in-time token purchase.",
        "Integer overflow breaks minting 1:1 and totalSupply invariants.",
        "Blocked or griefed splitDAO via a failing recipient.",
      ] },
      { type: "p", text: "The first is the 2016 exploit. The second and fourth are less famous and more interesting: a second reentrancy through the reward path, and buying tokens just before rewards arrive to claim rewards earned by others. The hunt turned these into six line-cited findings, two critical and two high, and Qwen 3.8 Max upheld all six." },
      { type: "h2", text: "Kept fast" },
      { type: "p", text: "Kimi K3 reasons before it answers, so it runs with a low reasoning effort and a 25 second limit. If it is slow or unavailable, the fast models write the threat model instead and the report does not credit Kimi. The report's threat model section says which model wrote it, and so does the downloaded Markdown." },
      { type: "h2", text: "Why it matters onchain" },
      { type: "p", text: "When a report is published to Monad, its hash goes onchain under Monsmith's ERC-8004 identity. The threat model and the record of who wrote it are part of that hashed report, so the reasoning behind a score cannot be changed after it is published." },
    ],
    faq: [
      { q: "What does Kimi do in Monsmith?", a: "Kimi K3 writes the threat model for every audited contract: what an attacker would go after, derived from that contract's own assets, actors and invariants. The vulnerability hunt and the review are both built on it." },
      { q: "Which models does a Monsmith audit use?", a: "Fast models describe the contract, Kimi K3 writes the threat model, Claude Sonnet 5.5 hunts for concrete attacks, and Qwen 3.8 Max cross-examines every finding. The report names the models that did the threat model and the review." },
    ],
  },

  {
    slug: "qwen-3-8-max-cross-examines-audit-findings",
    title: "Why Monsmith has Qwen 3.8 Max cross-examine every finding before it reaches a report",
    seoTitle: "Qwen 3.8 Max as the Second Auditor in Monsmith",
    description:
      "How Monsmith uses Qwen 3.8 Max as an independent reviewer in its smart contract audit: why the reviewer comes from a different model family, the rule that it must cite a line to reject anything, what it did on The DAO, and what we had to fix to run it.",
    keywords: ["Qwen 3.8 Max", "Qwen smart contract audit", "AI audit false positives", "multi-model audit", "LLM code review", "Monsmith Qwen"],
    category: "Security",
    level: "Advanced",
    published: "2026-10-11",
    updated: "2026-10-11",
    readMinutes: 6,
    terms: ["audit", "reentrancy", "static-analysis", "access-control"],
    related: ["ai-smart-contract-audit", "smart-contract-security-checklist"],
    blocks: [
      { type: "p", text: "A smart contract audit is trusted or it is ignored. One confident finding that turns out to be wrong costs more trust than three missed low-severity issues cost coverage, because it teaches the reader to skim. The hardest part of an AI audit is not finding things. It is not reporting the things that are not there." },
      { type: "p", text: "Monsmith's answer is a second auditor from a different model family, whose only job is to attack the first one's findings. Since 11 October 2026 that second auditor is Qwen 3.8 Max." },
      { type: "h2", text: "Where it sits in the audit" },
      { type: "p", text: "Every contract goes through four passes, each feeding the next:" },
      { type: "ol", items: [
        "Describe: what the contract does, in functional terms, with no security framing. Fast models.",
        "Threats: what an attacker would go after, derived from this contract's own assets, actors and invariants. Fast models.",
        "Hunt: concrete vulnerabilities, each tied to a line number and an attack that would work against this code. Claude Sonnet 5.5.",
        "Review: every candidate finding is judged by Qwen 3.8 Max, which may uphold it, correct its severity, or reject it.",
      ] },
      { type: "p", text: "Deterministic static analysis runs alongside. What it proves (for example, an external call made before a balance is zeroed) is handed to the reviewer as settled fact that it is not allowed to argue with." },
      { type: "h2", text: "Why a different family" },
      { type: "p", text: "Asking a model to check its own findings mostly returns agreement, because the reasoning that produced a mistake is the same reasoning being asked to catch it. Two models trained by different labs on different data make different mistakes. Putting Qwen behind Claude means a finding has to convince a reader that did not share the hunter's blind spots." },
      { type: "p", text: "Qwen 3.8 Max suits the job for three practical reasons. It reads a whole contract with line numbers at once (its context is a million tokens). It reasons before it answers, which is what judging an attack path needs. And at about 2 dollars per million input tokens and 6 per million output tokens through OpenRouter, a review costs a fraction of a cent to a few cents per contract." },
      { type: "h2", text: "The rule that makes the review safe" },
      { type: "p", text: "Left to its own judgement, a reviewer will sometimes delete a real vulnerability with a confident-sounding sentence. So Monsmith's reviewer works under one hard rule: it may only reject a finding by citing the specific line that prevents the attack, such as a modifier, a require, an ordering or a type constraint. A rejection without a line number is not honoured, and the finding stands. Findings the reviewer does not mention are kept, and if the review fails to run, every finding is kept and the report credits no reviewer." },
      { type: "callout", text: "Deleting a real finding costs far more than leaving a weak one in. The citation rule makes rejection the harder path on purpose." },
      { type: "h2", text: "What it did on The DAO" },
      { type: "p", text: "The DAO is the start contract in Monsmith's studio: a rebuild of the 2016 contract whose splitDAO reentrancy drained about 3.6 million ETH. In a run on 11 October 2026, the review pass received three candidate findings and answered as follows." },
      { type: "table", head: ["Candidate finding", "Qwen 3.8 Max", "Why"], rows: [
        ["Drain ether during withdrawal (the splitDAO reentrancy)", "Upheld, critical", "No line prevents it: ether leaves before the caller's balance is burned."],
        ["Manipulate total supply to exceed the ether contributed", "Rejected", "Cited line 24, require(msg.value > 0): the attack's second step, buying tokens with zero ether, cannot happen."],
        ["Change the curator to a malicious actor", "Rejected", "Cited line 77: the attack assumes the curator's key is already compromised, which is a key-management problem, not a flaw in this contract."],
      ] },
      { type: "p", text: "The real, famous vulnerability survived. The two that did not survive were each rejected with a line a reader can check in seconds. That is the behaviour the reviewer is there for." },
      { type: "h2", text: "What the reader sees" },
      { type: "p", text: "The report's Health section says, for example: \"Every AI finding was cross-examined by Qwen 3.8 Max: 4 findings upheld, 2 candidates rejected for lack of a working attack.\" The same line is in the downloaded Markdown. The model id is recorded from the API response that actually answered, not from configuration, so if Qwen is unavailable and another model stands in, the report names that model instead." },
      { type: "p", text: "When a report is published to Monad, its keccak256 hash goes onchain with the score under Monsmith's ERC-8004 identity. The verification record is part of the hashed report, so who checked the findings, and what they decided, is covered by the attestation and cannot be edited afterwards without the hash ceasing to match." },
      { type: "h2", text: "Two things we had to fix to run it" },
      { type: "ul", items: [
        "Qwen 3.8 Max always reasons; the API refuses a request that turns reasoning off. With the default token cap it spent its budget thinking and timed out. It now runs with reasoning effort set to low and room for 16,000 tokens.",
        "The same investigation found that Claude Sonnet 5.5 sometimes thinks before answering too. In one run it spent 2,341 of a 4,096 token cap reasoning, the findings JSON was cut off mid-sentence, and the audit parsed as empty. Every strong pass now has room, and a completion cut off at its cap fails over to the next model instead of being read as no findings.",
      ] },
      { type: "h2", text: "Limits" },
      { type: "p", text: "A second model is a filter, not a proof. Qwen can uphold a finding that is wrong, and the citation rule means it will sometimes keep a weak one rather than risk deleting a real one. That trade is deliberate. For anything that holds real value, Monsmith's report is a strong first pass and a human audit should still follow." },
    ],
    faq: [
      { q: "Which model does Monsmith use to review audit findings?", a: "Qwen 3.8 Max, through OpenRouter. It cross-examines every finding produced by the hunting model, Claude Sonnet 5.5, and may only reject one by citing the line that prevents the attack." },
      { q: "Why use two different AI models in one audit?", a: "A model checking its own work mostly agrees with itself. A reviewer from a different model family does not share the first model's blind spots, so false positives are caught without deleting real findings." },
      { q: "Does the report say which model checked it?", a: "Yes. The report and its Markdown download name the model that actually answered the review and how many findings it upheld and rejected, and that record is covered by the report hash attested on Monad." },
    ],
  },

  /* ----------------------------------------------------------- Tooling */
  {
    slug: "best-smart-contract-ide",
    title: "Best smart contract IDEs in 2026: Remix vs Hardhat vs Foundry vs Monsmith",
    seoTitle: "Best Smart Contract IDEs 2026: Remix, Hardhat, Foundry, Monsmith",
    description:
      "An honest comparison of the main Solidity development environments in 2026, browser and local, with what each is best at and which to pick for learning, prototyping, Monad, and production.",
    keywords: ["best smart contract IDE", "best Solidity IDE", "Solidity IDE 2026", "Remix vs Hardhat", "Hardhat vs Foundry", "smart contract development tools", "Web3 IDE"],
    category: "Tooling",
    level: "Beginner",
    published: "2026-02-26",
    updated: "2026-09-10",
    readMinutes: 7,
    terms: ["ide", "solidity", "deployment", "audit"],
    related: ["monsmith-vs-remix", "monsmith-vs-hardhat-foundry", "solidity-online-compiler"],
    blocks: [
      { type: "p", text: "There are two families. Browser IDEs (Remix, Monsmith, ChainIDE) open in a tab and need no setup. Local toolchains (Hardhat, Foundry, plus VS Code with extensions) need installation and reward it with tests, scripts, and CI. Most developers end up using one of each." },
      { type: "h2", text: "At a glance" },
      { type: "table", head: ["Tool", "Runs in", "Setup", "Best for", "Weak spot"], rows: [
        ["Remix", "Browser", "None", "Learning, quick prototypes, any EVM chain", "No security or performance analysis built in"],
        ["Monsmith", "Browser", "None", "Monad, AI audit, parallel profiling, cost comparison", "Younger ecosystem; no local test runner"],
        ["Hardhat", "Local (Node)", "Medium", "Tests, scripts, plugins, teams", "Slower tests than Foundry"],
        ["Foundry", "Local (Rust)", "Medium", "Fast tests, fuzzing, Solidity-native scripting", "Steeper learning curve"],
        ["VS Code + extensions", "Local", "Medium", "Editing experience", "Needs Hardhat or Foundry underneath"],
      ] },
      { type: "h2", text: "Remix" },
      { type: "p", text: "The default browser IDE for Ethereum since 2017. Broad plugin ecosystem, works with every EVM chain through MetaMask, and the fastest way to teach someone their first contract. It does not analyse security, gas across chains, or parallel behaviour." },
      { type: "h2", text: "Monsmith" },
      { type: "p", text: "A browser IDE built specifically for Monad by Adwait Keshari. Same zero-setup workflow as Remix, plus an AI security audit on every compile, a parallel execution profiler with a dependency graph, Chain Fit (executes your contract and prices it across EVM chains with live gas), guided migration, and one-click Monad testnet deployment. Free to use, no account required." },
      { type: "h2", text: "Hardhat" },
      { type: "p", text: "The JavaScript/TypeScript toolchain most teams use for production: a local network, a test runner, deployment scripts, and a large plugin ecosystem. Works with Monad by adding the RPC to the config." },
      { type: "h2", text: "Foundry" },
      { type: "p", text: "A Rust toolchain where tests are written in Solidity. Extremely fast, with built-in fuzzing and cheat codes. Preferred by many security-focused teams. Works with Monad via `--rpc-url`." },
      { type: "h2", text: "Recommendation" },
      { type: "ul", items: [
        "Learning Solidity: a browser IDE. Monsmith if you are targeting Monad or want auditing built in; Remix if you want the broadest plugin catalogue.",
        "Building for Monad: Monsmith for writing, auditing, profiling, and first deployments; Foundry or Hardhat for the test suite.",
        "Production on any chain: Hardhat or Foundry for tests and CI, with a browser IDE for quick checks and Chain Fit for cost decisions.",
      ] },
    ],
    faq: [
      { q: "What is the best IDE for Solidity?", a: "For learning and prototyping, a browser IDE such as Monsmith or Remix. For production test suites, Hardhat or Foundry. Most developers use one of each." },
      { q: "What is the best IDE for Monad?", a: "Monsmith is the only IDE built specifically for Monad, with a parallel execution profiler and one-click Monad deployment. Hardhat and Foundry work with Monad for local testing." },
      { q: "Is Remix still the best in 2026?", a: "Remix remains the most widely used browser IDE. Newer tools such as Monsmith add AI auditing, performance profiling, and cross-chain cost analysis that Remix lacks." },
    ],
  },
  {
    slug: "monsmith-vs-remix",
    title: "Monsmith vs Remix IDE: which browser IDE should you use for Monad?",
    seoTitle: "Monsmith vs Remix: Browser IDE Comparison for Monad",
    description:
      "Monsmith and Remix are both free browser Solidity IDEs. Remix is the general-purpose standard; Monsmith is built for Monad with AI auditing, a parallel profiler, and live cross-chain gas comparison. Here is a fair comparison.",
    keywords: ["Monsmith vs Remix", "Remix alternative", "Remix IDE alternative Monad", "browser Solidity IDE comparison", "Monad Remix"],
    category: "Tooling",
    level: "Beginner",
    published: "2026-03-12",
    updated: "2026-09-10",
    readMinutes: 5,
    terms: ["ide", "audit", "parallel-evm", "deployment"],
    related: ["best-smart-contract-ide", "solidity-online-compiler", "how-to-deploy-a-smart-contract-on-monad"],
    blocks: [
      { type: "table", head: ["", "Remix", "Monsmith"], rows: [
        ["Price", "Free", "Free"],
        ["Setup", "None", "None"],
        ["Account required", "No", "No"],
        ["Compile Solidity", "Yes", "Yes"],
        ["OpenZeppelin imports", "Yes (via URL)", "Yes (bundled)"],
        ["Deploy via wallet", "Any EVM chain", "Monad (testnet, one click)"],
        ["AI security audit", "Via plugins", "Built in, every compile"],
        ["Parallel execution profiler", "No", "Yes"],
        ["Cross-chain gas comparison", "No", "Yes (Chain Fit, live prices)"],
        ["Contract migration assistant", "No", "Yes"],
        ["Plugin ecosystem", "Large", "Small"],
        ["Open source", "Yes", "No"],
      ] },
      { type: "h2", text: "Where Remix wins" },
      { type: "p", text: "Breadth, and openness. Remix has years of plugins, supports every EVM chain, includes a debugger with step-through execution, and has documentation and tutorials everywhere. It is also open source, so you can read it, fork it, and run it yourself; Monsmith is a hosted product and you cannot. If you need to deploy to an obscure chain, use a specific plugin, or self-host your tooling, Remix is the answer." },
      { type: "h2", text: "Where Monsmith wins" },
      { type: "p", text: "Depth on Monad and analysis. The audit runs on every compile and explains its findings. The parallel profiler is the only tool that tells you whether your contract will actually benefit from Monad's execution model. Chain Fit runs your contract and prices it across chains with live gas, which no other IDE does. Deployment to Monad testnet is one click including the network switch." },
      { type: "h2", text: "Using both" },
      { type: "p", text: "They are not exclusive. Plenty of developers prototype and audit in Monsmith, then use Remix's debugger for a specific transaction, then move to Hardhat for tests. Contracts are plain Solidity files; nothing locks you in." },
    ],
    faq: [
      { q: "Is Monsmith a Remix alternative?", a: "Yes. Both are free browser Solidity IDEs with no setup. Monsmith is built specifically for Monad and adds AI auditing, parallel profiling, and cross-chain gas comparison." },
      { q: "Can I use Remix with Monad?", a: "Yes, through MetaMask with the Monad RPC added. Monsmith handles the network configuration automatically." },
    ],
  },
  {
    slug: "monsmith-vs-hardhat-foundry",
    title: "Monsmith vs Hardhat vs Foundry: browser IDE or local toolchain for Monad development?",
    seoTitle: "Monsmith vs Hardhat vs Foundry for Monad Development",
    description:
      "When a browser IDE is enough and when you need Hardhat or Foundry. How Monsmith fits alongside local toolchains for Monad smart contract development.",
    keywords: ["Hardhat vs Foundry", "Monad Hardhat", "Monad Foundry", "browser IDE vs local toolchain", "Monsmith Hardhat"],
    category: "Tooling",
    level: "Intermediate",
    published: "2026-03-15",
    updated: "2026-09-10",
    readMinutes: 5,
    terms: ["ide", "deployment", "rpc"],
    related: ["best-smart-contract-ide", "monad-testnet-guide", "monsmith-vs-remix"],
    blocks: [
      { type: "p", text: "This is not really a versus. Hardhat and Foundry are test and deployment frameworks; Monsmith is an IDE with analysis. Teams shipping on Monad use both. The useful question is which task belongs where." },
      { type: "h2", text: "Task by task" },
      { type: "table", head: ["Task", "Use"], rows: [
        ["Try an idea in 30 seconds", "Monsmith"],
        ["Teach someone their first contract", "Monsmith"],
        ["Security audit on every change", "Monsmith (automated) + humans"],
        ["Check if a contract parallelises on Monad", "Monsmith profiler"],
        ["Compare cost across chains", "Monsmith Chain Fit"],
        ["Unit and fuzz tests", "Foundry (or Hardhat)"],
        ["Deployment scripts across environments", "Hardhat or Foundry"],
        ["Fork mainnet state for tests", "Foundry or Hardhat"],
        ["CI pipeline", "Hardhat or Foundry"],
        ["First testnet deploy without a private key file", "Monsmith (via wallet)"],
      ] },
      { type: "h2", text: "Hardhat with Monad" },
      { type: "p", text: `Add a network entry with url ${MONAD.testnetRpc} and chainId ${MONAD.testnetChainId}. Everything else is standard. See the Monad testnet guide for the full config.` },
      { type: "h2", text: "Foundry with Monad" },
      { type: "p", text: `Pass --rpc-url ${MONAD.testnetRpc} to forge create or forge script. Foundry's fast test runner is the best place to fuzz a contract that Monsmith's profiler has already shaped for parallel execution.` },
      { type: "h2", text: "A workflow that works" },
      { type: "ol", items: [
        "Draft and iterate in Monsmith. Audit on every compile; profile until the dependency graph looks right.",
        "Move the file into a Foundry or Hardhat project. Write tests.",
        "Deploy to Monad testnet from either tool. Verify on the explorer.",
        "Before mainnet, run Chain Fit for the final cost picture and get a human audit.",
      ] },
    ],
    faq: [
      { q: "Does Hardhat work with Monad?", a: `Yes. Add a network with the Monad RPC URL and chain ID (${MONAD.testnetChainId} for testnet, ${MONAD.mainnetChainId} for mainnet).` },
      { q: "Does Foundry work with Monad?", a: "Yes. Pass the Monad RPC URL with --rpc-url to forge commands." },
      { q: "Do I need Hardhat if I use Monsmith?", a: "For a serious test suite and CI, yes. For writing, auditing, profiling, and first deployments, Monsmith alone is enough." },
    ],
  },

  /* --------------------------------------------------------------- Gas */
  {
    slug: "smart-contract-gas-optimization",
    title: "Smart contract gas optimization: 15 techniques that actually move the number",
    seoTitle: "Smart Contract Gas Optimization: 15 Real Techniques",
    description:
      "Concrete Solidity gas optimisation techniques ranked by impact: storage layout, calldata, custom errors, loops, events, and the measurement habit that makes them stick. Includes Monad-specific notes.",
    keywords: ["gas optimization Solidity", "reduce gas smart contract", "Solidity gas tips", "gas efficient Solidity", "smart contract gas cost", "Solidity optimization techniques"],
    category: "Gas",
    level: "Intermediate",
    published: "2026-02-14",
    updated: "2026-09-10",
    readMinutes: 8,
    terms: ["gas", "opcode", "storage-slot", "event", "revert"],
    related: ["monad-gas-fees-explained", "parallel-execution-solidity", "smart-contract-security-checklist"],
    blocks: [
      { type: "p", text: "Gas optimisation has a bad reputation because much of the advice is micro-level and stale. The techniques below are ordered by how much they typically matter. The first five are worth more than the rest combined." },
      { type: "h2", text: "Storage (the big one)" },
      { type: "ol", items: [
        "Write storage as rarely as possible. An SSTORE from zero to non-zero is the most expensive ordinary operation in the EVM. Cache in memory, write once.",
        "Pack variables. Two `uint128` in one slot cost one SSTORE. But on Monad, note that packing concentrates writes on one slot, which can serialise otherwise independent transactions.",
        "Use `mapping` over arrays when you do not need iteration. Array length updates are extra writes.",
        "Delete storage you no longer need; refunds are smaller than they were but not zero.",
        "Read storage once into a local variable inside loops rather than on every iteration.",
      ] },
      { type: "h2", text: "Calldata and data types" },
      { type: "ol", items: [
        "Use `calldata` for external function array and string parameters; `memory` copies.",
        "Use custom errors instead of revert strings. Smaller bytecode and cheaper reverts.",
        "Do not shrink integer types below 256 bits for local variables; the EVM works in 256-bit words and shrinking adds masking. Shrink only for storage packing.",
      ] },
      { type: "h2", text: "Control flow" },
      { type: "ol", items: [
        "Cache array length outside loops. Use `unchecked { ++i; }` where overflow is impossible.",
        "Short-circuit conditions with the cheapest check first.",
        "Avoid unbounded loops entirely; they are a gas problem and a denial-of-service problem.",
      ] },
      { type: "h2", text: "Events and external calls" },
      { type: "ol", items: [
        "Emit events instead of storing data that only off-chain readers need. An event is far cheaper than a storage write.",
        "Batch external calls where the callee supports it.",
        "Use `immutable` and `constant` for values set once; they live in bytecode, not storage.",
      ] },
      { type: "h2", text: "Deployment" },
      { type: "ol", items: [
        "Turn the optimizer on and tune runs to how often the contract will be called: low runs for cheap deployment, high runs for cheap calls.",
      ] },
      { type: "h2", text: "Monad-specific notes" },
      { type: "ul", items: [
        "Fees are billed on the gas limit. Tight estimation is a gas optimisation on Monad.",
        `The ${MONAD.maxCodeSizeKb} KB contract limit means you can often skip the library-splitting that costs extra DELEGATECALLs on Ethereum.`,
        "Storage packing trades gas for parallelism. Profile before you pack hot-path variables together.",
      ] },
      { type: "h2", text: "Measure, do not guess" },
      { type: "p", text: "Chain Fit at monsmith.com/compare runs your contract in a real EVM and reports gas per function, then prices it on each chain with live gas prices. Optimise against those numbers, and re-run after every change." },
    ],
    faq: [
      { q: "What uses the most gas in a smart contract?", a: "Storage writes (SSTORE), followed by external calls and contract deployment. Reducing storage writes is the highest-impact optimisation." },
      { q: "Do gas optimisations matter on Monad?", a: "Less in dollar terms because fees are low, but Monad bills the gas limit, so accurate estimates matter more, and storage layout affects parallel throughput." },
    ],
  },
];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

export const GUIDE_CATEGORIES = Array.from(new Set(GUIDES.map((g) => g.category)));

export { AUTHOR as GUIDE_AUTHOR };
