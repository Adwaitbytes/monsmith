'use client';

import type { ReactNode } from 'react';

/**
 * Everything the studio can do, as a list.
 *
 * The toolbar used to carry seventeen controls, nine of them unlabelled icons,
 * two of which shared an icon and so were impossible to tell apart. The feedback
 * that started this work was that nobody could see what the product did, and the
 * cause was not that the product did too much. It was that every capability had
 * been given permanent chrome, so nothing could be emphasised over anything else.
 *
 * This file is where the capability goes instead. A command costs no screen
 * space, is searchable by name, and can carry a description, which is strictly
 * more discoverable than a 32px icon with a tooltip. That is what makes the
 * toolbar safe to cut down to four controls: nothing was removed from the
 * product, it was moved somewhere that scales.
 *
 * Commands are built from an actions object rather than reaching into the
 * studio's state, so this stays a list of intentions and the page stays the only
 * thing that knows how to carry them out.
 */

export interface Command {
    id: string;
    label: string;
    hint?: string;
    group: string;
    icon?: ReactNode;
    keywords?: string[];
    run: () => void;
    disabled?: boolean;
}

/**
 * What a command needs the studio to do.
 *
 * Every field is required so that adding a capability to the studio forces a
 * decision about whether it belongs in the palette, rather than letting it
 * quietly accumulate in the toolbar again.
 */
export interface StudioActions {
    runReport: () => void;
    /** Audits only the file in the editor, for the edit-and-recheck loop. */
    runReportForFile: () => void;
    /** Opens the chooser for which contracts the report covers. */
    chooseContracts: () => void;
    compile: () => void;
    deploy: () => void;
    importFromGitHub: () => void;
    importFromAddress: () => void;
    newFile: () => void;
    /** Each template is its own command, so `erc20` finds it by name. */
    templates: ReadonlyArray<{ key: string; name: string; description: string; load: () => void }>;
    openAI: () => void;
    aiAudit: () => void;
    openMigration: () => void;
    openInteract: () => void;
    openTerminal: () => void;
    toggleTheme: () => void;
    toggleNetwork: () => void;
    setLanguage: (language: 'solidity' | 'python') => void;
    connectWallet: () => void;
    disconnectWallet: () => void;
    shareReport: () => void;
    showStartCards: () => void;
    showTour: () => void;
}

export interface StudioCommandContext {
    compiled: boolean;
    deployed: boolean;
    walletConnected: boolean;
    reportReady: boolean;
    language: 'solidity' | 'python';
    network: 'testnet' | 'mainnet';
    theme: 'dark' | 'light';
}

/** The platform's own modifier, so the hint matches the key people will press. */
export function modifierLabel(): string {
    if (typeof navigator === 'undefined') return 'Ctrl';
    return /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent) ? '⌘' : 'Ctrl';
}

