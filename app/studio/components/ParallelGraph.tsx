'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactFlow, {
    Background,
    BackgroundVariant,
    Handle,
    MiniMap,
    Position,
    type Edge,
    type NodeProps,
    type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { Maximize2, Minimize2, Minus, Plus, Scan, Search, X } from 'lucide-react';

import { GRAPH_WIDTH } from '@/lib/parallel/graph';
import type { ParallelGraph as GraphModel, ParallelNode, ParallelNodeData } from '@/lib/parallel/graph';

/**
 * The dependency view.
 *
 * Its predecessor stacked every node in one column and drew a dashed line
 * between every pair of functions in every conflict, which for a real contract
 * is a solid red rectangle. Here contention lives in the node, the two columns
 * read left to right as "this entrypoint touches that slot", read edges are off
 * until asked for, and selecting anything dims everything it does not reach.
 *
 * A flattened contract is the case that breaks a side panel: Uniswap V2 has
 * seventeen entrypoints across three contracts, and at panel width the labels
 * are unreadable however the view is fitted. So the graph can take over the
 * viewport, and at that size it earns a search box and a minimap, because the
 * problem stops being "can I see it" and becomes "can I find the one I want".
 */

interface ParallelGraphProps {
    graph: GraphModel;
    /** Reset selection when a new analysis arrives. */
    analysisKey: string;
}

type Filter = 'all' | 'contended';

const TONE_VAR: Record<ParallelNodeData['tone'], string> = {
    serial: '--contention-serial',
    global: '--contention-serial',
    conditional: '--contention-conditional',
    keyed: '--contention-conditional',
    independent: '--contention-parallel',
    caller: '--contention-parallel',
};

const TONE_LABEL: Record<ParallelNodeData['tone'], string> = {
    serial: 'always serialises',
    global: 'one slot for all callers',
    conditional: 'same key only',
    keyed: 'keyed slot',
    independent: 'runs in parallel',
    caller: 'keyed by msg.sender',
};

function EntrypointNode({ data, selected }: NodeProps<ParallelNodeData>) {
    return (
        <div
            className="group w-[236px] rounded-xl border pl-3 pr-3 py-2.5 transition-all duration-200"
            style={{
                background: `var(${TONE_VAR[data.tone]}-soft)`,
                borderColor: selected ? `var(${TONE_VAR[data.tone]})` : `var(${TONE_VAR[data.tone]}-line)`,
                boxShadow: selected ? `0 0 0 1px var(${TONE_VAR[data.tone]})` : 'var(--shadow-panel)',
            }}
        >
            <Handle type="source" id="out" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-[var(--border-strong)]" />
            <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[13px] font-medium text-text-primary truncate">{data.label}</span>
                <span
                    className="shrink-0 text-[10px] font-medium uppercase tracking-wider"
                    style={{ color: `var(${TONE_VAR[data.tone]})` }}
                >
                    {data.tone === 'serial' ? 'serial' : data.tone === 'conditional' ? 'keyed' : 'parallel'}
                </span>
            </div>
            <div className="mt-0.5 text-[11px] text-text-muted">{data.detail}</div>
        </div>
    );
}

function SlotNode({ data, selected }: NodeProps<ParallelNodeData>) {
    return (
        <div
            className="w-[212px] rounded-xl border px-3 py-2.5 transition-all duration-200"
            style={{
                background: 'var(--surface-raised)',
                borderColor: selected ? `var(${TONE_VAR[data.tone]})` : 'var(--border-subtle)',
                boxShadow: selected ? `0 0 0 1px var(${TONE_VAR[data.tone]})` : 'var(--shadow-panel)',
            }}
        >
            <Handle type="target" id="in" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-[var(--border-strong)]" />
            <div className="flex items-center gap-2">
                <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: `var(${TONE_VAR[data.tone]})` }}
                />
                <span className="font-mono text-[13px] text-text-primary truncate">{data.label}</span>
            </div>
            <div className="mt-0.5 truncate pl-3.5 font-mono text-[10.5px] text-text-muted">{data.detail}</div>
        </div>
    );
}

const nodeTypes = { entrypoint: EntrypointNode, slot: SlotNode };

