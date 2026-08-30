"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * The signature visual. Three lanes run in parallel; within a lane, two
 * transactions that write the same storage slot are serialized. This is the
 * literal shape of what the parallel profiler analyses — independent work runs
 * at once, shared state waits — rendered as thin lanes and state nodes.
 */

type Lane = {
  id: string;
  slot: string;
  first: { tx: string; fn: string };
  second: { tx: string; fn: string };
};

const LANES: Lane[] = [
  { id: "L0", slot: "balanceOf[a]", first: { tx: "T1", fn: "transfer" }, second: { tx: "T4", fn: "transfer" } },
  { id: "L1", slot: "totalSupply", first: { tx: "T2", fn: "mint" }, second: { tx: "T5", fn: "burn" } },
  { id: "L2", slot: "allowance[b]", first: { tx: "T3", fn: "approve" }, second: { tx: "T6", fn: "approve" } },
];

const LANE_Y = [78, 190, 302];
const CHIP_W = 108;
const CHIP_H = 46;
const AX = 24; //  first transaction column
const BX = 168; // second transaction column
const SX = 372; // storage slot centre
const SR = 18;
const CX = 486; // commit bar left edge

function edge(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(28, (x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
}

export function ExecutionGraph({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const flow = reduce ? "" : "lane-flow";

  return (
    <svg
      viewBox="0 0 560 380"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Execution graph: three lanes running in parallel, with transactions that share a storage slot serialized within their lane."
      style={{ fontFamily: "var(--font-mono), monospace", width: "100%", height: "auto" }}
    >
      {/* Column headers */}
      <g fill="var(--text-muted)" fontSize="9.5" letterSpacing="1.4" textAnchor="middle">
        <text x={96} y={30}>TRANSACTIONS</text>
        <text x={SX} y={30}>STATE</text>
        <text x={CX + 24} y={30}>COMMIT</text>
      </g>

      {/* Commit bar */}
      <motion.g
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.5 }}
      >
        <rect
          x={CX}
          y={52}
          width={48}
          height={276}
          rx={14}
          fill="var(--accent-soft)"
          stroke="var(--accent-line)"
        />
        <text
          x={CX + 24}
          y={196}
          fill="var(--accent)"
          fontSize="10"
          textAnchor="middle"
          transform={`rotate(90 ${CX + 24} 196)`}
          letterSpacing="2"
        >
          MONAD BLOCK
        </text>
      </motion.g>

      {LANES.map((lane, i) => {
        const y = LANE_Y[i];
        return (
          <motion.g
            key={lane.id}
            initial={{ opacity: 0, x: -12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.12 * i }}
          >
            {/* Dependency link: T(second) waits on T(first) — same slot */}
            <path
              d={`M ${AX + CHIP_W} ${y} C ${AX + CHIP_W + 22} ${y} ${BX - 22} ${y} ${BX} ${y}`}
              stroke="var(--accent-line)"
              strokeWidth={1.4}
              strokeDasharray="3 4"
              fill="none"
            />
            {/* Flowing lanes to state, then to commit */}
            <path d={edge(BX + CHIP_W, y, SX - SR, y)} stroke="var(--accent)" strokeWidth={1.6} fill="none" className={flow} opacity={0.9} />
            <path d={edge(SX + SR, y, CX, y)} stroke="var(--accent)" strokeWidth={1.6} fill="none" className={flow} opacity={0.9} />

            {/* First transaction */}
            <TxChip x={AX} y={y} tx={lane.first.tx} fn={lane.first.fn} />
            {/* Second transaction */}
            <TxChip x={BX} y={y} tx={lane.second.tx} fn={lane.second.fn} />

            {/* Storage slot node */}
            <circle cx={SX} cy={y} r={SR} fill="var(--surface-base)" stroke="var(--accent)" strokeWidth={1.6} />
            <circle cx={SX} cy={y} r={SR + 5} fill="none" stroke="var(--accent-line)" strokeWidth={1} opacity={reduce ? 0.4 : 0.6} />
            <text x={SX} y={y - SR - 9} fill="var(--text-secondary)" fontSize="10.5" textAnchor="middle">
              {lane.slot}
            </text>
          </motion.g>
        );
      })}
    </svg>
  );
}

function TxChip({ x, y, tx, fn }: { x: number; y: number; tx: string; fn: string }) {
  return (
    <g>
      <rect
        x={x}
        y={y - CHIP_H / 2}
        width={CHIP_W}
        height={CHIP_H}
        rx={11}
        fill="var(--surface-raised)"
        stroke="var(--border-strong)"
      />
      <circle cx={x + 16} cy={y} r={3.2} fill="var(--accent)" />
      <text x={x + 30} y={y - 3} fill="var(--text-primary)" fontSize="12" fontWeight={600}>
        {tx}
      </text>
      <text x={x + 30} y={y + 12} fill="var(--text-muted)" fontSize="10">
        {fn}()
      </text>
    </g>
  );
}
