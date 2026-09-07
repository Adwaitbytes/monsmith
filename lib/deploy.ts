"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatEther,
  type Abi,
  type Address,
  type Hash,
} from "viem";
import { getEthereumProvider, isProviderRpcError } from "./ethereum";
import { deploymentOrder, hasUnlinkedPlaceholder, linkBytecode, type LinkReferences } from "./link";
import { explainRevert } from "./revert";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
});

/** MetaMask's "chain not added to wallet" error code. */
const CHAIN_NOT_ADDED = 4902;
/** MetaMask's "user rejected the request" error code. */
const USER_REJECTED = 4001;

/** Constructor parameters the user must supply before a deploy can succeed. */
export interface ConstructorInput {
  name: string;
  type: string;
  /** Field types, for a struct. Without them a tuple cannot be encoded. */
  components?: ConstructorInput[];
}

function describeInput(input: unknown, index: number): ConstructorInput {
  const entry = input as { name?: string; type?: string; components?: unknown[] };
  return {
    name: entry.name || `arg${index}`,
    type: entry.type === undefined ? "unknown" : String(entry.type),
    components: Array.isArray(entry.components)
      ? entry.components.map(describeInput)
      : undefined,
  };
}

export function constructorInputs(abi: Abi): ConstructorInput[] {
  const ctor = abi.find((entry) => entry.type === "constructor");
  if (!ctor || !("inputs" in ctor) || !Array.isArray(ctor.inputs)) return [];
  return ctor.inputs.map(describeInput);
}

/**
 * Whether the constructor accepts MON.
 *
 * A payable constructor is usually payable because it checks `msg.value`, so
 * the deploy form has to offer a value field. Without one the transaction is
 * sent with zero and reverts, and the wallet reports only a generic failure.
 */
export function isConstructorPayable(abi: Abi): boolean {
  const ctor = abi.find((entry) => entry.type === "constructor");
  return ctor !== undefined && "stateMutability" in ctor && ctor.stateMutability === "payable";
}

export interface DeployResult {
  address: Address;
  txHash: Hash;
  gasUsed?: string;
  explorerUrl: string;
}

async function ensureMonadTestnet(): Promise<void> {
  const ethereum = getEthereumProvider();
  if (!ethereum) throw new Error("No wallet detected. Install MetaMask to deploy.");

  const target = `0x${monadTestnet.id.toString(16)}`;
  const current = await ethereum.request<string>({ method: "eth_chainId" });
  if (current === target) return;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target }],
    });
    return;
  } catch (error) {
    if (!isProviderRpcError(error) || error.code !== CHAIN_NOT_ADDED) throw error;
  }

  await ethereum.request({
    method: "wallet_addEthereumChain",
    params: [{
      chainId: target,
      chainName: monadTestnet.name,
      nativeCurrency: monadTestnet.nativeCurrency,
      rpcUrls: [...monadTestnet.rpcUrls.default.http],
      blockExplorerUrls: [monadTestnet.blockExplorers.default.url],
    }],
  });
}

/**
 * The most common reason a payable constructor reverts, when it is plausible.
 *
 * Added only when nothing was sent, because a constructor that checks msg.value
 * and got zero is the overwhelmingly likely explanation and the revert data
 * alone does not say which value was wrong.
 */
function payableHint(value: bigint, abi: Abi): string {
  return value === 0n && isConstructorPayable(abi)
    ? " This constructor is payable and nothing was sent with the deployment, which may be why."
    : "";
}

/**
 * Puts each library on chain and writes its address into the bytecode.
 *
 * Deployed in dependency order, because a library may call another library and
 * so have holes of its own. Each is a separate wallet prompt, which is why the
 * caller gets told what is about to be signed.
 */
async function deployLibraries(
  clients: {
    walletClient: ReturnType<typeof createWalletClient>;
    publicClient: ReturnType<typeof createPublicClient>;
    account: Address;
  },
  bytecode: string,
  linkReferences: LinkReferences | undefined,
  libraries: DeployLibrary[],
  onStep?: (message: string) => void
): Promise<string> {
  if (libraries.length === 0) return bytecode;

  const byQualified: Record<string, DeployLibrary> = {};
  for (const library of libraries) byQualified[library.qualified] = library;

  const addresses: Record<string, string> = {};

  for (const qualified of deploymentOrder(byQualified)) {
    const library = byQualified[qualified];

    // Its own holes are already filled: dependencies come first in this order.
    const linked = linkBytecode(library.bytecode, library.linkReferences, addresses);
    const hex = (linked.startsWith("0x") ? linked : `0x${linked}`) as `0x${string}`;

    onStep?.(`Deploying library ${library.name}. Confirm in your wallet.`);

    let txHash: Hash;
    try {
      txHash = await clients.walletClient.deployContract({
        abi: [],
        bytecode: hex,
        account: clients.account,
        chain: monadTestnet,
      });
    } catch (error) {
      if (isProviderRpcError(error) && error.code === USER_REJECTED) {
        throw new Error(`Deployment cancelled: library ${library.name} was not confirmed.`);
      }
      throw error;
    }

    const receipt = await clients.publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success" || !receipt.contractAddress) {
      throw new Error(`Library ${library.name} failed to deploy.`);
    }

    addresses[qualified] = receipt.contractAddress;
    addresses[library.name] = receipt.contractAddress;
    onStep?.(`Library ${library.name} deployed at ${receipt.contractAddress}`);
  }

  return linkBytecode(bytecode, linkReferences, addresses);
}

