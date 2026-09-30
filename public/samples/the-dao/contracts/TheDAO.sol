// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The DAO (2016), its vulnerable core rebuilt in modern Solidity.
/// The original lost about 3.6M ETH to the bug in splitDAO below.
contract TheDAO {
    string public constant name = "The DAO";

    mapping(address => uint256) public balances;
    mapping(address => uint256) public paidOut;
    uint256 public totalSupply;
    uint256 public totalRewards;
    address public curator;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Split(address indexed member, uint256 amount);

    constructor() {
        curator = msg.sender;
    }

    /// Buy DAO tokens one to one with ether during the creation phase.
    function createTokenProxy(address tokenHolder) external payable returns (bool) {
        require(msg.value > 0, "no ether sent");
        balances[tokenHolder] += msg.value;
        totalSupply += msg.value;
        emit Transfer(address(0), tokenHolder, msg.value);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balances[msg.sender] >= amount, "balance too low");
        balances[msg.sender] -= amount;
        balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    /// Profit paid into the DAO, shared across token holders.
    function receiveReward() external payable {
        totalRewards += msg.value;
    }

    /// Leave the DAO and take your share of the ether with you.
    function splitDAO() external returns (bool) {
        uint256 share = balances[msg.sender];
        require(share > 0, "nothing to split");

        // Pay out rewards and the member's ether first...
        withdrawRewardFor(msg.sender);
        require(payOut(msg.sender, share), "payout failed");
        emit Split(msg.sender, share);

        // ...and only then burn their tokens. A recipient contract that calls
        // splitDAO again from its fallback is paid again, every time.
        totalSupply -= balances[msg.sender];
        balances[msg.sender] = 0;
        return true;
    }

    function withdrawRewardFor(address account) internal {
        if (totalSupply == 0) return;
        uint256 owed = (balances[account] * totalRewards) / totalSupply;
        if (owed <= paidOut[account]) return;
        uint256 reward = owed - paidOut[account];
        require(payOut(account, reward), "reward payout failed");
        paidOut[account] += reward;
    }

    function payOut(address recipient, uint256 amount) internal returns (bool) {
        (bool ok, ) = recipient.call{value: amount}("");
        return ok;
    }

    /// The curator could change who controlled the DAO, checked by tx.origin.
    function changeCurator(address newCurator) external {
        require(tx.origin == curator, "only the curator");
        curator = newCurator;
    }
}