export function ParallelGraph({ graph, analysisKey }: ParallelGraphProps) {
    const [focusId, setFocusId] = useState<string | null>(null);
    const [filter, setFilter] = useState<Filter>('all');
    const [showReads, setShowReads] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [query, setQuery] = useState('');
    const canvasRef = useRef<HTMLDivElement>(null);
    const instanceRef = useRef<ReactFlowInstance | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    // A new analysis invalidates a selection that pointed into the old one.
    const [seenKey, setSeenKey] = useState(analysisKey);
    if (seenKey !== analysisKey) {
        setSeenKey(analysisKey);
        setFocusId(null);
    }

    const focused = useMemo(
        () => graph.nodes.find((node) => node.id === focusId) ?? null,
        [graph.nodes, focusId]
    );

    const lit = useMemo(
        () => (focused ? new Set(focused.data.related) : null),
        [focused]
    );

    /**
     * Search keeps the neighbours of a match, not just the match. A lone node
     * with its edges cut tells you nothing about why it contends, which is the
     * only reason to have gone looking for it.
     */
    const matched = useMemo<Set<string> | null>(() => {
        const needle = query.trim().toLowerCase();
        if (needle.length === 0) return null;

        const hits = graph.nodes.filter((node) => node.data.label.toLowerCase().includes(needle));
        if (hits.length === 0) return new Set<string>();

        const keep = new Set<string>();
        for (const hit of hits) {
            keep.add(hit.id);
            for (const id of hit.data.related) keep.add(id);
        }
        return keep;
    }, [graph.nodes, query]);

    const nodes = useMemo<ParallelNode[]>(() => {
        const contendedOnly = filter === 'contended';

        return graph.nodes
            .filter((node) => !contendedOnly || node.data.tone === 'serial' || node.data.tone === 'global')
            .filter((node) => matched === null || matched.has(node.id))
            .map((node) => ({
                ...node,
                selected: node.id === focusId,
                draggable: false,
                style: {
                    opacity: lit && !lit.has(node.id) ? 0.18 : 1,
                    transition: 'opacity 180ms ease',
                },
            }));
    }, [graph.nodes, filter, focusId, lit, matched]);

    const visibleIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);

    const edges = useMemo<Edge[]>(() => {
        return graph.edges
            .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
            .filter((edge) => showReads || edge.data?.flow === 'write')
            .map((edge) => {
                const isWrite = edge.data?.flow === 'write';
                const inFocus = !focusId || edge.source === focusId || edge.target === focusId;

                return {
                    ...edge,
                    label: undefined,
                    animated: false,
                    style: {
                        stroke: isWrite ? 'var(--contention-serial)' : 'var(--graph-read)',
                        strokeWidth: inFocus && focusId ? 1.8 : 1.1,
                        strokeDasharray: isWrite ? undefined : '4 4',
                        // Unfocused edges read as texture showing where the density
                        // is; focusing a node is what makes an individual one legible.
                        opacity: inFocus ? (focusId ? 0.95 : 0.26) : 0.04,
                        transition: 'opacity 180ms ease',
                    },
                };
            });
    }, [graph.edges, visibleIds, showReads, focusId]);

    const hiddenCount = graph.nodes.length - nodes.length;

    const onNodeClick = useCallback((_: React.MouseEvent, node: ParallelNode) => {
        setFocusId((current) => (current === node.id ? null : node.id));
    }, []);

    /**
     * A contract with a dozen slots lays out taller than the panel is deep.
     * Fitting that vertically would shrink the labels past reading, so the
     * default view fits the width and scrolls, and the fit button in the
     * controls is there for the overview.
     */
    const fitToPanel = useCallback(() => {
        const instance = instanceRef.current;
        const container = canvasRef.current;
        if (!instance || !container) return;

        const { clientWidth, clientHeight } = container;
        if (graph.height <= clientHeight) {
            instance.fitView({ padding: 0.12, maxZoom: 1 });
            return;
        }

        const zoom = Math.min(1, Math.max(0.55, (clientWidth - 40) / GRAPH_WIDTH));
        instance.setViewport({ x: 20, y: 12, zoom });
    }, [graph.height]);

    const onInit = useCallback((instance: ReactFlowInstance) => {
        instanceRef.current = instance;
        fitToPanel();
    }, [fitToPanel]);

    // A different contract lays out differently, so the view is re-fitted rather
    // than left showing the previous graph's corner.
    useEffect(fitToPanel, [fitToPanel, analysisKey]);

    /**
     * Refit whenever the canvas changes size.
     *
     * Going fullscreen resizes the container after this render, so fitting on
     * the state change alone measures the old box and lands on the wrong
     * viewport. Observing the element instead covers that, dragging the panel
     * wider, and resizing the window, with no timing assumption in any of them.
     */
    useEffect(() => {
        const container = canvasRef.current;
        if (container === null || typeof ResizeObserver === 'undefined') return;

        let frame = 0;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(fitToPanel);
        });
        observer.observe(container);

        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [fitToPanel, fullscreen]);

    // Escape leaves fullscreen, and "/" jumps to the search box, which is the
    // pair of shortcuts anyone tries first in a viewport-sized canvas.
    useEffect(() => {
        if (!fullscreen) return;

        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setFullscreen(false);
                return;
            }
            if (event.key === '/' && document.activeElement !== searchRef.current) {
                event.preventDefault();
                searchRef.current?.focus();
            }
        };

        window.addEventListener('keydown', onKey);
        // The page behind must not scroll while the overlay owns the viewport.
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = previousOverflow;
        };
    }, [fullscreen]);

    if (graph.nodes.length === 0) {
        return (
            <div className="flex h-full items-center justify-center rounded-xl border border-border-subtle panel-sunken">
                <p className="max-w-xs text-center text-sm text-text-muted">
                    This contract has no state-changing entrypoints, so there is no dependency graph to draw.
                </p>
            </div>
        );
    }

    const body = (
        <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg border border-border-subtle p-0.5">
                    {(['all', 'contended'] as const).map((value) => (
                        <button
                            key={value}
                            onClick={() => setFilter(value)}
                            className={`rounded-[6px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                filter === value
                                    ? 'bg-accent-soft text-accent'
                                    : 'text-text-muted hover:text-text-primary'
                            }`}
                        >
                            {value === 'all' ? 'Everything' : 'Contended only'}
                        </button>
                    ))}
                </div>

                <button
                    onClick={() => setShowReads((value) => !value)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        showReads
                            ? 'border-accent-line bg-accent-soft text-accent'
                            : 'border-border-subtle text-text-muted hover:text-text-primary'
                    }`}
                >
                    Read edges
                </button>

                {focusId && (
                    <button
                        onClick={() => setFocusId(null)}
                        className="rounded-lg border border-border-subtle px-2.5 py-1 text-[11px] font-medium text-text-muted transition-colors hover:text-text-primary"
                    >
                        Clear focus
                    </button>
                )}

                {(fullscreen || graph.nodes.length > 8) && (
                    <label className="relative flex items-center">
                        <Search className="pointer-events-none absolute left-2 h-3 w-3 text-text-muted" strokeWidth={2} />
                        <input
                            ref={searchRef}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={fullscreen ? 'Find a function or slot  /' : 'Find'}
                            spellCheck={false}
                            aria-label="Filter the graph by name"
                            className="w-32 rounded-lg border border-border-subtle bg-transparent py-1 pl-7 pr-6 text-[11px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent-line sm:w-44"
                        />
                        {query.length > 0 && (
                            <button
                                onClick={() => setQuery('')}
                                aria-label="Clear search"
                                className="absolute right-1.5 rounded p-0.5 text-text-muted transition-colors hover:text-text-primary"
                            >
                                <X className="h-3 w-3" strokeWidth={2} />
                            </button>
                        )}
                    </label>
                )}

                <span className="ml-auto hidden text-[11px] text-text-muted sm:inline">
                    {hiddenCount > 0
                        ? `${nodes.length} of ${graph.nodes.length} shown`
                        : graph.grouped
                          ? `${graph.entrypointCount} entrypoints folded by footprint`
                          : focused
                            ? 'Click again to unfocus'
                            : 'Click a node to trace it'}
                </span>

                <div className="flex items-center gap-0.5 rounded-lg border border-border-subtle p-0.5">
                    <ZoomButton label="Zoom out" onClick={() => instanceRef.current?.zoomOut()}>
                        <Minus className="h-3.5 w-3.5" strokeWidth={2} />
                    </ZoomButton>
                    <ZoomButton label="Zoom in" onClick={() => instanceRef.current?.zoomIn()}>
                        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                    </ZoomButton>
                    <ZoomButton
                        label="Fit graph to view"
                        onClick={() => instanceRef.current?.fitView({ padding: 0.12, maxZoom: 1 })}
                    >
                        <Scan className="h-3.5 w-3.5" strokeWidth={2} />
                    </ZoomButton>
                    <ZoomButton
                        label={fullscreen ? 'Exit fullscreen  (Esc)' : 'Expand to fullscreen'}
                        onClick={() => setFullscreen((value) => !value)}
                    >
                        {fullscreen ? (
                            <Minimize2 className="h-3.5 w-3.5" strokeWidth={2} />
                        ) : (
                            <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
                        )}
                    </ZoomButton>
                </div>
            </div>

            <div ref={canvasRef} className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border-subtle panel-sunken">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    onNodeClick={onNodeClick}
                    onPaneClick={() => setFocusId(null)}
                    onInit={onInit}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable
                    proOptions={{ hideAttribution: true }}
                    minZoom={0.2}
                    maxZoom={1.6}
                >
                    <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--graph-grid)" />
                    {fullscreen && (
                        <MiniMap
                            pannable
                            zoomable
                            ariaLabel="Graph overview"
                            maskColor="var(--graph-minimap-mask)"
                            style={{
                                background: 'var(--surface-sunken)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: 10,
                            }}
                            nodeColor={(node) =>
                                `var(${TONE_VAR[(node.data as ParallelNodeData).tone]})`
                            }
                        />
                    )}
                </ReactFlow>
            </div>

            <GraphFooter focused={focused} />
        </div>
    );

    if (!fullscreen) return body;

    // Portalled to the body on purpose. The panel this lives in is an animated,
    // overflow-hidden flex child, and a transformed ancestor makes `fixed`
    // resolve against that box rather than the viewport, which would clip the
    // overlay to the panel it is trying to escape.
    if (typeof document === 'undefined') return body;

    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Parallel execution graph, fullscreen"
            className="fixed inset-0 z-[60] flex flex-col bg-background/98 backdrop-blur-sm"
        >
            <div className="flex items-center justify-between gap-4 border-b border-border-subtle px-5 py-3">
                <div className="flex items-baseline gap-3">
                    <h2 className="font-display text-[15px] font-semibold tracking-tight text-text-primary">
                        Parallel execution
                    </h2>
                    <span className="text-[12px] text-text-muted">
                        {graph.nodes.length} nodes · press Esc to close
                    </span>
                </div>
                <button
                    onClick={() => setFullscreen(false)}
                    aria-label="Exit fullscreen"
                    className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-border-subtle hover:text-text-primary"
                >
                    <X className="h-4 w-4" strokeWidth={2} />
                </button>
            </div>
            <div className="min-h-0 flex-1 px-5 py-4">{body}</div>
        </div>,
        document.body,
    );
}

/** Legend when nothing is selected, inspector when something is. */
function GraphFooter({ focused }: { focused: ParallelNode | null }) {
    if (!focused) {
        return (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border-subtle px-3 py-2 text-[11px] text-text-muted">
                <Swatch varName="--contention-serial" label="Always serialises" />
                <Swatch varName="--contention-conditional" label="Same key only" />
                <Swatch varName="--contention-parallel" label="Runs in parallel" />
                <span className="flex items-center gap-1.5">
                    <span className="h-px w-5" style={{ background: 'var(--contention-serial)' }} />
                    write
                </span>
                <span className="flex items-center gap-1.5">
                    <span
                        className="h-px w-5"
                        style={{ backgroundImage: 'linear-gradient(to right, var(--graph-read) 55%, transparent 55%)', backgroundSize: '6px 1px' }}
                    />
                    read
                </span>
            </div>
        );
    }

    const { data } = focused;
    const entry = data.entrypoint;
    const hotspot = data.hotspot;
    const members = data.members ?? [];

    return (
        <div className="rounded-xl border border-border-subtle px-3 py-2.5">
            <div className="flex items-baseline gap-2">
                <span className="font-mono text-[13px] font-medium text-text-primary">{data.label}</span>
                <span className="text-[11px]" style={{ color: `var(${TONE_VAR[data.tone]})` }}>
                    {TONE_LABEL[data.tone]}
                </span>
            </div>

            {entry && (
                <>
                    <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">{entry.reason}</p>
                    {entry.through.length > 0 && (
                        <p className="mt-1 text-[11px] text-text-muted">
                            Footprint includes{' '}
                            <span className="font-mono">{entry.through.join(', ')}</span>
                        </p>
                    )}
                    {members.length > 1 && (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">
                            <span className="text-text-secondary">
                                {members.length} functions share this footprint:
                            </span>{' '}
                            <span className="font-mono">{members.slice(0, 12).join(', ')}</span>
                            {members.length > 12 && ` and ${members.length - 12} more`}
                        </p>
                    )}
                </>
            )}

            {hotspot && (
                <>
                    <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">{hotspot.impact}</p>
                    <p className="mt-1 font-mono text-[11px] text-text-muted">
                        {hotspot.typeText}
                        {hotspot.line > 0 ? ` · line ${hotspot.line}` : ''}
                    </p>
                </>
            )}
        </div>
    );
}

function ZoomButton({
    label,
    onClick,
    children,
}: {
    label: string;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            aria-label={label}
            title={label}
            className="rounded-[6px] p-1.5 text-text-muted transition-colors hover:bg-border-subtle hover:text-text-primary"
        >
            {children}
        </button>
    );
}

function Swatch({ varName, label }: { varName: string; label: string }) {
    return (
        <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: `var(${varName})` }} />
            {label}
        </span>
    );
}

export default ParallelGraph;