/**
 * Deploys compiled bytecode from the user's own wallet.
 *
 * The server deliberately does not hold a deployer key. A shared server wallet
 * has to be funded and silently breaks everyone's deploys the moment it runs
 * dry, and it also makes every contract on chain look like it came from one
 * address. Signing here means the user owns what they deploy and pays their own
 * gas, which is the behaviour people expect from a wallet prompt.
 */
export interface DeployLibrary {
  qualified: string;
  name: string;
  bytecode: string;
  linkReferences?: LinkReferences;
}

export interface DeployOptions {
  args?: readonly unknown[];
  value?: bigint;
  linkReferences?: LinkReferences;
  /** Libraries to put on chain first, in any order; dependencies are resolved here. */
  libraries?: DeployLibrary[];
  /** Called before each wallet prompt, so a multi-step deploy is not silent. */
  onStep?: (message: string) => void;
}

export async function deployFromWallet(
  abi: Abi,
  bytecode: string,
  account: Address,
  options: DeployOptions = {}
): Promise<DeployResult> {
  const { args = [], value = 0n, linkReferences, libraries = [], onStep } = options;
  const ethereum = getEthereumProvider();
  if (!ethereum) throw new Error("No wallet detected. Install MetaMask to deploy.");

  await ensureMonadTestnet();

  const transport = custom(ethereum);
  const walletClient = createWalletClient({ account, chain: monadTestnet, transport });
  const publicClient = createPublicClient({ chain: monadTestnet, transport });

  const balance = await publicClient.getBalance({ address: account });
  if (balance === 0n) {
    throw new Error(
      "This wallet has no testnet MON. Get some from https://faucet.monad.xyz and try again."
    );
  }
  // Checked before the wallet opens, because the shortfall is knowable here and
  // an insufficient-funds rejection inside MetaMask does not say by how much.
  if (value > balance) {
    throw new Error(
      `This deployment sends ${formatEther(value)} MON but the wallet holds ${formatEther(balance)}.`
    );
  }

  // Libraries first. A contract calling one holds a DELEGATECALL to an address
  // the compiler could not know, so its bytecode has a 20-byte hole in it.
  // Deploying that unpatched does not fail loudly, it puts the placeholder text
  // on chain where those bytes are read as instructions.
  const linked = await deployLibraries(
    { walletClient, publicClient, account },
    bytecode,
    linkReferences,
    libraries,
    onStep
  );

  const hex = (linked.startsWith("0x") ? linked : `0x${linked}`) as `0x${string}`;

  if (hasUnlinkedPlaceholder(hex)) {
    throw new Error(
      "This bytecode still references a library that was not deployed, so it cannot be deployed as-is."
    );
  }

  // A contract whose constructor takes parameters reverts when deployed with
  // none, and the wallet reports only a generic failure, so the mismatch is
  // caught here where it can be explained.
  const expected = constructorInputs(abi);
  if (expected.length !== args.length) {
    throw new Error(
      `This constructor needs ${expected.length} argument${expected.length === 1 ? "" : "s"} ` +
      `(${expected.map((i) => `${i.name}: ${i.type}`).join(", ")}), but ${args.length} were supplied.`
    );
  }

  let txHash: Hash;
  try {
    onStep?.("Confirm the deployment in your wallet.");
    txHash = await walletClient.deployContract({ abi, bytecode: hex, args, value });
  } catch (error) {
    if (isProviderRpcError(error) && error.code === USER_REJECTED) {
      throw new Error("Deployment cancelled in wallet.");
    }

    // viem estimates gas before prompting, so a constructor that reverts fails
    // here. The chain returns a four-byte selector and the wallet has no ABI to
    // read it with, so the useful message can only be assembled on this side.
    const reason = explainRevert(error, abi);
    if (reason !== null) {
      throw new Error(`The constructor ${reason}${payableHint(value, abi)}`);
    }
    throw error;
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status !== "success" || !receipt.contractAddress) {
    // A payable constructor almost always reverts because it checked msg.value,
    // and the receipt carries no reason string to say so.
    throw new Error(`Deployment transaction reverted on chain.${payableHint(value, abi)}`);
  }

  return {
    address: receipt.contractAddress,
    txHash,
    gasUsed: receipt.gasUsed?.toString(),
    explorerUrl: `${monadTestnet.blockExplorers.default.url}/address/${receipt.contractAddress}`,
  };
}
