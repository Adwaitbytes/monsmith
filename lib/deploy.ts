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
}

export function constructorInputs(abi: Abi): ConstructorInput[] {
  const ctor = abi.find((entry) => entry.type === "constructor");
  if (!ctor || !("inputs" in ctor) || !Array.isArray(ctor.inputs)) return [];
  return ctor.inputs.map((input, i) => ({
    name: ("name" in input && input.name) || `arg${i}`,
    type: "type" in input ? String(input.type) : "unknown",
  }));
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
 * Deploys compiled bytecode from the user's own wallet.
 *
 * The server deliberately does not hold a deployer key. A shared server wallet
 * has to be funded and silently breaks everyone's deploys the moment it runs
 * dry, and it also makes every contract on chain look like it came from one
 * address. Signing here means the user owns what they deploy and pays their own
 * gas, which is the behaviour people expect from a wallet prompt.
 */
export async function deployFromWallet(
  abi: Abi,
  bytecode: string,
  account: Address,
  args: readonly unknown[] = [],
  value: bigint = 0n
): Promise<DeployResult> {
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

  const hex = (bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`) as `0x${string}`;

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
    txHash = await walletClient.deployContract({ abi, bytecode: hex, args, value });
  } catch (error) {
    if (isProviderRpcError(error) && error.code === USER_REJECTED) {
      throw new Error("Deployment cancelled in wallet.");
    }
    throw error;
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status !== "success" || !receipt.contractAddress) {
    // A payable constructor almost always reverts because it checked msg.value,
    // and the receipt carries no reason string to say so.
    const hint =
      value === 0n && isConstructorPayable(abi)
        ? " This constructor is payable, so it may require MON to be sent with the deployment."
        : "";
    throw new Error(`Deployment transaction reverted on chain.${hint}`);
  }

  return {
    address: receipt.contractAddress,
    txHash,
    gasUsed: receipt.gasUsed?.toString(),
    explorerUrl: `${monadTestnet.blockExplorers.default.url}/address/${receipt.contractAddress}`,
  };
}
