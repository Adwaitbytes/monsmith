'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft,
    Brain,
    Bug,
    ChevronRight,
    Code2,
    Globe,
    Hammer,
    Lightbulb,
    Loader2,
    Search,
    Send,
    Shield,
    Sparkles,
    X,
    Zap,
} from 'lucide-react';

import type { QuickActionType, TeachModeContent } from '@/lib/apiTypes';
import type { useResizable } from '@/lib/useResizable';

import { Markdown } from './Markdown';
import { ARCHITECT_CONTRACT_TYPES, MONAD_KNOWLEDGE } from '../templates';

/**
 * The AI panel: architect on one tab, researcher on the other.
 *
 * Lifted out of the studio page, where it was five hundred lines of JSX in a
 * component that was already three thousand. Nothing about it is specific to
 * the page — it reads its own feature's state and calls its own feature's
 * handlers — so it was only there because that is where it was first written.
 *
 * Moving it buys two things beyond the line count. The panel can be rendered
 * and reasoned about on its own, and, being memoised, a keystroke in the editor
 * no longer re-renders five hundred lines of a panel that did not change.
 *
 * The state stays on the page. These two modes write into the editor and the
 * console, so the page owns it and hands it down; a panel that owned its own
 * would need a way to reach back up, which is the same coupling facing the
 * other way.
 */

type Turn = { role: 'user' | 'assistant'; content: string };

/** Everything the architect tab reads and writes. */
export interface ArchitectState {
    selectedContractType: string | null;
    setSelectedContractType: (id: string | null) => void;
    architectParams: Record<string, string>;
    setArchitectParams: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    architectGenerating: boolean;
    handleArchitectGenerate: () => void;
    architectChatInput: string;
    setArchitectChatInput: React.Dispatch<React.SetStateAction<string>>;
    architectChatHistory: Turn[];
    setArchitectChatHistory: React.Dispatch<React.SetStateAction<Turn[]>>;
    handleArchitectChat: () => void;
}

/** Everything the researcher tab reads and writes. */
export interface ResearcherState {
    researchQuery: string;
    setResearchQuery: React.Dispatch<React.SetStateAction<string>>;
    researchHistory: Turn[];
    setResearchHistory: React.Dispatch<React.SetStateAction<Turn[]>>;
    researchLoading: boolean;
    handleResearchQuery: (query?: string) => void;
    handleQuickTopic: (topicId: string) => void;
}

export interface AIPanelProps {
    aiPanelOpen: boolean;
    toggleAIPanel: () => void;
    aiMode: 'architect' | 'researcher';
    setAIMode: React.Dispatch<React.SetStateAction<'architect' | 'researcher'>>;
    /** Width, drag state and handlers from the page's resizable hook. */
    aiResize: ReturnType<typeof useResizable>;
    aiResponse: string | null;
    setAIResponse: React.Dispatch<React.SetStateAction<string | null>>;
    aiLoading: boolean;
    teachModeContent: TeachModeContent | null;
    setTeachModeContent: React.Dispatch<React.SetStateAction<TeachModeContent | null>>;
    handleQuickAction: (action: QuickActionType) => void;
    isDark: boolean;
    architect: ArchitectState;
    researcher: ResearcherState;
}

function AIPanelInner({
    aiPanelOpen,
    toggleAIPanel,
    aiMode,
    setAIMode,
    aiResize,
    aiResponse,
    setAIResponse,
    aiLoading,
    teachModeContent,
    setTeachModeContent,
    handleQuickAction,
    isDark,
    architect,
    researcher,
}: AIPanelProps) {
    /*
      Destructured back to the names the markup already used.

      The markup below moved across unchanged, which is the whole point: a
      five-hundred-line transplant that also renames thirty identifiers is a
      transplant nobody can review. Grouping them into two objects keeps the
      call site honest about what the two tabs need without touching the JSX.
    */
    const {
        selectedContractType, setSelectedContractType,
        architectParams, setArchitectParams,
        architectGenerating, handleArchitectGenerate,
        architectChatInput, setArchitectChatInput,
        architectChatHistory, setArchitectChatHistory,
        handleArchitectChat,
    } = architect;

    /*
      One fact, chosen once.

      This read `quickFacts[Math.floor(Math.random() * ...)]` inline, so it
      re-rolled on every render: the fact changed under the reader as they
      typed in the box below it. Buried in a three-thousand-line component
      nobody saw it; in a component small enough to compile, the React rules
      catch it on sight.
    */
    const [quickFact] = React.useState(
        () => MONAD_KNOWLEDGE.quickFacts[Math.floor(Math.random() * MONAD_KNOWLEDGE.quickFacts.length)],
    );

    const {
        researchQuery, setResearchQuery,
        researchHistory, setResearchHistory,
        researchLoading, handleResearchQuery,
        handleQuickTopic,
    } = researcher;

    return (
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
                      <button
                        onClick={toggleAIPanel}
                        aria-label="Close the AI panel"
                        className="rounded p-1 text-text-muted outline-none ring-accent-line transition-colors hover:text-text-primary focus-visible:ring-2"
                      >
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
                                {quickFact}
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
    );
}

/*
  Memoised because the page around it changes on every keystroke in the editor
  and this panel depends on none of that.
*/
export const AIPanel = React.memo(AIPanelInner);
