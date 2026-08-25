"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sun,
  Moon,
  Play,
  Rocket,
  Shield,
  Brain,
  Terminal,
  FileCode,
  FolderOpen,
  Plus,
  ChevronRight,
  ChevronDown,
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
  Trash2,
  Coins,
  Image as ImageIcon,
  Users,
  Landmark,
  Hammer,
  Search,
  Globe,
  TrendingUp,
  Layers,
  Database,
  Lock,
  Send,
  ArrowRightLeft,
  Gift,
  Gauge,
} from "lucide-react";
import Link from "next/link";
import { useThemeStore, useUserStore, useProjectStore, useIDEStore } from "@/lib/store";
import { useHydrated } from "@/lib/useHydrated";
import { useResizable } from "@/lib/useResizable";
import { ResizeHandle } from "./components/ResizeHandle";
import type { QuickActionType } from "@/lib/supabase";
import { ParallelProfiler } from "./components/ParallelProfiler";
import { MigrationWizard } from "./components/MigrationWizard";
import { Markdown } from "./components/Markdown";
import { ContractInteraction } from "./components/ContractInteraction";
import { GasProfiler } from "./components/GasProfiler";
import { generateFromTemplate, ARCHITECT_TO_TEMPLATE, CONTRACT_TEMPLATES } from "@/lib/contractTemplates";
import { track } from "@/lib/track";
import { createPaymentHeader } from "@/utils/q402";
import { getEthereumProvider } from "@/lib/ethereum";
import { deployFromWallet, constructorInputs, type ConstructorInput } from "@/lib/deploy";
import { coerceArgument } from "@/lib/contractInteraction";
import type { Abi } from "viem";
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

