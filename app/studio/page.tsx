"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeftRight,
  Files,
  Fuel,
  Network,
  Rocket,
  Scale,
  Radio,
  ShieldCheck,
  Brain,
  Terminal,
  X,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Copy,
  ExternalLink,
  Hammer,
  Search,
} from "lucide-react";
import { useThemeStore, useUserStore, useIDEStore } from "@/lib/store";
import { basenameOf, seedWorkspace, solidityFiles, useWorkspace } from "@/lib/workspace";
import { FileExplorer } from "./components/FileExplorer";
import { useHydrated } from "@/lib/useHydrated";
import { useNarrowViewport } from "@/lib/useNarrowViewport";
import { useBalance } from "@/lib/useBalance";
import { useResizable } from "@/lib/useResizable";
import { ResizeHandle } from "./components/ResizeHandle";
import type { QuickActionType } from "@/lib/apiTypes";
import { MigrationWizard } from "./components/MigrationWizard";
import { ContractInteraction } from "./components/ContractInteraction";
import { CompileArtifacts } from "./components/CompileArtifacts";
import { ReportHistory } from "./components/ReportHistory";
import { AIPanel } from "./components/AIPanel";
import { SidePanelSection, useSection } from "./components/SidePanel";
import { Assistant } from "./components/Assistant";
import { ParallelProfiler } from "./components/ParallelProfiler";
import { GasProfiler } from "./components/GasProfiler";
import { ChainFitReport } from "./components/ChainFitReport";
import { SAMPLE_CONTRACTS } from "../compare/samples";
import { generateFromTemplate, ARCHITECT_TO_TEMPLATE, CONTRACT_TEMPLATES } from "@/lib/contractTemplates";
import { track, visitorId } from "@/lib/track";
import { createPaymentHeader } from "@/utils/q402";
import { getEthereumProvider } from "@/lib/ethereum";
import { deployFromWallet, constructorInputs, isConstructorPayable, type ConstructorInput } from "@/lib/deploy";
import { coerceArgument, describeType, placeholderFor } from "@/lib/contractInteraction";
import { parseEther, type Abi } from "viem";
import {
  errorMessage,
  readJson,
  type AgentTextResponse,
  type CompileResponse,
  type CompilerDiagnostic,
  type ExplainErrorResponse,
  type PaymentChallenge,
  type PymonAuditResponse,
  type SecurityAuditResponse,
  type TeachModeContent,
  type TranspileResponse,
} from "@/lib/apiTypes";

// Dynamically import Monaco to avoid SSR issues
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center panel-sunken">
      <Loader2 className="animate-spin text-purple-500" size={32} />
    </div>
  ),
});

import { StudioBar, type PrimaryAction } from "./components/StudioBar";
import { AccountMenu } from "./components/AccountMenu";
import { CommandPalette } from "./components/CommandPalette";
import type { OmniboxIntent } from "./components/Omnibox";
import { StartScreen } from "./components/StartScreen";
import { SAMPLE_PATH, SAMPLE_SOURCE } from "./sampleContract";
import { usePlan } from "@/lib/billing/usePlan";
import { useReportUnlock } from "@/lib/billing/useReportUnlock";
import { RepoPicker } from "./components/RepoPicker";
import { WelcomeTour } from "./components/WelcomeTour";
import { ActivityBar, type ActivityItem } from "./components/ActivityBar";
import { StatusBar } from "./components/StatusBar";
import { EditorTabs } from "./components/EditorTabs";
import { ReportRail, type RailState } from "./components/report/ReportRail";
import { buildCommands, modifierLabel } from "./commands";
import { useShortcuts } from "./useShortcuts";
import { useReportStream } from "@/lib/report/useReportStream";
import { useGitHub, importFailed } from "@/lib/github/useGitHub";
import type { ReportOrigin } from "@/lib/report/types";
import type { RepoSummary } from "@/lib/github/source";
import {
    ARCHITECT_CONTRACT_TYPES,
    DEFAULT_CONTRACT,
    DEFAULT_PYTHON_CONTRACT,
    PYTHON_TEMPLATES,
    TEMPLATES,
} from "./templates";

/**
 * How a console line is coloured.
 *
 * The old version matched on emoji prefixes and hardcoded dark-theme colours,
 * so every line was grey on a light background and the meaning was carried by a
 * character rather than by the words. Matching on what the line says survives
 * the emoji being removed, and the tokens follow the theme the way the rest of
 * the studio does.
 */
function consoleLineClass(line: string): string {
    const text = line.toLowerCase();
    if (/(failed|error|could not|reverted|denied)/.test(text)) {
        return 'text-red-600 dark:text-red-400';
    }
    if (/(warning|skipped|cut short|not measured)/.test(text)) {
        return 'text-amber-600 dark:text-amber-400';
    }
    if (/(deployed|compiled|imported|unlocked|connected|copied|opened|created)/.test(text)) {
        return 'text-emerald-700 dark:text-emerald-400';
    }
    return 'text-text-secondary';
}

