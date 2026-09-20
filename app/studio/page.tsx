"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Brain,
  Terminal,
  ChevronRight,
  X,
  CheckCircle2,
  Loader2,
  Sparkles,
  Lightbulb,
  Zap,
  Bug,
  Code2,
  RefreshCw,
  Copy,
  ExternalLink,
  ArrowLeft,
  Hammer,
  Search,
  Globe,
  Send,
} from "lucide-react";
import { useThemeStore, useUserStore, useIDEStore } from "@/lib/store";
import { basenameOf, seedWorkspace, solidityFiles, useWorkspace } from "@/lib/workspace";
import { FileExplorer } from "./components/FileExplorer";
import { useHydrated } from "@/lib/useHydrated";
import { useResizable } from "@/lib/useResizable";
import { ResizeHandle } from "./components/ResizeHandle";
import type { QuickActionType } from "@/lib/supabase";
import { MigrationWizard } from "./components/MigrationWizard";
import { Markdown } from "./components/Markdown";
import { ContractInteraction } from "./components/ContractInteraction";
import { SAMPLE_CONTRACTS } from "../compare/samples";
import { generateFromTemplate, ARCHITECT_TO_TEMPLATE, CONTRACT_TEMPLATES } from "@/lib/contractTemplates";
import { track } from "@/lib/track";
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
import { Omnibox, type OmniboxIntent } from "./components/Omnibox";
import { StartCards } from "./components/StartCards";
import { RepoPicker } from "./components/RepoPicker";
import { ReportRail, type RailState } from "./components/report/ReportRail";
import { buildCommands } from "./commands";
import { useReportStream } from "@/lib/report/useReportStream";
import { useGitHub, importFailed } from "@/lib/github/useGitHub";
import type { ReportOrigin } from "@/lib/report/types";
import type { RepoSummary } from "@/lib/github/source";
import {
    ARCHITECT_CONTRACT_TYPES,
    DEFAULT_CONTRACT,
    DEFAULT_PYTHON_CONTRACT,
    MONAD_KNOWLEDGE,
    PYTHON_TEMPLATES,
    TEMPLATES,
} from "./templates";