// ============= CONTRACT TEMPLATES =============
const TEMPLATES = {
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
const PYTHON_TEMPLATES = {
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
const DEFAULT_PYTHON_CONTRACT = `from pymon_service.py_contracts import PySmartContract, public_function, view_function

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
const DEFAULT_CONTRACT = `// SPDX-License-Identifier: MIT
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
const ARCHITECT_CONTRACT_TYPES = [
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
const MONAD_KNOWLEDGE = {
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

export default function StudioPage() {
  const { theme, toggleTheme } = useThemeStore();
  const { walletAddress, isConnected, network, setUser, disconnect, setNetwork } = useUserStore();
  const { setActiveFile, addFile } = useProjectStore();
  const { 
    isCompiling, 
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
  const [code, setCode] = useState(DEFAULT_CONTRACT);
  const [currentFileName, setCurrentFileName] = useState("MyToken.sol");
  const [language, setLanguage] = useState<"solidity" | "python">("solidity");
  const [transpilledSolidity, setTranspiledSolidity] = useState<string | null>(null);
  const [aiResponse, setAIResponse] = useState<string | null>(null);
  const [aiLoading, setAILoading] = useState(false);
  const [teachModeContent, setTeachModeContent] = useState<TeachModeContent | null>(null);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [deployedAddress, setDeployedAddress] = useState<string | null>(null);
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [userFiles, setUserFiles] = useState<{name: string, code: string}[]>([
    { name: "MyToken.sol", code: DEFAULT_CONTRACT }
  ]);

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
  // A constructor with parameters cannot be deployed blind; these hold the
  // prompt state until the user supplies them.
  const [ctorInputs, setCtorInputs] = useState<ConstructorInput[]>([]);
  const [ctorArgs, setCtorArgs] = useState<string[]>([]);
  const [ctorError, setCtorError] = useState<string | null>(null);
  // Architect Chat State
  const [architectChatInput, setArchitectChatInput] = useState("");
  const [architectChatHistory, setArchitectChatHistory] = useState<{role: "user" | "assistant", content: string}[]>([]);
  const [researchLoading, setResearchLoading] = useState(false);

  const isDark = theme === "dark";

  // Docked panels are drag-resizable; sizes persist per panel.
  const sidebarResize = useResizable({ initial: 200, min: 160, max: 420, edge: "right", storageKey: "ms.w.sidebar" });
  const aiResize = useResizable({ initial: 380, min: 300, max: 720, edge: "left", storageKey: "ms.w.ai" });
  const profilerResize = useResizable({ initial: 500, min: 360, max: 900, edge: "left", storageKey: "ms.w.profiler" });
  const migrationResize = useResizable({ initial: 450, min: 360, max: 860, edge: "left", storageKey: "ms.w.migration" });
  const interactResize = useResizable({ initial: 420, min: 340, max: 820, edge: "left", storageKey: "ms.w.interact" });
  const gasResize = useResizable({ initial: 460, min: 360, max: 860, edge: "left", storageKey: "ms.w.gas" });
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
  };

  const openSidePanel = (panel: "ai" | "profiler" | "migration" | "interact" | "gas") => {
    const aiNext = panel === "ai" ? !aiPanelOpen : false;

    if (aiNext !== aiPanelOpen) toggleAIPanel();
    setParallelProfilerOpen(panel === "profiler" ? !parallelProfilerOpen : false);
    setMigrationOpen(panel === "migration" ? !migrationOpen : false);
    setInteractOpen(panel === "interact" ? !interactOpen : false);
    setGasOpen(panel === "gas" ? !gasOpen : false);

    // Opening a tool is the clearest signal of what people came for.
    const opening =
      (panel === "profiler" && !parallelProfilerOpen) ||
      (panel === "migration" && !migrationOpen) ||
      (panel === "gas" && !gasOpen) ||
      (panel === "interact" && !interactOpen);
    if (opening) {
      const eventFor = {
        profiler: "parallel_analysis",
        migration: "migration",
        gas: "gas_profile",
        interact: "interact_read",
        ai: "ai_generate",
      } as const;
      track(eventFor[panel], { walletAddress, detail: { opened: true } });
    }
  };

  // One page view per mount, so visitor counts reflect people rather than renders.
  useEffect(() => {
    track("page_view", { detail: { page: "studio" } });
  }, []);

  // Seed the workspace with a starter file on first mount. `files` is read
  // through the store's getState so re-adding is not retriggered by its own write.
  useEffect(() => {
    if (useProjectStore.getState().files.length > 0) return;
    addFile({
      id: "main",
      path: "contracts/MyToken.sol",
      content: DEFAULT_CONTRACT,
      language: "solidity",
      isModified: false,
    });
    setActiveFile("main");
  }, [addFile, setActiveFile]);

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
          }),
        });
      }

      const result = await readJson<CompileResponse>(res);
      const compileTime = Date.now() - startTime;

      if (result.success) {
        addConsoleOutput(`✅ Compiled successfully in ${compileTime}ms`);
        addConsoleOutput(`📦 Bytecode size: ${(result.bytecode?.length || 0) / 2} bytes`);
        setCompileResult({
          success: true,
          bytecode: result.bytecode,
          abi: result.abi,
        });
        
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
    // the wrong number of them reverts on chain and costs gas for nothing.
    const required = constructorInputs(compileResult.abi as Abi);
    if (required.length > 0 && ctorInputs.length === 0) {
      setCtorInputs(required);
      setCtorArgs(required.map(() => ""));
      setCtorError(null);
      return;
    }

    await performDeploy(required, ctorArgs);
  };

  const performDeploy = async (required: ConstructorInput[], rawArgs: string[]) => {
    if (!compileResult?.abi || !compileResult.bytecode || !walletAddress) return;

    let typedArgs: unknown[];
    try {
      typedArgs = required.map((input, i) => coerceArgument(rawArgs[i] ?? "", input.type));
    } catch (err) {
      setCtorError(errorMessage(err));
      return;
    }

    setCtorInputs([]);
    setCtorError(null);
    setDeploying(true);
    addConsoleOutput(`🚀 Deploying ${language === "python" ? "Python" : "Solidity"} contract to Monad testnet...`);
    addConsoleOutput("🔑 Confirm the transaction in your wallet...");

    try {
      const result = await deployFromWallet(
        compileResult.abi as Abi,
        compileResult.bytecode,
        walletAddress as `0x${string}`,
        typedArgs
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

    if (newLang === "python") {
      setCode(DEFAULT_PYTHON_CONTRACT);
      setCurrentFileName("MyContract.py");
      addConsoleOutput("🐍 Switched to Python mode (PyMon)");
    } else {
      setCode(DEFAULT_CONTRACT);
      setCurrentFileName("MyToken.sol");
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
    setCode(template.code);
    setLanguage("solidity");
    const fileName = `${template.name.replace(/\s+/g, '')}.sol`;
    setCurrentFileName(fileName);
    addConsoleOutput(`📄 Loaded template: ${template.name}`);

    // Add to files list if not exists
    if (!userFiles.find(f => f.name === fileName)) {
      setUserFiles(prev => [...prev, { name: fileName, code: template.code }]);
    }
  };

  const loadPythonTemplate = (templateKey: keyof typeof PYTHON_TEMPLATES) => {
    const template = PYTHON_TEMPLATES[templateKey];
    setCode(template.code);
    setLanguage("python");
    const fileName = `${template.name.replace(/\s+/g, '')}.py`;
    setCurrentFileName(fileName);
    addConsoleOutput(`🐍 Loaded Python template: ${template.name}`);

    // Add to files list if not exists
    if (!userFiles.find(f => f.name === fileName)) {
      setUserFiles(prev => [...prev, { name: fileName, code: template.code }]);
    }
  };

  // ============= FILE MANAGEMENT =============
  const createNewFile = () => {
    if (!newFileName.trim()) return;
    
    let fileName = newFileName.trim();
    if (!fileName.endsWith('.sol')) {
      fileName += '.sol';
    }
    
    // Check if file already exists
    if (userFiles.find(f => f.name === fileName)) {
      addConsoleOutput(`❌ File "${fileName}" already exists`);
      return;
    }
    
    const newCode = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ${fileName.replace('.sol', '')}
 * @dev Your contract description here
 * @notice Built with Monsmith for Monad Network
 */
contract ${fileName.replace('.sol', '')} {
    // Your code here
    
    constructor() {
        // Initialize your contract
    }
}
`;
    
    setUserFiles(prev => [...prev, { name: fileName, code: newCode }]);
    setCurrentFileName(fileName);
    setCode(newCode);
    setNewFileName("");
    setShowNewFileModal(false);
    addConsoleOutput(`✅ Created new file: ${fileName}`);
  };

  const switchFile = (fileName: string) => {
    // Save current file
    setUserFiles(prev => prev.map(f => 
      f.name === currentFileName ? { ...f, code } : f
    ));
    
    // Switch to new file
    const file = userFiles.find(f => f.name === fileName);
    if (file) {
      setCurrentFileName(fileName);
      setCode(file.code);
      addConsoleOutput(`📂 Opened: ${fileName}`);
    }
  };

  const deleteFile = (fileName: string) => {
    if (userFiles.length <= 1) {
      addConsoleOutput(`❌ Cannot delete the last file`);
      return;
    }
    
    setUserFiles(prev => prev.filter(f => f.name !== fileName));
    
    // If deleting current file, switch to first available
    if (currentFileName === fileName) {
      const remaining = userFiles.filter(f => f.name !== fileName);
      if (remaining.length > 0) {
        setCurrentFileName(remaining[0].name);
        setCode(remaining[0].code);
      }
    }
    
    addConsoleOutput(`🗑️ Deleted: ${fileName}`);
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

      // Set the code
      setCode(generatedCode);
      const fileName = `${contractType.name.replace(/\s+/g, '')}.sol`;
      setCurrentFileName(fileName);

      // Add to files if not exists
      if (!userFiles.find(f => f.name === fileName)) {
        setUserFiles(prev => [...prev, { name: fileName, code: generatedCode }]);
      } else {
        setUserFiles(prev => prev.map(f => f.name === fileName ? { ...f, code: generatedCode } : f));
      }

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

      // Set the code
      setCode(generatedCode);
      setCurrentFileName(fileName);

      // Add to files
      if (!userFiles.find(f => f.name === fileName)) {
        setUserFiles(prev => [...prev, { name: fileName, code: generatedCode }]);
      } else {
        setUserFiles(prev => prev.map(f => f.name === fileName ? { ...f, code: generatedCode } : f));
      }

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

  if (!mounted) return null;

  return (
    <div className={`h-screen flex flex-col ${isDark ? "bg-[#0d0d12] text-white" : "bg-gray-50 text-gray-900"}`}>
      {/* Top Bar */}
      <div className={`h-12 flex items-center justify-between px-4 border-b ${
        isDark ? "bg-[#16161d] border-white/5" : "bg-white border-gray-200"
      }`}>
        {/* Left */}
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center font-bold text-white text-xs">
              M
            </div>
          </Link>
          <div className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>|</div>
          <span className="text-sm font-medium">{currentFileName}</span>

          {/* Language Toggle */}
          <div className={`flex items-center rounded-lg p-0.5 ml-4 ${isDark ? "bg-white/5" : "bg-gray-100"}`}>
            <button
              onClick={() => handleLanguageSwitch("solidity")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                language === "solidity"
                  ? "bg-purple-600 text-white"
                  : isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Solidity
            </button>
            <button
              onClick={() => handleLanguageSwitch("python")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${
                language === "python"
                  ? "bg-green-600 text-white"
                  : isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              🐍 Python
            </button>
          </div>
        </div>

        {/* Center - Actions */}
        <div className="flex items-center gap-2">
          <motion.button
            onClick={() => handleCompile()}
            disabled={isCompiling}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 ${
              isCompiling
                ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                : "bg-purple-600 hover:bg-purple-500 text-white"
            }`}
            whileTap={{ scale: 0.98 }}
          >
            {isCompiling ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Compile
          </motion.button>

          <motion.button
            onClick={language === "python" ? handlePythonAudit : handleAudit}
            disabled={aiLoading}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 ${
              isDark ? "bg-white/5 hover:bg-white/10" : "bg-gray-100 hover:bg-gray-200"
            }`}
            whileTap={{ scale: 0.98 }}
          >
            <Shield size={14} />
            {language === "python" ? "🔍 Audit" : "Audit"}
          </motion.button>

          <motion.button
            onClick={handleDeploy}
            disabled={isDeploying || !compileResult?.success}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 ${
              isDeploying || !compileResult?.success
                ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                : "bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 text-white"
            }`}
            whileTap={{ scale: 0.98 }}
          >
            {isDeploying ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
            Deploy
          </motion.button>
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          {/* Network Toggle */}
          <button
            onClick={() => setNetwork(network === "testnet" ? "mainnet" : "testnet")}
            className={`px-3 py-1 rounded-full text-xs font-medium border ${
              network === "mainnet"
                ? "border-red-500/50 text-red-400 bg-red-500/10"
                : "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
            }`}
          >
            {network.toUpperCase()}
          </button>

          {/* Theme Toggle */}
          <motion.button
            onClick={toggleTheme}
            className={`p-2 rounded-lg ${isDark ? "bg-white/5 hover:bg-white/10" : "bg-gray-100 hover:bg-gray-200"}`}
            whileTap={{ scale: 0.95 }}
          >
            {isDark ? <Sun size={16} className="text-yellow-400" /> : <Moon size={16} className="text-purple-600" />}
          </motion.button>

          {/* Terminal Toggle */}
          <motion.button
            onClick={toggleTerminal}
            className={`p-2 rounded-lg ${terminalOpen ? "bg-green-600 text-white" : isDark ? "bg-white/5 hover:bg-white/10" : "bg-gray-100 hover:bg-gray-200"}`}
            whileTap={{ scale: 0.95 }}
            title="Toggle Terminal"
          >
            <Terminal size={16} />
          </motion.button>

          {/* AI Panel Toggle */}
          <motion.button
            onClick={() => openSidePanel("ai")}
            className={`p-2 rounded-lg ${aiPanelOpen ? "bg-purple-600 text-white" : isDark ? "bg-white/5 hover:bg-white/10" : "bg-gray-100 hover:bg-gray-200"}`}
            whileTap={{ scale: 0.95 }}
            title="AI Assistant"
          >
            <Brain size={16} />
          </motion.button>

          {/* Parallel Profiler Toggle */}
          <motion.button
            onClick={() => openSidePanel("profiler")}
            className={`p-2 rounded-lg ${parallelProfilerOpen ? "bg-gradient-to-r from-purple-600 to-blue-600 text-white" : isDark ? "bg-white/5 hover:bg-white/10" : "bg-gray-100 hover:bg-gray-200"}`}
            whileTap={{ scale: 0.95 }}
            title="Parallel Execution Profiler"
          >
            <Gauge size={16} />
          </motion.button>

          {/* Migration Tool Toggle */}
          <motion.button
            onClick={() => openSidePanel("gas")}
            className={`p-2 rounded-lg ${gasOpen ? "bg-gradient-to-r from-amber-500 to-orange-600 text-white" : isDark ? "bg-white/5 hover:bg-white/10" : "bg-gray-100 hover:bg-gray-200"}`}
            whileTap={{ scale: 0.95 }}
            title="Gas profiler"
          >
            <Gauge size={16} />
          </motion.button>

          <motion.button
            onClick={() => openSidePanel("interact")}
            className={`p-2 rounded-lg ${interactOpen ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white" : isDark ? "bg-white/5 hover:bg-white/10" : "bg-gray-100 hover:bg-gray-200"}`}
            whileTap={{ scale: 0.95 }}
            title="Interact with a deployed contract"
          >
            <Play size={16} />
          </motion.button>

          <motion.button
            onClick={() => openSidePanel("migration")}
            className={`p-2 rounded-lg ${migrationOpen ? "bg-gradient-to-r from-blue-600 to-cyan-600 text-white" : isDark ? "bg-white/5 hover:bg-white/10" : "bg-gray-100 hover:bg-gray-200"}`}
            whileTap={{ scale: 0.95 }}
            title="Contract Migration (ETH → Monad)"
          >
            <ArrowRightLeft size={16} />
          </motion.button>

          {/* Wallet */}
          {!isConnected ? (
            <motion.button
              onClick={connectWallet}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                isDark
                  ? "bg-white text-black hover:bg-gray-200"
                  : "bg-gray-900 text-white hover:bg-gray-700"
              }`}
              whileTap={{ scale: 0.98 }}
            >
              Connect Wallet
            </motion.button>
          ) : (
            <div className="relative group">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-xs font-mono">{walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}</span>
              </div>
              
              {/* Disconnect Dropdown */}
              <div className="absolute right-0 top-full mt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                <motion.button
                  onClick={() => {
                    disconnect();
                    addConsoleOutput("👋 Wallet disconnected");
                  }}
                  className={`px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap flex items-center gap-2 ${
                    isDark ? "bg-[#16161d] hover:bg-red-500/10 text-red-400" : "bg-white hover:bg-red-50 text-red-600"
                  } border ${isDark ? "border-white/10" : "border-gray-200"} shadow-lg`}
                  whileTap={{ scale: 0.98 }}
                >
                  <X size={14} />
                  Disconnect
                </motion.button>
              </div>
            </div>
          )}
        </div>
      </div>

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
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <span className={`text-xs font-bold uppercase tracking-wider ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                    Explorer
                  </span>
                  <button
                    onClick={() => setShowNewFileModal(true)}
                    className={`p-1 rounded hover:bg-white/10 transition-colors`}
                    title="New File"
                  >
                    <Plus size={14} className="text-purple-400" />
                  </button>
                </div>
                
                {/* File Tree */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ChevronDown size={14} />
                    <FolderOpen size={14} className="text-yellow-500" />
                    <span>contracts</span>
                  </div>
                  
                  {/* Dynamic file list */}
                  {userFiles.map((file) => (
                    <div
                      key={file.name}
                      className={`ml-6 flex items-center justify-between group text-sm py-1 px-2 rounded-lg cursor-pointer transition-colors ${
                        currentFileName === file.name
                          ? isDark ? "bg-purple-500/10 text-purple-400" : "bg-purple-50 text-purple-600"
                          : isDark ? "hover:bg-white/5 text-gray-400" : "hover:bg-gray-100 text-gray-600"
                      }`}
                      onClick={() => switchFile(file.name)}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileCode size={14} className="flex-shrink-0" />
                        <span className="truncate text-xs">{file.name}</span>
                      </div>
                      {userFiles.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteFile(file.name);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all"
                        >
                          <Trash2 size={12} className="text-red-400" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Solidity Templates */}
              {language === "solidity" && (
                <div className="p-4 border-t border-white/5">
                  <div className={`text-xs font-bold uppercase tracking-wider mb-4 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                    Solidity Templates
                  </div>
                  <div className="space-y-1">
                    {[
                      { key: "erc20", icon: <Coins size={14} className="text-yellow-400" />, name: "ERC20 Token" },
                      { key: "nft", icon: <ImageIcon size={14} className="text-pink-400" />, name: "NFT Collection" },
                      { key: "dao", icon: <Users size={14} className="text-blue-400" />, name: "Simple DAO" },
                      { key: "staking", icon: <Landmark size={14} className="text-green-400" />, name: "Staking" },
                    ].map((template) => (
                      <button
                        key={template.key}
                        onClick={() => loadTemplate(template.key as keyof typeof TEMPLATES)}
                        className={`w-full flex items-center gap-2 text-xs py-2 px-3 rounded-lg transition-colors ${
                          isDark ? "hover:bg-white/5 text-gray-400" : "hover:bg-gray-100 text-gray-600"
                        }`}
                      >
                        {template.icon}
                        {template.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Python Templates */}
              {language === "python" && (
                <div className="p-4 border-t border-white/5">
                  <div className={`text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                    <span>🐍</span> Python Templates
                  </div>
                  <div className="space-y-1">
                    {[
                      { key: "simpleStorage", icon: <FileCode size={14} className="text-blue-400" />, name: "Simple Storage" },
                      { key: "counter", icon: <Zap size={14} className="text-yellow-400" />, name: "Counter" },
                      { key: "token", icon: <Coins size={14} className="text-green-400" />, name: "Basic Token" },
                      { key: "nft", icon: <ImageIcon size={14} className="text-pink-400" />, name: "NFT Collection" },
                    ].map((template) => (
                      <button
                        key={template.key}
                        onClick={() => loadPythonTemplate(template.key as keyof typeof PYTHON_TEMPLATES)}
                        className={`w-full flex items-center gap-2 text-xs py-2 px-3 rounded-lg transition-colors ${
                          isDark ? "hover:bg-white/5 text-gray-400" : "hover:bg-gray-100 text-gray-600"
                        }`}
                      >
                        {template.icon}
                        {template.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
          {/* Monaco Editor */}
          <div className={`${terminalOpen ? "flex-1" : "h-full"} min-h-0`}>
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
          {ctorInputs.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
              onClick={() => setCtorInputs([])}
            >
              <motion.div
                initial={{ scale: 0.96, y: 8 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.96, y: 8 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md rounded-2xl panel-surface border border-border-subtle p-5 shadow-[var(--shadow-panel)]"
              >
                <h3 className="text-base font-bold text-text-primary mb-1">Constructor arguments</h3>
                <p className="text-xs text-text-secondary mb-4">
                  This contract&apos;s constructor takes {ctorInputs.length} argument
                  {ctorInputs.length === 1 ? "" : "s"}. Deploying without them reverts on chain.
                </p>

                <div className="space-y-3">
                  {ctorInputs.map((input, i) => (
                    <div key={input.name}>
                      <label className="text-[10px] font-mono text-text-muted">
                        {input.name}: {input.type}
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
                        placeholder={input.type === "string" ? "Hello Monad" : input.type}
                        spellCheck={false}
                        className="w-full mt-1 px-3 py-2 rounded-lg text-xs font-mono panel-sunken border border-border-subtle outline-none focus:border-purple-500"
                      />
                    </div>
                  ))}
                </div>

                {ctorError && (
                  <p className="mt-3 text-[11px] text-red-600 dark:text-red-400">{ctorError}</p>
                )}

                <div className="flex gap-2 mt-5">
                  <button
                    onClick={() => setCtorInputs([])}
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

        {/* Parallel Execution Profiler Panel */}
        {parallelProfilerOpen && (
          <ResizeHandle
              edge="left"
              label="Resize profiler"
              isDragging={profilerResize.isDragging}
              onPointerDown={profilerResize.onPointerDown}
              onReset={profilerResize.reset}
            />
        )}
        <AnimatePresence>
          {parallelProfilerOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: profilerResize.size, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              style={{ width: profilerResize.size }}
              className={`border-l flex flex-col min-w-0 flex-shrink-0 overflow-hidden ${"panel-surface border"}`}
            >
              <ParallelProfiler
                code={language === "python" ? (transpilledSolidity || code) : code}
                onClose={() => setParallelProfilerOpen(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {gasOpen && (
          <ResizeHandle
            edge="left"
            label="Resize gas profiler"
            isDragging={gasResize.isDragging}
            onPointerDown={gasResize.onPointerDown}
            onReset={gasResize.reset}
          />
        )}
        <AnimatePresence>
          {gasOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: gasResize.size, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              style={{ width: gasResize.size }}
              className="border-l border-border-subtle flex flex-col min-w-0 flex-shrink-0 overflow-hidden panel-surface"
            >
              <GasProfiler code={code} onClose={() => setGasOpen(false)} />
            </motion.div>
          )}
        </AnimatePresence>

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
                  setCode(importedCode);
                  setCurrentFileName(fileName);
                  // Add to files if not exists
                  if (!userFiles.find(f => f.name === fileName)) {
                    setUserFiles(prev => [...prev, { name: fileName, code: importedCode }]);
                  } else {
                    setUserFiles(prev => prev.map(f => f.name === fileName ? { ...f, code: importedCode } : f));
                  }
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

      {/* New File Modal */}
      <AnimatePresence>
        {showNewFileModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={() => setShowNewFileModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className={`w-[400px] rounded-2xl p-6 ${"panel-surface"}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                  <Plus size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">Create New File</h3>
                  <p className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                    Add a new Solidity contract
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                    File Name
                  </label>
                  <input
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createNewFile()}
                    placeholder="MyContract.sol"
                    className={`w-full px-4 py-3 rounded-xl text-sm ${
                      isDark 
                        ? "bg-white/5 border border-white/10 focus:border-purple-500" 
                        : "bg-gray-100 border border-gray-200 focus:border-purple-500"
                    } outline-none transition-colors`}
                    autoFocus
                  />
                  <p className={`text-xs mt-2 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                    .sol extension will be added automatically
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowNewFileModal(false)}
                    className={`flex-1 py-3 rounded-xl text-sm font-medium ${
                      isDark ? "bg-white/5 hover:bg-white/10" : "bg-gray-100 hover:bg-gray-200"
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createNewFile}
                    disabled={!newFileName.trim()}
                    className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2"
                  >
                    <Plus size={16} />
                    Create File
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