export default function StudioPage() {
  const { theme, toggleTheme } = useThemeStore();
  const { walletAddress, isConnected, network, setUser, disconnect, setNetwork } = useUserStore();
  const { 
    isCompiling,
    isDeploying, 
    compileResult, 
    consoleOutput,
    terminalOpen,
    sidebarOpen,
    setCompiling,
    setDeploying,
    setCompileResult,
    addConsoleOutput,
    clearConsole,
    toggleTerminal,
    toggleAIPanel
  } = useIDEStore();

  const mounted = useHydrated();

  // The editor reads and writes the persisted workspace directly. It used to
  // hold the source in component state beside a second, unpersisted store,
  // which is why a reload restored the starter contract and a deliberate
  // delete could not be told apart from closing the tab.
  const files = useWorkspace((state) => state.files);
  const activePath = useWorkspace((state) => state.activePath);
  const writeFile = useWorkspace((state) => state.writeFile);
  const addFiles = useWorkspace((state) => state.addFiles);
  const setActive = useWorkspace((state) => state.setActive);

  const code = (activePath === null ? undefined : files[activePath]) ?? "";
  const currentFileName = activePath === null ? "" : basenameOf(activePath);

  const setCode = useCallback(
    (next: string) => {
      if (activePath !== null) writeFile(activePath, next);
    },
    [activePath, writeFile],
  );

  /** Opens a path at the given contents, creating it if it is not there yet. */
  const openWith = useCallback(
    (path: string, content: string) => {
      addFiles({ [path]: content }, path);
    },
    [addFiles],
  );
  const [language, setLanguage] = useState<"solidity" | "python">("solidity");
  const [, setTranspiledSolidity] = useState<string | null>(null);
  const [aiResponse, setAIResponse] = useState<string | null>(null);
  const [aiLoading, setAILoading] = useState(false);
  const [teachModeContent, setTeachModeContent] = useState<TeachModeContent | null>(null);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [deployedAddress, setDeployedAddress] = useState<string | null>(null);

  // ============= AI MODES STATE =============
  const [aiMode, setAIMode] = useState<"architect" | "researcher">("architect");
  // Architect Mode State
  const [selectedContractType, setSelectedContractType] = useState<string | null>(null);
  const [architectParams, setArchitectParams] = useState<Record<string, string>>({});
  const [architectGenerating, setArchitectGenerating] = useState(false);
  // Researcher Mode State
  const [researchQuery, setResearchQuery] = useState("");
  const [researchHistory, setResearchHistory] = useState<{role: "user" | "assistant", content: string}[]>([]);

  // A constructor with parameters cannot be deployed blind; these hold the
  // prompt state until the user supplies them.
  const [ctorInputs, setCtorInputs] = useState<ConstructorInput[]>([]);
  const [ctorArgs, setCtorArgs] = useState<string[]>([]);
  const [ctorError, setCtorError] = useState<string | null>(null);
  // A payable constructor needs a value field even with no arguments, so the
  // dialog's own open state cannot be inferred from the argument list alone.
  const [ctorPayable, setCtorPayable] = useState(false);
  const [ctorValue, setCtorValue] = useState("");
  const ctorOpen = ctorInputs.length > 0 || ctorPayable;
  // Architect Chat State
  const [architectChatInput, setArchitectChatInput] = useState("");
  const [architectChatHistory, setArchitectChatHistory] = useState<{role: "user" | "assistant", content: string}[]>([]);
  const [researchLoading, setResearchLoading] = useState(false);

  // ============= REPORT, PALETTE AND IMPORT =============
  // The report rail, the command palette and the repository picker are what the
  // six panel toggles and the three action buttons turned into. They are held
  // here rather than in a store because none of them outlive the studio.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [showStart, setShowStart] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const plan = usePlan();
  /*
    Two independent regions, because they are two independent questions.

    The explorer and search live on the left, beside the editor. The report and
    the measurement tools live on the right. Running one flag across both meant
    opening Chain Fit closed the file tree, which is not a trade anyone wants to
    make: you open a tool to look at a contract you still need to navigate to.
    VS Code keeps its primary and secondary side bars independent for the same
    reason.
  */
  const [sideBarView, setSideBarView] = useState<string | null>("explorer");

  /*
    The side panel's sections. Kept here rather than inside each one because
    only the container can enforce the rule that makes the column work: exactly
    one section grows and the rest size to their contents.
  */
  const [filesOpen, toggleFiles] = useSection("files");
  const [reportsOpen, toggleReports] = useSection("reports");
  const [artifactsOpen, toggleArtifacts] = useSection("artifacts");
  const [reportCount, setReportCount] = useState(0);
  const [activeView, setActiveView] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [railOpen, setRailOpen] = useState(true);
  // Below this width the editor is at its floor, so the right dock stands down
  // unless it was opened deliberately.
  const narrow = useNarrowViewport();
  const balance = useBalance(walletAddress, network);
  const [railForced, setRailForced] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [repoOrigin, setRepoOrigin] = useState<ReportOrigin>({ kind: "workspace" });
  const [repoLabel, setRepoLabel] = useState<string | null>(null);

  const report = useReportStream();
  const github = useGitHub();

  const isDark = theme === "dark";

  // Docked panels are drag-resizable; sizes persist per panel.
  const sidebarResize = useResizable({ initial: 248, min: 180, max: 420, edge: "right", storageKey: "ms.w.sidebar" });
  const aiResize = useResizable({ initial: 380, min: 300, max: 720, edge: "left", storageKey: "ms.w.ai" });
  const railResize = useResizable({ initial: 460, min: 360, max: 900, edge: "left", storageKey: "ms.w.rail" });
  const toolResize = useResizable({ initial: 560, min: 400, max: 1000, edge: "left", storageKey: "ms.w.tool" });
  const migrationResize = useResizable({ initial: 450, min: 360, max: 860, edge: "left", storageKey: "ms.w.migration" });
  const interactResize = useResizable({ initial: 420, min: 340, max: 820, edge: "left", storageKey: "ms.w.interact" });
  const terminalResize = useResizable({ initial: 180, min: 90, max: 520, edge: "top", storageKey: "ms.h.terminal" });

  /**
   * The AI assistant, profiler and migration wizard all dock to the right of the
   * editor. Showing two at once leaves no room for the code, so opening one
   * closes the others; clicking the active one closes it.
   */
  /**
   * One dock, one source of truth.
   *
   * There were two. The AI panel, the interaction panel and the migration
   * wizard each kept their own open flag and coordinated through a helper that
   * closed the others by hand, while the newer tools went through `activeView`.
   * Neither mechanism knew about the other, so opening the assistant and then
   * Chain Fit left both on screen with the editor crushed between them, and no
   * amount of care in either would have prevented it: the bug was having two.
   *
   * `activeView` now decides what occupies the right dock, and every panel
   * derives its visibility from it. Adding a panel means adding a case here,
   * which is the point: there is nowhere else to add one.
   */
  const openSidePanel = (panel: "ai" | "profiler" | "migration" | "interact" | "gas" | "chainfit") => {
    const id = panel === "profiler" ? "parallel" : panel;
    setActiveView((current) => (current === id ? null : id));

    const eventFor = {
      profiler: "parallel_analysis",
      migration: "migration",
      gas: "gas_profile",
      chainfit: "chain_fit",
      interact: "interact_read",
      ai: "ai_generate",
    } as const;
    track(eventFor[panel], { walletAddress, detail: { opened: true } });
  };

  /** Opens the assistant without toggling it shut when it is already open. */
  const showAIPanel = () => setActiveView("ai");

  // Named views, so the JSX still reads as "is this panel open" rather than as
  // a string comparison repeated a dozen times.
  const aiPanelOpen = activeView === "ai";
  const interactOpen = activeView === "interact";
  const migrationOpen = activeView === "migration";
  const setInteractOpen = (open: boolean) => setActiveView(open ? "interact" : null);
  const setMigrationOpen = (open: boolean) => setActiveView(open ? "migration" : null);

  // One page view per mount, so visitor counts reflect people rather than renders.
  //
  // A `?sample=` parameter lets /compare hand the studio a specific contract, so
  // "try this stage now" lands in the editor with the code already loaded rather
  // than on an empty file the reader has to go and fill in themselves.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("sample");
    const sample = requested === null
      ? undefined
      : SAMPLE_CONTRACTS.find((entry) => entry.id === requested);

    // Seeding runs before the sample is applied, and only fills a workspace
    // that is genuinely empty, so returning to the studio reopens your files
    // instead of overwriting them with the starter contract.
    seedWorkspace(DEFAULT_CONTRACT);

    if (sample !== undefined) {
      useWorkspace.getState().addFiles(
        { [`contracts/${sample.id}.sol`]: sample.source },
        `contracts/${sample.id}.sol`,
      );
      setLanguage("solidity");
    }

    track("page_view", { detail: { page: "studio", sample: sample?.id ?? null } });
  }, []);

  /**
   * Where a first visit begins, and where GitHub sends people back to.
   *
   * The start cards open for anyone who has not chosen a path yet, which is the
   * whole answer to "a new user cannot tell what this does". Someone with work
   * already in the workspace, or arriving on a sample link, has clearly chosen,
   * so they go straight to the editor.
   *
   * The same effect handles the return trip from GitHub, because the install
   * redirect lands here and the only useful thing to do with that is open the
   * picker they were in the middle of using.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnedFrom = params.get("github");
    const repo = params.get("repo");
    const address = params.get("address");

    if (returnedFrom !== null || repo !== null || address !== null) {
      // The parameters have been consumed, and leaving them in the URL would
      // re-trigger this on every reload.
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (returnedFrom === "connected") {
      void github.refreshStatus();
      setRepoPickerOpen(true);
      addConsoleOutput("GitHub connected.");
      return;
    }
    if (returnedFrom === "signin") {
      addConsoleOutput("Sign in first, then connect GitHub.");
      return;
    }
    if (repo !== null) {
      void loadRepo({ url: repo });
      return;
    }
    if (address !== null) {
      void loadAddress(address, params.get("chain") ?? "ethereum");
      return;
    }

    if (params.get("sample") !== null) return;
    // `seedWorkspace` has already run, so a genuinely new visitor has exactly
    // the one starter file and nothing they have chosen.
    const existing = Object.keys(useWorkspace.getState().files);
    const fresh = existing.length <= 1;
    setShowStart(fresh);

    /*
      No modal before the product.

      The tour used to open over a first visit, four cards deep, before anything
      had happened. Remix is the thing to beat here and it wins on exactly this:
      open the URL, make a file, hit compile, seconds to a real result. A
      walkthrough in front of that trades the one metric that matters for an
      explanation nobody asked for yet.

      So the cards stay, one keystroke away and offered by name in the palette,
      and the studio opens on something you can act on. Someone who wants the
      tour can have it; someone who wants to audit a contract is not stopped.
    */
    // The picker needs this the moment a card is clicked, and it is one cheap
    // request rather than a wait at the point of intent.
    void github.prepare();
    // Reading the workspace once on mount is the point; re-running when it
    // changes would reopen the cards over work in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Connects a wallet, stably.
   *
   * Declared as a plain function it was rebuilt on every render, so every
   * callback that depended on it was rebuilt too, and the memoisation around
   * them bought nothing. It closes over nothing that changes.
   */
  const connectWallet = useCallback(async () => {
    const ethereum = getEthereumProvider();
    if (ethereum) {
      try {
        const accounts = await ethereum.request<string[]>({
          method: "eth_requestAccounts",
        });
        const address = accounts?.[0];
        if (!address) {
          addConsoleOutput("No account returned by the wallet");
          return;
        }
        setUser({ walletAddress: address });
        addConsoleOutput(`Wallet connected: ${address.slice(0, 6)}...${address.slice(-4)}`);
        
        // Track in Supabase - get or create user and store UUID
        track("wallet_connect", { walletAddress: address });
            } catch (err) {
        addConsoleOutput(`Wallet connection failed: ${errorMessage(err)}`);
      }
    } else {
      addConsoleOutput("No wallet detected. Install MetaMask to deploy.");
    }
  }, [addConsoleOutput, setUser]);

  // Compile contract.
  // `sourceOverride` lets the architect compile code it just generated: reading
  // `code` here would return the pre-update value until React re-renders.
  /**
   * Compiles, with no wallet required.
   *
   * This used to refuse outright until a wallet was connected, which made the
   * most basic operation in the product the one thing a visitor could not do.
   * Compiling runs solc on the server and charges nothing: the paid actions are
   * audit and deploy, and compile was never on that list. Remix asks for no
   * wallet to compile and neither should this.
   *
   * The payment branch below stays, because the server is allowed to change its
   * mind about what costs money. It now asks for a wallet at the point one is
   * actually needed rather than at the door.
   */
  const handleCompile = async (sourceOverride?: string) => {

    const source = sourceOverride ?? code;

    // Every .sol file in the workspace goes to the compiler, not just the open
    // one, so `import "./Ownable.sol"` resolves against a file the user wrote.
    // `entry` names the contract they mean to build; without it the compiler
    // would guess, and on a workspace with several contracts it would guess wrong.
    const project =
      activePath !== null && sourceOverride === undefined
        ? { sources: solidityFiles(files), entry: activePath }
        : undefined;

    setCompiling(true);
    clearConsole();

    const startTime = Date.now();

    // Handle Python contracts via PyMon API
    if (language === "python") {
      addConsoleOutput("Transpiling Python contract...");

      try {
        // First transpile Python to Solidity
        const transpileRes = await fetch("/api/pymon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "compile",
            code: source,
          }),
        });

        const transpileResult = await readJson<TranspileResponse>(transpileRes);

        if (!transpileResult.success) {
          addConsoleOutput(`Transpilation failed: ${transpileResult.error}`);
          setCompileResult({
            success: false,
            errors: [{ message: transpileResult.error ?? "Transpilation failed" }],
          });
          setCompiling(false);
          return;
        }

        if (!transpileResult.solidityCode) {
          addConsoleOutput("Transpiler returned no Solidity output");
          setCompileResult({ success: false, errors: [{ message: "Transpiler returned no Solidity output" }] });
          setCompiling(false);
          return;
        }

        addConsoleOutput(`Transpiled to Solidity: ${transpileResult.contractName ?? "contract"}`);
        setTranspiledSolidity(transpileResult.solidityCode);

        // Now compile the Solidity code
        addConsoleOutput("Compiling generated Solidity...");

        let res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "compile",
            userAddress: walletAddress,
            code: transpileResult.solidityCode,
          }),
        });

        // Handle payment if the server asks for it.
        if (res.status === 402) {
          if (walletAddress === null) {
            addConsoleOutput("This compile needs a payment. Connect a wallet to continue.");
            setCompiling(false);
            return;
          }
          const data = await readJson<PaymentChallenge>(res);
          addConsoleOutput("Signature required for compilation...");
          const xPaymentHeader = await createPaymentHeader(walletAddress, data.paymentDetails);

          res = await fetch("/api/agent", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-PAYMENT": xPaymentHeader,
            },
            body: JSON.stringify({
              action: "compile",
              userAddress: walletAddress,
              code: transpileResult.solidityCode,
            }),
          });
        }

        const result = await readJson<CompileResponse>(res);
        const compileTime = Date.now() - startTime;

        if (result.success) {
          addConsoleOutput(`Python contract compiled in ${compileTime}ms`);
          addConsoleOutput(`Bytecode size: ${(result.bytecode?.length || 0) / 2} bytes`);
          setCompileResult({
            success: true,
            bytecode: result.bytecode,
            abi: result.abi || transpileResult.abi,
          });
        } else {
          addConsoleOutput(`Compilation failed`);
          setCompileResult({ success: false, errors: result.errors });
        }
      } catch (err) {
        addConsoleOutput(`Error: ${errorMessage(err)}`);
        setCompileResult({ success: false, errors: [{ message: errorMessage(err) }] });
      }

      setCompiling(false);
      return;
    }

    // Standard Solidity compilation
    addConsoleOutput("Compiling contract...");

    try {
      let res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "compile",
          userAddress: walletAddress,
          code: source,
          ...project,
        }),
      });

      // Handle payment if the server asks for it.
      if (res.status === 402) {
        if (walletAddress === null) {
          addConsoleOutput("This compile needs a payment. Connect a wallet to continue.");
          setCompiling(false);
          return;
        }
        const data = await readJson<PaymentChallenge>(res);
        addConsoleOutput("Signature required for compilation...");
        const xPaymentHeader = await createPaymentHeader(walletAddress, data.paymentDetails);
        
        res = await fetch("/api/agent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PAYMENT": xPaymentHeader,
          },
          body: JSON.stringify({
            action: "compile",
            userAddress: walletAddress,
            code: source,
            ...project,
          }),
        });
      }

      const result = await readJson<CompileResponse>(res);
      const compileTime = Date.now() - startTime;

      if (result.success) {
        // Named, because a file can declare several contracts and only one is
        // built. Silently deploying the wrong one is worse than not deploying.
        const built = result.contractName === undefined ? "" : ` ${result.contractName}`;
        addConsoleOutput(`Compiled${built} in ${compileTime}ms`);
        addConsoleOutput(`Bytecode size: ${(result.bytecode?.length || 0) / 2} bytes`);
        setCompileResult({
          success: true,
          bytecode: result.bytecode,
          abi: result.abi,
          linkReferences: result.linkReferences,
          libraries: result.libraries,
        });

        if (result.libraries !== undefined && result.libraries.length > 0) {
          const names = result.libraries.map((library) => library.name).join(", ");
          addConsoleOutput(
            `Links against ${result.libraries.length} librar${result.libraries.length === 1 ? "y" : "ies"}: ${names}. ` +
            `Deploying will put ${result.libraries.length === 1 ? "it" : "them"} on chain first.`
          );
        }
        
        track("compile", {
          durationMs: compileTime,
          walletAddress,
          detail: { bytes: result.contractSize, language },
        });
      } else {
        addConsoleOutput(`Compilation failed`);
        if (result.errors) {
          result.errors.forEach((err) => {
            addConsoleOutput(`   ${err.message}`);
          });
        }
        setCompileResult({
          success: false,
          errors: result.errors,
        });

        // Generate AI explanation for errors
        if (result.errors && result.errors.length > 0) {
          await generateErrorExplanation(result.errors);
        }

        // Track failure
        track("compile", {
          status: "error",
          durationMs: compileTime,
          walletAddress,
          detail: { error: result.errors?.[0]?.message?.slice(0, 200) },
        });
      }
    } catch (err) {
      addConsoleOutput(`Error: ${errorMessage(err)}`);
      setCompileResult({ success: false, errors: [{ message: errorMessage(err) }] });
    } finally {
      setCompiling(false);
    }
  };

  // Generate AI explanation for errors
  const generateErrorExplanation = async (errors: CompilerDiagnostic[]) => {
    setAILoading(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "explain_error",
          userAddress: walletAddress,
          code,
          errors,
        }),
      });

      const data = await readJson<ExplainErrorResponse>(res);
      if (data.success && data.explanation) {
        setAIResponse(data.explanation);
        setTeachModeContent(data.teachMode ?? null);
        showAIPanel();
      }
    } catch (err) {
      console.error("Failed to get AI explanation:", err);
    } finally {
      setAILoading(false);
    }
  };

  // Deploy contract
  const handleDeploy = async () => {
    if (!compileResult?.success) {
      addConsoleOutput("Please compile successfully first");
      return;
    }
    if (!walletAddress) {
      addConsoleOutput("Connect a wallet to deploy");
      return;
    }
    if (!compileResult.abi || !compileResult.bytecode) {
      addConsoleOutput("Compile output is missing the ABI or bytecode. Compile again.");
      return;
    }

    // Ask for constructor arguments before touching the wallet. Deploying with
    // the wrong number of them reverts on chain and costs gas for nothing. A
    // payable constructor opens the same dialog even with no arguments, because
    // it still needs somewhere to say how much MON to send.
    const required = constructorInputs(compileResult.abi as Abi);
    const payable = isConstructorPayable(compileResult.abi as Abi);

    if ((required.length > 0 || payable) && !ctorOpen) {
      setCtorInputs(required);
      setCtorPayable(payable);
      setCtorArgs(required.map(() => ""));
      setCtorValue("");
      setCtorError(null);
      return;
    }

    await performDeploy(required, ctorArgs);
  };

  const closeCtorDialog = () => {
    setCtorInputs([]);
    setCtorPayable(false);
    setCtorError(null);
  };

  const performDeploy = async (required: ConstructorInput[], rawArgs: string[]) => {
    if (!compileResult?.abi || !compileResult.bytecode || !walletAddress) return;

    let typedArgs: unknown[];
    let value = 0n;
    try {
      typedArgs = required.map((input, i) =>
        coerceArgument(rawArgs[i] ?? "", input.type, input.components)
      );
      // Blank means zero. Anything else has to parse, or the deployment would
      // go out with a value the person did not write.
      if (ctorPayable && ctorValue.trim().length > 0) {
        value = parseEther(ctorValue.trim());
      }
    } catch (err) {
      setCtorError(errorMessage(err));
      return;
    }

    setCtorInputs([]);
    setCtorPayable(false);
    setCtorError(null);
    setDeploying(true);
    addConsoleOutput(`Deploying ${language === "python" ? "Python" : "Solidity"} contract to Monad testnet...`);
    addConsoleOutput("Confirm the transaction in your wallet...");

    try {
      const result = await deployFromWallet(
        compileResult.abi as Abi,
        compileResult.bytecode,
        walletAddress as `0x${string}`,
        {
          args: typedArgs,
          value,
          linkReferences: compileResult.linkReferences,
          libraries: compileResult.libraries,
          // The network the status bar has been showing all along. Without
          // this the deploy forced testnet regardless, so choosing mainnet
          // turned the bar red and then quietly deployed somewhere else.
          network,
          onStep: addConsoleOutput,
        }
      );

      addConsoleOutput(`Contract deployed!`);
      addConsoleOutput(`Address: ${result.address}`);
      addConsoleOutput(`TX: ${result.txHash}`);
      addConsoleOutput(` ${result.explorerUrl}`);
      setDeployedAddress(result.address);
      setShowDeployModal(true);

      track("deploy", {
        walletAddress,
        detail: { name: currentFileName },
        deployment: {
          contractAddress: result.address,
          contractName: currentFileName.replace(/\.sol$/, ""),
          txHash: result.txHash,
          deployerAddress: walletAddress,
          gasUsed: result.gasUsed,
        },
      });
    } catch (err) {
      addConsoleOutput(`Deployment failed: ${errorMessage(err)}`);
    } finally {
      setDeploying(false);
    }
  };

  // Switch language and reset code
  const handleLanguageSwitch = (newLang: "solidity" | "python") => {
    if (newLang === language) return;
    setLanguage(newLang);
    setTranspiledSolidity(null);
    setCompileResult(null);

    // Opens the language's starter file rather than overwriting whatever is
    // in the editor. Switching back and forth used to destroy both.
    if (newLang === "python") {
      openWith("contracts/MyContract.py", DEFAULT_PYTHON_CONTRACT);
      addConsoleOutput("Switched to Python mode (PyMon)");
    } else {
      openWith("contracts/MyToken.sol", DEFAULT_CONTRACT);
      addConsoleOutput("Switched to Solidity mode");
    }
  };

  // Python Security Audit
  const handlePythonAudit = async () => {
    if (language !== "python") {
      addConsoleOutput("Audit only available for Python contracts");
      return;
    }

    addConsoleOutput("Running security audit...");

    try {
      const res = await fetch("/api/pymon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "audit",
          code,
        }),
      });

      const result = await readJson<PymonAuditResponse>(res);

      if (result.success) {
        addConsoleOutput(`Security Score: ${result.score}/100 (${result.riskLevel})`);
        addConsoleOutput(`Found ${result.findings?.length || 0} issues`);

        if (result.findings && result.findings.length > 0) {
          result.findings.forEach((f) => {
            const icon = f.severity === 'critical' ? '' :
              f.severity === 'high' ? '' :
                f.severity === 'medium' ? '' : '';
            addConsoleOutput(`   ${icon} [${f.severity.toUpperCase()}] ${f.title}`);
          });
        }

        if (result.bestPractices && result.bestPractices.length > 0) {
          addConsoleOutput("Recommendations:");
          result.bestPractices.forEach((tip: string) => {
            addConsoleOutput(`   • ${tip}`);
          });
        }
      } else {
        addConsoleOutput(`Audit failed: ${result.error}`);
      }
    } catch (err) {
      addConsoleOutput(`Error: ${errorMessage(err)}`);
    }
  };

  // Security Audit
  const handleAudit = async () => {
    setAILoading(true);
    addConsoleOutput("Running security audit...");

    try {
      const res = await fetch("/api/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      const result = await readJson<SecurityAuditResponse>(res);

      if (!result.success || !result.analysis) {
        addConsoleOutput(`Audit failed: ${result.error ?? "Unknown error"}`);
        return;
      }

      const { riskLevel, issues, securityScore, deploymentRecommendation } = result.analysis;
      addConsoleOutput(`Security Score: ${securityScore}/100`);
      addConsoleOutput(`Risk Level: ${riskLevel.toUpperCase()}`);
      addConsoleOutput(`Issues found: ${issues.length}`);

      setAIResponse(`## Security Audit Report\n\n**Risk Level:** ${riskLevel}\n**Score:** ${securityScore}/100\n\n${deploymentRecommendation}\n\n### Issues Found:\n${
        issues.length
          ? issues.map((i) => `- **${i.severity}**: ${i.title}\n  ${i.description}`).join("\n\n")
          : "_No issues detected._"
      }`);

      showAIPanel();

      // Track audit
      track("audit", {
        walletAddress,
        detail: { securityScore, riskLevel, issues: issues.length },
      });
    } catch (err) {
      addConsoleOutput(`Audit failed: ${errorMessage(err)}`);
    } finally {
      setAILoading(false);
    }
  };

  // ============= TEMPLATE LOADING =============
  const loadTemplate = (templateKey: keyof typeof TEMPLATES) => {
    const template = TEMPLATES[templateKey];
    setLanguage("solidity");
    openWith(`contracts/${template.name.replace(/\s+/g, '')}.sol`, template.code);
    addConsoleOutput(`Loaded template: ${template.name}`);
  };

  const loadPythonTemplate = (templateKey: keyof typeof PYTHON_TEMPLATES) => {
    const template = PYTHON_TEMPLATES[templateKey];
    setLanguage("python");
    openWith(`contracts/${template.name.replace(/\s+/g, '')}.py`, template.code);
    addConsoleOutput(`Loaded Python template: ${template.name}`);
  };

  /**
   * Replaces the open file with a verified rewrite from the parallel profiler.
   *
   * The previous source stays only as the editor's undo history, so the console
   * line is the record that it was swapped.
   */
  const applyOptimizedContract = (optimized: string) => {
    setCode(optimized);
    addConsoleOutput(`Applied the parallel-optimized rewrite to ${currentFileName}. Compile and run your tests before deploying.`);
  };

  // ============= QUICK ACTIONS =============
  const handleQuickAction = async (action: QuickActionType) => {
    if (!code.trim()) {
      addConsoleOutput("No code to analyze");
      return;
    }

    setAILoading(true);
    showAIPanel();

    const prompts: Record<QuickActionType, string> = {
      explain: `Explain this Solidity contract in simple terms. What does it do? What are the main functions? 

CONTRACT:
${code}

Provide a clear, beginner-friendly explanation with:
1. Overview (what the contract does)
2. Key functions and their purpose
3. How to use it
4. Any important notes`,

      optimize: `Analyze this Solidity contract for gas optimization opportunities:

CONTRACT:
${code}

Provide:
1. Current gas-heavy patterns found
2. Specific optimization suggestions with code examples
3. Estimated gas savings for each suggestion
4. Optimized version of critical functions`,

      secure: `Review this Solidity contract for security vulnerabilities and suggest improvements:

CONTRACT:
${code}

Provide:
1. Security vulnerabilities found (with severity)
2. Missing security patterns that should be added
3. Specific code additions for each suggestion
4. A summary of recommended security improvements`,

      debug: `Analyze this Solidity contract for potential bugs and issues:

CONTRACT:
${code}

Look for:
1. Logic errors
2. Edge cases not handled
3. Potential runtime errors
4. Best practice violations
5. Provide fixes for each issue found`,
    };

    try {
      addConsoleOutput(`Running ${action} analysis...`);

      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "research",
          userAddress: walletAddress || "anonymous",
          prompt: prompts[action],
        }),
      });

      const result = await readJson<AgentTextResponse>(res);

      if (result.success) {
        const response = result.answer || result.response || "Analysis complete";
        setAIResponse(response);
        addConsoleOutput(` ${action.charAt(0).toUpperCase() + action.slice(1)} analysis complete`);
        
        // Ensure AI panel is visible
        showAIPanel();
        
        track("ai_generate", { walletAddress, detail: { mode: action } });
      } else {
        const errorMsg = result.error || "Unknown error";
        setAIResponse(`Analysis failed: ${errorMsg}`);
        addConsoleOutput(`Analysis failed: ${errorMsg}`);
        showAIPanel();
      }
    } catch (err) {
      const errorMsg = errorMessage(err) || "Request failed";
      setAIResponse(`Error: ${errorMsg}`);
      addConsoleOutput(`Error: ${errorMsg}`);
      showAIPanel();
    } finally {
      setAILoading(false);
    }
  };

  // ============= ARCHITECT MODE HANDLER =============
  const handleArchitectGenerate = async () => {
    if (!selectedContractType) {
      addConsoleOutput("Please select a contract type");
      return;
    }

    const contractType = ARCHITECT_CONTRACT_TYPES.find(t => t.id === selectedContractType);
    if (!contractType) return;

    setArchitectGenerating(true);
    addConsoleOutput(`Architect generating ${contractType.name}...`);

    // ALWAYS switch to Solidity mode when generating contracts
    if (language !== "solidity") {
      setLanguage("solidity");
      addConsoleOutput(`Switched to Solidity mode for contract generation`);
    }

    try {
      let generatedCode: string;
      const templateId = ARCHITECT_TO_TEMPLATE[selectedContractType];

      // Check if we have a pre-built template for this contract type
      if (templateId && CONTRACT_TEMPLATES[templateId]) {
        addConsoleOutput(`Using pre-built template for guaranteed compilation...`);

        // Map user params to template params
        const templateParams: Record<string, string> = {};

        // Map common params
        if (architectParams.name) {
          templateParams["TOKEN_NAME"] = architectParams.name;
          templateParams["COLLECTION_NAME"] = architectParams.name;
          templateParams["DAO_NAME"] = architectParams.name;
          templateParams["VAULT_NAME"] = architectParams.name;
          templateParams["WALLET_NAME"] = architectParams.name;
          templateParams["CONTRACT_NAME"] = architectParams.name.replace(/\s+/g, '');
        }
        if (architectParams.symbol) {
          templateParams["TOKEN_SYMBOL"] = architectParams.symbol;
          templateParams["SYMBOL"] = architectParams.symbol;
        }
        if (architectParams.supply) {
          templateParams["INITIAL_SUPPLY"] = architectParams.supply;
        }
        if (architectParams.maxSupply) {
          templateParams["MAX_SUPPLY"] = architectParams.maxSupply;
        }
        if (architectParams.taxFee) {
          templateParams["BUY_TAX"] = architectParams.taxFee;
          templateParams["SELL_TAX"] = architectParams.taxFee;
        }
        if (architectParams.maxWallet) {
          templateParams["MAX_WALLET"] = architectParams.maxWallet;
        }
        if (architectParams.mintPrice) {
          templateParams["MINT_PRICE"] = architectParams.mintPrice;
          templateParams["WL_PRICE"] = (parseFloat(architectParams.mintPrice) * 0.8).toString();
        }
        if (architectParams.royaltyFee) {
          templateParams["ROYALTY_BPS"] = (parseFloat(architectParams.royaltyFee) * 100).toString();
        }
        if (architectParams.votingDelay) {
          templateParams["VOTING_DELAY"] = architectParams.votingDelay;
        }
        if (architectParams.votingPeriod) {
          templateParams["VOTING_PERIOD"] = architectParams.votingPeriod;
        }
        if (architectParams.quorum) {
          templateParams["QUORUM"] = architectParams.quorum;
        }
        if (architectParams.rewardRate) {
          templateParams["REWARD_RATE"] = architectParams.rewardRate;
        }
        if (architectParams.lockPeriod) {
          templateParams["LOCK_PERIOD"] = architectParams.lockPeriod;
        }
        if (architectParams.threshold) {
          templateParams["TIMELOCK"] = (parseInt(architectParams.timelockDelay || "24")).toString();
        }
        if (architectParams.owners) {
          // For multisig, we need to handle owners differently
        }

        // Generate from template
        generatedCode = generateFromTemplate(templateId, templateParams);
        addConsoleOutput(`Template applied successfully!`);

      } else {
        // Fallback to AI generation for types without templates
        addConsoleOutput(`Using AI generation...`);

        const paramsDescription = Object.entries(architectParams)
          .filter(([_, value]) => value)
          .map(([key, value]) => `- ${key}: ${value}`)
          .join("\n");

        const architectPrompt = `You are a senior Solidity architect. Generate a production-ready, secure, and gas-optimized smart contract for Monad Network.

CONTRACT TYPE: ${contractType.name}
DESCRIPTION: ${contractType.description}
REQUIRED FEATURES: ${contractType.features.join(", ")}

USER PARAMETERS:
${paramsDescription || "Use sensible defaults"}

CRITICAL REQUIREMENTS - YOUR CODE MUST COMPILE:
1. Use EXACTLY: pragma solidity ^0.8.24;
2. Use ONLY these OpenZeppelin imports (copy exactly):
   - @openzeppelin/contracts/token/ERC20/ERC20.sol
   - @openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol
   - @openzeppelin/contracts/token/ERC721/ERC721.sol
   - @openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol
   - @openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol
   - @openzeppelin/contracts/access/Ownable.sol
   - @openzeppelin/contracts/utils/ReentrancyGuard.sol
3. Ownable constructor: Ownable(msg.sender) NOT Ownable()
4. Include comprehensive NatSpec documentation
5. Include events for all state changes
6. Add receive() external payable {} at the end
7. NO constructor parameters - hardcode all values

OUTPUT: ONLY valid Solidity code starting with "// SPDX-License-Identifier: MIT"NO markdown, NO explanations, NO code blocks.`;

        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "architect",
            userAddress: walletAddress || "anonymous",
            prompt: architectPrompt,
            contractType: selectedContractType,
            params: architectParams,
          }),
        });

        const result = await readJson<AgentTextResponse>(res);

        if (!result.success || !result.code) {
          throw new Error(result.error || "AI generation failed");
        }

        generatedCode = result.code;
      }

      // Clean up generated code
      generatedCode = generatedCode
        .replace(/```solidity/g, "")
        .replace(/```/g, "")
        .trim();

      // Ensure proper SPDX header
      if (!generatedCode.startsWith("// SPDX")) {
        const spdxIndex = generatedCode.indexOf("// SPDX");
        if (spdxIndex > 0) {
          generatedCode = generatedCode.substring(spdxIndex);
        } else {
          generatedCode = "// SPDX-License-Identifier: MIT\n" + generatedCode;
        }
      }

      // Fix common issues
      generatedCode = generatedCode
        .replace(/MITpragma/g, "MIT\npragma")
        .replace(/Ownable\(\)/g, "Ownable(msg.sender)")
        .replace(/pragma solidity \^0\.8\.\d+;/g, "pragma solidity ^0.8.24;");

      const fileName = `${contractType.name.replace(/\s+/g, '')}.sol`;
      openWith(`contracts/${fileName}`, generatedCode);

      addConsoleOutput(` ${contractType.name} contract generated successfully!`);
      addConsoleOutput(`File: ${fileName}`);

      // Auto-compile the code we just produced. Passing it explicitly avoids
      // compiling the previous contract from a stale closure.
      if (isConnected) {
        addConsoleOutput(`Auto-compiling to verify...`);
        await handleCompile(generatedCode);
      } else {
        addConsoleOutput(`Connect a wallet to compile and deploy this contract.`);
      }

      track("ai_generate", { walletAddress, detail: { mode: "architect", type: contractType.name } });

    } catch (err) {
      addConsoleOutput(`Error: ${errorMessage(err)}`);
    } finally {
      setArchitectGenerating(false);
    }
  };

  // ============= ARCHITECT CHAT HANDLER =============
  const handleArchitectChat = async () => {
    const message = architectChatInput.trim();
    if (!message || architectGenerating) return;

    // Add user message to history
    setArchitectChatHistory(prev => [...prev, { role: "user", content: message }]);
    setArchitectChatInput("");
    setArchitectGenerating(true);
    addConsoleOutput(`Architect generating contract from request...`);

    // Switch to Solidity mode
    if (language !== "solidity") {
      setLanguage("solidity");
      addConsoleOutput(`Switched to Solidity mode`);
    }

    try {
      const architectPrompt = `You are a senior Solidity architect. Generate a production-ready, secure, and gas-optimized smart contract for Monad Network.

USER REQUEST: "${message}"CRITICAL REQUIREMENTS - YOUR CODE MUST COMPILE:
1. Use EXACTLY: pragma solidity ^0.8.24;
2. Start with: // SPDX-License-Identifier: MIT
3. Use ONLY these OpenZeppelin imports (copy exactly):
   - @openzeppelin/contracts/token/ERC20/ERC20.sol
   - @openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol
   - @openzeppelin/contracts/token/ERC721/ERC721.sol
   - @openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol
   - @openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol
   - @openzeppelin/contracts/access/Ownable.sol
   - @openzeppelin/contracts/utils/ReentrancyGuard.sol
4. Ownable constructor: Ownable(msg.sender) NOT Ownable()
5. Include comprehensive NatSpec documentation
6. Include events for all state changes
7. Add receive() external payable {} at the end
8. NO constructor parameters - hardcode sensible defaults
9. Make the contract feature-complete based on the user's request

OUTPUT: ONLY valid Solidity code starting with "// SPDX-License-Identifier: MIT"NO markdown, NO explanations, NO code blocks, JUST THE CODE.`;

      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "architect",
          userAddress: walletAddress || "anonymous",
          prompt: architectPrompt,
        }),
      });

      const result = await readJson<AgentTextResponse>(res);

      if (!result.success || !result.code) {
        throw new Error(result.error || "Generation failed");
      }

      // Clean up generated code
      let generatedCode = result.code
        .replace(/```solidity/g, "")
        .replace(/```/g, "")
        .trim();

      // Ensure proper SPDX header
      if (!generatedCode.startsWith("// SPDX")) {
        const spdxIndex = generatedCode.indexOf("// SPDX");
        if (spdxIndex > 0) {
          generatedCode = generatedCode.substring(spdxIndex);
        } else {
          generatedCode = "// SPDX-License-Identifier: MIT\n" + generatedCode;
        }
      }

      // Fix common issues
      generatedCode = generatedCode
        .replace(/MITpragma/g, "MIT\npragma")
        .replace(/Ownable\(\)/g, "Ownable(msg.sender)")
        .replace(/pragma solidity \^0\.8\.\d+;/g, "pragma solidity ^0.8.24;");

      // Extract contract name for filename
      const contractNameMatch = generatedCode.match(/contract\s+(\w+)/);
      const contractName = contractNameMatch ? contractNameMatch[1] : "GeneratedContract";
      const fileName = `${contractName}.sol`;

      openWith(`contracts/${fileName}`, generatedCode);

      // Add assistant response to chat
      setArchitectChatHistory(prev => [...prev, {
        role: "assistant",
        content: `Generated **${contractName}** contract!\n\n File: ${fileName}${isConnected ? "\n Auto-compiling to verify..." : "\n Connect a wallet to compile it."}`
      }]);

      addConsoleOutput(` ${contractName} contract generated!`);
      addConsoleOutput(`File: ${fileName}`);

      // Auto-compile the code we just produced. Passing it explicitly avoids
      // compiling the previous contract from a stale closure.
      if (isConnected) {
        addConsoleOutput(`Auto-compiling to verify...`);
        await handleCompile(generatedCode);
      } else {
        addConsoleOutput(`Connect a wallet to compile and deploy this contract.`);
      }

      // Track analytics
      track("ai_generate", { walletAddress, detail: { mode: "architect" } });

    } catch (err) {
      setArchitectChatHistory(prev => [...prev, {
        role: "assistant",
        content: `Error: ${errorMessage(err)}\n\nPlease try again with more specific requirements.`
      }]);
      addConsoleOutput(`Error: ${errorMessage(err)}`);
    } finally {
      setArchitectGenerating(false);
    }
  };

  // ============= RESEARCHER MODE HANDLER =============
  const handleResearchQuery = async (query?: string) => {
    const searchQuery = query || researchQuery;
    if (!searchQuery.trim()) return;

    setResearchLoading(true);
    setResearchHistory(prev => [...prev, { role: "user", content: searchQuery }]);
    setResearchQuery("");

    const researchPrompt = `You are a Web3 and blockchain expert specializing in the Monad ecosystem. Answer the following question with accurate, detailed, and helpful information.

QUESTION: ${searchQuery}

CONTEXT: The user is building on Monad Network, a high-performance EVM-compatible L1 with:
- 10,000+ TPS throughput
- 1-second finality
- Parallel transaction execution
- Full EVM/Solidity compatibility
- MonadDB custom state database
- Optimistic parallelism with conflict detection

Provide a comprehensive answer that includes:
1. Direct answer to the question
2. Technical details where relevant
3. Best practices for Monad specifically
4. Code examples if applicable
5. Links to resources (if you know them)

Be concise but thorough. Format your response with markdown for readability.`;

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "research",
          userAddress: walletAddress || "anonymous",
          prompt: researchPrompt,
        }),
      });

      const result = await readJson<AgentTextResponse>(res);

      if (result.success) {
        const answer = result.answer || result.response || "I couldn't find specific information about that.";
        setResearchHistory(prev => [...prev, { role: "assistant", content: answer }]);

        track("ai_generate", { walletAddress, detail: { mode: "research" } });
      } else {
        setResearchHistory(prev => [...prev, {
          role: "assistant",
          content: `Error: ${result.error || "Failed to get response"}`
        }]);
      }
    } catch (err) {
      setResearchHistory(prev => [...prev, {
        role: "assistant",
        content: `Error: ${errorMessage(err)}`
      }]);
    } finally {
      setResearchLoading(false);
    }
  };

  // Handle quick topic click in researcher mode
  const handleQuickTopic = (topicId: string) => {
    const topicQueries: Record<string, string> = {
      "monad-overview": "What is Monad blockchain and what makes it unique compared to other L1s?",
      "parallel-evm": "How does Monad achieve parallel EVM execution? Explain the technical architecture.",
      "monad-db": "What is MonadDB and how does it improve blockchain performance?",
      "gas-optimization": "What are the best practices for gas optimization on Monad Network?",
      "defi-patterns": "What are the best DeFi patterns and practices for building on Monad?",
      "nft-gaming": "How can I leverage Monad's high TPS for NFT and gaming applications?",
    };
    handleResearchQuery(topicQueries[topicId] || `Tell me about ${topicId}`);
  };

  // ============= THE PRIMARY ACTION AND THE THINGS IT REPLACED =============

  /**
   * One button, labelled by what comes next.
   *
   * The bar used to offer Compile, Audit and Deploy side by side as though they
   * were three choices. They are a sequence, and compiling is not something
   * anyone wants for its own sake. So the report compiles on its own, and the
   * button says the thing the person actually came to do: measure it, or ship it.
   */
  const primaryAction: PrimaryAction =
    compileResult?.success === true && report.state.status === "ready" ? "deploy" : "report";

  const primaryBusy =
    primaryAction === "deploy" ? isDeploying : report.state.status === "running";

  const primaryBlockedReason =
    primaryAction === "deploy" && compileResult?.success !== true
      ? "Compile the contract first."
      : undefined;

  const workspaceTitle = repoLabel ?? (currentFileName === "" ? "Untitled" : currentFileName);
  const workspaceSubtitle = repoLabel !== null && activePath !== null ? activePath : undefined;

  /**
   * Runs the report over a chosen set, or over everything.
   *
   * Auditing the whole workspace was the only option, which is wrong in both
   * directions. Someone working on one contract waited minutes for nine others
   * they did not change, and someone with a forty file repository could not say
   * which ten mattered. The compiler still receives every file so imports
   * resolve; the selection decides what gets audited, not what gets compiled.
   */
  const runReport = useCallback(
    (only?: readonly string[]) => {
      const solidity = solidityFiles(files);
      if (Object.keys(solidity).length === 0) {
        addConsoleOutput("There is no Solidity in the workspace to measure.");
        return;
      }

      const chosen = only !== undefined && only.length > 0 ? only : undefined;
      setShowStart(false);
      setUnlockError(null);
      void report.run({
        files: solidity,
        origin: repoOrigin,
        ...(chosen !== undefined ? { only: [...chosen] } : {}),
      });

      addConsoleOutput(
        chosen === undefined
          ? `Measuring every contract in the workspace.`
          : `Measuring ${chosen.length === 1 ? basenameOf(chosen[0]) : `${chosen.length} selected contracts`}.`,
      );
      track("audit", { walletAddress, detail: { surface: "report", origin: repoOrigin.kind } });
    },
    [files, report, repoOrigin, walletAddress, addConsoleOutput],
  );

  /** Audits just the file in the editor, which is the common case while editing. */
  const runReportForActiveFile = useCallback(() => {
    if (activePath === null || !activePath.toLowerCase().endsWith(".sol")) {
      addConsoleOutput("Open a Solidity file to audit it on its own.");
      return;
    }
    runReport([activePath]);
  }, [activePath, runReport, addConsoleOutput]);

  /**
   * The one-click path from the start screen: load a contract with real bugs in
   * it and audit it at once, so a first visit ends in a report rather than in an
   * editor wondering what to do next. The files are passed straight to the run
   * because the workspace update has not reached `files` in this render yet.
   */
  const runSample = useCallback(() => {
    addFiles({ [SAMPLE_PATH]: SAMPLE_SOURCE }, SAMPLE_PATH);
    setLanguage("solidity");
    const origin: ReportOrigin = { kind: "workspace" };
    setRepoOrigin(origin);
    setShowStart(false);
    setUnlockError(null);
    setRailOpen(true);
    setRailForced(true);
    void report.run({ files: { [SAMPLE_PATH]: SAMPLE_SOURCE }, origin });
    addConsoleOutput("Checking the sample contract.");
    track("audit", { walletAddress, detail: { surface: "sample", origin: origin.kind } });
  }, [addFiles, report, walletAddress, addConsoleOutput]);

  const handlePrimary = () => {
    if (primaryAction === "deploy") handleDeploy();
    else runReport();
  };

  /**
   * Bringing code in, from whichever of the three shapes it arrived in.
   *
   * The omnibox replaced four separate entry points, so this is where they all
   * land. Each one ends the same way: files in the workspace, ready to measure.
   */
  const loadRepo = useCallback(
    async (target: { url: string } | { owner: string; repo: string; ref?: string }) => {
      setRepoPickerOpen(false);
      addConsoleOutput("Reading the repository");

      const result = await github.importRepo(target);
      if (importFailed(result)) {
        addConsoleOutput(result.message);
        // A private repository reads as "not found" to anyone who cannot see
        // it, so the picker opens for both and offers the way in.
        if (result.connectable === true) setRepoPickerOpen(true);
        return;
      }

      addFiles(result.files);
      const origin: ReportOrigin = {
        kind: "github",
        owner: result.ref.owner,
        repo: result.ref.repo,
        ref: result.ref.ref,
        private: result.private,
      };
      setRepoOrigin(origin);
      setRepoLabel(`${result.ref.owner}/${result.ref.repo}`);
      setShowStart(false);

      const count = Object.keys(result.files).length;
      addConsoleOutput(
        `Imported ${count} Solidity file${count === 1 ? "" : "s"} from ${result.ref.owner}/${result.ref.repo}`,
      );
      if (result.truncated) {
        addConsoleOutput("GitHub truncated the file tree, so this import may be partial.");
      }

      /*
        Then actually audit it.
        
        The button that starts this says "Audit it" and the card beside it
        promises that every contract in the repository gets the full report.
        Importing and stopping there keeps neither promise: it drops somebody
        into an editor full of code they did not write, with the thing they
        asked for one more click away and no sign that it is coming.
      */
      void report.run({ files: solidityFiles(result.files), origin });
    },
    [github, addFiles, addConsoleOutput, report],
  );

  /**
   * Brings a deployed contract in by address, then audits it.
   *
   * The same shape as the repository import on purpose: fetch the source,
   * drop it in the workspace, run the report. A reader should not be able to
   * tell from the result whether the contract arrived from GitHub or from a
   * chain, because for the purposes of auditing it there is no difference.
   */
  const loadAddress = useCallback(
    async (address: string, network = "ethereum") => {
      addConsoleOutput(`Looking up ${address.slice(0, 10)}…${address.slice(-6)}`);

      try {
        const response = await fetch("/api/contract-source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, network }),
        });
        const data = (await response.json()) as {
          files?: Record<string, string>;
          name?: string;
          chainId?: number;
          isProxy?: boolean;
          implementationAddress?: string | null;
          sourceProvider?: string;
          error?: string;
        };

        if (!response.ok || data.files === undefined) {
          addConsoleOutput(data.error ?? "That contract could not be loaded.");
          return;
        }

        addFiles(data.files);
        const origin: ReportOrigin = {
          kind: "address",
          address,
          chainId: data.chainId ?? 1,
        };
        setRepoOrigin(origin);
        setRepoLabel(data.name ?? address.slice(0, 10));
        setShowStart(false);

        addConsoleOutput(
          `Loaded ${data.name ?? "the contract"} from ${data.sourceProvider ?? "the explorer"}.`,
        );
        if (data.isProxy === true) {
          // A clean report on twenty lines of forwarding logic is worse than
          // no report, because it reads as a verdict on the thing behind it.
          addConsoleOutput(
            `This is a proxy. What you are about to audit is the forwarder, not the logic it points at${
              data.implementationAddress !== null && data.implementationAddress !== undefined
                ? ` (${data.implementationAddress})`
                : ""
            }.`,
          );
        }

        void report.run({ files: solidityFiles(data.files), origin });
      } catch {
        addConsoleOutput("Could not reach the explorer just now.");
      }
    },
    [addFiles, addConsoleOutput, report],
  );

  const handleOmnibox = useCallback(
    (intent: OmniboxIntent) => {
      if (intent.kind === "repo") {
        void loadRepo({
          owner: intent.ref.owner,
          repo: intent.ref.repo,
          ...(intent.ref.ref !== undefined ? { ref: intent.ref.ref } : {}),
        });
        return;
      }
      if (intent.kind === "address") {
        // Audit it, rather than opening the migration wizard. Pasting an
        // address into a field that offers an audit is a request for an audit;
        // migrating it is a different question nobody asked here.
        void loadAddress(intent.address);
        return;
      }
      const name = `contracts/Pasted${Date.now()}.sol`;
      addFiles({ [name]: intent.code });
      setShowStart(false);
      addConsoleOutput(`Added ${name}`);
    },
    [loadRepo, loadAddress, addFiles, addConsoleOutput],
  );

  const handleRepoPick = (repo: RepoSummary) => {
    void loadRepo({ owner: repo.owner, repo: repo.repo, ref: repo.defaultBranch });
  };

  const openRepoPicker = () => {
    void github.prepare();
    setRepoPickerOpen(true);
  };

  /** Pays for the full report, in MON, over the rail the agent route already uses. */
  const unlockReport = useCallback(async () => {
    if (report.state.status !== "ready") return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const address = walletAddress ?? (await connectWallet());
      if (typeof address !== "string" || address.length === 0) {
        setUnlockError("Connect a wallet to unlock the full report.");
        return;
      }

      const id = report.state.report.reportId;
      const challenge = await fetch(`/api/report/${id}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-visitor-id": visitorId() },
        body: JSON.stringify({ userAddress: address, network }),
      });
      const offer = await challenge.json();

      if (challenge.status === 402 && offer.paymentDetails !== undefined) {
        const header = await createPaymentHeader(address, offer.paymentDetails);
        const paid = await fetch(`/api/report/${id}/unlock`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Payment": header,
            "x-visitor-id": visitorId(),
          },
          body: JSON.stringify({ userAddress: address, network }),
        });
        const settled = await paid.json();
        if (settled.success !== true) {
          setUnlockError(settled.error ?? "The payment did not go through.");
          return;
        }
        report.replace(settled.report);
        addConsoleOutput("Full report unlocked.");
        return;
      }

      if (offer.success === true) {
        report.replace(offer.report);
        return;
      }
      setUnlockError(offer.error ?? "The report could not be unlocked.");
    } catch (error) {
      setUnlockError(errorMessage(error));
    } finally {
      setUnlocking(false);
    }
  }, [report, walletAddress, network, connectWallet, addConsoleOutput]);

  const reportUnlock = useReportUnlock({
    report: report.state.status === "ready" ? report.state.report : null,
    onReplace: report.replace,
    payMon: () => void unlockReport(),
  });

  const railState: RailState =
    report.state.status === "idle"
      ? { status: "empty" }
      : report.state.status === "running"
        ? {
            status: "running",
            done: report.state.done,
            total: report.state.total,
            label: report.state.label,
            partial: report.state.partial,
          }
        : report.state.status === "ready"
          ? { status: "ready", report: report.state.report }
          : { status: "error", message: report.state.message };

  /*
    Errors and warnings, from the compiler and the audit together.

    A developer reading a status bar wants one count of things wrong, not one
    number from solc and a different one from the report. Compiler errors and
    critical or high findings both mean "this is not ready", so they are counted
    as the same thing.
  */
  const problemCounts = useMemo(() => {
    const diagnostics = compileResult?.errors?.length ?? 0;
    const warnings = compileResult?.warnings?.length ?? 0;

    let findingErrors = 0;
    let findingWarnings = 0;
    if (report.state.status === "ready") {
      for (const contract of report.state.report.contracts) {
        findingErrors += contract.counts.critical + contract.counts.high;
        findingWarnings += contract.counts.medium + contract.counts.low;
      }
    }
    return { errors: diagnostics + findingErrors, warnings: warnings + findingWarnings };
  }, [compileResult, report.state]);

  const compileState: "idle" | "working" | "ok" | "failed" = isCompiling
    ? "working"
    : compileResult === null
      ? "idle"
      : compileResult.success
        ? "ok"
        : "failed";

  /*
    Tabs follow whatever the workspace considers open.

    Derived rather than pushed, so opening a file from the tree, the palette,
    an import or a deep link all produce a tab without each of those call sites
    having to remember to add one. Forgetting exactly one of them is how a tab
    strip ends up disagreeing with the editor.
  */
  useEffect(() => {
    if (activePath === null) return;
    setOpenTabs((current) => (current.includes(activePath) ? current : [...current, activePath]));
  }, [activePath]);

  // A file deleted or renamed away must not leave a tab pointing at nothing.
  useEffect(() => {
    setOpenTabs((current) => {
      const live = current.filter((path) => files[path] !== undefined);
      return live.length === current.length ? current : live;
    });
  }, [files]);

  /*
    Hand the AMD loader back after Monaco has taken what it needs.

    Monaco ships an AMD loader that installs a global `define` carrying an `amd`
    marker. Any UMD script that loads afterwards sees that marker, decides it is
    in an AMD environment, and registers itself as an anonymous module. Monaco's
    loader then rejects it with "Can only have one anonymous define call per
    script file" and the script never initialises.

    Clerk's sign-in UI is a UMD script, and it loads lazily, which means it
    always arrived after Monaco. The result was that sign-in silently did not
    work anywhere the editor was mounted, and the console blamed Clerk's CDN
    rather than us. Chasing that error to the wrong place cost real time.

    Only the marker is removed. Monaco keeps `define` itself and its module
    registry, so everything it has already loaded keeps working; what changes is
    that later UMD scripts take the plain browser-global path they were written
    to fall back to.
  */
  const releaseAmdLoader = useCallback(() => {
    const amdDefine = (window as unknown as { define?: { amd?: unknown } }).define;
    if (amdDefine?.amd !== undefined) delete amdDefine.amd;
  }, []);

  const closeTab = (path: string) => {
    setOpenTabs((current) => {
      const next = current.filter((entry) => entry !== path);
      // Closing the file you are looking at should land you somewhere, not on
      // an empty editor.
      if (path === activePath && next.length > 0) {
        const fallback = next[Math.min(current.indexOf(path), next.length - 1)];
        if (fallback !== undefined) setActive(fallback);
      }
      return next;
    });
  };

  /** The activity bar's tools. Distinct shapes, each opening in the same place. */
  const activityItems: ActivityItem[] = [
    { id: "explorer", label: "Explorer", icon: <Files size={19} />, shortcut: `${modifierLabel()}B` },
    {
      id: "search",
      label: "Search files and commands",
      icon: <Search size={19} />,
      shortcut: `${modifierLabel()}K`,
    },
    {
      id: "report",
      label: "Contract report",
      icon: <ShieldCheck size={19} />,
      ...(problemCounts.errors + problemCounts.warnings > 0
        ? {
            badge: problemCounts.errors + problemCounts.warnings,
            badgeTone: (problemCounts.errors > 0 ? "bad" : "warn") as "bad" | "warn",
          }
        : {}),
    },
    /*
      Every tool that exists, reachable.

      The parallel profiler, the execution graph inside it, the optimisation
      panel and the gas profiler were all built, and the toolbar cut left them
      unreachable from the studio: they survived only on the share page. The
      report rail summarises what they measure, which is not the same as the
      tool itself, and summarising something is a poor reason to delete the
      thing that produced it.
    */
    { id: "parallel", label: "Parallel execution and graph", icon: <Network size={19} /> },
    { id: "gas", label: "Gas profiler", icon: <Fuel size={19} /> },
    { id: "chainfit", label: "Chain fit", icon: <Scale size={19} /> },
    { id: "ai", label: "AI assistant", icon: <Brain size={19} /> },
    { id: "interact", label: "Interact with a deployment", icon: <Radio size={19} /> },
    { id: "migration", label: "Migrate from another chain", icon: <ArrowLeftRight size={19} /> },
  ];

  /** Which region an activity-bar icon belongs to. */
  const SIDEBAR_VIEWS = new Set(["explorer", "search"]);

  const selectView = (id: string) => {
    /*
      Every icon in the rail does something, which is the whole point.

      Two of them did not on the first pass, and a control that looks live and
      is not is worse than no control at all: it is the same failure as the nine
      identical icons, just quieter. Search hands off to the palette, which is
      already the thing that searches, and the report icon shows and hides the
      report the way its own panel toggle would.
    */
    if (id === "search") {
      setPaletteOpen(true);
      return;
    }

    // The left side bar toggles on its own and never disturbs the right dock.
    if (SIDEBAR_VIEWS.has(id)) {
      setSideBarView((current) => (current === id ? null : id));
      return;
    }
    if (id === "report") {
      setRailOpen((open) => !open);
      // An explicit toggle outranks the narrow-screen default, in both
      // directions: asking for the report on a small screen should get it.
      setRailForced(true);
      setActiveView("report");
      return;
    }

    /*
      One toggle, not two.

      This used to set the view and then call `openSidePanel`, which toggles the
      same flag, so every click cancelled itself and the panel never appeared.
      That is the cost of a helper that both opens and closes: called from
      something that has already decided, it undoes the decision.
    */
    const next = activeView === id ? null : id;
    setActiveView(next);

    if (next !== null) {
      const eventFor: Record<string, "ai_generate" | "interact_read" | "migration" | "parallel_analysis" | "gas_profile" | "chain_fit"> = {
        ai: "ai_generate",
        interact: "interact_read",
        migration: "migration",
        parallel: "parallel_analysis",
        gas: "gas_profile",
        chainfit: "chain_fit",
      };
      const event = eventFor[next];
      if (event !== undefined) track(event, { walletAddress, detail: { opened: true } });
    }
  };

  /** Which measurement tool is docked, if any. */
  const toolPanel =
    activeView === "parallel" || activeView === "gas" || activeView === "chainfit"
      ? activeView
      : null;

  /*
    Whether anything else already occupies the right dock.

    The first version of this only knew about the three measurement tools, so
    opening the migration wizard left the report beside it and the editor
    squeezed between the two again. Listing the exceptions was the mistake:
    every panel added afterwards had to remember to join the list, and the one
    that forgot produced exactly this bug. Asking whether the dock is free
    cannot be forgotten by a panel that does not exist yet.
  */
  const dockTaken = activeView !== null && activeView !== "report";

  /*
    The keys the interface already claims, actually bound.

    These follow VS Code rather than inventing a scheme, because the muscle
    memory arrives with the person. `useMemo` is not used deliberately: the
    handlers close over current state, and a memoised list would keep firing
    last render's closures.
  */
  useShortcuts([
    { key: "b", mod: true, run: () => setSideBarView((v) => (v === null ? "explorer" : null)) },
    { key: "j", mod: true, run: toggleTerminal },
    { key: "enter", mod: true, run: () => runReport() },
    { key: "s", mod: true, run: () => void handleCompile() },
    {
      key: "escape",
      run: () => {
        // Escape walks out of whatever is in front, innermost first, rather
        // than closing everything and losing the place you were in.
        if (paletteOpen) setPaletteOpen(false);
        else if (repoPickerOpen) setRepoPickerOpen(false);
        else if (activeView !== null) setActiveView(null);
      },
    },
  ]);

  const commands = buildCommands(
    {
      runReport: () => runReport(),
      runReportForFile: runReportForActiveFile,
      compile: () => void handleCompile(),
      deploy: handleDeploy,
      importFromGitHub: openRepoPicker,
      importFromAddress: () => openSidePanel("migration"),
      newFile: () => setShowStart(true),
      templates: [
        ...Object.entries(TEMPLATES).map(([key, template]) => ({
          key,
          name: template.name,
          description: template.description,
          load: () => {
            setShowStart(false);
            loadTemplate(key as keyof typeof TEMPLATES);
          },
        })),
        ...Object.entries(PYTHON_TEMPLATES).map(([key, template]) => ({
          key: `py-${key}`,
          name: `${template.name} (Python)`,
          description: template.description,
          load: () => {
            setShowStart(false);
            loadPythonTemplate(key as keyof typeof PYTHON_TEMPLATES);
          },
        })),
      ],
      openAI: () => openSidePanel("ai"),
      aiAudit: () => void (language === "python" ? handlePythonAudit() : handleAudit()),
      openMigration: () => openSidePanel("migration"),
      openInteract: () => openSidePanel("interact"),
      openTerminal: toggleTerminal,
      toggleTheme,
      toggleNetwork: () => setNetwork(network === "testnet" ? "mainnet" : "testnet"),
      setLanguage: handleLanguageSwitch,
      connectWallet: () => void connectWallet(),
      disconnectWallet: disconnect,
      shareReport: () => {
        if (report.state.status !== "ready") return;
        void navigator.clipboard.writeText(
          `${window.location.origin}/report/${report.state.report.reportId}`,
        );
        addConsoleOutput("Report link copied.");
      },
      showStartCards: () => setShowStart(true),
      showTour: () => setTourOpen(true),
    },
    {
      compiled: compileResult?.success === true,
      deployed: deployedAddress !== null,
      walletConnected: isConnected,
      reportReady: report.state.status === "ready",
      language,
      network,
      theme: isDark ? "dark" : "light",
    },
  );

  if (!mounted) return null;

  return (
    <div className="h-screen flex flex-col bg-background text-text-primary">
      {/* Top bar, at four controls. See StudioBar for why. */}
      <StudioBar
        title={showStart ? "Monsmith" : workspaceTitle}
        {...(showStart ? {} : { subtitle: workspaceSubtitle })}
        primary={primaryAction}
        busy={primaryBusy}
        primaryBlockedReason={primaryBlockedReason}
        onPrimary={handlePrimary}
        onOpenPalette={() => setPaletteOpen(true)}
        minimal={showStart}
        /*
          Deploy appears once, wherever it currently belongs.

          It was listed here unconditionally while the primary button also
          becomes Deploy as soon as there is something to deploy, so a compiled
          contract put two of them side by side, one outlined and one filled,
          saying the same word. Whichever slot is showing it, the other drops it.
        */
        actions={[
          {
            label: "Compile",
            icon: <Hammer size={14} />,
            onClick: () => void handleCompile(),
            busy: isCompiling,
          },
          ...(primaryAction === "deploy"
            ? []
            : [
                {
                  label: "Deploy",
                  icon: <Rocket size={14} />,
                  onClick: handleDeploy,
                  busy: isDeploying,
                  ...(compileResult?.success === true
                    ? {}
                    : { blockedReason: "Compile the contract first." }),
                },
              ]),
        ]}
        account={
          <AccountMenu
            theme={isDark ? "dark" : "light"}
            onToggleTheme={toggleTheme}
            network={network}
            onNetworkChange={setNetwork}
            language={language}
            onLanguageChange={handleLanguageSwitch}
            wallet={walletAddress}
            balance={balance.formatted}
            wrongNetwork={balance.wrongNetwork}
            onConnectWallet={connectWallet}
            onDisconnectWallet={() => {
              disconnect();
              addConsoleOutput("Wallet disconnected");
            }}
          />
        }
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden min-w-0">
        {/*
          Tools get their own lane rather than competing in the top bar. This is
          the part the first cut got wrong: the fix for nine identical icons in
          a row was never to delete them, it was to give each one a distinct
          shape and a predictable home.
        */}
        {!showStart && (
          <ActivityBar
            items={activityItems}
            active={activeView ?? sideBarView}
            onSelect={selectView}
            footer={
              <button
                onClick={toggleTerminal}
                aria-label="Toggle the console"
                className={`grid h-10 w-10 place-items-center rounded-lg outline-none ring-accent-line transition-colors focus-visible:ring-2 ${
                  terminalOpen ? "text-text-primary" : "text-text-muted hover:text-text-secondary"
                }`}
              >
                <Terminal size={18} />
              </button>
            }
          />
        )}
        {/* Sidebar */}
        <AnimatePresence>
          {sideBarView === "explorer" && !showStart && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: sidebarResize.size, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              style={{ width: sidebarResize.size }}
              className={`border-r flex flex-col min-w-0 flex-shrink-0 overflow-hidden ${"panel-surface border"}`}
            >
              <FileExplorer
                expanded={filesOpen}
                onToggle={toggleFiles}
                onOpen={(path) => {
                  // Opening a file is a decision to start work, so the start
                  // cards get out of the way. Leaving them over the editor made
                  // the tree look broken: you click a file and nothing appears.
                  setShowStart(false);
                  addConsoleOutput(`Opened ${path}`);
                }}
                onNotify={addConsoleOutput}
              />

              <SidePanelSection
                open={reportsOpen}
                onToggle={toggleReports}
                title="Past reports"
                count={reportCount}
              >
                <ReportHistory
                  onOpen={(reportId) => window.open(`/report/${reportId}`, "_blank", "noopener")}
                  onCount={setReportCount}
                  refreshKey={
                    report.state.status === "ready" ? report.state.report.reportId : "none"
                  }
                  {...(report.state.status === "ready"
                    ? { activeReportId: report.state.report.reportId }
                    : {})}
                />
              </SidePanelSection>

              {/*
                Artifacts appear when a compile produces them, which is the
                honest answer to where an ABI comes from: the compiler writes
                it, and deploying only adds an address. A section that showed up
                after a deploy would be teaching the wrong thing.
              */}
              {compileResult?.success === true && (
                <SidePanelSection
                  open={artifactsOpen}
                  onToggle={toggleArtifacts}
                  title="Compiled artifacts"
                >
                  <CompileArtifacts
                    contractName={currentFileName.replace(/\.sol$/i, "") || "Contract"}
                    abi={(compileResult?.abi as unknown[] | undefined) ?? null}
                    bytecode={compileResult?.bytecode ?? null}
                    onNotify={addConsoleOutput}
                  />
                </SidePanelSection>
              )}

              {/*
                The two template lists that used to hang under the file tree are
                gone. Ten permanent buttons for something a person does once, at
                the very start, is the same mistake the toolbar was making. They
                are on the start cards, where a new file is actually chosen, and
                in the palette under "Start from a template".
              */}
            </motion.div>
          )}
        </AnimatePresence>

        {sidebarOpen && !showStart && (
          <ResizeHandle
            edge="right"
            label="Resize explorer"
            isDragging={sidebarResize.isDragging}
            onPointerDown={sidebarResize.onPointerDown}
            onReset={sidebarResize.reset}
          />
        )}

        {/* Editor Area - min-width keeps the code readable when a side panel opens */}
        <div className="flex-1 flex flex-col min-w-[320px] overflow-hidden">
          {/*
            The start cards, which are the studio's empty state rather than a
            modal. A tour someone dismisses teaches nothing; a launcher that is
            still there next week is the thing they come back to. Each card does
            the work rather than describing it.
          */}
          {showStart && (
            <StartScreen
              onRunSample={runSample}
              sampleBusy={report.state.status === "running"}
              onSubmit={handleOmnibox}
              importing={github.importing}
              onPickRepo={openRepoPicker}
              onPickAddress={() => {
                setShowStart(false);
                openSidePanel("migration");
              }}
              onPickTemplate={() => setPaletteOpen(true)}
              onShowTour={() => setTourOpen(true)}
              githubConnected={github.status?.connected === true}
              {...(github.status?.installUrl != null
                ? { connectUrl: github.status.installUrl }
                : {})}
              plan={plan}
            />
          )}

          {!showStart && (
            <EditorTabs
              tabs={openTabs.map((path) => ({ path, name: basenameOf(path) }))}
              activePath={activePath}
              onSelect={(path) => setActive(path)}
              onClose={closeTab}
            />
          )}

          {/* Monaco Editor */}
          <div className={`${showStart ? "hidden" : terminalOpen ? "flex-1" : "h-full"} min-h-0`}>
            <MonacoEditor
              height="100%"
              language={language === "python" ? "python" : "sol"}
              theme={isDark ? "vs-dark" : "light"}
              value={code}
              onChange={(value) => setCode(value || "")}
              onMount={releaseAmdLoader}
              options={{
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                lineNumbers: "on",
                automaticLayout: true,
                tabSize: 4,
                wordWrap: "on",
                formatOnPaste: true,
                formatOnType: true,
              }}
            />
          </div>

          {/* Terminal */}
          {terminalOpen && !showStart && (
            <div
              style={{ height: terminalResize.size }}
              className="flex-shrink-0 border-t border-border-subtle terminal-surface relative"
            >
              <div className="absolute -top-[3px] inset-x-0">
                <ResizeHandle
                  edge="top"
                  label="Resize terminal"
                  isDragging={terminalResize.isDragging}
                  onPointerDown={terminalResize.onPointerDown}
                  onReset={terminalResize.reset}
                />
              </div>
              <div className="h-8 px-4 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Terminal size={14} className="text-green-500" />
                  <span className="font-mono text-xs text-text-muted">Terminal</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={clearConsole}
                    aria-label="Clear the console"
                    title="Clear the console"
                    className="rounded p-0.5 text-text-muted outline-none ring-accent-line transition-colors hover:text-text-primary focus-visible:ring-2"
                  >
                    <RefreshCw size={12} />
                  </button>
                  <button
                    onClick={toggleTerminal}
                    aria-label="Close the console"
                    title="Close the console"
                    className="rounded p-0.5 text-text-muted outline-none ring-accent-line transition-colors hover:text-text-primary focus-visible:ring-2"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
              <div className="p-4 h-[calc(100%-32px)] overflow-y-auto font-mono text-xs space-y-1">
                {consoleOutput.map((line: string, i: number) => (
                  <div key={i} className={consoleLineClass(line)}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* AI Panel - Dual Mode */}
        {/*
          The AI panel, which used to be five hundred lines of JSX right here.

          It reads its own feature's state and calls its own feature's
          handlers, so nothing about it needed to live in this component. The
          state stays here because both tabs write into the editor and the
          console, and the page owns those.
        */}
        {aiPanelOpen && (
          <ResizeHandle
            edge="left"
            label="Resize AI panel"
            isDragging={aiResize.isDragging}
            onPointerDown={aiResize.onPointerDown}
            onReset={aiResize.reset}
          />
        )}
        <AIPanel
          aiPanelOpen={aiPanelOpen}
          toggleAIPanel={toggleAIPanel}
          aiMode={aiMode}
          setAIMode={setAIMode}
          aiResize={aiResize}
          aiResponse={aiResponse}
          setAIResponse={setAIResponse}
          aiLoading={aiLoading}
          teachModeContent={teachModeContent}
          setTeachModeContent={setTeachModeContent}
          handleQuickAction={handleQuickAction}
          isDark={isDark}
          architect={{
            selectedContractType,
            setSelectedContractType,
            architectParams,
            setArchitectParams,
            architectGenerating,
            handleArchitectGenerate,
            architectChatInput,
            setArchitectChatInput,
            architectChatHistory,
            setArchitectChatHistory,
            handleArchitectChat,
          }}
          researcher={{
            researchQuery,
            setResearchQuery,
            researchHistory,
            setResearchHistory,
            researchLoading,
            handleResearchQuery,
            handleQuickTopic,
          }}
        />

        {/* Constructor arguments. Shown only when the ABI says the contract needs them. */}
        <AnimatePresence>
          {ctorOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
              onClick={closeCtorDialog}
            >
              <motion.div
                initial={{ scale: 0.96, y: 8 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.96, y: 8 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md rounded-2xl panel-surface border border-border-subtle p-5 shadow-[var(--shadow-panel)]"
              >
                <h3 className="text-base font-bold text-text-primary mb-1">
                  {ctorInputs.length > 0 ? "Constructor arguments" : "Deployment value"}
                </h3>
                <p className="text-xs text-text-secondary mb-4">
                  {ctorInputs.length > 0
                    ? `This contract's constructor takes ${ctorInputs.length} argument${ctorInputs.length === 1 ? "" : "s"}. Deploying without them reverts on chain.`
                    : "This constructor is payable, so it can receive MON on deployment."}
                </p>

                <div className="space-y-3">
                  {ctorInputs.map((input, i) => (
                    <div key={input.name}>
                      <label className="text-[10px] font-mono text-text-muted">
                        {input.name}: {describeType(input.type, input.components)}
                      </label>
                      <input
                        autoFocus={i === 0}
                        value={ctorArgs[i] ?? ""}
                        onChange={(e) =>
                          setCtorArgs((prev) => {
                            const next = [...prev];
                            next[i] = e.target.value;
                            return next;
                          })
                        }
                        placeholder={placeholderFor(input.type, input.components)}
                        spellCheck={false}
                        className="w-full mt-1 px-3 py-2 rounded-lg text-xs font-mono panel-sunken border border-border-subtle outline-none focus:border-purple-500"
                      />
                    </div>
                  ))}
                </div>

                {ctorPayable && (
                  <div className={ctorInputs.length > 0 ? "mt-3 pt-3 border-t border-border-subtle" : ""}>
                    <label className="text-[10px] font-mono text-text-muted">
                      msg.value: MON
                    </label>
                    <input
                      autoFocus={ctorInputs.length === 0}
                      value={ctorValue}
                      onChange={(e) => setCtorValue(e.target.value)}
                      placeholder="0.0"
                      spellCheck={false}
                      inputMode="decimal"
                      className="w-full mt-1 px-3 py-2 rounded-lg text-xs font-mono panel-sunken border border-border-subtle outline-none focus:border-purple-500"
                    />
                    <p className="mt-1 text-[10px] text-text-muted">
                      Sent with the deployment. In MON, not wei, so 0.3 means 0.3 MON.
                    </p>
                  </div>
                )}

                {ctorError && (
                  <p className="mt-3 text-[11px] text-red-600 dark:text-red-400">{ctorError}</p>
                )}

                <div className="flex gap-2 mt-5">
                  <button
                    onClick={closeCtorDialog}
                    className="flex-1 py-2 rounded-lg text-xs font-semibold border border-border-subtle text-text-secondary hover:text-text-primary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => performDeploy(ctorInputs, ctorArgs)}
                    className="flex-1 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-purple-600 to-pink-600 text-white"
                  >
                    Deploy
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/*
          The report rail.

          This replaced the parallel, gas and chain fit panels, each of which
          used to be reached by its own unlabelled icon in the toolbar, two of
          them sharing an icon and so indistinguishable. They were never three
          tools. They were three views of one question, and asking someone to
          assemble that question out of three toggles is why the product looked
          like it did too much. Here it is one scrolling document that fills
          itself in as the measurements land.
        */}
        {/*
          The rail and the tool panel share the right dock, one at a time.

          Open together they left the editor a few hundred pixels wide, which is
          how a layout ends up with four columns and no room to read code. VS
          Code's secondary side bar shows one view at a time for the same
          reason, and a tool that measures the open file is not useful beside a
          summary of the same measurement anyway.
        */}
        {railOpen && !showStart && !dockTaken && (!narrow || railForced) && (
          <>
        <ResizeHandle
          edge="left"
          label="Resize the report"
          isDragging={railResize.isDragging}
          onPointerDown={railResize.onPointerDown}
          onReset={railResize.reset}
        />
        <div
          style={{ width: railResize.size }}
          className="flex min-w-0 shrink-0 flex-col overflow-hidden border-l border-border-subtle panel-surface"
        >
          <ReportRail
            state={railState}
            // A report the server did not redact needs no unlock panel, which
            // is also what makes the dormant paywall invisible here.
            entitled={railState.status !== "ready" || !railState.report.redacted}
            onUnlock={reportUnlock.unlock}
            offer={reportUnlock.offer}
            onPayMon={() => void unlockReport()}
            unlocking={unlocking || reportUnlock.busy}
            unlockError={unlockError ?? reportUnlock.error}
            onRerun={() => runReport()}
            onClose={() => {
              setRailOpen(false);
              setRailForced(false);
            }}
            onShare={() => {
              if (report.state.status !== "ready") return;
              void navigator.clipboard.writeText(
                `${window.location.origin}/report/${report.state.report.reportId}`,
              );
              addConsoleOutput("Report link copied.");
            }}
            onApplyPatch={(finding) => {
              if (finding.patch === undefined) return;
              applyOptimizedContract(finding.patch);
            }}
          />
        </div>
          </>
        )}

        {/*
          The measurement tools, each in its own dock.

          These are the full instruments, not the rail's summary of them: the
          profiler carries the execution graph and the optimisation panel, and
          the gas and chain fit views show every function rather than a headline
          number. The rail answers "is this good"; these answer "why".
        */}
        {toolPanel !== null && (
          <>
            <ResizeHandle
              edge="left"
              label="Resize the tool panel"
              isDragging={toolResize.isDragging}
              onPointerDown={toolResize.onPointerDown}
              onReset={toolResize.reset}
            />
            <div
              style={{ width: toolResize.size }}
              className="flex min-w-0 shrink-0 flex-col overflow-hidden border-l border-border-subtle panel-surface"
            >
              {toolPanel === "parallel" && (
                <ParallelProfiler code={code} onClose={() => setActiveView(null)} />
              )}
              {toolPanel === "gas" && (
                <GasProfiler code={code} onClose={() => setActiveView(null)} />
              )}
              {toolPanel === "chainfit" && (
                <ChainFitReport code={code} onClose={() => setActiveView(null)} />
              )}
            </div>
          </>
        )}

        {interactOpen && (
          <ResizeHandle
            edge="left"
            label="Resize interaction panel"
            isDragging={interactResize.isDragging}
            onPointerDown={interactResize.onPointerDown}
            onReset={interactResize.reset}
          />
        )}
        <AnimatePresence>
          {interactOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: interactResize.size, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              style={{ width: interactResize.size }}
              className="border-l border-border-subtle flex flex-col min-w-0 flex-shrink-0 overflow-hidden panel-surface"
            >
              <ContractInteraction
                abi={(compileResult?.abi as Abi | undefined) ?? null}
                deployedAddress={deployedAddress}
                walletAddress={walletAddress}
                onClose={() => setInteractOpen(false)}
                onLog={addConsoleOutput}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Migration Tool Panel */}
        {migrationOpen && (
          <ResizeHandle
              edge="left"
              label="Resize migration panel"
              isDragging={migrationResize.isDragging}
              onPointerDown={migrationResize.onPointerDown}
              onReset={migrationResize.reset}
            />
        )}
        <AnimatePresence>
          {migrationOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: migrationResize.size, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              style={{ width: migrationResize.size }}
              className={`border-l flex flex-col min-w-0 flex-shrink-0 overflow-hidden ${"panel-surface border"}`}
            >
              <MigrationWizard
                onImportCode={(importedCode, fileName) => {
                  openWith(`contracts/${fileName}`, importedCode);
                  // Auto-switch to Solidity mode
                  if (language !== "solidity") {
                    setLanguage("solidity");
                  }
                  setMigrationOpen(false);
                  addConsoleOutput(`Imported: ${fileName}`);
                }}
                onClose={() => setMigrationOpen(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Deploy Success Modal */}
      <AnimatePresence>
        {showDeployModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={() => setShowDeployModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className={`w-[480px] rounded-3xl p-8 ${"panel-surface"}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 size={32} className="text-white" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Contract Deployed! </h2>
                <p className={`text-sm mb-6 ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                  Your contract is now live on Monad {network}
                </p>
                
                <div className={`p-4 rounded-xl font-mono text-sm mb-6 ${isDark ? "bg-white/5" : "bg-gray-100"}`}>
                  {deployedAddress}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => navigator.clipboard.writeText(deployedAddress || "")}
                    className={`flex-1 py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 ${
                      isDark ? "bg-white/5 hover:bg-white/10" : "bg-gray-100 hover:bg-gray-200"
                    }`}
                  >
                    <Copy size={16} />
                    Copy Address
                  </button>
                  <a
                    href={`https://${network === "mainnet" ? "monadexplorer.com" : "testnet.monadexplorer.com"}/address/${deployedAddress}`}
                    target="_blank"
                    className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2"
                  >
                    <ExternalLink size={16} />
                    View on Explorer
                  </a>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/*
        Ambient state, along the bottom.

        Network and wallet were in a dropdown, which is the wrong home for a
        fact you need to be sure of before every deploy. State you have to open
        a menu to read is state you will eventually get wrong, and the version
        of that mistake here sends a contract to mainnet.
      */}
      <StatusBar
        network={network}
        onNetworkClick={() => setNetwork(network === "testnet" ? "mainnet" : "testnet")}
        wallet={walletAddress}
        onWalletClick={() => (isConnected ? disconnect() : void connectWallet())}
        balance={balance.formatted}
        wrongNetwork={balance.wrongNetwork}
        problems={problemCounts}
        onProblemsClick={() => setActiveView("report")}
        compileState={compileState}
        language={language}
      />

      {/*
        Everything the toolbar used to carry, in the two places that scale.

        The palette holds the long tail, searchable by name rather than guessed
        from a 32px icon. The picker is the one extra question GitHub forces,
        asked at the moment it becomes relevant instead of as a gate.
      */}
      {/*
        The assistant floats rather than docking, because asking a question is
        not a mode: you reach for it mid-read, get an answer, and carry on. It
        is handed the open file and the findings so it argues from the same
        facts the report does rather than offering a second opinion.
      */}
      <Assistant
        code={code}
        fileName={currentFileName === "" ? "your contract" : currentFileName}
        isDark={isDark}
        findings={
          report.state.status === "ready"
            ? report.state.report.contracts.flatMap((contract) => contract.findings)
            : []
        }
      />

      <CommandPalette commands={commands} open={paletteOpen} onOpenChange={setPaletteOpen} />

      <WelcomeTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        onFinish={() => setShowStart(true)}
      />

      <RepoPicker
        open={repoPickerOpen}
        onClose={() => setRepoPickerOpen(false)}
        connected={github.status === null ? null : github.status.connected}
        installUrl={github.status?.installUrl ?? null}
        signedIn={github.status?.signedIn === true}
        appAvailable={github.status?.appAvailable === true}
        repos={github.repos}
        loading={github.reposLoading}
        error={github.reposError}
        onPick={handleRepoPick}
        onPasteInstead={() => {
          setRepoPickerOpen(false);
          setShowStart(true);
        }}
      />
    </div>
  );
}