export default function StudioPage() {
  const { theme, toggleTheme } = useThemeStore();
  const { walletAddress, isConnected, network, setUser, disconnect, setNetwork } = useUserStore();
  const { 
    isDeploying, 
    compileResult, 
    consoleOutput,
    terminalOpen,
    sidebarOpen,
    aiPanelOpen,
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
  // Parallel Profiler State
  const [parallelProfilerOpen, setParallelProfilerOpen] = useState(false);
  // Migration Tool State
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [interactOpen, setInteractOpen] = useState(false);
  const [gasOpen, setGasOpen] = useState(false);
  const [chainFitOpen, setChainFitOpen] = useState(false);
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
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [repoOrigin, setRepoOrigin] = useState<ReportOrigin>({ kind: "workspace" });
  const [repoLabel, setRepoLabel] = useState<string | null>(null);

  const report = useReportStream();
  const github = useGitHub();

  const isDark = theme === "dark";

  // Docked panels are drag-resizable; sizes persist per panel.
  const sidebarResize = useResizable({ initial: 200, min: 160, max: 420, edge: "right", storageKey: "ms.w.sidebar" });
  const aiResize = useResizable({ initial: 380, min: 300, max: 720, edge: "left", storageKey: "ms.w.ai" });
  const railResize = useResizable({ initial: 460, min: 360, max: 900, edge: "left", storageKey: "ms.w.rail" });
  const migrationResize = useResizable({ initial: 450, min: 360, max: 860, edge: "left", storageKey: "ms.w.migration" });
  const interactResize = useResizable({ initial: 420, min: 340, max: 820, edge: "left", storageKey: "ms.w.interact" });
  const terminalResize = useResizable({ initial: 180, min: 90, max: 520, edge: "top", storageKey: "ms.h.terminal" });

  /**
   * The AI assistant, profiler and migration wizard all dock to the right of the
   * editor. Showing two at once leaves no room for the code, so opening one
   * closes the others; clicking the active one closes it.
   */
  const showAIPanel = () => {
    if (!aiPanelOpen) toggleAIPanel();
    setParallelProfilerOpen(false);
    setMigrationOpen(false);
    setInteractOpen(false);
    setGasOpen(false);
    setChainFitOpen(false);
  };

  const openSidePanel = (panel: "ai" | "profiler" | "migration" | "interact" | "gas" | "chainfit") => {
    const aiNext = panel === "ai" ? !aiPanelOpen : false;

    if (aiNext !== aiPanelOpen) toggleAIPanel();
    setParallelProfilerOpen(panel === "profiler" ? !parallelProfilerOpen : false);
    setMigrationOpen(panel === "migration" ? !migrationOpen : false);
    setInteractOpen(panel === "interact" ? !interactOpen : false);
    setGasOpen(panel === "gas" ? !gasOpen : false);
    setChainFitOpen(panel === "chainfit" ? !chainFitOpen : false);

    // Opening a tool is the clearest signal of what people came for.
    const opening =
      (panel === "profiler" && !parallelProfilerOpen) ||
      (panel === "migration" && !migrationOpen) ||
      (panel === "gas" && !gasOpen) ||
      (panel === "chainfit" && !chainFitOpen) ||
      (panel === "interact" && !interactOpen);
    if (opening) {
      const eventFor = {
        profiler: "parallel_analysis",
        migration: "migration",
        gas: "gas_profile",
        chainfit: "chain_fit",
        interact: "interact_read",
        ai: "ai_generate",
      } as const;
      track(eventFor[panel], { walletAddress, detail: { opened: true } });
    }
  };

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

    if (returnedFrom !== null || repo !== null) {
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

    if (params.get("sample") !== null) return;
    // `seedWorkspace` has already run, so a genuinely new visitor has exactly
    // the one starter file and nothing they have chosen.
    const existing = Object.keys(useWorkspace.getState().files);
    setShowStart(existing.length <= 1);
    // The picker needs this the moment a card is clicked, and it is one cheap
    // request rather than a wait at the point of intent.
    void github.prepare();
    // Reading the workspace once on mount is the point; re-running when it
    // changes would reopen the cards over work in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Connect wallet
  const connectWallet = async () => {
    const ethereum = getEthereumProvider();
    if (ethereum) {
      try {
        const accounts = await ethereum.request<string[]>({
          method: "eth_requestAccounts",
        });
        const address = accounts?.[0];
        if (!address) {
          addConsoleOutput("❌ No account returned by the wallet");
          return;
        }
        setUser({ walletAddress: address });
        addConsoleOutput(`✅ Wallet connected: ${address.slice(0, 6)}...${address.slice(-4)}`);
        
        // Track in Supabase - get or create user and store UUID
        track("wallet_connect", { walletAddress: address });
            } catch (err) {
        addConsoleOutput(`❌ Wallet connection failed: ${errorMessage(err)}`);
      }
    } else {
      addConsoleOutput("❌ Please install MetaMask");
    }
  };

  // Compile contract.
  // `sourceOverride` lets the architect compile code it just generated: reading
  // `code` here would return the pre-update value until React re-renders.
  const handleCompile = async (sourceOverride?: string) => {
    if (!isConnected) {
      addConsoleOutput("⚠️ Please connect wallet first");
      return;
    }

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
      addConsoleOutput("🐍 Transpiling Python contract...");

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
          addConsoleOutput(`❌ Transpilation failed: ${transpileResult.error}`);
          setCompileResult({
            success: false,
            errors: [{ message: transpileResult.error ?? "Transpilation failed" }],
          });
          setCompiling(false);
          return;
        }

        if (!transpileResult.solidityCode) {
          addConsoleOutput("❌ Transpiler returned no Solidity output");
          setCompileResult({ success: false, errors: [{ message: "Transpiler returned no Solidity output" }] });
          setCompiling(false);
          return;
        }

        addConsoleOutput(`✅ Transpiled to Solidity: ${transpileResult.contractName ?? "contract"}`);
        setTranspiledSolidity(transpileResult.solidityCode);

        // Now compile the Solidity code
        addConsoleOutput("🔨 Compiling generated Solidity...");

        let res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "compile",
            userAddress: walletAddress,
            code: transpileResult.solidityCode,
          }),
        });

        // Handle payment if required
        if (res.status === 402) {
          const data = await readJson<PaymentChallenge>(res);
          addConsoleOutput("💳 Signature required for compilation...");
          const xPaymentHeader = await createPaymentHeader(walletAddress!, data.paymentDetails);

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
          addConsoleOutput(`✅ Python contract compiled in ${compileTime}ms`);
          addConsoleOutput(`📦 Bytecode size: ${(result.bytecode?.length || 0) / 2} bytes`);
          setCompileResult({
            success: true,
            bytecode: result.bytecode,
            abi: result.abi || transpileResult.abi,
          });
        } else {
          addConsoleOutput(`❌ Compilation failed`);
          setCompileResult({ success: false, errors: result.errors });
        }
      } catch (err) {
        addConsoleOutput(`❌ Error: ${errorMessage(err)}`);
        setCompileResult({ success: false, errors: [{ message: errorMessage(err) }] });
      }

      setCompiling(false);
      return;
    }

    // Standard Solidity compilation
    addConsoleOutput("🔨 Compiling contract...");

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

      // Handle payment if required
      if (res.status === 402) {
        const data = await readJson<PaymentChallenge>(res);
        addConsoleOutput("💳 Signature required for compilation...");
        const xPaymentHeader = await createPaymentHeader(walletAddress!, data.paymentDetails);
        
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
        addConsoleOutput(`✅ Compiled${built} in ${compileTime}ms`);
        addConsoleOutput(`📦 Bytecode size: ${(result.bytecode?.length || 0) / 2} bytes`);
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
            `🔗 Links against ${result.libraries.length} librar${result.libraries.length === 1 ? "y" : "ies"}: ${names}. ` +
            `Deploying will put ${result.libraries.length === 1 ? "it" : "them"} on chain first.`
          );
        }
        
        track("compile", {
          durationMs: compileTime,
          walletAddress,
          detail: { bytes: result.contractSize, language },
        });
      } else {
        addConsoleOutput(`❌ Compilation failed`);
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
      addConsoleOutput(`❌ Error: ${errorMessage(err)}`);
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
      addConsoleOutput("⚠️ Please compile successfully first");
      return;
    }
    if (!walletAddress) {
      addConsoleOutput("⚠️ Connect a wallet to deploy");
      return;
    }
    if (!compileResult.abi || !compileResult.bytecode) {
      addConsoleOutput("⚠️ Compile output is missing the ABI or bytecode. Compile again.");
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
    addConsoleOutput(`🚀 Deploying ${language === "python" ? "Python" : "Solidity"} contract to Monad testnet...`);
    addConsoleOutput("🔑 Confirm the transaction in your wallet...");

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
          onStep: addConsoleOutput,
        }
      );

      addConsoleOutput(`✅ Contract deployed!`);
      addConsoleOutput(`📍 Address: ${result.address}`);
      addConsoleOutput(`🔗 TX: ${result.txHash}`);
      addConsoleOutput(`🔎 ${result.explorerUrl}`);
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
      addConsoleOutput(`❌ Deployment failed: ${errorMessage(err)}`);
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
      addConsoleOutput("🐍 Switched to Python mode (PyMon)");
    } else {
      openWith("contracts/MyToken.sol", DEFAULT_CONTRACT);
      addConsoleOutput("📜 Switched to Solidity mode");
    }
  };

  // Python Security Audit
  const handlePythonAudit = async () => {
    if (language !== "python") {
      addConsoleOutput("⚠️ Audit only available for Python contracts");
      return;
    }

    addConsoleOutput("🔍 Running security audit...");

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
        addConsoleOutput(`📊 Security Score: ${result.score}/100 (${result.riskLevel})`);
        addConsoleOutput(`📋 Found ${result.findings?.length || 0} issues`);

        if (result.findings && result.findings.length > 0) {
          result.findings.forEach((f) => {
            const icon = f.severity === 'critical' ? '🔴' :
              f.severity === 'high' ? '🟠' :
                f.severity === 'medium' ? '🟡' : '🟢';
            addConsoleOutput(`   ${icon} [${f.severity.toUpperCase()}] ${f.title}`);
          });
        }

        if (result.bestPractices && result.bestPractices.length > 0) {
          addConsoleOutput("💡 Recommendations:");
          result.bestPractices.forEach((tip: string) => {
            addConsoleOutput(`   • ${tip}`);
          });
        }
      } else {
        addConsoleOutput(`❌ Audit failed: ${result.error}`);
      }
    } catch (err) {
      addConsoleOutput(`❌ Error: ${errorMessage(err)}`);
    }
  };

  // Security Audit
  const handleAudit = async () => {
    setAILoading(true);
    addConsoleOutput("🔒 Running security audit...");

    try {
      const res = await fetch("/api/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      const result = await readJson<SecurityAuditResponse>(res);

      if (!result.success || !result.analysis) {
        addConsoleOutput(`❌ Audit failed: ${result.error ?? "Unknown error"}`);
        return;
      }

      const { riskLevel, issues, securityScore, deploymentRecommendation } = result.analysis;
      addConsoleOutput(`🛡️ Security Score: ${securityScore}/100`);
      addConsoleOutput(`⚠️ Risk Level: ${riskLevel.toUpperCase()}`);
      addConsoleOutput(`📋 Issues found: ${issues.length}`);

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
      addConsoleOutput(`❌ Audit failed: ${errorMessage(err)}`);
    } finally {
      setAILoading(false);
    }
  };

  // ============= TEMPLATE LOADING =============
  const loadTemplate = (templateKey: keyof typeof TEMPLATES) => {
    const template = TEMPLATES[templateKey];
    setLanguage("solidity");
    openWith(`contracts/${template.name.replace(/\s+/g, '')}.sol`, template.code);
    addConsoleOutput(`📄 Loaded template: ${template.name}`);
  };

  const loadPythonTemplate = (templateKey: keyof typeof PYTHON_TEMPLATES) => {
    const template = PYTHON_TEMPLATES[templateKey];
    setLanguage("python");
    openWith(`contracts/${template.name.replace(/\s+/g, '')}.py`, template.code);
    addConsoleOutput(`🐍 Loaded Python template: ${template.name}`);
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
      addConsoleOutput("⚠️ No code to analyze");
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
      addConsoleOutput(`🤖 Running ${action} analysis...`);

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
        addConsoleOutput(`✅ ${action.charAt(0).toUpperCase() + action.slice(1)} analysis complete`);
        
        // Ensure AI panel is visible
        showAIPanel();
        
        track("ai_generate", { walletAddress, detail: { mode: action } });
      } else {
        const errorMsg = result.error || "Unknown error";
        setAIResponse(`❌ Analysis failed: ${errorMsg}`);
        addConsoleOutput(`❌ Analysis failed: ${errorMsg}`);
        showAIPanel();
      }
    } catch (err) {
      const errorMsg = errorMessage(err) || "Request failed";
      setAIResponse(`❌ Error: ${errorMsg}`);
      addConsoleOutput(`❌ Error: ${errorMsg}`);
      showAIPanel();
    } finally {
      setAILoading(false);
    }
  };

  // ============= ARCHITECT MODE HANDLER =============
  const handleArchitectGenerate = async () => {
    if (!selectedContractType) {
      addConsoleOutput("⚠️ Please select a contract type");
      return;
    }

    const contractType = ARCHITECT_CONTRACT_TYPES.find(t => t.id === selectedContractType);
    if (!contractType) return;

    setArchitectGenerating(true);
    addConsoleOutput(`🏗️ Architect generating ${contractType.name}...`);

    // ALWAYS switch to Solidity mode when generating contracts
    if (language !== "solidity") {
      setLanguage("solidity");
      addConsoleOutput(`📝 Switched to Solidity mode for contract generation`);
    }

    try {
      let generatedCode: string;
      const templateId = ARCHITECT_TO_TEMPLATE[selectedContractType];

      // Check if we have a pre-built template for this contract type
      if (templateId && CONTRACT_TEMPLATES[templateId]) {
        addConsoleOutput(`📦 Using pre-built template for guaranteed compilation...`);

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
        addConsoleOutput(`✅ Template applied successfully!`);

      } else {
        // Fallback to AI generation for types without templates
        addConsoleOutput(`🤖 Using AI generation...`);

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

OUTPUT: ONLY valid Solidity code starting with "// SPDX-License-Identifier: MIT"
NO markdown, NO explanations, NO code blocks.`;

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

      addConsoleOutput(`✅ ${contractType.name} contract generated successfully!`);
      addConsoleOutput(`📄 File: ${fileName}`);

      // Auto-compile the code we just produced. Passing it explicitly avoids
      // compiling the previous contract from a stale closure.
      if (isConnected) {
        addConsoleOutput(`🔄 Auto-compiling to verify...`);
        await handleCompile(generatedCode);
      } else {
        addConsoleOutput(`💡 Connect a wallet to compile and deploy this contract.`);
      }

      track("ai_generate", { walletAddress, detail: { mode: "architect", type: contractType.name } });

    } catch (err) {
      addConsoleOutput(`❌ Error: ${errorMessage(err)}`);
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
    addConsoleOutput(`🏗️ Architect generating contract from request...`);

    // Switch to Solidity mode
    if (language !== "solidity") {
      setLanguage("solidity");
      addConsoleOutput(`📝 Switched to Solidity mode`);
    }

    try {
      const architectPrompt = `You are a senior Solidity architect. Generate a production-ready, secure, and gas-optimized smart contract for Monad Network.

USER REQUEST: "${message}"

CRITICAL REQUIREMENTS - YOUR CODE MUST COMPILE:
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

OUTPUT: ONLY valid Solidity code starting with "// SPDX-License-Identifier: MIT"
NO markdown, NO explanations, NO code blocks, JUST THE CODE.`;

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
        content: `✅ Generated **${contractName}** contract!\n\n📄 File: ${fileName}${isConnected ? "\n🔄 Auto-compiling to verify..." : "\n💡 Connect a wallet to compile it."}`
      }]);

      addConsoleOutput(`✅ ${contractName} contract generated!`);
      addConsoleOutput(`📄 File: ${fileName}`);

      // Auto-compile the code we just produced. Passing it explicitly avoids
      // compiling the previous contract from a stale closure.
      if (isConnected) {
        addConsoleOutput(`🔄 Auto-compiling to verify...`);
        await handleCompile(generatedCode);
      } else {
        addConsoleOutput(`💡 Connect a wallet to compile and deploy this contract.`);
      }

      // Track analytics
      track("ai_generate", { walletAddress, detail: { mode: "architect" } });

    } catch (err) {
      setArchitectChatHistory(prev => [...prev, {
        role: "assistant",
        content: `❌ Error: ${errorMessage(err)}\n\nPlease try again with more specific requirements.`
      }]);
      addConsoleOutput(`❌ Error: ${errorMessage(err)}`);
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
          content: `❌ Error: ${result.error || "Failed to get response"}`
        }]);
      }
    } catch (err) {
      setResearchHistory(prev => [...prev, {
        role: "assistant",
        content: `❌ Error: ${errorMessage(err)}`
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

  const runReport = useCallback(() => {
    const solidity = solidityFiles(files);
    if (Object.keys(solidity).length === 0) {
      addConsoleOutput("There is no Solidity in the workspace to measure.");
      return;
    }
    setShowStart(false);
    setUnlockError(null);
    void report.run({ files: solidity, origin: repoOrigin });
    track("audit", { walletAddress, detail: { surface: "report", origin: repoOrigin.kind } });
  }, [files, report, repoOrigin, walletAddress, addConsoleOutput]);

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
        if (result.installUrl !== undefined) setRepoPickerOpen(true);
        return;
      }

      addFiles(result.files);
      setRepoOrigin({
        kind: "github",
        owner: result.ref.owner,
        repo: result.ref.repo,
        ref: result.ref.ref,
        private: result.private,
      });
      setRepoLabel(`${result.ref.owner}/${result.ref.repo}`);
      setShowStart(false);

      const count = Object.keys(result.files).length;
      addConsoleOutput(
        `Imported ${count} Solidity file${count === 1 ? "" : "s"} from ${result.ref.owner}/${result.ref.repo}`,
      );
      if (result.truncated) {
        addConsoleOutput("GitHub truncated the file tree, so this import may be partial.");
      }
    },
    [github, addFiles, addConsoleOutput],
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
        setRepoOrigin({ kind: "address", address: intent.address, chainId: 1 });
        openSidePanel("migration");
        return;
      }
      const name = `contracts/Pasted${Date.now()}.sol`;
      addFiles({ [name]: intent.code });
      setShowStart(false);
      addConsoleOutput(`Added ${name}`);
    },
    [loadRepo, addFiles, addConsoleOutput],
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: address, network }),
      });
      const offer = await challenge.json();

      if (challenge.status === 402 && offer.paymentDetails !== undefined) {
        const header = await createPaymentHeader(address, offer.paymentDetails);
        const paid = await fetch(`/api/report/${id}/unlock`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Payment": header },
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

  const commands = buildCommands(
    {
      runReport,
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
        title={workspaceTitle}
        subtitle={workspaceSubtitle}
        primary={primaryAction}
        busy={primaryBusy}
        primaryBlockedReason={primaryBlockedReason}
        onPrimary={handlePrimary}
        onOpenPalette={() => setPaletteOpen(true)}
        account={
          <AccountMenu
            theme={isDark ? "dark" : "light"}
            onToggleTheme={toggleTheme}
            network={network}
            onNetworkChange={setNetwork}
            language={language}
            onLanguageChange={handleLanguageSwitch}
            wallet={walletAddress}
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
        {/* Sidebar */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: sidebarResize.size, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              style={{ width: sidebarResize.size }}
              className={`border-r flex flex-col min-w-0 flex-shrink-0 overflow-hidden ${"panel-surface border"}`}
            >
              <FileExplorer
                onOpen={(path) => addConsoleOutput(`📂 Opened: ${path}`)}
                onNotify={addConsoleOutput}
              />

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

        {sidebarOpen && (
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
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
              <div className="mx-auto max-w-2xl">
                <Omnibox onSubmit={handleOmnibox} busy={github.importing} autoFocus />
                <div className="mt-10">
                  <StartCards
                    onPickRepo={openRepoPicker}
                    onPickAddress={() => {
                      setShowStart(false);
                      openSidePanel("migration");
                    }}
                    onPickTemplate={() => setPaletteOpen(true)}
                    githubConnected={github.status?.connected === true}
                    {...(github.status?.installUrl != null
                      ? { connectUrl: github.status.installUrl }
                      : {})}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Monaco Editor */}
          <div className={`${showStart ? "hidden" : terminalOpen ? "flex-1" : "h-full"} min-h-0`}>
            <MonacoEditor
              height="100%"
              language={language === "python" ? "python" : "sol"}
              theme={isDark ? "vs-dark" : "light"}
              value={code}
              onChange={(value) => setCode(value || "")}
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
          {terminalOpen && (
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
                  <span className="text-xs font-mono text-gray-400">Terminal</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={clearConsole} className="text-gray-500 hover:text-white">
                    <RefreshCw size={12} />
                  </button>
                  <button onClick={toggleTerminal} className="text-gray-500 hover:text-white">
                    <X size={12} />
                  </button>
                </div>
              </div>
              <div className="p-4 h-[calc(100%-32px)] overflow-y-auto font-mono text-xs space-y-1">
                {consoleOutput.map((line: string, i: number) => (
                  <div key={i} className={
                    line.startsWith("✅") ? "text-green-400" :
                    line.startsWith("❌") ? "text-red-400" :
                    line.startsWith("⚠️") ? "text-yellow-400" :
                    line.startsWith("🔨") || line.startsWith("🚀") || line.startsWith("🤖") ? "text-purple-400" :
                    line.startsWith("💳") ? "text-cyan-400" :
                    "text-gray-400"
                  }>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* AI Panel - Dual Mode */}
        {aiPanelOpen && (
          <ResizeHandle
              edge="left"
              label="Resize AI panel"
              isDragging={aiResize.isDragging}
              onPointerDown={aiResize.onPointerDown}
              onReset={aiResize.reset}
            />
        )}
        <AnimatePresence>
          {aiPanelOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: aiResize.size, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              style={{ width: aiResize.size }}
              className={`border-l flex flex-col min-w-0 flex-shrink-0 overflow-hidden ${"panel-surface border"}`}
            >
              {/* Header with Mode Tabs */}
              <div className={`p-3 border-b ${isDark ? "border-white/5" : "border-gray-200"}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Brain className="text-purple-500" size={18} />
                    <span className="font-bold text-sm">AI Assistant</span>
                  </div>
                  <button onClick={toggleAIPanel} className="text-gray-500 hover:text-white p-1">
                    <X size={16} />
                  </button>
                </div>

                {/* Mode Tabs */}
                <div className={`flex rounded-xl p-1 ${isDark ? "bg-white/5" : "bg-gray-100"}`}>
                  <button
                    onClick={() => setAIMode("architect")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                      aiMode === "architect"
                        ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg"
                        : isDark ? "text-gray-400 hover:text-white" : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    <Hammer size={14} />
                    Architect
                  </button>
                  <button
                    onClick={() => setAIMode("researcher")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                      aiMode === "researcher"
                        ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg"
                        : isDark ? "text-gray-400 hover:text-white" : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    <Search size={14} />
                    Researcher
                  </button>
                </div>
              </div>

              {/* Mode Content */}
              <div className="flex-1 overflow-y-auto">
                {/* ========== ARCHITECT MODE ========== */}
                {aiMode === "architect" && (
                  <div className="flex flex-col h-full">
                    {/* Chat Section */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      {/* Header */}
                      <div className="text-center mb-2">
                        <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                          <Hammer size={24} className="text-white" />
                        </div>
                        <h3 className="font-bold text-sm">Smart Contract Architect</h3>
                        <p className={`text-xs mt-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                          Describe what you want or choose a template
                        </p>
                      </div>

                      {/* Chat History */}
                      {architectChatHistory.length > 0 && (
                        <div className="space-y-3 mb-4">
                          {architectChatHistory.map((msg, idx) => (
                            <div
                              key={idx}
                              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                            >
                              <div
                                className={`max-w-[85%] p-3 rounded-xl text-sm ${
                                  msg.role === "user"
                                    ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white"
                                    : isDark
                                      ? "bg-white/5 border border-white/10"
                                      : "bg-gray-50 border border-gray-200"
                                }`}
                              >
                                {msg.role === "assistant" ? (
                                  <Markdown content={msg.content} isDark={isDark} />
                                ) : (
                                  <div className="whitespace-pre-wrap text-xs">{msg.content}</div>
                                )}
                              </div>
                            </div>
                          ))}
                          {architectGenerating && (
                            <div className="flex items-center gap-2 text-purple-400">
                              <Loader2 size={14} className="animate-spin" />
                              <span className="text-xs">Generating contract...</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Analysis output - audits, explanations and quick actions land here */}
                      {(aiLoading || aiResponse || teachModeContent) && (
                        <div className="space-y-3 mb-4">
                          {aiLoading && !aiResponse && (
                            <div className="flex items-center gap-2 text-purple-400">
                              <Loader2 size={14} className="animate-spin" />
                              <span className="text-xs">Analyzing contract...</span>
                            </div>
                          )}

                          {aiResponse && (
                            <div
                              className={`p-3 rounded-xl border ${
                                isDark ? "bg-white/5 border-white/10" : "bg-gray-50 border-gray-200"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                                  Analysis
                                </span>
                                <button
                                  onClick={() => {
                                    setAIResponse(null);
                                    setTeachModeContent(null);
                                  }}
                                  aria-label="Dismiss analysis"
                                  className={isDark ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"}
                                >
                                  <X size={12} />
                                </button>
                              </div>
                              <Markdown content={aiResponse} isDark={isDark} />
                            </div>
                          )}

                          {teachModeContent && (
                            <div
                              className={`p-3 rounded-xl border ${
                                isDark ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50 border-amber-100"
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <Lightbulb size={14} className="text-amber-500" />
                                <span className="text-xs font-semibold">{teachModeContent.title}</span>
                              </div>
                              <ol className="list-decimal list-inside space-y-1">
                                {teachModeContent.steps.map((step, idx) => (
                                  <li key={idx} className={`text-xs ${isDark ? "text-gray-300" : "text-gray-600"}`}>
                                    {step}
                                  </li>
                                ))}
                              </ol>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Quick Templates Section */}
                      {architectChatHistory.length === 0 && !selectedContractType && (
                        <>
                          <div className={`text-xs font-medium mb-2 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                            Quick Templates
                          </div>
                          <div className="space-y-2">
                            {ARCHITECT_CONTRACT_TYPES.map((type) => {
                            const IconComponent = type.icon;
                            return (
                              <motion.button
                                key={type.id}
                                onClick={() => {
                                  setSelectedContractType(type.id);
                                  setArchitectParams({});
                                }}
                                className={`w-full p-3 rounded-xl border text-left transition-all ${
                                  isDark
                                    ? "border-white/10 hover:border-purple-500/50 bg-white/[0.02] hover:bg-white/[0.05]"
                                    : "border-gray-200 hover:border-purple-300 bg-white hover:bg-purple-50"
                                }`}
                                whileHover={{ scale: 1.01 }}
                                whileTap={{ scale: 0.99 }}
                              >
                                <div className="flex items-start gap-3">
                                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${type.color} flex items-center justify-center flex-shrink-0`}>
                                    <IconComponent size={18} className="text-white" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-sm">{type.name}</div>
                                    <div className={`text-xs mt-0.5 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                                      {type.description}
                                    </div>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                      {type.features.slice(0, 3).map((feature, i) => (
                                        <span
                                          key={i}
                                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                                            isDark ? "bg-white/10 text-gray-400" : "bg-gray-100 text-gray-500"
                                          }`}
                                        >
                                          {feature}
                                        </span>
                                      ))}
                                      {type.features.length > 3 && (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                                          +{type.features.length - 3}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <ChevronRight size={16} className={isDark ? "text-gray-600" : "text-gray-300"} />
                                </div>
                              </motion.button>
                            );
                          })}
                        </div>
                      </>
                      )}

                      {/* Parameter Configuration */}
                      {selectedContractType && (
                        <>
                        {(() => {
                          const contractType = ARCHITECT_CONTRACT_TYPES.find(t => t.id === selectedContractType);
                          if (!contractType) return null;
                          const IconComponent = contractType.icon;

                          return (
                            <>
                              <div className="flex items-center gap-2 mb-4">
                                <button
                                  onClick={() => setSelectedContractType(null)}
                                  className={`p-1.5 rounded-lg ${isDark ? "hover:bg-white/10" : "hover:bg-gray-100"}`}
                                >
                                  <ArrowLeft size={16} />
                                </button>
                                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${contractType.color} flex items-center justify-center`}>
                                  <IconComponent size={16} className="text-white" />
                                </div>
                                <div>
                                  <div className="font-semibold text-sm">{contractType.name}</div>
                                  <div className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                                    Configure parameters
                                  </div>
                                </div>
                              </div>

                              <div className="space-y-3">
                                {contractType.params.map((param) => (
                                  <div key={param.key}>
                                    <label className={`block text-xs font-medium mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                                      {param.label}
                                    </label>
                                    <input
                                      type={param.type}
                                      value={architectParams[param.key] || ""}
                                      onChange={(e) => setArchitectParams(prev => ({ ...prev, [param.key]: e.target.value }))}
                                      placeholder={param.placeholder}
                                      className={`w-full px-3 py-2 rounded-lg text-sm ${
                                        isDark
                                          ? "bg-white/5 border border-white/10 focus:border-purple-500"
                                          : "bg-gray-50 border border-gray-200 focus:border-purple-500"
                                      } outline-none transition-colors`}
                                    />
                                  </div>
                                ))}
                              </div>

                              <motion.button
                                onClick={handleArchitectGenerate}
                                disabled={architectGenerating}
                                className="w-full mt-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                                whileHover={{ scale: 1.01 }}
                                whileTap={{ scale: 0.99 }}
                              >
                                {architectGenerating ? (
                                  <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Generating...
                                  </>
                                ) : (
                                  <>
                                    <Sparkles size={16} />
                                    Generate Contract
                                  </>
                                )}
                              </motion.button>

                              <p className={`text-[10px] text-center mt-2 ${isDark ? "text-gray-600" : "text-gray-400"}`}>
                                AI will generate a secure, optimized contract
                              </p>
                            </>
                          );
                        })()}
                      </>
                    )}

                      {/* Quick Actions for current code */}
                      <div className={`pt-4 border-t ${isDark ? "border-white/5" : "border-gray-100"}`}>
                        <p className={`text-xs font-bold uppercase tracking-wider mb-2 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                          Analyze Current Code
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { icon: <Code2 size={12} />, label: "Explain", action: "explain" as const },
                            { icon: <Zap size={12} />, label: "Optimize", action: "optimize" as const },
                            { icon: <Shield size={12} />, label: "Secure", action: "secure" as const },
                            { icon: <Bug size={12} />, label: "Debug", action: "debug" as const },
                          ].map((item) => (
                            <button
                              key={item.action}
                              onClick={() => handleQuickAction(item.action)}
                              disabled={aiLoading}
                              className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                                isDark ? "bg-white/5 hover:bg-white/10 text-gray-400" : "bg-gray-100 hover:bg-gray-200 text-gray-600"
                              }`}
                            >
                              {item.icon}
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Chat Input Area */}
                    <div className={`p-3 border-t ${isDark ? "border-white/5" : "border-gray-200"}`}>
                      {architectChatHistory.length > 0 && (
                        <button
                          onClick={() => {
                            setArchitectChatHistory([]);
                            setSelectedContractType(null);
                          }}
                          className={`w-full mb-2 py-1.5 text-xs rounded-lg ${
                            isDark ? "bg-white/5 hover:bg-white/10 text-gray-400" : "bg-gray-100 hover:bg-gray-200 text-gray-500"
                          }`}
                        >
                          Clear Chat & Start Over
                        </button>
                      )}
                      <div className="flex gap-2">
                        <input
                          value={architectChatInput}
                          onChange={(e) => setArchitectChatInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleArchitectChat()}
                          placeholder="Describe the contract you want..."
                          disabled={architectGenerating}
                          className={`flex-1 px-3 py-2 rounded-xl text-sm ${
                            isDark
                              ? "bg-white/5 border border-white/10 focus:border-purple-500"
                              : "bg-gray-50 border border-gray-200 focus:border-purple-500"
                          } outline-none transition-colors disabled:opacity-50`}
                        />
                        <motion.button
                          onClick={handleArchitectChat}
                          disabled={architectGenerating || !architectChatInput.trim()}
                          className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-xl text-white disabled:opacity-50"
                          whileTap={{ scale: 0.95 }}
                        >
                          {architectGenerating ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Send size={16} />
                          )}
                        </motion.button>
                      </div>
                      <p className={`text-[10px] text-center mt-2 ${isDark ? "text-gray-600" : "text-gray-400"}`}>
                        Example: {'"Create an ERC20 token with 1M supply and 2% tax"'}
                      </p>
                    </div>
                  </div>
                )}

                {/* ========== RESEARCHER MODE ========== */}
                {aiMode === "researcher" && (
                  <div className="flex flex-col h-full">
                    {/* Quick Facts Banner */}
                    {researchHistory.length === 0 && (
                      <div className="p-4 space-y-4">
                        <div className="text-center mb-2">
                          <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                            <Globe size={24} className="text-white" />
                          </div>
                          <h3 className="font-bold text-sm">Monad Research Assistant</h3>
                          <p className={`text-xs mt-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                            Learn about Web3 & Monad ecosystem
                          </p>
                        </div>

                        {/* Quick Facts */}
                        <div className={`p-3 rounded-xl ${isDark ? "bg-cyan-500/10 border border-cyan-500/20" : "bg-cyan-50 border border-cyan-100"}`}>
                          <div className="flex items-center gap-2 mb-2">
                            <Lightbulb size={14} className="text-cyan-500" />
                            <span className="text-xs font-semibold">Quick Fact</span>
                          </div>
                          <p className={`text-xs ${isDark ? "text-gray-300" : "text-gray-600"}`}>
                            {MONAD_KNOWLEDGE.quickFacts[Math.floor(Math.random() * MONAD_KNOWLEDGE.quickFacts.length)]}
                          </p>
                        </div>

                        {/* Topic Grid */}
                        <div>
                          <p className={`text-xs font-bold uppercase tracking-wider mb-2 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                            Explore Topics
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {MONAD_KNOWLEDGE.topics.map((topic) => {
                              const IconComponent = topic.icon;
                              return (
                                <motion.button
                                  key={topic.id}
                                  onClick={() => handleQuickTopic(topic.id)}
                                  className={`p-3 rounded-xl border text-left transition-all ${
                                    isDark
                                      ? "border-white/10 hover:border-cyan-500/50 bg-white/[0.02] hover:bg-white/[0.05]"
                                      : "border-gray-200 hover:border-cyan-300 bg-white hover:bg-cyan-50"
                                  }`}
                                  whileHover={{ scale: 1.02 }}
                                  whileTap={{ scale: 0.98 }}
                                >
                                  <IconComponent size={16} className="text-cyan-500 mb-1" />
                                  <div className="font-medium text-xs">{topic.title}</div>
                                  <div className={`text-[10px] mt-0.5 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                                    {topic.description}
                                  </div>
                                </motion.button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Chat History */}
                    {researchHistory.length > 0 && (
                      <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {researchHistory.map((msg, i) => (
                          <div
                            key={i}
                            className={`${
                              msg.role === "user"
                                ? "ml-8"
                                : "mr-4"
                            }`}
                          >
                            <div
                              className={`p-3 rounded-xl text-sm ${
                                msg.role === "user"
                                  ? isDark
                                    ? "bg-cyan-600 text-white ml-auto"
                                    : "bg-cyan-500 text-white ml-auto"
                                  : isDark
                                    ? "bg-white/5 border border-white/10"
                                    : "bg-gray-50 border border-gray-200"
                              }`}
                            >
                              {msg.role === "assistant" ? (
                                <Markdown content={msg.content} isDark={isDark} />
                              ) : (
                                <div className="whitespace-pre-wrap text-xs">{msg.content}</div>
                              )}
                            </div>
                          </div>
                        ))}
                        {researchLoading && (
                          <div className="flex items-center gap-2 text-cyan-500">
                            <Loader2 size={14} className="animate-spin" />
                            <span className="text-xs">Researching...</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Input Area */}
                    <div className={`p-3 border-t ${isDark ? "border-white/5" : "border-gray-200"}`}>
                      {researchHistory.length > 0 && (
                        <button
                          onClick={() => setResearchHistory([])}
                          className={`w-full mb-2 py-1.5 text-xs rounded-lg ${
                            isDark ? "bg-white/5 hover:bg-white/10 text-gray-400" : "bg-gray-100 hover:bg-gray-200 text-gray-500"
                          }`}
                        >
                          Clear History
                        </button>
                      )}
                      <div className="flex gap-2">
                        <input
                          value={researchQuery}
                          onChange={(e) => setResearchQuery(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleResearchQuery()}
                          placeholder="Ask about Monad, Web3..."
                          className={`flex-1 px-3 py-2 rounded-xl text-sm ${
                            isDark
                              ? "bg-white/5 border border-white/10 focus:border-cyan-500"
                              : "bg-gray-50 border border-gray-200 focus:border-cyan-500"
                          } outline-none transition-colors`}
                        />
                        <motion.button
                          onClick={() => handleResearchQuery()}
                          disabled={researchLoading || !researchQuery.trim()}
                          className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl text-white disabled:opacity-50"
                          whileTap={{ scale: 0.95 }}
                        >
                          <Send size={16} />
                        </motion.button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
            onUnlock={() => void unlockReport()}
            unlocking={unlocking}
            unlockError={unlockError}
            onRerun={runReport}
            onApplyPatch={(finding) => {
              if (finding.patch === undefined) return;
              applyOptimizedContract(finding.patch);
            }}
          />
        </div>

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
                  addConsoleOutput(`✅ Imported: ${fileName}`);
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
                <h2 className="text-2xl font-bold mb-2">Contract Deployed! 🎉</h2>
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
        Everything the toolbar used to carry, in the two places that scale.

        The palette holds the long tail, searchable by name rather than guessed
        from a 32px icon. The picker is the one extra question GitHub forces,
        asked at the moment it becomes relevant instead of as a gate.
      */}
      <CommandPalette commands={commands} open={paletteOpen} onOpenChange={setPaletteOpen} />

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
