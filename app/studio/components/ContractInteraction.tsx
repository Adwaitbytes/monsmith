"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Play, Send, X, Loader2, ExternalLink, Wallet, Search } from "lucide-react";
import type { Abi, Address } from "viem";
import {
  callRead,
  contractBalance,
  readableFunctions,
  sendWrite,
  type ContractFunction,
} from "@/lib/contractInteraction";
import { errorMessage } from "@/lib/apiTypes";

interface Props {
  /** ABI from the most recent successful compile. */
  abi: Abi | null;
  /** Pre-filled from a deploy in this session, if there was one. */
  deployedAddress: string | null;
  walletAddress: string | null;
  onClose: () => void;
  onLog: (line: string) => void;
}

interface CallState {
  status: "idle" | "running" | "done" | "error";
  detail?: string;
  outputs?: { name: string; type: string; value: string }[];
  txHash?: string;
  explorerUrl?: string;
}

const KIND_STYLE: Record<string, string> = {
  read: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  write: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  payable: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
};

/**
 * Read and write a deployed contract from its ABI.
 *
 * Without this the studio can produce and ship a contract but not exercise it,
 * which is the point at which people go back to Remix.
 */
export function ContractInteraction({ abi, deployedAddress, walletAddress, onClose, onLog }: Props) {
  const [address, setAddress] = useState(deployedAddress ?? "");
  const [balance, setBalance] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [args, setArgs] = useState<Record<string, string[]>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [calls, setCalls] = useState<Record<string, CallState>>({});
  const [filter, setFilter] = useState("");

  const functions = useMemo(() => (abi ? readableFunctions(abi) : []), [abi]);
  const visible = useMemo(
    () => functions.filter((fn) => fn.name.toLowerCase().includes(filter.toLowerCase())),
    [functions, filter]
  );

  const addressValid = /^0x[a-fA-F0-9]{40}$/.test(address.trim());

  const refreshBalance = useCallback(async () => {
    if (!addressValid) return;
    try {
      setBalance(await contractBalance(address.trim() as Address));
    } catch {
      setBalance(null);
    }
  }, [address, addressValid]);

  const setArg = (fnKey: string, index: number, value: string) => {
    setArgs((prev) => {
      const next = [...(prev[fnKey] ?? [])];
      next[index] = value;
      return { ...prev, [fnKey]: next };
    });
  };

  const run = async (fn: ContractFunction) => {
    const key = fn.signature;
    if (!abi || !addressValid) return;

    setCalls((prev) => ({ ...prev, [key]: { status: "running" } }));

    try {
      if (fn.kind === "read") {
        const result = await callRead(address.trim() as Address, abi, fn, args[key] ?? []);
        setCalls((prev) => ({ ...prev, [key]: { status: "done", outputs: result.outputs } }));
        onLog(` ${fn.name}() → ${result.outputs.map((o) => o.value).join(", ")}`);
        return;
      }

      if (!walletAddress) {
        throw new Error("Connect a wallet to send a transaction.");
      }

      const raw = values[key]?.trim();
      const valueWei = raw ? BigInt(Math.round(parseFloat(raw) * 1e18)) : undefined;

      onLog(`Confirm ${fn.name}() in your wallet...`);
      const result = await sendWrite(
        address.trim() as Address,
        abi,
        fn,
        args[key] ?? [],
        walletAddress as Address,
        valueWei
      );

      setCalls((prev) => ({
        ...prev,
        [key]: { status: "done", txHash: result.txHash, explorerUrl: result.explorerUrl },
      }));
      onLog(` ${fn.name}() mined, gas ${result.gasUsed}`);
      void refreshBalance();
    } catch (error) {
      const detail = errorMessage(error);
      setCalls((prev) => ({ ...prev, [key]: { status: "error", detail } }));
      onLog(` ${fn.name}(): ${detail}`);
    }
  };

  return (
    <div className="h-full flex flex-col panel-surface">
      <div className="p-3 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Play size={16} className="text-emerald-600 dark:text-emerald-400" />
          <span className="font-semibold text-sm">Contract Interaction</span>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-text-muted hover:text-text-primary">
          <X size={16} />
        </button>
      </div>

      <div className="p-3 space-y-2 border-b border-border-subtle">
        <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Contract address
        </label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onBlur={refreshBalance}
          placeholder="0x..."
          spellCheck={false}
          className="w-full px-3 py-2 rounded-lg text-xs font-mono panel-sunken border border-border-subtle outline-none focus:border-purple-500 transition-colors"
        />
        {address && !addressValid && (
          <p className="text-[11px] text-red-600 dark:text-red-400">
            That is not a valid 0x address.
          </p>
        )}
        {balance !== null && (
          <p className="text-[11px] text-text-muted flex items-center gap-1">
            <Wallet size={11} /> Balance: {balance} MON
          </p>
        )}
      </div>

      {!abi ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <p className="text-sm font-semibold text-text-primary mb-1">No ABI yet</p>
            <p className="text-xs text-text-secondary">
              Compile a contract first. Its ABI is what tells this panel which functions exist.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-border-subtle">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Filter ${functions.length} functions`}
                className="w-full pl-7 pr-3 py-1.5 rounded-lg text-xs panel-sunken border border-border-subtle outline-none focus:border-purple-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {visible.map((fn) => {
              const key = fn.signature;
              const state = calls[key];
              const isOpen = expanded === key;

              return (
                <div key={key} className="rounded-xl border border-border-subtle overflow-hidden">
                  <button
                    onClick={() => setExpanded(isOpen ? null : key)}
                    className="w-full px-3 py-2 flex items-center justify-between hover:bg-border-subtle/40 transition-colors"
                  >
                    <span className="text-xs font-mono text-text-primary truncate">{fn.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${KIND_STYLE[fn.kind]}`}>
                      {fn.kind}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-3 pb-3 space-y-2">
                      {fn.inputs.map((input, i) => (
                        <div key={`${key}-${i}`}>
                          <label className="text-[10px] text-text-muted font-mono">
                            {input.name || `arg ${i}`}: {input.type}
                          </label>
                          <input
                            value={args[key]?.[i] ?? ""}
                            onChange={(e) => setArg(key, i, e.target.value)}
                            placeholder={input.type}
                            spellCheck={false}
                            className="w-full mt-0.5 px-2 py-1.5 rounded-lg text-xs font-mono panel-sunken border border-border-subtle outline-none focus:border-purple-500"
                          />
                        </div>
                      ))}

                      {fn.kind === "payable" && (
                        <div>
                          <label className="text-[10px] text-text-muted font-mono">value (MON)</label>
                          <input
                            value={values[key] ?? ""}
                            onChange={(e) => setValues((p) => ({ ...p, [key]: e.target.value }))}
                            placeholder="0.0"
                            className="w-full mt-0.5 px-2 py-1.5 rounded-lg text-xs font-mono panel-sunken border border-border-subtle outline-none focus:border-purple-500"
                          />
                        </div>
                      )}

                      <button
                        onClick={() => run(fn)}
                        disabled={!addressValid || state?.status === "running"}
                        className={`w-full py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors ${
                          fn.kind === "read"
                            ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                            : "bg-purple-600 hover:bg-purple-500 text-white"
                        }`}
                      >
                        {state?.status === "running" ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : fn.kind === "read" ? (
                          <Play size={12} />
                        ) : (
                          <Send size={12} />
                        )}
                        {fn.kind === "read" ? "Call" : "Send transaction"}
                      </button>

                      {state?.status === "done" && state.outputs && (
                        <div className="panel-sunken rounded-lg p-2 space-y-1">
                          {state.outputs.map((output, i) => (
                            <div key={i} className="text-[11px] font-mono break-all">
                              <span className="text-text-muted">{output.name}: </span>
                              <span className="text-emerald-700 dark:text-emerald-300">{output.value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {state?.status === "done" && state.txHash && (
                        <a
                          href={state.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[11px] text-purple-600 dark:text-purple-400 hover:underline"
                        >
                          <ExternalLink size={11} /> View transaction
                        </a>
                      )}

                      {state?.status === "error" && (
                        <p className="text-[11px] text-red-600 dark:text-red-400 break-words">
                          {state.detail}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {visible.length === 0 && (
              <p className="text-xs text-text-muted text-center py-6">
                No function matches “{filter}”.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
