import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * The studio's file system.
 *
 * There were two before this, which is why files disappeared on reload. The
 * explorer rendered a component-local `useState` array, and a separate zustand
 * store held a `files` list that nothing read. Neither was persisted, so every
 * refresh reset the workspace and a deliberate delete looked the same as
 * closing the tab. One store, written to localStorage, replaces both.
 *
 * Files are keyed by full path, `contracts/MyToken.sol`, rather than by a bare
 * name. Paths are what a Solidity import resolves against, so a tree with real
 * folders is not decoration: it is what lets one of your files import another.
 *
 * Empty folders are tracked separately. A path-keyed map implies its folders
 * from the files inside it, which means a folder you created and have not put
 * anything in yet would vanish the moment you looked away.
 */

export interface WorkspaceState {
    /** Full path to file contents. */
    files: Record<string, string>;
    /** Folders that exist without holding a file yet. */
    folders: string[];
    /** Path of the file open in the editor. */
    activePath: string | null;
    /** Bumped on every structural change, so effects can watch one value. */
    revision: number;

    createFile: (path: string, content?: string) => boolean;
    writeFile: (path: string, content: string) => void;
    renameFile: (from: string, to: string) => boolean;
    deleteFile: (path: string) => void;
    createFolder: (path: string) => boolean;
    deleteFolder: (path: string) => void;
    setActive: (path: string) => void;
    /** Adds many files at once, as an upload or an import does. */
    addFiles: (files: Record<string, string>, activate?: string) => void;
    reset: (files: Record<string, string>, activePath?: string) => void;
}

/** Trims, strips leading slashes and collapses repeats, so keys stay comparable. */
export function normalisePath(path: string): string {
    return path
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/{2,}/g, "/")
        .replace(/\/+$/, "");
}

export function dirnameOf(path: string): string {
    const index = path.lastIndexOf("/");
    return index === -1 ? "" : path.slice(0, index);
}

export function basenameOf(path: string): string {
    const index = path.lastIndexOf("/");
    return index === -1 ? path : path.slice(index + 1);
}

/** Every folder implied by the files and the explicit folder list. */
export function folderSet(files: Record<string, string>, folders: string[]): Set<string> {
    const all = new Set<string>();

    const addAncestors = (path: string) => {
        const parts = path.split("/");
        for (let i = 1; i < parts.length; i += 1) all.add(parts.slice(0, i).join("/"));
    };

    for (const path of Object.keys(files)) addAncestors(path);
    for (const folder of folders) {
        if (folder.length === 0) continue;
        all.add(folder);
        addAncestors(`${folder}/x`);
    }

    all.delete("");
    return all;
}

const DEFAULT_PATH = "contracts/MyToken.sol";

export const useWorkspace = create<WorkspaceState>()(
    persist(
        (set, get) => ({
            files: {},
            folders: [],
            activePath: null,
            revision: 0,

            createFile: (rawPath, content = "") => {
                const path = normalisePath(rawPath);
                if (path.length === 0) return false;
                if (get().files[path] !== undefined) return false;

                set((state) => ({
                    files: { ...state.files, [path]: content },
                    activePath: path,
                    revision: state.revision + 1,
                }));
                return true;
            },

            // Deliberately does not bump the revision: this fires on every
            // keystroke, and anything watching structure should not re-run for
            // a character typed into a file it already knows about.
            writeFile: (rawPath, content) => {
                const path = normalisePath(rawPath);
                set((state) =>
                    state.files[path] === content
                        ? state
                        : { files: { ...state.files, [path]: content } },
                );
            },

            renameFile: (rawFrom, rawTo) => {
                const from = normalisePath(rawFrom);
                const to = normalisePath(rawTo);
                if (to.length === 0 || from === to) return false;

                const state = get();
                if (state.files[from] === undefined) return false;
                if (state.files[to] !== undefined) return false;

                const files: Record<string, string> = {};
                // Rebuilt in order rather than deleted and appended, so a rename
                // does not send the file to the bottom of the tree.
                for (const [path, value] of Object.entries(state.files)) {
                    files[path === from ? to : path] = value;
                }

                set({
                    files,
                    activePath: state.activePath === from ? to : state.activePath,
                    revision: state.revision + 1,
                });
                return true;
            },

            deleteFile: (rawPath) => {
                const path = normalisePath(rawPath);
                set((state) => {
                    if (state.files[path] === undefined) return state;
                    const files = { ...state.files };
                    delete files[path];

                    const remaining = Object.keys(files);
                    return {
                        files,
                        activePath:
                            state.activePath === path ? (remaining[0] ?? null) : state.activePath,
                        revision: state.revision + 1,
                    };
                });
            },

            createFolder: (rawPath) => {
                const path = normalisePath(rawPath);
                if (path.length === 0) return false;
                if (get().folders.includes(path)) return false;

                set((state) => ({
                    folders: [...state.folders, path],
                    revision: state.revision + 1,
                }));
                return true;
            },

            deleteFolder: (rawPath) => {
                const path = normalisePath(rawPath);
                const prefix = `${path}/`;

                set((state) => {
                    const files = { ...state.files };
                    for (const key of Object.keys(files)) {
                        if (key === path || key.startsWith(prefix)) delete files[key];
                    }

                    const remaining = Object.keys(files);
                    const stillActive =
                        state.activePath !== null && files[state.activePath] !== undefined;

                    return {
                        files,
                        folders: state.folders.filter(
                            (folder) => folder !== path && !folder.startsWith(prefix),
                        ),
                        activePath: stillActive ? state.activePath : (remaining[0] ?? null),
                        revision: state.revision + 1,
                    };
                });
            },

            setActive: (rawPath) => {
                const path = normalisePath(rawPath);
                if (get().files[path] === undefined) return;
                set({ activePath: path });
            },

            addFiles: (incoming, activate) => {
                const files: Record<string, string> = { ...get().files };
                for (const [path, content] of Object.entries(incoming)) {
                    const key = normalisePath(path);
                    if (key.length > 0) files[key] = content;
                }

                const first = Object.keys(incoming)[0];
                set((state) => ({
                    files,
                    activePath: normalisePath(activate ?? first ?? state.activePath ?? ""),
                    revision: state.revision + 1,
                }));
            },

            reset: (files, activePath) =>
                set((state) => ({
                    files,
                    folders: [],
                    activePath: activePath ?? Object.keys(files)[0] ?? null,
                    revision: state.revision + 1,
                })),
        }),
        {
            name: "monsmith-workspace",
            storage: createJSONStorage(() => localStorage),
            version: 1,
            partialize: (state) => ({
                files: state.files,
                folders: state.folders,
                activePath: state.activePath,
                revision: state.revision,
            }),
        },
    ),
);

/**
 * Seeds an empty workspace.
 *
 * Only when it is genuinely empty. Running on every mount would overwrite the
 * files someone came back for, which is the bug this store exists to fix.
 */
export function seedWorkspace(defaultContract: string): void {
    const state = useWorkspace.getState();
    if (Object.keys(state.files).length > 0) {
        // Repair an active path pointing at a file that no longer exists.
        if (state.activePath === null || state.files[state.activePath] === undefined) {
            useWorkspace.setState({ activePath: Object.keys(state.files)[0] });
        }
        return;
    }
    useWorkspace.getState().reset({ [DEFAULT_PATH]: defaultContract }, DEFAULT_PATH);
}

/** Solidity sources, for compiling the workspace as one project. */
export function solidityFiles(files: Record<string, string>): Record<string, string> {
    const sources: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
        if (path.endsWith(".sol")) sources[path] = content;
    }
    return sources;
}
