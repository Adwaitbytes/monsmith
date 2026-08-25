// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GenContract
 * @notice Reference ERC20 shipped with Monsmith. Doubles as the test token for
 *         the DEX suite, so it stays mintable, burnable and pausable.
 * @dev Deployed with no constructor arguments so the studio's one-click deploy
 *      flow can broadcast the bytecode without prompting for parameters.
 */
contract GenContract is ERC20, ERC20Burnable, ERC20Pausable, Ownable {
    uint256 public constant INITIAL_SUPPLY = 100_000_000 ether;

    error NoBalanceToWithdraw();
    error WithdrawFailed();

    event MONWithdrawn(address indexed to, uint256 amount);

    constructor() ERC20("GenesisToken", "GNT") Ownable(msg.sender) {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /// @notice Mints new tokens to `to`. Restricted to the owner.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Halts all transfers. Restricted to the owner.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes transfers. Restricted to the owner.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Sweeps any MON sent to the contract to the owner.
    function withdrawMON() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NoBalanceToWithdraw();

        (bool sent, ) = payable(owner()).call{value: balance}("");
        if (!sent) revert WithdrawFailed();

        emit MONWithdrawn(owner(), balance);
    }

    receive() external payable {}

    // ERC20 and ERC20Pausable both hook _update; Solidity requires an explicit resolution.
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable)
    {
        super._update(from, to, value);
    }
}
