/**
 * Validates the Chain Fit gas model against a contract deployed on Monad.
 *
 * `eth_estimateGas` pads, because Monad charges the gas limit rather than the
 * gas used and a tight estimate would cost the sender real money. So this
 * binary-searches the smallest gas limit at which the call still succeeds,
 * which is the gas the chain actually requires, and compares that against what
 * the model predicts.
 *
 * Run:  node scripts/validate-onchain.mjs [address] [ownerAddress]
 *
 * The defaults point at a token deployed on Monad testnet where the model was
 * exact on every function.
 */

const ADDR = process.argv[2] ?? "0x3007a9e4b04e1359c44840dd7cc9047dd5275f5e";
const OWNER = process.argv[3] ?? "0xdb1c8df161a280c93d5997cd5437edfc79811cc8";
const RPC = "https://testnet-rpc.monad.xyz";
const A1 = "00000000000000000000000000000000000000000000000000000000000000a1";
const ONE = "0000000000000000000000000000000000000000000000000000000000000001";

const call = async (data, gas) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call",
      params: [{ from: OWNER, to: ADDR, data, gas: "0x" + gas.toString(16) }, "latest"] }) });
  const j = await r.json();
  return !j.error;
};

// The smallest gas limit at which the call still succeeds is the gas the chain
// actually needs. eth_estimateGas is free to return more than that.
const minimumGas = async (label, data, lo, hi) => {
  if (!(await call(data, hi))) { console.log(label, "fails even at", hi); return; }
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await call(data, mid)) hi = mid; else lo = mid;
  }
  return hi;
};

const cases = [
  ["approve",           "0x095ea7b3" + A1 + ONE, 51865],
  ["transfer",          "0xa9059cbb" + A1 + ONE, 63190],
  ["mint",              "0x40c10f19" + A1 + ONE, 63189],
  ["transferOwnership", "0xf2fde38b" + A1,       34417],
  ["renounceOwnership", "0x715018a6",            34039],
];

const ESTIMATES = {
  approve: 52259, transfer: 64024, mint: 64023, transferOwnership: 34776, renounceOwnership: 34397,
};

console.log("function            ourModel  trueMin  estimateGas   model-vs-trueMin");
for (const [name, data, ours] of cases) {
  const min = await minimumGas(name, data, 21000, 200000);
  if (min === undefined) continue;
  const delta = min - ours;
  console.log(
    name.padEnd(19),
    String(ours).padStart(8),
    String(min).padStart(8),
    String(ESTIMATES[name]).padStart(12),
    `   ${delta >= 0 ? "+" : ""}${delta}  (${((delta / min) * 100).toFixed(2)}%)`
  );
}
