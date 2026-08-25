"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Code2, 
  Shield, 
  Rocket, 
  Brain, 
  Monitor,
  ChevronRight,
  Sun,
  Moon,
  Github,
  Twitter,
  ArrowRight,
  Play,
  Sparkles,
  Terminal,
  FileCode,
  Bug
} from "lucide-react";
import { useThemeStore } from "@/lib/store";
import { useHydrated } from "@/lib/useHydrated";
import { track } from "@/lib/track";

export default function LandingPage() {
  const { theme, toggleTheme } = useThemeStore();
  const mounted = useHydrated();
  const [metrics, setMetrics] = useState({
    developers: 2847,
    contracts: 12543,
    deployments: 8921,
    gasOptimized: "42M"
  });

  useEffect(() => {
    track("page_view", { detail: { page: "landing" } });
  }, []);

  useEffect(() => {
    // Simulate live metrics updates
    const interval = setInterval(() => {
      setMetrics(prev => ({
        developers: prev.developers + Math.floor(Math.random() * 3),
        contracts: prev.contracts + Math.floor(Math.random() * 5),
        deployments: prev.deployments + Math.floor(Math.random() * 4),
        gasOptimized: prev.gasOptimized
      }));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!mounted) return null;

  const isDark = theme === 'dark';

  return (
    <div className={`min-h-screen transition-colors duration-500 ${
      isDark 
        ? 'bg-[#0a0a0f] text-white' 
        : 'bg-[#fafafa] text-gray-900'
    }`}>
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Gradient Orbs */}
        <div className={`absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full blur-[120px] ${
          isDark ? 'bg-purple-600/20' : 'bg-purple-400/20'
        }`} />
        <div className={`absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full blur-[100px] ${
          isDark ? 'bg-cyan-500/15' : 'bg-cyan-400/15'
        }`} />
        <div className={`absolute top-1/2 left-1/2 w-[400px] h-[400px] rounded-full blur-[80px] ${
          isDark ? 'bg-pink-500/10' : 'bg-pink-400/10'
        }`} />
        
        {/* Grid Pattern */}
        <div className={`absolute inset-0 ${isDark ? 'opacity-[0.02]' : 'opacity-[0.03]'}`}
          style={{
            backgroundImage: `linear-gradient(${isDark ? '#fff' : '#000'} 1px, transparent 1px),
                             linear-gradient(90deg, ${isDark ? '#fff' : '#000'} 1px, transparent 1px)`,
            backgroundSize: '60px 60px'
          }}
        />
      </div>

      {/* Navigation */}
      <nav className={`fixed top-0 left-0 right-0 z-50 ${
        isDark ? 'bg-[#0a0a0f]/80' : 'bg-white/80'
      } backdrop-blur-xl border-b ${isDark ? 'border-white/5' : 'border-gray-200'}`}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 via-pink-500 to-cyan-500 rounded-xl flex items-center justify-center font-black text-white text-lg shadow-lg shadow-purple-500/25">
              M
            </div>
            <span className="font-bold text-xl tracking-tight">Monsmith</span>
          </Link>

          {/* Nav Links */}
          <div className="hidden md:flex items-center gap-8">
            <Link href="#features" className={`text-sm font-medium ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>
              Features
            </Link>
            <Link href="#ide" className={`text-sm font-medium ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>
              IDE
            </Link>
            <Link href="/tutorials/erc20-token" className={`text-sm font-medium ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>
              Learn
            </Link>
            <a href="https://docs.monad.xyz" target="_blank" className={`text-sm font-medium ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>
              Docs
            </a>
          </div>

          {/* Right Side */}
          <div className="flex items-center gap-4">
            {/* Theme Toggle */}
            <motion.button
              onClick={toggleTheme}
              className={`p-2 rounded-full ${isDark ? 'bg-white/5 hover:bg-white/10' : 'bg-gray-100 hover:bg-gray-200'} transition-colors`}
              whileTap={{ scale: 0.95 }}
            >
              <AnimatePresence mode="wait">
                {isDark ? (
                  <motion.div
                    key="sun"
                    initial={{ rotate: -90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: 90, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Sun size={18} className="text-yellow-400" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="moon"
                    initial={{ rotate: 90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: -90, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Moon size={18} className="text-purple-600" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>

            {/* Launch App Button */}
            <Link href="/studio">
              <motion.button
                className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-full text-sm font-semibold shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-shadow flex items-center gap-2"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Launch Studio
                <ArrowRight size={16} />
              </motion.button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-4xl mx-auto">
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-8 ${
                isDark 
                  ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' 
                  : 'bg-purple-50 text-purple-600 border border-purple-200'
              }`}
            >
              <Sparkles size={14} />
              Built for Monad&apos;s 10,000 TPS
              <ChevronRight size={14} />
            </motion.div>

            {/* Main Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-5xl md:text-7xl font-black tracking-tight leading-[1.1] mb-6"
            >
              Build. Learn.
              <br />
              <span className="bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 bg-clip-text text-transparent">
                Ship to Monad.
              </span>
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className={`text-xl md:text-2xl mb-10 max-w-2xl mx-auto ${isDark ? 'text-gray-400' : 'text-gray-600'}`}
            >
              The AI-powered IDE for smart contract development. 
              Write, compile, debug, and deploy - all in your browser.
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <Link href="/studio">
                <motion.button
                  className="px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-2xl text-lg font-bold shadow-2xl shadow-purple-500/30 hover:shadow-purple-500/50 transition-all flex items-center gap-3"
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Start Building Free
                  <Rocket size={20} />
                </motion.button>
              </Link>
              
              <motion.button
                className={`px-8 py-4 rounded-2xl text-lg font-bold flex items-center gap-3 ${
                  isDark 
                    ? 'bg-white/5 hover:bg-white/10 border border-white/10' 
                    : 'bg-gray-100 hover:bg-gray-200 border border-gray-200'
                } transition-all`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Play size={20} className="text-purple-500" />
                Watch Demo
              </motion.button>
            </motion.div>
          </div>

          {/* Hero Visual - IDE Preview */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className={`mt-20 rounded-3xl overflow-hidden border ${
              isDark ? 'border-white/10 bg-[#111]/50' : 'border-gray-200 bg-white/50'
            } backdrop-blur-xl shadow-2xl`}
          >
            {/* IDE Header */}
            <div className={`h-12 px-4 flex items-center justify-between border-b ${
              isDark ? 'border-white/5 bg-[#0a0a0f]' : 'border-gray-100 bg-gray-50'
            }`}>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <div className="w-3 h-3 rounded-full bg-green-500" />
              </div>
              <span className={`text-xs font-mono ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                MyToken.sol - Monsmith
              </span>
              <div />
            </div>

            {/* IDE Content */}
            <div className="grid grid-cols-12">
              {/* Sidebar */}
              <div className={`col-span-2 p-4 border-r ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
                <div className={`text-xs font-bold uppercase tracking-wider mb-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Explorer
                </div>
                <div className="space-y-2">
                  <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>
                    <FileCode size={14} />
                    <span>MyToken.sol</span>
                  </div>
                  <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    <FileCode size={14} />
                    <span>Deploy.js</span>
                  </div>
                </div>
              </div>

              {/* Code Editor */}
              <div className={`col-span-7 p-6 font-mono text-sm border-r ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
                <pre className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                  <code>
                    <span className="text-purple-400">{'// SPDX-License-Identifier: MIT'}</span>{'\n'}
                    <span className="text-pink-400">pragma</span> <span className="text-cyan-400">solidity</span> ^0.8.24;{'\n\n'}
                    <span className="text-pink-400">import</span> <span className="text-green-400">{'"@openzeppelin/contracts/token/ERC20/ERC20.sol"'}</span>;{'\n\n'}
                    <span className="text-pink-400">contract</span> <span className="text-yellow-400">MyToken</span> <span className="text-pink-400">is</span> ERC20 {'{'}{'\n'}
                    {'    '}<span className="text-pink-400">constructor</span>() ERC20(<span className="text-green-400">{'"Monad Token"'}</span>, <span className="text-green-400">{'"MON"'}</span>) {'{'}{'\n'}
                    {'        '}_mint(msg.sender, <span className="text-cyan-400">1000000</span> * <span className="text-cyan-400">10</span> ** decimals());{'\n'}
                    {'    }'}{'\n'}
                    {'}'}
                  </code>
                </pre>
              </div>

              {/* AI Panel */}
              <div className={`col-span-3 p-4 ${isDark ? 'bg-[#0a0a0f]/50' : 'bg-gray-50'}`}>
                <div className="flex items-center gap-2 mb-4">
                  <Brain className="text-purple-500" size={16} />
                  <span className="text-sm font-bold">AI Assistant</span>
                </div>
                <div className={`p-3 rounded-xl text-xs ${
                  isDark ? 'bg-purple-500/10 border border-purple-500/20' : 'bg-purple-50 border border-purple-100'
                }`}>
                  <p className={isDark ? 'text-purple-300' : 'text-purple-700'}>
                    ✨ Contract looks good! Consider adding a burn function for deflationary tokenomics.
                  </p>
                </div>
                <button className={`mt-4 w-full py-2 rounded-lg text-xs font-medium ${
                  isDark ? 'bg-white/5 hover:bg-white/10' : 'bg-gray-100 hover:bg-gray-200'
                } transition-colors`}>
                  Run Security Audit
                </button>
              </div>
            </div>

            {/* Terminal */}
            <div className={`h-32 p-4 border-t ${isDark ? 'border-white/5 bg-[#0a0a0f]' : 'border-gray-100 bg-gray-50'}`}>
              <div className="flex items-center gap-2 mb-3">
                <Terminal size={14} className="text-green-500" />
                <span className="text-xs font-mono text-gray-500">Terminal</span>
              </div>
              <div className="font-mono text-xs space-y-1">
                <p className="text-green-400">✓ Compiled successfully</p>
                <p className="text-cyan-400">Contract size: 2.4 KB</p>
                <p className="text-gray-500">Ready to deploy...</p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Metrics Section */}
      <section className={`py-16 border-y ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { label: 'Active Developers', value: metrics.developers.toLocaleString(), suffix: '+' },
              { label: 'Contracts Created', value: metrics.contracts.toLocaleString(), suffix: '' },
              { label: 'Deployments', value: metrics.deployments.toLocaleString(), suffix: '' },
              { label: 'Gas Saved', value: metrics.gasOptimized, suffix: ' GWEI' },
            ].map((metric, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="text-center"
              >
                <div className="text-3xl md:text-4xl font-black bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
                  {metric.value}{metric.suffix}
                </div>
                <div className={`text-sm mt-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {metric.label}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-black mb-4">
              Everything you need to
              <br />
              <span className="bg-gradient-to-r from-cyan-500 to-purple-500 bg-clip-text text-transparent">
                ship faster
              </span>
            </h2>
            <p className={`text-lg max-w-2xl mx-auto ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              From idea to mainnet in minutes. No setup, no configuration, just code.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: <Code2 className="text-purple-500" />,
                title: 'Browser IDE',
                description: 'Full-featured code editor with Solidity syntax highlighting, autocomplete, and real-time error detection.',
                gradient: 'from-purple-500/20 to-purple-600/5'
              },
              {
                icon: <Brain className="text-pink-500" />,
                title: 'AI Code Assistant',
                description: 'Generate contracts from prompts, get intelligent suggestions, and auto-fix errors with explanations.',
                gradient: 'from-pink-500/20 to-pink-600/5'
              },
              {
                icon: <Bug className="text-red-500" />,
                title: 'Smart Debugging',
                description: 'When compilation fails, get human-readable explanations and "Teach Me" lessons for every error.',
                gradient: 'from-red-500/20 to-red-600/5'
              },
              {
                icon: <Shield className="text-green-500" />,
                title: 'Security Audits',
                description: 'Automated vulnerability scanning, gas optimization tips, and best-practice recommendations.',
                gradient: 'from-green-500/20 to-green-600/5'
              },
              {
                icon: <Rocket className="text-cyan-500" />,
                title: 'One-Click Deploy',
                description: 'Deploy to Monad testnet or mainnet instantly. We handle the complexity, you ship the product.',
                gradient: 'from-cyan-500/20 to-cyan-600/5'
              },
              {
                icon: <Monitor className="text-yellow-500" />,
                title: 'Live Monitoring',
                description: 'Track transactions, events, gas usage, and contract interactions in real-time.',
                gradient: 'from-yellow-500/20 to-yellow-600/5'
              },
            ].map((feature, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className={`p-6 rounded-3xl border ${
                  isDark ? 'border-white/5 bg-white/[0.02]' : 'border-gray-100 bg-white'
                } hover:border-purple-500/30 transition-all group`}
              >
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 bg-gradient-to-br ${feature.gradient}`}>
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className={`py-24 px-6 ${isDark ? 'bg-[#111]/50' : 'bg-gray-50'}`}>
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-black mb-4">
              From zero to deployed
              <br />
              in 4 steps
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-4 gap-8">
            {[
              { step: '01', title: 'Write or Generate', desc: 'Use our AI to generate contracts or write your own in the browser IDE' },
              { step: '02', title: 'Compile & Debug', desc: 'Get instant feedback, error explanations, and fix suggestions' },
              { step: '03', title: 'Audit & Optimize', desc: 'Run security checks and get gas optimization recommendations' },
              { step: '04', title: 'Deploy & Monitor', desc: 'One-click deploy to Monad and track everything in real-time' },
            ].map((item, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="text-center"
              >
                <div className="text-6xl font-black bg-gradient-to-r from-purple-500/30 to-pink-500/30 bg-clip-text text-transparent mb-4">
                  {item.step}
                </div>
                <h3 className="text-xl font-bold mb-2">{item.title}</h3>
                <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            className={`p-12 rounded-3xl border ${
              isDark ? 'border-white/10 bg-gradient-to-br from-purple-900/20 to-pink-900/20' : 'border-purple-100 bg-gradient-to-br from-purple-50 to-pink-50'
            }`}
          >
            <h2 className="text-4xl md:text-5xl font-black mb-4">
              Ready to build the future?
            </h2>
            <p className={`text-lg mb-8 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              Join thousands of developers shipping on Monad. No credit card required.
            </p>
            <Link href="/studio">
              <motion.button
                className="px-10 py-5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-2xl text-lg font-bold shadow-2xl shadow-purple-500/30 hover:shadow-purple-500/50 transition-all"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Launch Monsmith →
              </motion.button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className={`py-12 px-6 border-t ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center font-bold text-white text-sm">
              M
            </div>
            <span className="font-bold">Monsmith</span>
            <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>© 2025</span>
          </div>
          
          <div className="flex items-center gap-6">
            <a href="https://github.com/Adwaitbytes/monsmith" target="_blank" className={`${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'} transition-colors`}>
              <Github size={20} />
            </a>
            <a href="https://twitter.com" target="_blank" className={`${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'} transition-colors`}>
              <Twitter size={20} />
            </a>
            <a href="https://discord.gg/monad" target="_blank" className={`${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'} transition-colors`}>
              Discord
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
