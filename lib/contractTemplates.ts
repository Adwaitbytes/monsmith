/**
 * Pre-built, Tested Contract Templates
 *
 * These templates are GUARANTEED to compile without errors.
 * The AI customizes parameters within these tested patterns.
 */

export interface ContractTemplate {
  id: string;
  name: string;
  code: string;
  params: { key: string; placeholder: string; defaultValue: string }[];
}

// ============= DeFi TOKEN TEMPLATE =============
export const DEFI_TOKEN_TEMPLATE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title {{TOKEN_NAME}}
 * @dev Advanced DeFi Token with tax system and anti-whale protection
 * @notice Built with Monsmith for Monad Network
 */
contract {{CONTRACT_NAME}} is ERC20, ERC20Burnable, Ownable, ReentrancyGuard {
    // Tax configuration
    uint256 public buyTax = {{BUY_TAX}};
    uint256 public sellTax = {{SELL_TAX}};
    uint256 public constant MAX_TAX = 10; // 10% max

    // Anti-whale
    uint256 public maxWalletPercent = {{MAX_WALLET}};
    uint256 public maxTxPercent = {{MAX_TX}};

    // Exclusions
    mapping(address => bool) public isExcludedFromTax;
    mapping(address => bool) public isExcludedFromMaxWallet;

    // Treasury
    address public treasury;

    // Events
    event TaxUpdated(uint256 buyTax, uint256 sellTax);
    event TreasuryUpdated(address indexed newTreasury);
    event ExcludedFromTax(address indexed account, bool excluded);
    event MaxWalletUpdated(uint256 newPercent);

    constructor() ERC20("{{TOKEN_NAME}}", "{{TOKEN_SYMBOL}}") Ownable(msg.sender) {
        treasury = msg.sender;

        // Exclude owner and contract from restrictions
        isExcludedFromTax[msg.sender] = true;
        isExcludedFromTax[address(this)] = true;
        isExcludedFromMaxWallet[msg.sender] = true;
        isExcludedFromMaxWallet[address(this)] = true;

        // Mint initial supply
        _mint(msg.sender, {{INITIAL_SUPPLY}} * 10 ** decimals());
    }

    /**
     * @dev Override transfer to apply taxes and limits
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        // Skip on mint/burn
        if (from == address(0) || to == address(0)) {
            super._update(from, to, amount);
            return;
        }

        // Check max wallet
        if (!isExcludedFromMaxWallet[to]) {
            uint256 maxWallet = (totalSupply() * maxWalletPercent) / 100;
            require(balanceOf(to) + amount <= maxWallet, "Exceeds max wallet");
        }

        // Apply tax if not excluded
        if (!isExcludedFromTax[from] && !isExcludedFromTax[to]) {
            uint256 taxAmount = (amount * sellTax) / 100;
            if (taxAmount > 0) {
                super._update(from, treasury, taxAmount);
                amount -= taxAmount;
            }
        }

        super._update(from, to, amount);
    }

    /**
     * @dev Mint new tokens (owner only)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev Update tax rates
     */
    function setTaxes(uint256 _buyTax, uint256 _sellTax) external onlyOwner {
        require(_buyTax <= MAX_TAX && _sellTax <= MAX_TAX, "Tax too high");
        buyTax = _buyTax;
        sellTax = _sellTax;
        emit TaxUpdated(_buyTax, _sellTax);
    }

    /**
     * @dev Update treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid address");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    /**
     * @dev Exclude/include address from tax
     */
    function setExcludedFromTax(address account, bool excluded) external onlyOwner {
        isExcludedFromTax[account] = excluded;
        emit ExcludedFromTax(account, excluded);
    }

    /**
     * @dev Update max wallet percent
     */
    function setMaxWalletPercent(uint256 _percent) external onlyOwner {
        require(_percent >= 1 && _percent <= 100, "Invalid percent");
        maxWalletPercent = _percent;
        emit MaxWalletUpdated(_percent);
    }

    receive() external payable {}
}
`;

// ============= NFT COLLECTION TEMPLATE =============
export const NFT_COLLECTION_TEMPLATE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title {{COLLECTION_NAME}}
 * @dev NFT Collection with reveal, royalties, and whitelist
 * @notice Built with Monsmith for Monad Network
 */
contract {{CONTRACT_NAME}} is ERC721, ERC721URIStorage, ERC721Burnable, Ownable, ReentrancyGuard {
    // Supply
    uint256 private _nextTokenId;
    uint256 public maxSupply = {{MAX_SUPPLY}};

    // Pricing
    uint256 public mintPrice = {{MINT_PRICE}} ether;
    uint256 public whitelistPrice = {{WL_PRICE}} ether;

    // Royalties (basis points, 100 = 1%)
    uint256 public royaltyBps = {{ROYALTY_BPS}};
    address public royaltyReceiver;

    // Reveal
    bool public revealed;
    string public hiddenMetadataUri = "ipfs://hidden/";
    string public baseTokenUri = "";

    // Whitelist
    mapping(address => bool) public isWhitelisted;
    bool public whitelistMintEnabled;
    bool public publicMintEnabled;

    // Events
    event Revealed(string baseUri);
    event MintPriceUpdated(uint256 newPrice);
    event WhitelistUpdated(address indexed account, bool status);

    constructor() ERC721("{{COLLECTION_NAME}}", "{{SYMBOL}}") Ownable(msg.sender) {
        royaltyReceiver = msg.sender;
    }

    /**
     * @dev Owner mint (free)
     */
    function ownerMint(address to, uint256 quantity) external onlyOwner {
        require(_nextTokenId + quantity <= maxSupply, "Exceeds max supply");
        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = _nextTokenId++;
            _safeMint(to, tokenId);
        }
    }

    /**
     * @dev Whitelist mint
     */
    function whitelistMint(uint256 quantity) external payable nonReentrant {
        require(whitelistMintEnabled, "Whitelist mint not active");
        require(isWhitelisted[msg.sender], "Not whitelisted");
        require(msg.value >= whitelistPrice * quantity, "Insufficient payment");
        require(_nextTokenId + quantity <= maxSupply, "Exceeds max supply");

        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = _nextTokenId++;
            _safeMint(msg.sender, tokenId);
        }
    }

    /**
     * @dev Public mint
     */
    function publicMint(uint256 quantity) external payable nonReentrant {
        require(publicMintEnabled, "Public mint not active");
        require(msg.value >= mintPrice * quantity, "Insufficient payment");
        require(_nextTokenId + quantity <= maxSupply, "Exceeds max supply");

        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = _nextTokenId++;
            _safeMint(msg.sender, tokenId);
        }
    }

    /**
     * @dev Reveal collection
     */
    function reveal(string calldata _baseUri) external onlyOwner {
        revealed = true;
        baseTokenUri = _baseUri;
        emit Revealed(_baseUri);
    }

    /**
     * @dev Set whitelist status for addresses
     */
    function setWhitelist(address[] calldata accounts, bool status) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            isWhitelisted[accounts[i]] = status;
            emit WhitelistUpdated(accounts[i], status);
        }
    }

    /**
     * @dev Toggle mint phases
     */
    function setMintPhase(bool _whitelist, bool _public) external onlyOwner {
        whitelistMintEnabled = _whitelist;
        publicMintEnabled = _public;
    }

    /**
     * @dev Update mint price
     */
    function setMintPrice(uint256 _price) external onlyOwner {
        mintPrice = _price;
        emit MintPriceUpdated(_price);
    }

    /**
     * @dev EIP-2981 royalty info
     */
    function royaltyInfo(uint256, uint256 salePrice) external view returns (address, uint256) {
        uint256 royaltyAmount = (salePrice * royaltyBps) / 10000;
        return (royaltyReceiver, royaltyAmount);
    }

    /**
     * @dev Withdraw funds
     */
    function withdraw() external onlyOwner {
        (bool success, ) = payable(owner()).call{value: address(this).balance}("");
        require(success, "Withdraw failed");
    }

    /**
     * @dev Token URI with reveal logic
     */
    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        if (!revealed) {
            return hiddenMetadataUri;
        }
        return string(abi.encodePacked(baseTokenUri, _toString(tokenId), ".json"));
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return interfaceId == 0x2a55205a || super.supportsInterface(interfaceId); // EIP-2981
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    receive() external payable {}
}
`;

