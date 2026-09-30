/**
 * The contracts on the start screen, one click each.
 *
 * Real code people already know, so the first report a visitor sees is about
 * something they can judge for themselves. The DAO leads: it is the one every
 * developer knows the ending of, and the one where Optimize has real bugs to fix,
 * so the first session shows the whole product, a report and then a large,
 * measured jump in score. Audited code like Uniswap barely moves under the
 * optimizer, which is correct but makes a flat first impression. The sources live in `public/samples/<id>/` at pinned commits (see
 * the README there) and are fetched when chosen, so none of it ships in the
 * studio's bundle. The file lists are generated from those folders.
 */

export interface ReferenceContract {
    id: string;
    name: string;
    /** The contract the report audits; every other file is there to compile it. */
    contract: string;
    blurb: string;
    /** Longer line for the featured button, when this one leads. */
    pitch?: string;
    year: string;
    compiler: string;
    /** Path of the audited file, relative to the folder. */
    main: string;
    files: readonly string[];
}

export const REFERENCE_CONTRACTS: readonly ReferenceContract[] = [
    {
        id: "the-dao",
        name: "The DAO",
        contract: "TheDAO",
        blurb: "The 2016 hack that split Ethereum, rebuilt.",
        pitch: "The 2016 hack that drained 3.6M ETH. Run the report, then press Optimize and watch the score climb.",
        year: "2016",
        compiler: "0.8.24",
        main: "contracts/TheDAO.sol",
        files: [
            "contracts/TheDAO.sol",
        ],
    },
    {
        id: "uniswap-v2",
        name: "Uniswap V2",
        contract: "UniswapV2Pair",
        blurb: "The pair contract behind the most forked AMM in DeFi.",
        year: "2020",
        compiler: "0.5.16",
        main: "contracts/UniswapV2Pair.sol",
        files: [
            "contracts/UniswapV2ERC20.sol",
            "contracts/UniswapV2Factory.sol",
            "contracts/UniswapV2Pair.sol",
            "contracts/interfaces/IERC20.sol",
            "contracts/interfaces/IUniswapV2Callee.sol",
            "contracts/interfaces/IUniswapV2ERC20.sol",
            "contracts/interfaces/IUniswapV2Factory.sol",
            "contracts/interfaces/IUniswapV2Pair.sol",
            "contracts/libraries/Math.sol",
            "contracts/libraries/SafeMath.sol",
            "contracts/libraries/UQ112x112.sol",
        ],
    },
    {
        id: "uniswap-v3",
        name: "Uniswap V3",
        contract: "UniswapV3Pool",
        blurb: "Concentrated liquidity. Heavily studied.",
        year: "2021",
        compiler: "0.7.6",
        main: "contracts/UniswapV3Pool.sol",
        files: [
            "contracts/NoDelegateCall.sol",
            "contracts/UniswapV3Factory.sol",
            "contracts/UniswapV3Pool.sol",
            "contracts/UniswapV3PoolDeployer.sol",
            "contracts/interfaces/IERC20Minimal.sol",
            "contracts/interfaces/IUniswapV3Factory.sol",
            "contracts/interfaces/IUniswapV3Pool.sol",
            "contracts/interfaces/IUniswapV3PoolDeployer.sol",
            "contracts/interfaces/callback/IUniswapV3FlashCallback.sol",
            "contracts/interfaces/callback/IUniswapV3MintCallback.sol",
            "contracts/interfaces/callback/IUniswapV3SwapCallback.sol",
            "contracts/interfaces/pool/IUniswapV3PoolActions.sol",
            "contracts/interfaces/pool/IUniswapV3PoolDerivedState.sol",
            "contracts/interfaces/pool/IUniswapV3PoolEvents.sol",
            "contracts/interfaces/pool/IUniswapV3PoolImmutables.sol",
            "contracts/interfaces/pool/IUniswapV3PoolOwnerActions.sol",
            "contracts/interfaces/pool/IUniswapV3PoolState.sol",
            "contracts/libraries/BitMath.sol",
            "contracts/libraries/FixedPoint128.sol",
            "contracts/libraries/FixedPoint96.sol",
            "contracts/libraries/FullMath.sol",
            "contracts/libraries/LiquidityMath.sol",
            "contracts/libraries/LowGasSafeMath.sol",
            "contracts/libraries/Oracle.sol",
            "contracts/libraries/Position.sol",
            "contracts/libraries/SafeCast.sol",
            "contracts/libraries/SqrtPriceMath.sol",
            "contracts/libraries/SwapMath.sol",
            "contracts/libraries/Tick.sol",
            "contracts/libraries/TickBitmap.sol",
            "contracts/libraries/TickMath.sol",
            "contracts/libraries/TransferHelper.sol",
            "contracts/libraries/UnsafeMath.sol",
        ],
    },
    {
        id: "weth9",
        name: "WETH9",
        contract: "WETH9",
        blurb: "Wrapped ether. Used by almost every dapp.",
        year: "2017",
        compiler: "0.4.18",
        main: "contracts/WETH9.sol",
        files: [
            "contracts/WETH9.sol",
        ],
    },
    {
        id: "compound-comp",
        name: "Compound",
        contract: "Comp",
        blurb: "The token whose voting half of DeFi copied.",
        year: "2020",
        compiler: "0.8.10",
        main: "contracts/Comp.sol",
        files: [
            "contracts/Comp.sol",
        ],
    },
];

/** Workspace path for a file of a reference contract. */
export function workspacePath(reference: ReferenceContract, file: string): string {
    return `${reference.id}/${file}`;
}

/**
 * Fetches every file of a reference contract into a workspace file map.
 *
 * All or nothing: a contract missing one of its imports would compile into a
 * confusing failure, so a single failed fetch fails the load.
 */
export async function loadReferenceContract(reference: ReferenceContract): Promise<Record<string, string>> {
    const entries = await Promise.all(
        reference.files.map(async (file) => {
            const response = await fetch(`/samples/${reference.id}/${file}`);
            if (!response.ok) throw new Error(`Could not load ${file} (${response.status}).`);
            return [workspacePath(reference, file), await response.text()] as const;
        }),
    );
    return Object.fromEntries(entries);
}
