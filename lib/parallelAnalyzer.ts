/**
 * Public entry point for the Monad parallel execution analyser.
 *
 * The implementation lives in ./parallel: lexing, structural parsing, storage
 * effect resolution and conflict scoring are separate concerns and each is
 * independently testable.
 */

export {
    analyzeParallelPotential,
    quickAnalysis,
} from './parallel/analyzer';

export type {
    AccessScope,
    ConflictPair,
    Contention,
    ContractOption,
    Entrypoint,
    Grade,
    Hotspot,
    OptimizationSuggestion,
    ParallelAnalysisResult,
    ParallelMetrics,
    ReadOnlyFunction,
    SlotEffect,
} from './parallel/analyzer';
