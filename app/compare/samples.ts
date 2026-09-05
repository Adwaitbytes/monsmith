/**
 * Sample contracts for the compare page.
 *
 * Each one is chosen to make a different point, and two of them make Monad look
 * worse. That is deliberate: the first question a sceptical reader asks of a
 * comparison tool is whether it can produce an answer its author did not want,
 * and a set of examples that all point the same way answers that question badly.
 */

export interface SampleContract {
    id: string;
    label: string;
    /** What this sample is here to demonstrate. */
    point: string;
    source: string;
}

const PACKED_STATE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// A player record whose fields sit in consecutive storage slots.
contract PlayerRegistry {
    struct Player {
        uint256 level;
        uint256 experience;
        uint256 gold;
        uint256 lastSeen;
        uint256 wins;
        uint256 losses;
    }

    mapping(address => Player) private players;

    function record(uint256 gained, bool won) external {
        Player storage player = players[msg.sender];
        player.experience += gained;
        player.gold += gained / 2;
        player.lastSeen = block.timestamp;
        if (won) { player.wins += 1; } else { player.losses += 1; }
        player.level = player.experience / 1000;
    }

    function reset() external {
        delete players[msg.sender];
    }
}
`;

const TOKEN = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// A minimal token. Balances live in a mapping, so every account is its own page.
contract MiniToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    constructor() {
        totalSupply = 1_000_000e18;
        balanceOf[msg.sender] = totalSupply;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}
`;

const ROUTER = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPool {
    function swap(uint256 amountIn) external returns (uint256);
}

/// A router that hops through several pools. Every hop is a cold account access.
contract MultiHopRouter {
    function route(address[] calldata pools, uint256 amountIn) external returns (uint256) {
        uint256 amount = amountIn;
        for (uint256 i = 0; i < pools.length; i++) {
            amount = IPool(pools[i]).swap(amount);
        }
        return amount;
    }

    function quote(address[] calldata pools) external view returns (uint256 liquidity) {
        for (uint256 i = 0; i < pools.length; i++) {
            liquidity += pools[i].balance;
        }
    }
}
`;

/**
 * Built rather than written out: the point of this sample is its size, and
 * 35 KB of pasted Solidity would make the file unreadable. Each function is
 * distinct so the optimiser cannot collapse them into one.
 */
function oversizedContract(): string {
    const body = Array.from(
        { length: 220 },
        (_, i) => `
    function settle${i}(uint256 amount, address counterparty) external returns (bytes32) {
        bytes32 id = keccak256(abi.encode(amount, counterparty, ${i}, block.number));
        positions[id] = amount + ${i + 1};
        holders[id] = counterparty;
        emit Settled(id, ${i}, amount);
        return id;
    }`,
    ).join("\n");

    return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// A settlement engine with one entrypoint per instrument. Realistic for a
/// venue that cannot route everything through a single generic function.
contract SettlementEngine {
    mapping(bytes32 => uint256) public positions;
    mapping(bytes32 => address) public holders;

    event Settled(bytes32 indexed id, uint256 indexed instrument, uint256 amount);
${body}
}
`;
}

export const SAMPLE_CONTRACTS: readonly SampleContract[] = [
    {
        id: "packed",
        label: "Packed game state",
        point:
            "Six fields of one struct land in consecutive slots, so they share a storage page. Monad pays the page charge once and then 100 gas a slot, where every other chain here pays per slot every time. This is the case Monad's storage model is built for.",
        source: PACKED_STATE,
    },
    {
        id: "token",
        label: "Token transfers",
        point:
            "The opposite case. Each mapping key resolves to its own page, so a token transfer touches two pages and pays the full page charge twice. This costs more gas units on Monad than on Ethereum, and the tool says so. Whether it costs more money is a separate question, and the cost table answers it.",
        source: TOKEN,
    },
    {
        id: "router",
        label: "Multi-hop router",
        point:
            "Every pool the router touches is a cold account access: 10,100 gas on Monad against 2,600 elsewhere. Composable DeFi is the shape that pays most for Monad's repricing, and pretending otherwise would be easy to check and easy to disprove.",
        source: ROUTER,
    },
    {
        id: "oversized",
        label: "Contract over 24 KB",
        point:
            "220 entrypoints puts the runtime bytecode past EIP-170. On Ethereum and every L2 here this does not deploy at all and has to be split behind a proxy. Monad's limit is 128 KB, so it goes out as one contract. This is the one difference that is not a matter of degree.",
        source: oversizedContract(),
    },
];
