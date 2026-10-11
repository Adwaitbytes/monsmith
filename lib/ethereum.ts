// lib/ethereum.ts
// Minimal EIP-1193 provider typings so wallet access is type-safe instead of
// reaching through `window as any` at every call site.

export interface EthereumRequestArgs {
  method: string;
  params?: unknown[];
}

export interface EthereumProvider {
  request<T = unknown>(args: EthereumRequestArgs): Promise<T>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
}


/** Provider error shape used by MetaMask (e.g. 4902 = chain not added). */
export interface ProviderRpcError extends Error {
  code: number;
}

export function isProviderRpcError(error: unknown): error is ProviderRpcError {
  return error instanceof Error && typeof (error as ProviderRpcError).code === "number";
}

let embeddedProvider: EthereumProvider | null = null;

/**
 * The signed-in user's Privy embedded wallet, registered by the auth bridge.
 * It is what lets someone who signed in with Google deploy and sign without
 * installing a browser wallet; null when signed out.
 */
export function setEmbeddedProvider(provider: EthereumProvider | null): void {
  embeddedProvider = provider;
}

export function hasEmbeddedProvider(): boolean {
  return embeddedProvider !== null;
}

/**
 * The wallet to sign with: an installed browser wallet when there is one,
 * since a person who installed one chose it, otherwise the embedded wallet
 * that came with their account. Null when there is neither.
 */
export function getEthereumProvider(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  // Typed here rather than globally: wallet SDKs declare window.ethereum too.
  const injected = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  return injected ?? embeddedProvider;
}
