'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
    ChevronDown,
    ChevronRight,
    Download,
    FileCode,
    FilePlus,
    Folder,
    FolderOpen,
    FolderPlus,
    Pencil,
    Trash2,
    Upload,
} from 'lucide-react';

import {
    basenameOf,
    dirnameOf,
    folderSet,
    normalisePath,
    useWorkspace,
} from '@/lib/workspace';

import { SectionHeader } from './SidePanel';

/**
 * The file tree.
 *
 * Its predecessor was a flat list of names over component state: no folders, no
 * rename, and nothing survived a reload. Paths are the point of the rewrite.
 * Solidity resolves an import against the importing file's path, so a tree with
 * real folders is what lets one of your files import another, and a flat list
 * of names cannot express that at all.
 *
 * Nesting is derived from the paths rather than stored as a tree, so there is
 * one representation of the workspace and no second structure to keep in step
 * with it.
 */

interface TreeNode {
    name: string;
    path: string;
    children: Map<string, TreeNode>;
    isFile: boolean;
}

function buildTree(files: Record<string, string>, folders: string[]): TreeNode {
    const root: TreeNode = { name: '', path: '', children: new Map(), isFile: false };

    const ensure = (path: string, isFile: boolean): TreeNode => {
        const parts = path.split('/');
        let node = root;
        let sofar = '';

        for (let i = 0; i < parts.length; i += 1) {
            sofar = sofar === '' ? parts[i] : `${sofar}/${parts[i]}`;
            const leaf = i === parts.length - 1;
            let child = node.children.get(parts[i]);
            if (child === undefined) {
                child = { name: parts[i], path: sofar, children: new Map(), isFile: leaf && isFile };
                node.children.set(parts[i], child);
            }
            node = child;
        }
        return node;
    };

    for (const folder of folderSet(files, folders)) ensure(folder, false);
    for (const path of Object.keys(files)) ensure(path, true);
    return root;
}

/** Folders first, then files, each alphabetical. */
function sortedChildren(node: TreeNode): TreeNode[] {
    return [...node.children.values()].sort((a, b) => {
        if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
        return a.name.localeCompare(b.name);
    });
}

export interface FileExplorerProps {
    /** Collapse state, owned by the side panel so one section can grow. */
    expanded?: boolean;
    onToggle?: () => void;
    /** Called when the open file changes, so the editor can follow. */
    onOpen: (path: string) => void;
    onNotify?: (message: string) => void;
}

