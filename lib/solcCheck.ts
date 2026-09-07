import "server-only";

import { compileVersioned } from "./solc/compile";

export interface CompileCheck {
  compiles: boolean;
  /** First few compiler errors, trimmed for display. */
  errors: string[];
}

/**
 * Compiles a source purely to find out whether it is valid.
 *
 * Migration used to rewrite a contract and hand it back without ever checking
 * the result, so a 0.4 contract whose pragma had been bumped looked migrated
 * and then failed on the first removed keyword. Reporting what still breaks is
 * far more useful than reporting a compatibility score for something that
 * cannot compile at all.
 *
 * It has to use the same compiler the studio would. Checking with the bundled
 * 0.8 against a contract pinned to 0.7.6 reported that Uniswap V3 does not
 * compile when it compiles fine, and a false negative here is worse than no
 * check: it puts a warning on correct output, which teaches people to ignore
 * the warning.
 */
export async function checkCompiles(sourceCode: string): Promise<CompileCheck> {
  try {
    await compileVersioned(sourceCode, { outputs: ["abi"] });
    return { compiles: true, errors: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      compiles: false,
      errors: message
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .slice(0, 5),
    };
  }
}