export function buildCommands(
    actions: StudioActions,
    context: StudioCommandContext,
): Command[] {
    const mod = modifierLabel();

    return [
        // ---------------------------------------------------------- Analyse
        {
            id: 'report.run',
            label: 'Run the full report',
            hint: `${mod}↵`,
            group: 'Analyse',
            keywords: ['audit', 'security', 'scan', 'check', 'analyse', 'analyze', 'everything'],
            run: actions.runReport,
        },
        {
            id: 'report.choose',
            label: 'Choose contracts to audit',
            group: 'Analyse',
            keywords: ['select', 'pick', 'which', 'some', 'subset', 'files'],
            run: actions.chooseContracts,
        },
        {
            id: 'report.file',
            label: 'Audit only the open file',
            group: 'Analyse',
            keywords: ['single', 'this file', 'current', 'quick', 'one'],
            run: actions.runReportForFile,
        },
        {
            id: 'report.share',
            label: 'Share this report',
            group: 'Analyse',
            keywords: ['link', 'permalink', 'export', 'send'],
            run: actions.shareReport,
            disabled: !context.reportReady,
        },
        {
            id: 'ai.audit',
            label: 'Run an AI security audit',
            group: 'Analyse',
            keywords: ['ai', 'llm', 'review', 'vulnerability', 'secure', 'python', 'pymon'],
            run: actions.aiAudit,
        },
        {
            id: 'build.compile',
            label: 'Compile',
            hint: `${mod}S`,
            group: 'Analyse',
            keywords: ['build', 'solc', 'bytecode'],
            run: actions.compile,
        },

        // ------------------------------------------------------------ Bring
        {
            id: 'import.github',
            label: 'Import a GitHub repository',
            group: 'Bring in code',
            keywords: ['git', 'repo', 'clone', 'connect', 'github'],
            run: actions.importFromGitHub,
        },
        {
            id: 'import.address',
            label: 'Import a deployed contract by address',
            group: 'Bring in code',
            keywords: ['0x', 'verified', 'sourcify', 'etherscan', 'onchain'],
            run: actions.importFromAddress,
        },
        {
            id: 'file.new',
            label: 'New file',
            group: 'Bring in code',
            keywords: ['create', 'add', 'sol'],
            run: actions.newFile,
        },
        // One command per template rather than one command that opens a list.
        // The list was ten permanent buttons in the sidebar; as commands they
        // cost nothing and are found by typing the name of the thing you want.
        ...actions.templates.map((template) => ({
            id: `template.${template.key}`,
            label: `New ${template.name}`,
            hint: template.description,
            group: 'Bring in code',
            keywords: ['template', 'example', 'boilerplate', template.key, template.name],
            run: template.load,
        })),
        {
            id: 'start.tour',
            label: 'What is this? Show me around',
            group: 'Bring in code',
            keywords: ['tour', 'intro', 'onboarding', 'walkthrough', 'explain', 'new', 'help'],
            run: actions.showTour,
        },
        {
            id: 'start.cards',
            label: 'Start here',
            group: 'Bring in code',
            keywords: ['onboarding', 'help', 'begin', 'new', 'guide'],
            run: actions.showStartCards,
        },

        // ------------------------------------------------------------- Ship
        {
            id: 'deploy.run',
            label: `Deploy to Monad ${context.network}`,
            group: 'Ship',
            keywords: ['publish', 'send', 'launch', 'testnet', 'mainnet'],
            run: actions.deploy,
            // Deploying uncompiled bytecode is not a thing, so the command says
            // so rather than failing after the click.
            disabled: !context.compiled,
        },
        {
            id: 'deploy.interact',
            label: 'Interact with a deployed contract',
            group: 'Ship',
            keywords: ['call', 'read', 'write', 'abi', 'function'],
            run: actions.openInteract,
        },
        {
            id: 'deploy.migrate',
            label: 'Migrate a contract from another chain',
            group: 'Ship',
            keywords: ['port', 'ethereum', 'move', 'transfer', 'convert'],
            run: actions.openMigration,
        },

        // ------------------------------------------------------------ Tools
        {
            id: 'ai.open',
            label: 'Ask the AI assistant',
            group: 'Tools',
            keywords: ['architect', 'research', 'generate', 'explain', 'chat', 'help'],
            run: actions.openAI,
        },
        {
            id: 'terminal.toggle',
            label: 'Toggle the console',
            hint: `${mod}J`,
            group: 'Tools',
            keywords: ['output', 'log', 'terminal'],
            run: actions.openTerminal,
        },

        // --------------------------------------------------------- Settings
        {
            id: 'settings.theme',
            label: context.theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme',
            group: 'Settings',
            keywords: ['dark', 'light', 'appearance', 'colour', 'color'],
            run: actions.toggleTheme,
        },
        {
            id: 'settings.network',
            label:
                context.network === 'testnet'
                    ? 'Switch to Monad mainnet'
                    : 'Switch to Monad testnet',
            group: 'Settings',
            keywords: ['chain', 'testnet', 'mainnet', 'rpc'],
            run: actions.toggleNetwork,
        },
        {
            id: 'settings.language',
            label:
                context.language === 'solidity'
                    ? 'Switch to Python contracts'
                    : 'Switch to Solidity',
            group: 'Settings',
            keywords: ['pymon', 'python', 'solidity', 'language'],
            run: () => actions.setLanguage(context.language === 'solidity' ? 'python' : 'solidity'),
        },
        context.walletConnected
            ? {
                  id: 'wallet.disconnect',
                  label: 'Disconnect the wallet',
                  group: 'Settings',
                  keywords: ['metamask', 'account', 'sign out'],
                  run: actions.disconnectWallet,
              }
            : {
                  id: 'wallet.connect',
                  label: 'Connect a wallet',
                  group: 'Settings',
                  keywords: ['metamask', 'account', 'sign in'],
                  run: actions.connectWallet,
              },
    ];
}