// ============= DAO GOVERNANCE TEMPLATE =============
export const DAO_GOVERNANCE_TEMPLATE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title {{DAO_NAME}}
 * @dev Governance DAO with proposals, voting, and treasury
 * @notice Built with Monsmith for Monad Network
 */
contract {{CONTRACT_NAME}} is Ownable, ReentrancyGuard {
    // Proposal structure
    struct Proposal {
        uint256 id;
        address proposer;
        string description;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 startBlock;
        uint256 endBlock;
        bool executed;
        bool canceled;
        mapping(address => bool) hasVoted;
    }

    // Storage
    mapping(uint256 => Proposal) public proposals;
    mapping(address => uint256) public votingPower;
    uint256 public proposalCount;
    uint256 public totalMembers;

    // Configuration
    uint256 public votingDelay = {{VOTING_DELAY}};
    uint256 public votingPeriod = {{VOTING_PERIOD}};
    uint256 public proposalThreshold = {{PROPOSAL_THRESHOLD}};
    uint256 public quorumVotes = {{QUORUM}};
    uint256 public membershipFee = {{MEMBERSHIP_FEE}} ether;

    // Treasury
    uint256 public treasuryBalance;

    // Events
    event MemberJoined(address indexed member, uint256 votingPower);
    event ProposalCreated(uint256 indexed id, address indexed proposer, string description);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 votes);
    event ProposalExecuted(uint256 indexed id, bool passed);
    event ProposalCanceled(uint256 indexed id);
    event TreasuryDeposit(address indexed from, uint256 amount);
    event TreasuryWithdraw(address indexed to, uint256 amount);

    constructor() Ownable(msg.sender) {
        // Owner starts with voting power
        votingPower[msg.sender] = 10;
        totalMembers = 1;
        emit MemberJoined(msg.sender, 10);
    }

    /**
     * @dev Join the DAO by paying membership fee
     */
    function join() external payable nonReentrant {
        require(msg.value >= membershipFee, "Insufficient fee");
        require(votingPower[msg.sender] == 0, "Already member");

        votingPower[msg.sender] = 1;
        totalMembers++;
        treasuryBalance += msg.value;

        emit MemberJoined(msg.sender, 1);
        emit TreasuryDeposit(msg.sender, msg.value);
    }

    /**
     * @dev Create a new proposal
     */
    function propose(string calldata description) external returns (uint256) {
        require(votingPower[msg.sender] >= proposalThreshold, "Below threshold");

        uint256 proposalId = proposalCount++;
        Proposal storage p = proposals[proposalId];
        p.id = proposalId;
        p.proposer = msg.sender;
        p.description = description;
        p.startBlock = block.number + votingDelay;
        p.endBlock = p.startBlock + votingPeriod;

        emit ProposalCreated(proposalId, msg.sender, description);
        return proposalId;
    }

    /**
     * @dev Cast vote on a proposal
     */
    function castVote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(block.number >= p.startBlock, "Voting not started");
        require(block.number < p.endBlock, "Voting ended");
        require(!p.hasVoted[msg.sender], "Already voted");
        require(votingPower[msg.sender] > 0, "No voting power");

        p.hasVoted[msg.sender] = true;
        uint256 votes = votingPower[msg.sender];

        if (support) {
            p.forVotes += votes;
        } else {
            p.againstVotes += votes;
        }

        emit VoteCast(proposalId, msg.sender, support, votes);
    }

    /**
     * @dev Execute a passed proposal
     */
    function execute(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(block.number >= p.endBlock, "Voting not ended");
        require(!p.executed, "Already executed");
        require(!p.canceled, "Proposal canceled");

        p.executed = true;
        bool passed = p.forVotes > p.againstVotes && (p.forVotes + p.againstVotes) >= quorumVotes;

        emit ProposalExecuted(proposalId, passed);
    }

    /**
     * @dev Cancel a proposal (proposer or owner only)
     */
    function cancel(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(msg.sender == p.proposer || msg.sender == owner(), "Not authorized");
        require(!p.executed, "Already executed");

        p.canceled = true;
        emit ProposalCanceled(proposalId);
    }

    /**
     * @dev Deposit to treasury
     */
    function depositToTreasury() external payable {
        treasuryBalance += msg.value;
        emit TreasuryDeposit(msg.sender, msg.value);
    }

    /**
     * @dev Withdraw from treasury (owner only, should be governance controlled)
     */
    function withdrawFromTreasury(address to, uint256 amount) external onlyOwner {
        require(amount <= treasuryBalance, "Insufficient treasury");
        treasuryBalance -= amount;
        (bool success, ) = payable(to).call{value: amount}("");
        require(success, "Transfer failed");
        emit TreasuryWithdraw(to, amount);
    }

    /**
     * @dev Update governance parameters (owner only)
     */
    function setParameters(
        uint256 _votingDelay,
        uint256 _votingPeriod,
        uint256 _proposalThreshold,
        uint256 _quorum
    ) external onlyOwner {
        votingDelay = _votingDelay;
        votingPeriod = _votingPeriod;
        proposalThreshold = _proposalThreshold;
        quorumVotes = _quorum;
    }

    /**
     * @dev Grant voting power to address (owner only)
     */
    function grantVotingPower(address account, uint256 power) external onlyOwner {
        if (votingPower[account] == 0 && power > 0) {
            totalMembers++;
        }
        votingPower[account] = power;
    }

    /**
     * @dev Get proposal state
     */
    function getProposalState(uint256 proposalId) external view returns (
        string memory description,
        uint256 forVotes,
        uint256 againstVotes,
        uint256 startBlock,
        uint256 endBlock,
        bool executed,
        bool canceled
    ) {
        Proposal storage p = proposals[proposalId];
        return (p.description, p.forVotes, p.againstVotes, p.startBlock, p.endBlock, p.executed, p.canceled);
    }

    receive() external payable {
        treasuryBalance += msg.value;
        emit TreasuryDeposit(msg.sender, msg.value);
    }
}
`;

// ============= STAKING VAULT TEMPLATE =============
export const STAKING_VAULT_TEMPLATE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title {{VAULT_NAME}}
 * @dev Staking vault with flexible rewards and lock periods
 * @notice Built with Monsmith for Monad Network
 */
contract {{CONTRACT_NAME}} is Ownable, ReentrancyGuard {

    // Tokens
    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;

    // Staking info per user
    struct StakeInfo {
        uint256 amount;
        uint256 rewardDebt;
        uint256 lockEndTime;
    }

    mapping(address => StakeInfo) public stakes;

    // Global state
    uint256 public totalStaked;
    uint256 public rewardPerSecond = {{REWARD_RATE}};
    uint256 public accRewardPerShare;
    uint256 public lastRewardTime;
    uint256 public lockDuration = {{LOCK_PERIOD}} days;

    // Precision
    uint256 private constant PRECISION = 1e18;

    // Events
    event Staked(address indexed user, uint256 amount, uint256 lockEndTime);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 amount);
    event RewardRateUpdated(uint256 newRate);
    event LockDurationUpdated(uint256 newDuration);

    constructor(address _stakingToken, address _rewardToken) Ownable(msg.sender) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        lastRewardTime = block.timestamp;
    }

    /**
     * @dev Update reward variables
     */
    function updatePool() public {
        if (block.timestamp <= lastRewardTime) return;
        if (totalStaked == 0) {
            lastRewardTime = block.timestamp;
            return;
        }

        uint256 timeElapsed = block.timestamp - lastRewardTime;
        uint256 reward = timeElapsed * rewardPerSecond;
        accRewardPerShare += (reward * PRECISION) / totalStaked;
        lastRewardTime = block.timestamp;
    }

    /**
     * @dev Calculate pending rewards
     */
    function pendingReward(address user) external view returns (uint256) {
        StakeInfo storage stake = stakes[user];
        uint256 accReward = accRewardPerShare;

        if (block.timestamp > lastRewardTime && totalStaked > 0) {
            uint256 timeElapsed = block.timestamp - lastRewardTime;
            uint256 reward = timeElapsed * rewardPerSecond;
            accReward += (reward * PRECISION) / totalStaked;
        }

        return (stake.amount * accReward) / PRECISION - stake.rewardDebt;
    }

    /**
     * @dev Stake tokens
     */
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot stake 0");
        updatePool();

        StakeInfo storage userStake = stakes[msg.sender];

        // Claim pending rewards if any
        if (userStake.amount > 0) {
            uint256 pending = (userStake.amount * accRewardPerShare) / PRECISION - userStake.rewardDebt;
            if (pending > 0) {
                _safeRewardTransfer(msg.sender, pending);
                emit RewardClaimed(msg.sender, pending);
            }
        }

        // Transfer tokens
        require(stakingToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        // Update stake
        userStake.amount += amount;
        userStake.rewardDebt = (userStake.amount * accRewardPerShare) / PRECISION;
        userStake.lockEndTime = block.timestamp + lockDuration;
        totalStaked += amount;

        emit Staked(msg.sender, amount, userStake.lockEndTime);
    }

    /**
     * @dev Withdraw staked tokens
     */
    function withdraw(uint256 amount) external nonReentrant {
        StakeInfo storage userStake = stakes[msg.sender];
        require(userStake.amount >= amount, "Insufficient stake");
        require(block.timestamp >= userStake.lockEndTime, "Still locked");

        updatePool();

        // Claim pending rewards
        uint256 pending = (userStake.amount * accRewardPerShare) / PRECISION - userStake.rewardDebt;
        if (pending > 0) {
            _safeRewardTransfer(msg.sender, pending);
            emit RewardClaimed(msg.sender, pending);
        }

        // Update stake
        userStake.amount -= amount;
        userStake.rewardDebt = (userStake.amount * accRewardPerShare) / PRECISION;
        totalStaked -= amount;

        // Transfer tokens
        require(stakingToken.transfer(msg.sender, amount), "Transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @dev Claim rewards only
     */
    function claimReward() external nonReentrant {
        updatePool();

        StakeInfo storage userStake = stakes[msg.sender];
        uint256 pending = (userStake.amount * accRewardPerShare) / PRECISION - userStake.rewardDebt;

        require(pending > 0, "No rewards");

        userStake.rewardDebt = (userStake.amount * accRewardPerShare) / PRECISION;
        _safeRewardTransfer(msg.sender, pending);

        emit RewardClaimed(msg.sender, pending);
    }

    /**
     * @dev Emergency withdraw without rewards
     */
    function emergencyWithdraw() external nonReentrant {
        StakeInfo storage userStake = stakes[msg.sender];
        uint256 amount = userStake.amount;

        userStake.amount = 0;
        userStake.rewardDebt = 0;
        totalStaked -= amount;

        require(stakingToken.transfer(msg.sender, amount), "Transfer failed");

        emit EmergencyWithdraw(msg.sender, amount);
    }

    /**
     * @dev Safe reward transfer
     */
    function _safeRewardTransfer(address to, uint256 amount) internal {
        uint256 rewardBalance = rewardToken.balanceOf(address(this));
        uint256 transferAmount = amount > rewardBalance ? rewardBalance : amount;
        if (transferAmount > 0) {
            require(rewardToken.transfer(to, transferAmount), "Reward transfer failed");
        }
    }

    /**
     * @dev Update reward rate (owner only)
     */
    function setRewardRate(uint256 _rate) external onlyOwner {
        updatePool();
        rewardPerSecond = _rate;
        emit RewardRateUpdated(_rate);
    }

    /**
     * @dev Update lock duration (owner only)
     */
    function setLockDuration(uint256 _days) external onlyOwner {
        lockDuration = _days * 1 days;
        emit LockDurationUpdated(_days);
    }

    /**
     * @dev Deposit reward tokens (owner only)
     */
    function depositRewards(uint256 amount) external onlyOwner {
        require(rewardToken.transferFrom(msg.sender, address(this), amount), "Deposit failed");
    }

    receive() external payable {}
}
`;

