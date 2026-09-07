"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  http,
  type Abi,
  type AbiFunction,
  type AbiParameter,
  type Address,
  type Hash,
} from "viem";
import { getEthereumProvider, isProviderRpcError } from "./ethereum";
import { monadTestnet } from "./deploy";
import { explainRevert } from "./revert";

/** MetaMask's "user rejected the request" code. */
const USER_REJECTED = 4001;

export type FunctionKind = "read" | "write" | "payable";

export interface ContractFunction {
  name: string;
  kind: FunctionKind;
  inputs: readonly AbiParameter[];
  outputs: readonly AbiParameter[];
  signature: string;
}

export interface CallResult {
  kind: "read";
  outputs: { name: string; type: string; value: string }[];
}

export interface TxResult {
  kind: "write";
  txHash: Hash;
  gasUsed: string;
  explorerUrl: string;
}

/**
 * Splits an ABI into the functions a user can actually invoke.
 *
 * `view` and `pure` are free local calls; everything else costs gas and needs a
 * wallet signature. Payable is separated so the UI knows to offer a value field
 * rather than silently dropping the funds the user meant to send.
 */
export function readableFunctions(abi: Abi): ContractFunction[] {
  return abi
    .filter((entry): entry is AbiFunction => entry.type === "function")
    .map((fn) => {
      const kind: FunctionKind =
        fn.stateMutability === "view" || fn.stateMutability === "pure"
          ? "read"
          : fn.stateMutability === "payable"
            ? "payable"
            : "write";

      return {
        name: fn.name,
        kind,
        inputs: fn.inputs,
        outputs: fn.outputs,
        signature: `${fn.name}(${fn.inputs.map((i) => i.type).join(",")})`,
      };
    })
    .sort((a, b) => {
      // Reads first: they are free and safe to click, so they make the better
      // starting point when exploring an unfamiliar contract.
      if (a.kind === "read" && b.kind !== "read") return -1;
      if (a.kind !== "read" && b.kind === "read") return 1;
      return a.name.localeCompare(b.name);
    });
}

/** `uint256[]`, `uint256[2]`, and the outer dimension of `uint256[][]`. */
const ARRAY_SUFFIX = /\[(\d*)\]$/;

/**
 * Removes one pair of surrounding quotes.
 *
 * Quotes here are notation, never part of the value. A uint256 worth writing
 * is usually past 2^53 already, so `["100000000000000000"]` is the only way to
 * put one in a list without an unquoted JSON number rounding it. Exactly one
 * pair comes off, which leaves a genuinely quoted string still expressible.
 */
