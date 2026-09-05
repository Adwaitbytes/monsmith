/**
 * Graph model for the parallel execution view.
 *
 * The previous version stacked every node in one tall column and drew a dashed
 * edge between every pair of functions in every conflict, which on a real
 * contract is thousands of crossing lines inside a 500px panel. Contention is
 * a property of a slot, not a line between two boxes, so it is encoded in the
 * nodes here and the edges only carry what they can actually show: which
 * entrypoint touches which slot, and how.
 */

import type { Edge, Node } from 'reactflow';
import type { Entrypoint, Hotspot, ParallelAnalysisResult } from './analyzer';

export type NodeTone = 'serial' | 'conditional' | 'independent' | 'global' | 'keyed' | 'caller';

export interface ParallelNodeData {
    kind: 'entrypoint' | 'slot';
    label: string;
    /** One short line under the title: the type, or the effect counts. */
    detail: string;
    tone: NodeTone;
    /** Node ids that stay lit when this node is focused. */
    related: string[];
    entrypoint?: Entrypoint;
    hotspot?: Hotspot;
}

export type ParallelNode = Node<ParallelNodeData>;

export interface ParallelGraph {
    nodes: ParallelNode[];
    edges: Edge[];
    /** Height the laid-out graph occupies, so the view can size its canvas. */
    height: number;
}

const ROW = 84;
const COLUMN_GAP = 420;
const TOP = 24;
const SLOT_WIDTH = 212;

/** Laid-out width of the two columns, used to fit the graph to the panel. */
export const GRAPH_WIDTH = COLUMN_GAP + SLOT_WIDTH;

export function buildParallelGraph(analysis: ParallelAnalysisResult): ParallelGraph {
    const contentionRank: Record<Entrypoint['contention'], number> = {
        serial: 0, conditional: 1, independent: 2,
    };
    const scopeRank = { global: 0, keyed: 1, caller: 2 } as const;

    const entrypoints = [...analysis.entrypoints].sort(
        (a, b) => contentionRank[a.contention] - contentionRank[b.contention] || a.name.localeCompare(b.name)
    );
    const hotspots = [...analysis.hotspots].sort(
        (a, b) => scopeRank[a.scope] - scopeRank[b.scope] || a.variable.localeCompare(b.variable)
    );

    // Two columns of different lengths look broken when both start at the top.
    const rows = Math.max(entrypoints.length, hotspots.length);
    const offsetOf = (count: number) => TOP + ((rows - count) * ROW) / 2;
    const entryTop = offsetOf(entrypoints.length);
    const slotTop = offsetOf(hotspots.length);

    const slotIds = new Set(hotspots.map((hotspot) => slotId(hotspot.variable)));
    const nodes: ParallelNode[] = [];
    const edges: Edge[] = [];

    entrypoints.forEach((entry, index) => {
        const touched = [...entry.writes, ...entry.reads]
            .map((effect) => slotId(effect.variable))
            .filter((id) => slotIds.has(id));

        const peers = [...entry.conflictsWith, ...entry.contendsOnKeyWith].map(entryId);

        nodes.push({
            id: entryId(entry.name),
            type: 'entrypoint',
            position: { x: 0, y: entryTop + index * ROW },
            data: {
                kind: 'entrypoint',
                label: `${entry.name}()`,
                detail: detailFor(entry),
                tone: entry.contention,
                related: [...new Set([entryId(entry.name), ...touched, ...peers])],
                entrypoint: entry,
            },
        });
    });

    hotspots.forEach((hotspot, index) => {
        const touching = [...hotspot.writers, ...hotspot.readers].map(entryId);

        nodes.push({
            id: slotId(hotspot.variable),
            type: 'slot',
            position: { x: COLUMN_GAP, y: slotTop + index * ROW },
            data: {
                kind: 'slot',
                label: hotspot.variable,
                detail: shortType(hotspot.typeText),
                tone: hotspot.scope,
                related: [...new Set([slotId(hotspot.variable), ...touching])],
                hotspot,
            },
        });
    });

    for (const entry of entrypoints) {
        const written = new Set(entry.writes.map((effect) => effect.variable));

        for (const effect of entry.writes) {
            const target = slotId(effect.variable);
            if (!slotIds.has(target)) continue;
            const alsoReads = entry.reads.some((read) => read.variable === effect.variable);

            edges.push({
                id: `w-${entry.name}-${effect.variable}`,
                source: entryId(entry.name),
                target,
                sourceHandle: 'out',
                targetHandle: 'in',
                type: 'bezier',
                data: { flow: 'write' },
                label: alsoReads ? 'read + write' : 'write',
            });
        }

        for (const effect of entry.reads) {
            if (written.has(effect.variable)) continue;
            const source = slotId(effect.variable);
            if (!slotIds.has(source)) continue;

            edges.push({
                id: `r-${entry.name}-${effect.variable}`,
                source: entryId(entry.name),
                target: source,
                sourceHandle: 'out',
                targetHandle: 'in',
                type: 'bezier',
                data: { flow: 'read' },
                label: 'read',
            });
        }
    }

    return { nodes, edges, height: TOP * 2 + rows * ROW };
}

function detailFor(entry: Entrypoint): string {
    const writes = entry.writes.length;
    const reads = entry.reads.length;
    if (writes === 0 && reads === 0) return 'touches no storage';
    return `${writes} write${writes === 1 ? '' : 's'} · ${reads} read${reads === 1 ? '' : 's'}`;
}

/** `mapping(address => mapping(address => uint))` is unreadable at node size. */
function shortType(typeText: string): string {
    const trimmed = typeText.replace(/\s+/g, ' ').trim();
    if (!trimmed.startsWith('mapping')) return trimmed;
    const depth = (trimmed.match(/mapping/g) || []).length;
    const value = trimmed.replace(/.*=>\s*/, '').replace(/\)+$/, '').trim();
    return depth > 1 ? `nested mapping → ${value}` : `mapping → ${value}`;
}

export function entryId(name: string): string {
    return `fn:${name}`;
}

export function slotId(variable: string): string {
    return `slot:${variable}`;
}

/** The few actions worth putting at the top of the overview, in impact order. */
export function optimizationPriorities(analysis: ParallelAnalysisResult): string[] {
    const priorities: string[] = [];

    // Ordered by measured cost. Hotspots already arrive sorted by blocked pairs.
    for (const hotspot of analysis.hotspots.filter((h) => h.scope === 'global' && h.blockedPairs > 0)) {
        const action = hotspot.accumulator ? 'Shard' : 'Key or remove';
        priorities.push(
            `${action} '${hotspot.variable}' — one slot for all callers, blocking ${hotspot.blockedPairs} entrypoint ${hotspot.blockedPairs === 1 ? 'pair' : 'pairs'}`
        );
    }

    for (const entry of analysis.entrypoints) {
        if (entry.contention === 'serial' && entry.conflictsWith.length === 1 && entry.conflictsWith[0] === entry.name) {
            priorities.push(`${entry.name}() serialises against its own concurrent callers`);
        }
    }

    return priorities.slice(0, 5);
}
