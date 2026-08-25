import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CompilerDiagnostic } from './apiTypes';

export type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
    }),
    {
      name: 'monsmith-theme',
    }
  )
);

// User store
interface UserState {
  walletAddress: string | null;
  userId: string | null;
  username: string | null;
  isConnected: boolean;
  network: 'testnet' | 'mainnet';
  setUser: (data: { walletAddress: string; userId?: string; username?: string }) => void;
  disconnect: () => void;
  setNetwork: (network: 'testnet' | 'mainnet') => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      walletAddress: null,
      userId: null,
      username: null,
      isConnected: false,
      network: 'testnet',
      setUser: (data) => set({ 
        walletAddress: data.walletAddress, 
        userId: data.userId,
        username: data.username,
        isConnected: true 
      }),
      disconnect: () => set({ 
        walletAddress: null, 
        userId: null,
        username: null,
        isConnected: false 
      }),
      setNetwork: (network) => set({ network }),
    }),
    {
      name: 'monsmith-user',
    }
  )
);

// Project store
interface ProjectFile {
  id: string;
  path: string;
  content: string;
  language: string;
  isModified: boolean;
}

interface ProjectState {
  currentProjectId: string | null;
  currentProjectName: string | null;
  files: ProjectFile[];
  activeFileId: string | null;
  setProject: (id: string, name: string) => void;
  setFiles: (files: ProjectFile[]) => void;
  setActiveFile: (id: string) => void;
  updateFileContent: (id: string, content: string) => void;
  addFile: (file: ProjectFile) => void;
  removeFile: (id: string) => void;
  clearProject: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProjectId: null,
  currentProjectName: null,
  files: [],
  activeFileId: null,
  setProject: (id, name) => set({ currentProjectId: id, currentProjectName: name }),
  setFiles: (files) => set({ files }),
  setActiveFile: (id) => set({ activeFileId: id }),
  updateFileContent: (id, content) => set({
    files: get().files.map(f => 
      f.id === id ? { ...f, content, isModified: true } : f
    )
  }),
  addFile: (file) => set({ files: [...get().files, file] }),
  removeFile: (id) => set({ 
    files: get().files.filter(f => f.id !== id),
    activeFileId: get().activeFileId === id ? null : get().activeFileId
  }),
  clearProject: () => set({ 
    currentProjectId: null, 
    currentProjectName: null, 
    files: [], 
    activeFileId: null 
  }),
}));

// IDE State
interface CompileResult {
  success: boolean;
  errors?: CompilerDiagnostic[];
  warnings?: CompilerDiagnostic[];
  bytecode?: string;
  abi?: unknown[];
}

interface IDEState {
  isCompiling: boolean;
  isDeploying: boolean;
  compileResult: CompileResult | null;
  consoleOutput: string[];
  terminalOpen: boolean;
  sidebarOpen: boolean;
  aiPanelOpen: boolean;
  setCompiling: (val: boolean) => void;
  setDeploying: (val: boolean) => void;
  setCompileResult: (result: CompileResult | null) => void;
  addConsoleOutput: (line: string) => void;
  clearConsole: () => void;
  toggleTerminal: () => void;
  toggleSidebar: () => void;
  toggleAIPanel: () => void;
}

export const useIDEStore = create<IDEState>((set, get) => ({
  isCompiling: false,
  isDeploying: false,
  compileResult: null,
  consoleOutput: ['🟣 Monsmith IDE initialized...'],
  terminalOpen: true,
  sidebarOpen: true,
  aiPanelOpen: false,
  setCompiling: (val) => set({ isCompiling: val }),
  setDeploying: (val) => set({ isDeploying: val }),
  setCompileResult: (result) => set({ compileResult: result }),
  addConsoleOutput: (line) => set({ consoleOutput: [...get().consoleOutput, line] }),
  clearConsole: () => set({ consoleOutput: [] }),
  toggleTerminal: () => set({ terminalOpen: !get().terminalOpen }),
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  toggleAIPanel: () => set({ aiPanelOpen: !get().aiPanelOpen }),
}));