function unquote(value: string): string {
  const first = value[0];
  const quoted =
    value.length >= 2 && (first === '"' || first === "'") && value[value.length - 1] === first;

  return quoted ? value.slice(1, -1).replace(/\\(["'\\])/g, "$1") : value;
}

/**
 * Splits an array literal into its elements.
 *
 * Splitting on every comma is wrong twice over: `[[1,2],[3]]` and `["a,b"]`
 * both contain commas that separate nothing. Tracking bracket depth and quote
 * state is the smallest thing that reads either correctly.
 */
function splitElements(body: string): string[] {
  const items: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];

    if (quote !== null) {
      if (char === "\\" && i + 1 < body.length) {
        current += char + body[i + 1];
        i += 1;
        continue;
      }
      current += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") quote = char;
    else if (char === "[") depth += 1;
    else if (char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      items.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (quote !== null) throw new Error(`Unclosed quote in "${body}"`);
  if (depth !== 0) throw new Error(`Unbalanced brackets in "${body}"`);

  items.push(current);

  // A single empty element is an empty list, not a list holding nothing.
  if (items.length === 1 && items[0].trim().length === 0) return [];

  return items.map((item) => {
    const element = item.trim();
    // Dropping it would quietly deploy with fewer values than were written.
    if (element.length === 0) throw new Error(`Empty element in "[${body}]"`);
    return element;
  });
}

/** A parameter's struct fields, when it has any. */
function componentsOf(input: AbiParameter): AbiComponent[] | undefined {
  return "components" in input && Array.isArray(input.components)
    ? (input.components as AbiComponent[])
    : undefined;
}

/** The fields of a struct, as the ABI describes them. */
export interface AbiComponent {
  name: string;
  type: string;
  components?: AbiComponent[];
}

/**
 * Reads an integer, in any of the forms people actually write.
 *
 * Hex because that is how every explorer prints a number, and underscores
 * because Solidity's own literals allow them, so `1_000_000` copied out of the
 * source should not have to be edited to be used.
 */
function parseInteger(literal: string, type: string, original: string): bigint {
  const cleaned = literal.replace(/_/g, "");

  let parsed: bigint;
  if (/^-?0x[0-9a-fA-F]+$/.test(cleaned)) {
    parsed = cleaned.startsWith("-") ? -BigInt(cleaned.slice(1)) : BigInt(cleaned);
  } else if (/^-?\d+$/.test(cleaned)) {
    parsed = BigInt(cleaned);
  } else {
    throw new Error(`Expected a whole number for ${type}, got "${original}"`);
  }

  // Range is checked here rather than left to the encoder, because viem reports
  // it as a size error against the ABI with no mention of which argument.
  const signed = !type.startsWith("u");
  const bits = Number(/\d+$/.exec(type)?.[0] ?? 256);

  if (!signed && parsed < 0n) {
    throw new Error(`${type} cannot be negative, got "${original}"`);
  }

  const limit = signed ? 2n ** BigInt(bits - 1) : 2n ** BigInt(bits);
  const min = signed ? -limit : 0n;
  const max = signed ? limit - 1n : limit - 1n;

  if (parsed < min || parsed > max) {
    throw new Error(`${parsed} does not fit in ${type}, whose range is ${min} to ${max}.`);
  }

  return parsed;
}

/**
 * Turns the raw strings from the form into the types viem expects.
 *
 * The form cannot know the difference between the string "123" and the number
 * 123, and passing the wrong one produces an opaque encoding error deep inside
 * viem rather than something the user can act on.
 *
 * `components` describes a struct's fields. A tuple arrives as the bare type
 * name "tuple", which says nothing about what is in it, so without them a
 * struct argument cannot be encoded at all.
 */
export function coerceArgument(
  value: string,
  type: string,
  components?: AbiComponent[]
): unknown {
  const trimmed = value.trim();
  const array = ARRAY_SUFFIX.exec(type);

  if (array !== null) {
    const inner = type.slice(0, array.index);

    const opens = trimmed.startsWith("[");
    const closes = trimmed.endsWith("]");
    if (opens !== closes) {
      throw new Error(`Expected a bracketed list for ${type}, like ["1", "2"], got "${value}"`);
    }

    const items = splitElements(opens ? trimmed.slice(1, -1) : trimmed);

    const fixed = array[1];
    if (fixed.length > 0 && items.length !== Number(fixed)) {
      throw new Error(`${type} needs exactly ${fixed} values, got ${items.length}`);
    }

    return items.map((item) => coerceArgument(item, inner, components));
  }

  if (type === "tuple") {
    if (components === undefined) {
      throw new Error(`Cannot read a value for ${type}: the ABI does not describe its fields.`);
    }

    // Solidity writes a struct literal in parentheses and JSON writes it in
    // brackets. Both turn up in the wild, so both are read.
    const bracketed = /^[[(].*[\])]$/s.test(trimmed);
    const fields = splitElements(bracketed ? trimmed.slice(1, -1) : trimmed);

    if (fields.length !== components.length) {
      throw new Error(
        `This struct has ${components.length} field${components.length === 1 ? "" : "s"} ` +
          `(${components.map((c) => `${c.name || c.type}`).join(", ")}), but ${fields.length} were given.`
      );
    }

    const values = fields.map((field, i) =>
      coerceArgument(field, components[i].type, components[i].components)
    );

    // viem keys a tuple by field name when the ABI names them, and takes a
    // positional array when it does not.
    if (components.some((component) => component.name.length === 0)) return values;

    const object: Record<string, unknown> = {};
    components.forEach((component, i) => {
      object[component.name] = values[i];
    });
    return object;
  }

  const literal = unquote(trimmed);

  if (type === "bool") {
    if (literal === "true") return true;
    if (literal === "false") return false;
    throw new Error(`Expected true or false for a bool, got "${value}"`);
  }

  if (/^u?int/.test(type)) {
    return parseInteger(literal, type, value);
  }

  if (type === "address") {
    if (!/^0x[a-fA-F0-9]{40}$/.test(literal)) {
      throw new Error(`Expected a 0x address, got "${value}"`);
    }
    return literal as Address;
  }

  if (type.startsWith("bytes")) {
    if (!/^0x[0-9a-fA-F]*$/.test(literal)) {
      throw new Error(`Expected 0x-prefixed hex for ${type}, got "${value}"`);
    }

    const digits = literal.length - 2;
    if (digits % 2 !== 0) {
      throw new Error(`Hex comes in pairs, so ${type} needs an even number of digits.`);
    }

    // bytesN is exactly N bytes. Padding it here would change the value.
    const width = /^bytes(\d+)$/.exec(type);
    if (width !== null && digits !== Number(width[1]) * 2) {
      throw new Error(`${type} is exactly ${width[1]} bytes, got ${digits / 2}.`);
    }

    return literal as `0x${string}`;
  }

  return literal;
}

/**
 * What to show in an empty argument field.
 *
 * A list is the one type people reliably get wrong, and the bare type name
 * `uint256[]` does not tell anyone that the values want quoting. Showing the
 * shape is cheaper than explaining it after the error.
 */
export function placeholderFor(type: string, components?: AbiComponent[]): string {
  const array = ARRAY_SUFFIX.exec(type);
  if (array !== null) {
    const inner = type.slice(0, array.index);
    if (inner === "tuple") return `[${placeholderFor("tuple", components)}]`;
    if (/^u?int/.test(inner)) return '["1000000000000000000", "2000000000000000000"]';
    if (inner === "address") return '["0x…", "0x…"]';
    if (inner === "bool") return "[true, false]";
    return '["a", "b"]';
  }

  // A struct's placeholder is built from its own fields, since the type name
  // is only ever "tuple" and says nothing about what goes in it.
  if (type === "tuple") {
    const fields = (components ?? []).map((component) =>
      placeholderFor(component.type, component.components)
    );
    return `[${fields.join(", ")}]`;
  }

  if (type === "string") return "Hello Monad";
  if (type === "address") return "0x…";
  if (type === "bool") return "true";
  if (/^u?int/.test(type)) return "0";
  return type;
}

/** How a struct reads in a label, since the ABI only ever calls it "tuple". */
export function describeType(type: string, components?: AbiComponent[]): string {
  if (!type.startsWith("tuple") || components === undefined) return type;

  const fields = components
    .map((component) => `${describeType(component.type, component.components)} ${component.name}`.trim())
    .join(", ");

  return `(${fields})${type.slice("tuple".length)}`;
}

/** Renders a decoded return value without losing precision on big integers. */
function stringifyResult(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(stringifyResult).join(", ")}]`;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}

function publicClient() {
  const ethereum = getEthereumProvider();
  // Reads work without a wallet, so fall back to the public RPC rather than
  // forcing a connection just to look at a contract.
  return createPublicClient({
    chain: monadTestnet,
    transport: ethereum ? custom(ethereum) : http(monadTestnet.rpcUrls.default.http[0]),
  });
}

/** Calls a view or pure function. Free, no wallet required. */
export async function callRead(
  address: Address,
  abi: Abi,
  fn: ContractFunction,
  args: string[]
): Promise<CallResult> {
  const typedArgs = fn.inputs.map((input, i) =>
    coerceArgument(args[i] ?? "", input.type, componentsOf(input))
  );

  let result: unknown;
  try {
    result = await publicClient().readContract({
      address,
      abi,
      functionName: fn.name,
      args: typedArgs,
    });
  } catch (error) {
    const reason = explainRevert(error, abi);
    if (reason !== null) throw new Error(`${fn.name} ${reason}`);
    throw error;
  }

  // A single unnamed output comes back bare rather than in a tuple.
  const values = fn.outputs.length === 1 ? [result] : (result as unknown[]);

  return {
    kind: "read",
    outputs: fn.outputs.map((output, i) => ({
      name: output.name || `output ${i}`,
      type: output.type,
      value: stringifyResult(values[i]),
    })),
  };
}

/** Sends a state-changing transaction from the user's wallet. */
export async function sendWrite(
  address: Address,
  abi: Abi,
  fn: ContractFunction,
  args: string[],
  account: Address,
  valueWei?: bigint
): Promise<TxResult> {
  const ethereum = getEthereumProvider();
  if (!ethereum) throw new Error("No wallet detected. Install MetaMask to send transactions.");

  const typedArgs = fn.inputs.map((input, i) =>
    coerceArgument(args[i] ?? "", input.type, componentsOf(input))
  );
  const transport = custom(ethereum);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport });
  const reader = createPublicClient({ chain: monadTestnet, transport });

  // Simulating first turns an on-chain revert into a readable message before
  // the user is asked to sign and pay for a transaction that cannot succeed.
  try {
    await reader.simulateContract({
      address,
      abi,
      functionName: fn.name,
      args: typedArgs,
      account,
      value: valueWei,
    });
  } catch (error) {
    // The contract's own error name beats viem's wrapper text, which reports a
    // custom error as an undecoded selector.
    const reason = explainRevert(error, abi);
    if (reason !== null) throw new Error(`This call ${reason}`);

    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new Error(`This call would revert: ${message}`);
  }

  let txHash: Hash;
  try {
    txHash = await wallet.writeContract({
      address,
      abi,
      functionName: fn.name,
      args: typedArgs,
      value: valueWei,
    });
  } catch (error) {
    if (isProviderRpcError(error) && error.code === USER_REJECTED) {
      throw new Error("Transaction cancelled in wallet.");
    }
    throw error;
  }

  const receipt = await reader.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error("Transaction reverted on chain.");
  }

  return {
    kind: "write",
    txHash,
    gasUsed: receipt.gasUsed.toString(),
    explorerUrl: `${monadTestnet.blockExplorers.default.url}/tx/${txHash}`,
  };
}

/** Native balance of the contract, shown alongside the function list. */
export async function contractBalance(address: Address): Promise<string> {
  const balance = await publicClient().getBalance({ address });
  return formatEther(balance);
}
