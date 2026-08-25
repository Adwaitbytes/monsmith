# pymon_service/compiler.py
# Python Contract Compiler for Monsmith
# Compiles Python contracts to EVM bytecode via Solidity transpilation

import json
import os
import subprocess
import tempfile
from typing import Dict, Any, Optional
from pathlib import Path

from .transpiler import PyMonTranspiler, transpile_python_contract


class PyMonCompiler:
    """
    Compiler for Python smart contracts.
    Transpiles Python -> Solidity -> EVM Bytecode
    """

    def __init__(self, solc_path: Optional[str] = None):
        self.transpiler = PyMonTranspiler()
        self.solc_path = solc_path or "solc"
        self._solc_available = None

    def check_solc(self) -> bool:
        """Check if solc is available"""
        if self._solc_available is not None:
            return self._solc_available

        try:
            result = subprocess.run(
                [self.solc_path, "--version"],
                capture_output=True,
                text=True,
                timeout=10
            )
            self._solc_available = result.returncode == 0
        except Exception:
            self._solc_available = False

        return self._solc_available

    def compile(self, source_code: str, optimize: bool = True) -> Dict[str, Any]:
        """
        Compile Python contract to EVM bytecode.

        Args:
            source_code: Python contract source code
            optimize: Enable Solidity optimizer

        Returns:
            Compilation result with bytecode and ABI
        """
        # Step 1: Transpile Python to Solidity
        transpile_result = self.transpiler.transpile(source_code)

        if not transpile_result.get("success"):
            return {
                "success": False,
                "stage": "transpilation",
                "error": transpile_result.get("error", "Transpilation failed"),
                "details": transpile_result
            }

        primary = transpile_result.get("primaryContract")
        if not primary:
            return {
                "success": False,
                "stage": "transpilation",
                "error": "No contract found in source code"
            }

        solidity_code = primary.get("solidity", "")
        contract_name = primary.get("contractName", "GenContract")

        # Step 2: Compile Solidity to bytecode
        compile_result = self._compile_solidity(solidity_code, contract_name, optimize)

        if not compile_result.get("success"):
            return {
                "success": False,
                "stage": "compilation",
                "error": compile_result.get("error"),
                "solidityCode": solidity_code,
                "details": compile_result
            }

        # Combine results
        return {
            "success": True,
            "contractName": contract_name,
            "abi": compile_result.get("abi", primary.get("abi", [])),
            "bytecode": compile_result.get("bytecode", ""),
            "deployedBytecode": compile_result.get("deployedBytecode", ""),
            "solidityCode": solidity_code,
            "gasEstimate": compile_result.get("gasEstimate"),
            "metadata": {
                "compiler": "pymon",
                "solcVersion": compile_result.get("solcVersion", "0.8.20"),
                "optimized": optimize,
                "stateVariables": primary.get("stateVariables", []),
                "functions": primary.get("functions", [])
            }
        }

    def _compile_solidity(self, solidity_code: str, contract_name: str, optimize: bool) -> Dict[str, Any]:
        """Compile Solidity code using solc or solc-js"""

        # Try using solcjs via node
        try:
            return self._compile_with_solcjs(solidity_code, contract_name, optimize)
        except Exception as e:
            print(f"solcjs compilation failed: {e}")

        # Fallback: Try native solc
        if self.check_solc():
            try:
                return self._compile_with_solc(solidity_code, contract_name, optimize)
            except Exception as e:
                return {
                    "success": False,
                    "error": f"Solc compilation failed: {str(e)}"
                }

        # If no compiler available, return transpiled ABI only
        return {
            "success": True,
            "bytecode": "",
            "abi": [],
            "warning": "No Solidity compiler available. ABI generated from Python analysis.",
            "requiresExternalCompilation": True
        }

    def _compile_with_solcjs(self, solidity_code: str, contract_name: str, optimize: bool) -> Dict[str, Any]:
        """Compile using solc-js"""

        # Create input JSON for solc
        input_json = {
            "language": "Solidity",
            "sources": {
                f"{contract_name}.sol": {
                    "content": solidity_code
                }
            },
            "settings": {
                "outputSelection": {
                    "*": {
                        "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "evm.gasEstimates"]
                    }
                },
                "optimizer": {
                    "enabled": optimize,
                    "runs": 200
                }
            }
        }

        # Write to temp file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(input_json, f)
            input_file = f.name

        try:
            # Run solcjs
            result = subprocess.run(
                ["npx", "solc", "--standard-json"],
                input=json.dumps(input_json),
                capture_output=True,
                text=True,
                timeout=60
            )

            if result.returncode != 0 and not result.stdout:
                raise Exception(f"solcjs failed: {result.stderr}")

            output = json.loads(result.stdout)

            # Check for errors
            if "errors" in output:
                errors = [e for e in output["errors"] if e.get("severity") == "error"]
                if errors:
                    return {
                        "success": False,
                        "error": errors[0].get("formattedMessage", "Compilation error"),
                        "errors": errors
                    }

            # Extract contract output
            contracts = output.get("contracts", {})
            contract_file = f"{contract_name}.sol"

            if contract_file not in contracts:
                # Try to find the contract
                for file_name, file_contracts in contracts.items():
                    if contract_name in file_contracts:
                        contract_output = file_contracts[contract_name]
                        break
                else:
                    return {
                        "success": False,
                        "error": f"Contract {contract_name} not found in compilation output"
                    }
            else:
                contract_output = contracts[contract_file].get(contract_name, {})

            evm = contract_output.get("evm", {})
            bytecode = evm.get("bytecode", {}).get("object", "")
            deployed_bytecode = evm.get("deployedBytecode", {}).get("object", "")

            return {
                "success": True,
                "abi": contract_output.get("abi", []),
                "bytecode": "0x" + bytecode if bytecode and not bytecode.startswith("0x") else bytecode,
                "deployedBytecode": "0x" + deployed_bytecode if deployed_bytecode else "",
                "gasEstimate": evm.get("gasEstimates"),
                "solcVersion": "0.8.20"
            }

        finally:
            os.unlink(input_file)

    def _compile_with_solc(self, solidity_code: str, contract_name: str, optimize: bool) -> Dict[str, Any]:
        """Compile using native solc"""

        with tempfile.NamedTemporaryFile(mode='w', suffix='.sol', delete=False) as f:
            f.write(solidity_code)
            sol_file = f.name

        try:
            cmd = [
                self.solc_path,
                "--combined-json", "abi,bin,bin-runtime",
                "--optimize" if optimize else "",
                sol_file
            ]
            cmd = [c for c in cmd if c]  # Remove empty strings

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60
            )

            if result.returncode != 0:
                return {
                    "success": False,
                    "error": result.stderr or "Compilation failed"
                }

            output = json.loads(result.stdout)
            contracts = output.get("contracts", {})

            # Find our contract
            for key, data in contracts.items():
                if contract_name in key:
                    return {
                        "success": True,
                        "abi": json.loads(data.get("abi", "[]")),
                        "bytecode": "0x" + data.get("bin", ""),
                        "deployedBytecode": "0x" + data.get("bin-runtime", "")
                    }

            return {
                "success": False,
                "error": f"Contract {contract_name} not found in output"
            }

        finally:
            os.unlink(sol_file)


# ============= CONVENIENCE FUNCTIONS =============

def compile_python_contract(source_code: str, optimize: bool = True) -> Dict[str, Any]:
    """
    Compile a Python smart contract to EVM bytecode.

    Args:
        source_code: Python contract source code
        optimize: Enable optimizer

    Returns:
        Compilation result with bytecode and ABI
    """
    compiler = PyMonCompiler()
    return compiler.compile(source_code, optimize)


def get_solidity_from_python(source_code: str) -> Dict[str, Any]:
    """
    Transpile Python to Solidity without compilation.

    Args:
        source_code: Python contract source code

    Returns:
        Transpilation result with Solidity code
    """
    transpiler = PyMonTranspiler()
    result = transpiler.transpile(source_code)

    if result.get("success") and result.get("primaryContract"):
        return {
            "success": True,
            "solidity": result["primaryContract"]["solidity"],
            "contractName": result["primaryContract"]["contractName"],
            "abi": result["primaryContract"]["abi"]
        }

    return result
