/**
 * Graph model for the parallel execution view.
 *
 * The previous version stacked every node in one tall column and drew a dashed
 * edge between every pair of functions in every conflict, which on a real
 * contract is thousands of crossing lines inside a 500px panel. Contention is
 * a property of a slot, not a line between two boxes, so it is encoded in the
 * nodes here and the edges only carry what they can actually show: which
 * entrypoint touches which slot, and how.
 *
 * Past a certain size even that is too much. A settlement contract with two
 * hundred entrypoints draws two hundred boxes against the same two slots, which
 * is a wall rather than a diagram, and no amount of zooming fixes it. So above
 * a threshold entrypoints with an identical storage footprint collapse into one
 * node. That is not a simplification for display: "every entrypoint here writes
 * the same two keyed slots" is the finding, and two hundred separate boxes hide
 * it rather than showing it.
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
    /**
     * Names of every entrypoint folded into this node. Length one for an
     * ordinary node, so the inspector can read it without a special case.
     */
    members?: string[];
}

export type ParallelNode = Node<ParallelNodeData>;

export interface ParallelGraph {
    nodes: ParallelNode[];
    edges: Edge[];
    /** Height the laid-out graph occupies, so the view can size its canvas. */
    height: number;
    /** True when entrypoints were folded by footprint, so the view can say so. */
    grouped: boolean;
    /** Entrypoints in the analysis, before any folding. */
    entrypointCount: number;
}

const ROW = 84;
const COLUMN_GAP = 420;
const TOP = 24;
const SLOT_WIDTH = 212;

/** Laid-out width of the two columns, used to fit the graph to the panel. */
export const GRAPH_WIDTH = COLUMN_GAP + SLOT_WIDTH;

/**
 * Above this many entrypoints, identical footprints are folded together.
 * Below it every function is worth its own box, because the reader is looking
 * at named functions rather than at a shape.
 */
const GROUP_THRESHOLD = 12;

interface EntryGroup {
    id: string;
    members: Entrypoint[];
    tone: Entrypoint['contention'];
    /** Variables written, then read, restricted to those that have slot nodes. */
    writes: string[];
    reads: string[];
}

/**
 * Folds entrypoints whose storage footprint and contention are identical.
 *
 * The signature deliberately includes contention: two functions touching the
 * same slots but serialising for different reasons are not the same story.
 */
function groupEntrypoints(
    entrypoints: Entrypoint[],
    slotIds: ReadonlySet<string>,
    enabled: boolean,
): EntryGroup[] {
    const visible = (names: string[]) =>
        [...new Set(names)].filter((variable) => slotIds.has(slotId(variable))).sort();

    const groups: EntryGroup[] = [];
    const byKey = new Map<string, EntryGroup>();

    for (const entry of entrypoints) {
        const writes = visible(entry.writes.map((effect) => effect.variable));
        const reads = visible(entry.reads.map((effect) => effect.variable));

        if (!enabled) {
            groups.push({ id: entryId(entry.name), members: [entry], tone: entry.contention, writes, reads });
            continue;
        }

        const key = `${entry.contention}|w:${writes.join(',')}|r:${reads.join(',')}`;
        const existing = byKey.get(key);
        if (existing === undefined) {
            const group: EntryGroup = {
                id: entryId(entry.name),
                members: [entry],
                tone: entry.contention,
                writes,
                reads,
            };
            byKey.set(key, group);
            groups.push(group);
        } else {
            existing.members.push(entry);
        }
    }

    return groups;
}

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

    const slotIds = new Set(hotspots.map((hotspot) => slotId(hotspot.variable)));
    const grouped = entrypoints.length > GROUP_THRESHOLD;
    const groups = groupEntrypoints(entrypoints, slotIds, grouped);

    // Which node an entrypoint ended up in, so a conflict with a folded peer
    // still lights the node that peer is now part of.
    const nodeOf = new Map<string, string>();
    for (const group of groups) {
        for (const member of group.members) nodeOf.set(member.name, group.id);
    }

    // Two columns of different lengths look broken when both start at the top.
    const rows = Math.max(groups.length, hotspots.length);
    const offsetOf = (count: number) => TOP + ((rows - count) * ROW) / 2;
    const entryTop = offsetOf(groups.length);
    const slotTop = offsetOf(hotspots.length);

    const nodes: ParallelNode[] = [];
    const edges: Edge[] = [];

    groups.forEach((group, index) => {
        const lead = group.members[0];
        const touched = [...group.writes, ...group.reads].map(slotId);
        const peers = group.members
            .flatMap((member) => [...member.conflictsWith, ...member.contendsOnKeyWith])
            .map((name) => nodeOf.get(name))
            .filter((id): id is string => id !== undefined);

        nodes.push({
            id: group.id,
            type: 'entrypoint',
            position: { x: 0, y: entryTop + index * ROW },
            data: {
                kind: 'entrypoint',
                label: group.members.length === 1 ? `${lead.name}()` : `${lead.name}() +${group.members.length - 1}`,
                detail:
                    group.members.length === 1
                        ? detailFor(lead)
                        : `${group.members.length} functions · ${detailFor(lead)}`,
                tone: group.tone,
                related: [...new Set([group.id, ...touched, ...peers])],
                entrypoint: lead,
                members: group.members.map((member) => member.name),
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

    for (const group of groups) {
        const written = new Set(group.writes);

        for (const variable of group.writes) {
            const alsoReads = group.reads.includes(variable);

            edges.push({
                id: `w-${group.id}-${variable}`,
                source: group.id,
                target: slotId(variable),
                sourceHandle: 'out',
                targetHandle: 'in',
                type: 'bezier',
                data: { flow: 'write' },
                label: alsoReads ? 'read + write' : 'write',
            });
        }

        for (const variable of group.reads) {
            if (written.has(variable)) continue;

            edges.push({
                id: `r-${group.id}-${variable}`,
                source: group.id,
                target: slotId(variable),
                sourceHandle: 'out',
                targetHandle: 'in',
                type: 'bezier',
                data: { flow: 'read' },
                label: 'read',
            });
        }
    }

    return {
        nodes,
        edges,
        height: TOP * 2 + rows * ROW,
        grouped: grouped && groups.length < entrypoints.length,
        entrypointCount: entrypoints.length,
    };
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
