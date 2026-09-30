/**
 * The contract behind "Check a sample contract".
 *
 * A first visitor has no code to hand and should not need any to see what the
 * product does, so this is one click from the start screen and the report runs
 * on it straight away. It is small enough to read in the editor while the
 * report fills in, and it carries real, well-known mistakes (an external call
 * before the balance update, a tx.origin check, an unbounded loop over a
 * growing array) so the report has something true to say rather than a clean
 * bill of health that proves nothing.
 */

export const SAMPLE_PATH = "contracts/SampleVault.sol";

export const SAMPLE_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// A small savings vault. It compiles, it works, and it has bugs in it.
contract SampleVault {
    address public owner;
    mapping(address => uint256) public balances;
    address[] public depositors;
    uint256 public feeBps = 50;

    event Deposited(address indexed who, uint256 amount);
    event Withdrawn(address indexed who, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    function deposit() external payable {
        require(msg.value > 0, "nothing sent");
        if (balances[msg.sender] == 0) depositors.push(msg.sender);
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "not enough");
        uint256 fee = (amount * feeBps) / 10_000;
        (bool ok, ) = msg.sender.call{value: amount - fee}("");
        require(ok, "transfer failed");
        balances[msg.sender] -= amount;
        balances[owner] += fee;
        emit Withdrawn(msg.sender, amount);
    }

    function setFee(uint256 newFeeBps) external {
        require(tx.origin == owner, "not owner");
        feeBps = newFeeBps;
    }

    function totalDeposits() external view returns (uint256 total) {
        for (uint256 i = 0; i < depositors.length; i++) {
            total += balances[depositors[i]];
        }
    }

    function sweep(address payable to) external {
        require(msg.sender == owner, "not owner");
        to.transfer(address(this).balance);
    }
}
`;