export function FileExplorer({ onOpen, onNotify, expanded = true, onToggle }: FileExplorerProps) {
    const files = useWorkspace((state) => state.files);
    const folders = useWorkspace((state) => state.folders);
    const activePath = useWorkspace((state) => state.activePath);
    const createFile = useWorkspace((state) => state.createFile);
    const createFolder = useWorkspace((state) => state.createFolder);
    const renameFile = useWorkspace((state) => state.renameFile);
    const deleteFile = useWorkspace((state) => state.deleteFile);
    const deleteFolder = useWorkspace((state) => state.deleteFolder);
    const addFiles = useWorkspace((state) => state.addFiles);
    const setActive = useWorkspace((state) => state.setActive);

    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [renaming, setRenaming] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [creating, setCreating] = useState<{ kind: 'file' | 'folder'; parent: string } | null>(null);
    const uploadRef = useRef<HTMLInputElement>(null);

    const tree = useMemo(() => buildTree(files, folders), [files, folders]);
    const fileCount = Object.keys(files).length;

    /**
     * Opens a file and tells the host it happened.
     *
     * Selection goes through the store rather than out through `onOpen`,
     * because a callback the host might only log leaves the tree highlighting
     * one file while the editor shows another. `onOpen` is a notification of
     * something that already happened, never the thing that makes it happen.
     */
    const open = (path: string) => {
        if (setActive(path)) onOpen(path);
        else onNotify?.(`Could not open ${path}: it is no longer in the workspace.`);
    };

    const toggle = (path: string) =>
        setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });

    const commitCreate = () => {
        if (creating === null) return;
        const name = draft.trim();
        setCreating(null);
        setDraft('');
        if (name.length === 0) return;

        const path = normalisePath(creating.parent === '' ? name : `${creating.parent}/${name}`);

        if (creating.kind === 'folder') {
            if (createFolder(path)) onNotify?.(`Created folder ${path}`);
            else onNotify?.(`${path} already exists`);
            return;
        }

        const withExtension = /\.[a-z]+$/i.test(path) ? path : `${path}.sol`;
        const stub = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ${basenameOf(withExtension).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '') || 'NewContract'} {
}
`;
        if (createFile(withExtension, stub)) {
            open(withExtension);
            onNotify?.(`Created ${withExtension}`);
        } else {
            onNotify?.(`${withExtension} already exists`);
        }
    };

    const commitRename = () => {
        if (renaming === null) return;
        const target = normalisePath(`${dirnameOf(renaming)}/${draft.trim()}`.replace(/^\//, ''));
        const from = renaming;
        setRenaming(null);
        setDraft('');
        if (draft.trim().length === 0) return;

        if (renameFile(from, target)) {
            open(target);
            onNotify?.(`Renamed to ${target}`);
        } else {
            onNotify?.(`Could not rename to ${target}`);
        }
    };

    const onUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const picked = event.target.files;
        if (picked === null || picked.length === 0) return;

        const incoming: Record<string, string> = {};
        for (const file of Array.from(picked)) {
            // `webkitRelativePath` is set when a folder was chosen, which is how
            // an uploaded project keeps the shape its imports rely on.
            const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
            const path = normalisePath(relative !== undefined && relative.length > 0 ? relative : file.name);
            incoming[path] = await file.text();
        }

        addFiles(incoming);
        const first = Object.keys(incoming)[0];
        if (first !== undefined) open(first);
        onNotify?.(`Added ${Object.keys(incoming).length} file(s)`);
        event.target.value = '';
    };

    const download = () => {
        // One file downloads as itself; a workspace downloads as a readable
        // bundle rather than pulling in a zip library for the occasional export.
        const paths = Object.keys(files);
        const single = paths.length === 1;
        const body = single
            ? files[paths[0]]
            : paths.map((path) => `// ==== ${path} ====\n${files[path]}`).join('\n\n');

        const blob = new Blob([body], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = single ? basenameOf(paths[0]) : 'monsmith-workspace.sol';
        anchor.click();
        URL.revokeObjectURL(url);
        onNotify?.(`Downloaded ${anchor.download}`);
    };

    const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
        const isCollapsed = collapsed.has(node.path);
        const indent = { paddingLeft: `${depth * 12 + 8}px` };

        if (!node.isFile) {
            return (
                <div key={node.path}>
                    <div
                        className="group flex items-center gap-1.5 rounded py-1 pr-1 text-[12.5px] text-text-secondary transition-colors hover:bg-border-subtle/60"
                        style={indent}
                    >
                        <button
                            onClick={() => toggle(node.path)}
                            className="flex min-w-0 flex-1 items-center gap-1.5"
                        >
                            {isCollapsed ? (
                                <ChevronRight size={13} className="shrink-0" />
                            ) : (
                                <ChevronDown size={13} className="shrink-0" />
                            )}
                            {isCollapsed ? (
                                <Folder size={13} className="shrink-0 text-amber-500" />
                            ) : (
                                <FolderOpen size={13} className="shrink-0 text-amber-500" />
                            )}
                            <span className="truncate">{node.name}</span>
                        </button>

                        <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                                onClick={() => {
                                    setCreating({ kind: 'file', parent: node.path });
                                    setDraft('');
                                }}
                                title="New file here"
                                className="rounded p-0.5 hover:text-text-primary"
                            >
                                <FilePlus size={12} />
                            </button>
                            <button
                                onClick={() => {
                                    setCreating({ kind: 'folder', parent: node.path });
                                    setDraft('');
                                }}
                                title="New folder here"
                                className="rounded p-0.5 hover:text-text-primary"
                            >
                                <FolderPlus size={12} />
                            </button>
                            <button
                                onClick={() => {
                                    deleteFolder(node.path);
                                    onNotify?.(`Deleted ${node.path}`);
                                }}
                                title="Delete folder and everything in it"
                                className="rounded p-0.5 text-red-400 hover:bg-red-500/20"
                            >
                                <Trash2 size={12} />
                            </button>
                        </span>
                    </div>

                    {!isCollapsed && (
                        <>
                            {creating !== null && creating.parent === node.path && (
                                <input
                                    autoFocus
                                    value={draft}
                                    onChange={(event) => setDraft(event.target.value)}
                                    onBlur={commitCreate}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') commitCreate();
                                        if (event.key === 'Escape') setCreating(null);
                                    }}
                                    placeholder={creating.kind === 'file' ? 'Name.sol' : 'folder'}
                                    style={{ marginLeft: `${(depth + 1) * 12 + 8}px` }}
                                    className="my-0.5 w-[70%] rounded border border-accent-line bg-transparent px-1.5 py-0.5 text-[12px] text-text-primary outline-none"
                                />
                            )}
                            {sortedChildren(node).map((child) => renderNode(child, depth + 1))}
                        </>
                    )}
                </div>
            );
        }

        const isActive = node.path === activePath;
        return (
            <div
                key={node.path}
                onClick={() => open(node.path)}
                className={`group flex cursor-pointer items-center gap-1.5 rounded py-1 pr-1 text-[12.5px] transition-colors ${
                    isActive
                        ? 'bg-accent-soft text-accent'
                        : 'text-text-secondary hover:bg-border-subtle/60 hover:text-text-primary'
                }`}
                style={indent}
            >
                <FileCode size={13} className="ml-[13px] shrink-0" />
                {renaming === node.path ? (
                    <input
                        autoFocus
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') commitRename();
                            if (event.key === 'Escape') setRenaming(null);
                        }}
                        onClick={(event) => event.stopPropagation()}
                        className="w-full rounded border border-accent-line bg-transparent px-1 py-0.5 text-[12px] text-text-primary outline-none"
                    />
                ) : (
                    <span className="truncate">{node.name}</span>
                )}

                <span className="ml-auto flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                        onClick={(event) => {
                            event.stopPropagation();
                            setRenaming(node.path);
                            setDraft(node.name);
                        }}
                        title="Rename"
                        className="rounded p-0.5 hover:text-text-primary"
                    >
                        <Pencil size={11} />
                    </button>
                    {fileCount > 1 && (
                        <button
                            onClick={(event) => {
                                event.stopPropagation();
                                deleteFile(node.path);
                                onNotify?.(`Deleted ${node.path}`);
                            }}
                            title="Delete"
                            className="rounded p-0.5 text-red-400 hover:bg-red-500/20"
                        >
                            <Trash2 size={11} />
                        </button>
                    )}
                </span>
            </div>
        );
    };

    const action = 'rounded p-1 text-text-muted outline-none ring-accent-line transition-colors hover:bg-border-subtle hover:text-text-primary focus-visible:ring-2';

    return (
        <section
            className={`flex min-h-0 flex-col border-b border-border-subtle ${
                expanded ? 'flex-1' : 'shrink-0'
            }`}
        >
            <SectionHeader
                open={expanded}
                onToggle={onToggle ?? (() => undefined)}
                title="Explorer"
                count={fileCount}
                actions={
                    <>
                    <button
                        onClick={() => {
                            setCreating({ kind: 'file', parent: 'contracts' });
                            setDraft('');
                        }}
                        title="New file"
                        aria-label="New file"
                        className={action}
                    >
                        <FilePlus size={14} />
                    </button>
                    <button
                        onClick={() => {
                            setCreating({ kind: 'folder', parent: '' });
                            setDraft('');
                        }}
                        title="New folder"
                        aria-label="New folder"
                        className={action}
                    >
                        <FolderPlus size={14} />
                    </button>
                    <button
                        onClick={() => uploadRef.current?.click()}
                        title="Upload files or a folder"
                        aria-label="Upload files or a folder"
                        className={action}
                    >
                        <Upload size={14} />
                    </button>
                    <button
                        onClick={download}
                        title="Download the workspace"
                        aria-label="Download the workspace"
                        className={action}
                    >
                        <Download size={14} />
                    </button>
                    </>
                }
            />

            <input
                ref={uploadRef}
                type="file"
                multiple
                accept=".sol,.json,.txt,.md"
                onChange={onUpload}
                className="hidden"
                // Lets a whole project be dropped in with its folder shape intact.
                {...{ webkitdirectory: '', directory: '' }}
            />

            {expanded && (
            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                {creating !== null && creating.parent === '' && (
                    <input
                        autoFocus
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commitCreate}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') commitCreate();
                            if (event.key === 'Escape') setCreating(null);
                        }}
                        placeholder={creating.kind === 'file' ? 'Name.sol' : 'folder'}
                        className="mx-2 mb-1 w-[85%] rounded border border-accent-line bg-transparent px-1.5 py-0.5 text-[12px] text-text-primary outline-none"
                    />
                )}
                {sortedChildren(tree).map((node) => renderNode(node, 0))}
                {fileCount === 0 && (
                    <p className="px-3 py-4 text-[12px] leading-relaxed text-text-muted">
                        No files yet. Create one, or upload a folder.
                    </p>
                )}
            </div>
            )}

            {expanded && fileCount > 0 && (
                <p className="shrink-0 px-3 pb-2 pt-1 text-[10.5px] leading-relaxed text-text-muted">
                    Saved in this browser. Compiling uses every .sol file here, so your imports
                    resolve.
                </p>
            )}
        </section>
    );
}
