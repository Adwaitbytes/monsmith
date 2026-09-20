/**
 * Static content for the studio: contract templates, the architect's contract
 * types, and the Monad knowledge base behind the researcher's topic chips.
 *
 * This was 758 lines living at the top of `page.tsx`, which is most of the
 * reason that file reached three thousand lines and became unsafe to change.
 * None of it is logic and none of it is state; it is data the studio renders,
 * so it belongs beside the studio rather than inside it. Lifting it out is what
 * makes the component small enough to restructure.
 *
 * It sits under `app/studio` rather than `lib` on purpose. These strings are
 * presentation, tuned to what the panels show, and pretending otherwise would
 * put React icons in a library that nothing else imports.
 */

import {
    Coins,
    Database,
    Gauge,
    Gift,
    Globe,
    Image as ImageIcon,
    Landmark,
    Layers,
    Lock,
    TrendingUp,
    Users,
} from "lucide-react";

// ============= CONTRACT TEMPLATES =============
export const TEMPLATES = {
  erc20: {
    name: "ERC20 Token",
    icon: "Coins",
    description: "Standard fungible token with mint/burn",
    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MyToken
 * @dev ERC20 token with mint and burn capabilities
 * @notice Built with Monsmith for Monad Network
 */
contract MyToken is ERC20, ERC20Burnable, Ownable {
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        _mint(msg.sender, initialSupply * 10 ** decimals());
    }

    /**
     * @dev Mint new tokens (only owner)
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    receive() external payable {}
}
`,
  },
  nft: {
    name: "NFT Collection",
    icon: "Image",
    description: "ERC721 NFT with metadata & minting",
    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MyNFT
 * @dev NFT collection with metadata management
 * @notice Built with Monsmith for Monad Network
 */
contract MyNFT is ERC721, ERC721URIStorage, ERC721Burnable, Ownable {
    uint256 private _nextTokenId;
    uint256 public mintPrice = 0.01 ether;
    uint256 public maxSupply = 10000;

    constructor(
        string memory name,
        string memory symbol
    ) ERC721(name, symbol) Ownable(msg.sender) {}

    /**
     * @dev Mint a new NFT (owner only, free)
     */
    function safeMint(address to, string memory uri) public onlyOwner {
        require(_nextTokenId < maxSupply, "Max supply reached");
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }

    /**
     * @dev Public mint with payment
     */
    function publicMint(string memory uri) public payable {
        require(msg.value >= mintPrice, "Insufficient payment");
        require(_nextTokenId < maxSupply, "Max supply reached");
        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);
    }

    function setMintPrice(uint256 _price) external onlyOwner {
        mintPrice = _price;
    }

    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    receive() external payable {}
}
`,
  },
  dao: {
    name: "Simple DAO",
    icon: "Users",
    description: "Governance with proposals & voting",
    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SimpleDAO
 * @dev Basic DAO with proposal creation and voting
 * @notice Built with Monsmith for Monad Network
 */
contract SimpleDAO is Ownable {
    struct Proposal {
        uint256 id;
        string description;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 deadline;
        bool executed;
        mapping(address => bool) hasVoted;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(address => uint256) public memberVotingPower;
    
    uint256 public proposalCount;
    uint256 public totalMembers;
    uint256 public constant VOTING_PERIOD = 3 days;
    uint256 public constant MEMBERSHIP_FEE = 0.01 ether;

    event MemberJoined(address indexed member, uint256 votingPower);
    event ProposalCreated(uint256 indexed id, string description);
    event Voted(uint256 indexed proposalId, address indexed voter, bool support);
    event ProposalExecuted(uint256 indexed id, bool passed);

    constructor() Ownable(msg.sender) {
        // Owner is first member with 10 voting power
        memberVotingPower[msg.sender] = 10;
        totalMembers = 1;
    }

    /**
     * @dev Join the DAO by paying membership fee
     */
    function join() external payable {
        require(msg.value >= MEMBERSHIP_FEE, "Insufficient membership fee");
        require(memberVotingPower[msg.sender] == 0, "Already a member");
        
        memberVotingPower[msg.sender] = 1;
        totalMembers++;
        
        emit MemberJoined(msg.sender, 1);
    }

    /**
     * @dev Create a new proposal (members only)
     */
    function createProposal(string memory description) external returns (uint256) {
        require(memberVotingPower[msg.sender] > 0, "Not a member");
        
        uint256 proposalId = proposalCount++;
        Proposal storage p = proposals[proposalId];
        p.id = proposalId;
        p.description = description;
        p.deadline = block.timestamp + VOTING_PERIOD;
        
        emit ProposalCreated(proposalId, description);
        return proposalId;
    }

    /**
     * @dev Vote on a proposal
     */
    function vote(uint256 proposalId, bool support) external {
        require(memberVotingPower[msg.sender] > 0, "Not a member");
        Proposal storage p = proposals[proposalId];
        require(block.timestamp < p.deadline, "Voting ended");
        require(!p.hasVoted[msg.sender], "Already voted");
        
        p.hasVoted[msg.sender] = true;
        uint256 power = memberVotingPower[msg.sender];
        
        if (support) {
            p.forVotes += power;
        } else {
            p.againstVotes += power;
        }
        
        emit Voted(proposalId, msg.sender, support);
    }

    /**
     * @dev Execute a proposal after voting ends
     */
    function executeProposal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp >= p.deadline, "Voting not ended");
        require(!p.executed, "Already executed");
        
        p.executed = true;
        bool passed = p.forVotes > p.againstVotes;
        
        emit ProposalExecuted(proposalId, passed);
    }

    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    receive() external payable {}
}
`,
  },
  staking: {
    name: "Staking",
    icon: "Landmark",
    description: "Stake tokens & earn rewards",
    code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title StakingRewards
 * @dev Stake tokens and earn rewards over time
 * @notice Built with Monsmith for Monad Network
 */
contract StakingRewards is Ownable, ReentrancyGuard {
    IERC20 public stakingToken;
    IERC20 public rewardToken;

    uint256 public rewardRate = 100; // rewards per second
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public totalStaked;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public balances;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardRateUpdated(uint256 newRate);

    constructor(address _stakingToken, address _rewardToken) Ownable(msg.sender) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        lastUpdateTime = block.timestamp;
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = block.timestamp;
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + 
            (((block.timestamp - lastUpdateTime) * rewardRate * 1e18) / totalStaked);
    }

    function earned(address account) public view returns (uint256) {
        return ((balances[account] * 
            (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18) + rewards[account];
    }

    /**
     * @dev Stake tokens
     */
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        totalStaked += amount;
        balances[msg.sender] += amount;
        stakingToken.transferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    /**
     * @dev Withdraw staked tokens
     */
    function withdraw(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        totalStaked -= amount;
        balances[msg.sender] -= amount;
        stakingToken.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @dev Claim accumulated rewards
     */
    function claimReward() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardToken.transfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    /**
     * @dev Exit: withdraw all and claim rewards
     */
    function exit() external {
        withdraw(balances[msg.sender]);
        claimReward();
    }

    function setRewardRate(uint256 _rate) external onlyOwner updateReward(address(0)) {
        rewardRate = _rate;
        emit RewardRateUpdated(_rate);
    }

    receive() external payable {}
}
`,
  },
};

// ============= PYTHON CONTRACT TEMPLATES =============
export const PYTHON_TEMPLATES = {
  simpleStorage: {
    name: "Simple Storage",
    icon: "FileCode",
    description: "Store and retrieve a value",
    code: `from pymon_service.py_contracts import PySmartContract, public_function, view_function

class SimpleStorage(PySmartContract):
    """
    Simple Storage Contract for Monad
    Stores and retrieves a single value
    """

    def __init__(self):
        super().__init__()
        self.stored_value = self.state_var("stored_value", 0, "uint256")
        self.owner = self.state_var("owner", self.msg_sender(), "address")

    @public_function
    def store(self, value: int):
        """Store a new value"""
        self.set_state("stored_value", value)
        self.event("ValueStored", value=value, sender=self.msg_sender())

    @view_function
    def retrieve(self) -> int:
        """Retrieve the stored value"""
        return self.get_state("stored_value")

    @view_function
    def get_owner(self) -> str:
        """Get the contract owner"""
        return self.get_state("owner")
`,
  },
  counter: {
    name: "Counter",
    icon: "Zap",
    description: "Increment/decrement counter",
    code: `from pymon_service.py_contracts import PySmartContract, public_function, view_function

class Counter(PySmartContract):
    """
    Counter Contract for Monad
    Increment, decrement, and reset a counter
    """

    def __init__(self):
        super().__init__()
        self.count = self.state_var("count", 0, "uint256")
        self.owner = self.state_var("owner", self.msg_sender(), "address")

    @public_function
    def increment(self):
        """Increment counter by 1"""
        current = self.get_state("count")
        self.set_state("count", current + 1)
        self.event("CountChanged", new_value=current + 1, action="increment")

    @public_function
    def decrement(self):
        """Decrement counter by 1"""
        current = self.get_state("count")
        self.require(current > 0, "Counter cannot go below zero")
        self.set_state("count", current - 1)
        self.event("CountChanged", new_value=current - 1, action="decrement")

    @public_function
    def reset(self):
        """Reset counter to zero (owner only)"""
        self.require(self.msg_sender() == self.get_state("owner"), "Only owner can reset")
        self.set_state("count", 0)
        self.event("CountReset", by=self.msg_sender())

    @view_function
    def get_count(self) -> int:
        """Get current count"""
        return self.get_state("count")
`,
  },
  token: {
    name: "Basic Token",
    icon: "Coins",
    description: "ERC20-like token in Python",
    code: `from pymon_service.py_contracts import PySmartContract, public_function, view_function

class BasicToken(PySmartContract):
    """
    Basic ERC20-like Token for Monad
    Simple token with transfer and mint functionality
    """

    def __init__(self):
        super().__init__()
        self.name = self.state_var("name", "My Monad Token", "string")
        self.symbol = self.state_var("symbol", "MMT", "string")
        self.decimals = self.state_var("decimals", 18, "uint8")
        self.total_supply = self.state_var("total_supply", 0, "uint256")
        self.balances = self.mapping("balances", "address", "uint256")
        self.owner = self.state_var("owner", self.msg_sender(), "address")

    @public_function
    def initialize(self, initial_supply: int):
        """Initialize token with initial supply"""
        self.require(self.get_state("total_supply") == 0, "Already initialized")
        supply = initial_supply * (10 ** 18)
        self.set_state("total_supply", supply)
        balances = self.get_state("balances")
        balances[self.msg_sender()] = supply
        self.event("Transfer", from_addr="0x0", to=self.msg_sender(), amount=supply)

    @view_function
    def balance_of(self, account: str) -> int:
        """Get token balance of an account"""
        balances = self.get_state("balances")
        return balances.get(account, 0)

    @public_function
    def transfer(self, to: str, amount: int) -> bool:
        """Transfer tokens to another address"""
        balances = self.get_state("balances")
        sender = self.msg_sender()

        self.require(balances.get(sender, 0) >= amount, "Insufficient balance")
        self.require(to != "0x0000000000000000000000000000000000000000", "Invalid recipient")

        balances[sender] = balances.get(sender, 0) - amount
        balances[to] = balances.get(to, 0) + amount

        self.event("Transfer", from_addr=sender, to=to, amount=amount)
        return True

    @public_function
    def mint(self, to: str, amount: int):
        """Mint new tokens (owner only)"""
        self.require(self.msg_sender() == self.get_state("owner"), "Only owner can mint")

        balances = self.get_state("balances")
        balances[to] = balances.get(to, 0) + amount
        self.set_state("total_supply", self.get_state("total_supply") + amount)

        self.event("Transfer", from_addr="0x0", to=to, amount=amount)

    @view_function
    def get_total_supply(self) -> int:
        """Get total token supply"""
        return self.get_state("total_supply")
`,
  },
  nft: {
    name: "NFT Collection",
    icon: "Image",
    description: "Simple NFT in Python",
    code: `from pymon_service.py_contracts import PySmartContract, public_function, view_function, payable_function

class NFTCollection(PySmartContract):
    """
    Simple NFT Collection for Monad
    Mint and transfer NFTs
    """

    def __init__(self):
        super().__init__()
        self.name = self.state_var("name", "Monad NFT", "string")
        self.symbol = self.state_var("symbol", "MNFT", "string")
        self.total_supply = self.state_var("total_supply", 0, "uint256")
        self.max_supply = self.state_var("max_supply", 10000, "uint256")
        self.mint_price = self.state_var("mint_price", 10000000000000000, "uint256")
        self.owners = self.mapping("owners", "uint256", "address")
        self.balances = self.mapping("balances", "address", "uint256")
        self.token_uris = self.mapping("token_uris", "uint256", "string")
        self.owner = self.state_var("owner", self.msg_sender(), "address")

    @payable_function
    def mint(self, uri: str):
        """Mint a new NFT"""
        self.require(self.msg_value() >= self.get_state("mint_price"), "Insufficient payment")
        self.require(self.get_state("total_supply") < self.get_state("max_supply"), "Max supply reached")

        token_id = self.get_state("total_supply")
        self.set_state("total_supply", token_id + 1)

        owners = self.get_state("owners")
        owners[token_id] = self.msg_sender()

        balances = self.get_state("balances")
        balances[self.msg_sender()] = balances.get(self.msg_sender(), 0) + 1

        token_uris = self.get_state("token_uris")
        token_uris[token_id] = uri

        self.event("Transfer", from_addr="0x0", to=self.msg_sender(), token_id=token_id)

    @public_function
    def transfer_nft(self, to: str, token_id: int):
        """Transfer NFT to another address"""
        owners = self.get_state("owners")
        self.require(owners.get(token_id) == self.msg_sender(), "Not token owner")

        balances = self.get_state("balances")
        balances[self.msg_sender()] -= 1
        balances[to] = balances.get(to, 0) + 1
        owners[token_id] = to

        self.event("Transfer", from_addr=self.msg_sender(), to=to, token_id=token_id)

    @view_function
    def owner_of(self, token_id: int) -> str:
        """Get owner of a token"""
        owners = self.get_state("owners")
        return owners.get(token_id, "0x0000000000000000000000000000000000000000")

    @view_function
    def token_uri(self, token_id: int) -> str:
        """Get token URI"""
        token_uris = self.get_state("token_uris")
        return token_uris.get(token_id, "")
`,
  },
};

// Default Python contract
export const DEFAULT_PYTHON_CONTRACT = `from pymon_service.py_contracts import PySmartContract, public_function, view_function

class MyContract(PySmartContract):
    """
    My First Python Contract for Monad
    Built with PyMon Transpiler
    """

    def __init__(self):
        super().__init__()
        self.value = self.state_var("value", 0, "uint256")
        self.owner = self.state_var("owner", self.msg_sender(), "address")

    @public_function
    def set_value(self, new_value: int):
        """Set a new value"""
        self.set_state("value", new_value)
        self.event("ValueChanged", value=new_value, sender=self.msg_sender())

    @view_function
    def get_value(self) -> int:
        """Get the current value"""
        return self.get_state("value")
`;

// Default contract template
export const DEFAULT_CONTRACT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MyToken
 * @dev A simple ERC20 token with minting capability
 * @notice Built with Monsmith for Monad Network
 */
contract MyToken is ERC20, Ownable {
    constructor() ERC20("My Monad Token", "MMT") Ownable(msg.sender) {
        // Mint initial supply to deployer
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }

    /**
     * @dev Mint new tokens (only owner)
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
`;

// ============= ARCHITECT MODE CONTRACT TYPES =============
export const ARCHITECT_CONTRACT_TYPES = [
  {
    id: "defi-token",
    name: "DeFi Token",
    icon: Coins,
    color: "from-yellow-500 to-orange-500",
    description: "ERC20 with advanced tokenomics",
    features: ["Mint/Burn", "Tax System", "Anti-whale", "Liquidity Lock"],
    params: [
      { key: "name", label: "Token Name", type: "text", placeholder: "My Token" },
      { key: "symbol", label: "Symbol", type: "text", placeholder: "MTK" },
      { key: "supply", label: "Initial Supply", type: "number", placeholder: "1000000" },
      { key: "taxFee", label: "Tax Fee (%)", type: "number", placeholder: "2" },
      { key: "maxWallet", label: "Max Wallet (%)", type: "number", placeholder: "5" },
    ],
  },
  {
    id: "nft-collection",
    name: "NFT Collection",
    icon: ImageIcon,
    color: "from-pink-500 to-purple-500",
    description: "ERC721 with reveal & royalties",
    features: ["Lazy Mint", "Reveal", "Royalties", "Whitelist"],
    params: [
      { key: "name", label: "Collection Name", type: "text", placeholder: "My NFTs" },
      { key: "symbol", label: "Symbol", type: "text", placeholder: "MNFT" },
      { key: "maxSupply", label: "Max Supply", type: "number", placeholder: "10000" },
      { key: "mintPrice", label: "Mint Price (MON)", type: "number", placeholder: "0.05" },
      { key: "royaltyFee", label: "Royalty (%)", type: "number", placeholder: "5" },
    ],
  },
  {
    id: "dao-governance",
    name: "DAO Governance",
    icon: Users,
    color: "from-blue-500 to-cyan-500",
    description: "Full governance with treasury",
    features: ["Proposals", "Voting", "Timelock", "Treasury"],
    params: [
      { key: "name", label: "DAO Name", type: "text", placeholder: "My DAO" },
      { key: "votingDelay", label: "Voting Delay (blocks)", type: "number", placeholder: "1" },
      { key: "votingPeriod", label: "Voting Period (blocks)", type: "number", placeholder: "50400" },
      { key: "quorum", label: "Quorum (%)", type: "number", placeholder: "4" },
    ],
  },
  {
    id: "staking-vault",
    name: "Staking Vault",
    icon: Landmark,
    color: "from-green-500 to-emerald-500",
    description: "Stake tokens & earn rewards",
    features: ["Flexible APY", "Lock Periods", "Compound", "Emergency Withdraw"],
    params: [
      { key: "stakingToken", label: "Staking Token", type: "text", placeholder: "0x..." },
      { key: "rewardToken", label: "Reward Token", type: "text", placeholder: "0x..." },
      { key: "rewardRate", label: "Rewards/Second", type: "number", placeholder: "100" },
      { key: "lockPeriod", label: "Lock Period (days)", type: "number", placeholder: "30" },
    ],
  },
  {
    id: "dex-amm",
    name: "DEX / AMM",
    icon: TrendingUp,
    color: "from-purple-500 to-pink-500",
    description: "Automated market maker",
    features: ["Swap", "Liquidity Pools", "Fee Collection", "Flash Loans"],
    params: [
      { key: "name", label: "DEX Name", type: "text", placeholder: "MonadSwap" },
      { key: "swapFee", label: "Swap Fee (%)", type: "number", placeholder: "0.3" },
      { key: "protocolFee", label: "Protocol Fee (%)", type: "number", placeholder: "0.05" },
    ],
  },
  {
    id: "multisig-wallet",
    name: "Multi-Sig Wallet",
    icon: Lock,
    color: "from-red-500 to-orange-500",
    description: "Secure multi-signature wallet",
    features: ["Multiple Owners", "Threshold", "Transaction Queue", "Timelock"],
    params: [
      { key: "owners", label: "Number of Owners", type: "number", placeholder: "3" },
      { key: "threshold", label: "Required Signatures", type: "number", placeholder: "2" },
      { key: "timelockDelay", label: "Timelock (hours)", type: "number", placeholder: "24" },
    ],
  },
];

// ============= MONAD KNOWLEDGE BASE =============
export const MONAD_KNOWLEDGE = {
  topics: [
    {
      id: "monad-overview",
      title: "What is Monad?",
      icon: Globe,
      description: "Layer-1 blockchain with 10,000 TPS",
    },
    {
      id: "parallel-evm",
      title: "Parallel EVM",
      icon: Layers,
      description: "How Monad achieves parallel execution",
    },
    {
      id: "monad-db",
      title: "MonadDB",
      icon: Database,
      description: "Custom database for blockchain state",
    },
    {
      id: "gas-optimization",
      title: "Gas Optimization",
      icon: Gauge,
      description: "Best practices for Monad contracts",
    },
    {
      id: "defi-patterns",
      title: "DeFi on Monad",
      icon: TrendingUp,
      description: "Building DeFi protocols on Monad",
    },
    {
      id: "nft-gaming",
      title: "NFT & Gaming",
      icon: Gift,
      description: "High-performance NFTs and gaming",
    },
  ],
  quickFacts: [
    "Monad achieves 10,000+ TPS with 1-second finality",
    "Full EVM compatibility - deploy existing Solidity code",
    "Parallel execution without modifying smart contracts",
    "MonadDB: Custom state database optimized for blockchain",
    "Deferred execution separates consensus from execution",
    "Optimistic parallelism with conflict detection",
  ],
};