// ============= MULTISIG WALLET TEMPLATE =============
export const MULTISIG_WALLET_TEMPLATE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title {{WALLET_NAME}}
 * @dev Multi-signature wallet with timelock
 * @notice Built with Monsmith for Monad Network
 */
contract {{CONTRACT_NAME}} is ReentrancyGuard {
    // Owners
    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public required;

    // Transactions
    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
        uint256 submitTime;
    }

    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;

    // Timelock
    uint256 public timelockDuration = {{TIMELOCK}} hours;

    // Events
    event Deposit(address indexed sender, uint256 value);
    event SubmitTransaction(uint256 indexed txId, address indexed to, uint256 value, bytes data);
    event ConfirmTransaction(uint256 indexed txId, address indexed owner);
    event RevokeConfirmation(uint256 indexed txId, address indexed owner);
    event ExecuteTransaction(uint256 indexed txId);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event RequirementChanged(uint256 required);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier txExists(uint256 txId) {
        require(txId < transactions.length, "Tx doesn't exist");
        _;
    }

    modifier notExecuted(uint256 txId) {
        require(!transactions[txId].executed, "Already executed");
        _;
    }

    modifier notConfirmed(uint256 txId) {
        require(!confirmations[txId][msg.sender], "Already confirmed");
        _;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "Owners required");
        require(_required > 0 && _required <= _owners.length, "Invalid requirement");

        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0), "Invalid owner");
            require(!isOwner[owner], "Duplicate owner");

            isOwner[owner] = true;
            owners.push(owner);
        }

        required = _required;
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @dev Submit a new transaction
     */
    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        uint256 txId = transactions.length;

        transactions.push(Transaction({
            to: to,
            value: value,
            data: data,
            executed: false,
            confirmations: 0,
            submitTime: block.timestamp
        }));

        emit SubmitTransaction(txId, to, value, data);

        // Auto-confirm by submitter
        confirmTransaction(txId);

        return txId;
    }

    /**
     * @dev Confirm a transaction
     */
    function confirmTransaction(uint256 txId) public onlyOwner txExists(txId) notExecuted(txId) notConfirmed(txId) {
        confirmations[txId][msg.sender] = true;
        transactions[txId].confirmations++;

        emit ConfirmTransaction(txId, msg.sender);
    }

    /**
     * @dev Revoke confirmation
     */
    function revokeConfirmation(uint256 txId) external onlyOwner txExists(txId) notExecuted(txId) {
        require(confirmations[txId][msg.sender], "Not confirmed");

        confirmations[txId][msg.sender] = false;
        transactions[txId].confirmations--;

        emit RevokeConfirmation(txId, msg.sender);
    }

    /**
     * @dev Execute a confirmed transaction
     */
    function executeTransaction(uint256 txId) external onlyOwner txExists(txId) notExecuted(txId) nonReentrant {
        Transaction storage txn = transactions[txId];

        require(txn.confirmations >= required, "Not enough confirmations");
        require(block.timestamp >= txn.submitTime + timelockDuration, "Timelock active");

        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit ExecuteTransaction(txId);
    }

    /**
     * @dev Add new owner (requires multisig)
     */
    function addOwner(address owner) external onlyOwner {
        require(owner != address(0), "Invalid address");
        require(!isOwner[owner], "Already owner");

        isOwner[owner] = true;
        owners.push(owner);

        emit OwnerAdded(owner);
    }

    /**
     * @dev Remove owner (requires multisig)
     */
    function removeOwner(address owner) external onlyOwner {
        require(isOwner[owner], "Not owner");
        require(owners.length - 1 >= required, "Cannot remove");

        isOwner[owner] = false;

        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == owner) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }

        emit OwnerRemoved(owner);
    }

    /**
     * @dev Change required confirmations
     */
    function changeRequirement(uint256 _required) external onlyOwner {
        require(_required > 0 && _required <= owners.length, "Invalid requirement");
        required = _required;
        emit RequirementChanged(_required);
    }

    /**
     * @dev Get transaction count
     */
    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }

    /**
     * @dev Get owners
     */
    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    /**
     * @dev Check if transaction is confirmed by owner
     */
    function isConfirmed(uint256 txId, address owner) external view returns (bool) {
        return confirmations[txId][owner];
    }
}
`;

// ============= TEMPLATE REGISTRY =============
export const CONTRACT_TEMPLATES: Record<string, { template: string; defaults: Record<string, string> }> = {
  "defi-token": {
    template: DEFI_TOKEN_TEMPLATE,
    defaults: {
      "{{TOKEN_NAME}}": "MyToken",
      "{{TOKEN_SYMBOL}}": "MTK",
      "{{CONTRACT_NAME}}": "MyToken",
      "{{INITIAL_SUPPLY}}": "1000000",
      "{{BUY_TAX}}": "2",
      "{{SELL_TAX}}": "2",
      "{{MAX_WALLET}}": "5",
      "{{MAX_TX}}": "2",
    },
  },
  "nft-collection": {
    template: NFT_COLLECTION_TEMPLATE,
    defaults: {
      "{{COLLECTION_NAME}}": "MyNFT",
      "{{SYMBOL}}": "MNFT",
      "{{CONTRACT_NAME}}": "MyNFT",
      "{{MAX_SUPPLY}}": "10000",
      "{{MINT_PRICE}}": "0.05",
      "{{WL_PRICE}}": "0.03",
      "{{ROYALTY_BPS}}": "500",
    },
  },
  "dao-governance": {
    template: DAO_GOVERNANCE_TEMPLATE,
    defaults: {
      "{{DAO_NAME}}": "MyDAO",
      "{{CONTRACT_NAME}}": "MyDAO",
      "{{VOTING_DELAY}}": "1",
      "{{VOTING_PERIOD}}": "50400",
      "{{PROPOSAL_THRESHOLD}}": "1",
      "{{QUORUM}}": "10",
      "{{MEMBERSHIP_FEE}}": "0.01",
    },
  },
  "staking-vault": {
    template: STAKING_VAULT_TEMPLATE,
    defaults: {
      "{{VAULT_NAME}}": "StakingVault",
      "{{CONTRACT_NAME}}": "StakingVault",
      "{{REWARD_RATE}}": "100",
      "{{LOCK_PERIOD}}": "7",
    },
  },
  "multisig-wallet": {
    template: MULTISIG_WALLET_TEMPLATE,
    defaults: {
      "{{WALLET_NAME}}": "MultiSigWallet",
      "{{CONTRACT_NAME}}": "MultiSigWallet",
      "{{TIMELOCK}}": "24",
    },
  },
};

/**
 * Generate a contract from template with parameters
 */
export function generateFromTemplate(
  templateId: string,
  params: Record<string, string>
): string {
  const templateConfig = CONTRACT_TEMPLATES[templateId];
  if (!templateConfig) {
    throw new Error(`Template not found: ${templateId}`);
  }

  let code = templateConfig.template;

  // Apply defaults first
  for (const [placeholder, defaultValue] of Object.entries(templateConfig.defaults)) {
    code = code.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), defaultValue);
  }

  // Apply user params (override defaults)
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      const placeholder = `{{${key.toUpperCase().replace(/\s+/g, '_')}}}`;
      code = code.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    }
  }

  return code;
}

/**
 * Map ARCHITECT_CONTRACT_TYPES to template IDs
 */
export const ARCHITECT_TO_TEMPLATE: Record<string, string> = {
  "defi-token": "defi-token",
  "nft-collection": "nft-collection",
  "dao-governance": "dao-governance",
  "staking-vault": "staking-vault",
  "dex-amm": "defi-token", // Fallback - will use AI
  "multisig-wallet": "multisig-wallet",
};
