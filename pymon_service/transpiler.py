# pymon_service/transpiler.py
# Python to Solidity/EVM Transpiler for Monsmith

import ast
import re
import hashlib
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, field

# ============= TYPE MAPPINGS =============

PYTHON_TO_SOLIDITY_TYPES = {
    "int": "uint256",
    "float": "uint256",  # Scaled by 10^18
    "str": "string",
    "bool": "bool",
    "bytes": "bytes",
    "list": "array",
    "dict": "mapping",
    "address": "address",
    "uint256": "uint256",
    "uint128": "uint128",
    "uint64": "uint64",
    "uint32": "uint32",
    "uint8": "uint8",
    "int256": "int256",
    "bytes32": "bytes32",
}

# ============= DATA STRUCTURES =============

@dataclass
class StateVariable:
    name: str
    var_type: str
    initial_value: Any
    slot: int
    is_mapping: bool = False
    key_type: str = ""
    value_type: str = ""


@dataclass
class FunctionDef:
    name: str
    params: List[Tuple[str, str]]  # (name, type)
    return_type: str
    is_public: bool
    is_view: bool
    is_payable: bool
    body: str
    selector: str = ""


@dataclass
class EventDef:
    name: str
    params: List[Tuple[str, str, bool]]  # (name, type, indexed)


@dataclass
class ContractAnalysis:
    name: str
    state_vars: List[StateVariable] = field(default_factory=list)
    functions: List[FunctionDef] = field(default_factory=list)
    events: List[EventDef] = field(default_factory=list)
    constructor_body: str = ""
    inherits: List[str] = field(default_factory=list)


# ============= AST ANALYZER =============

class PythonContractAnalyzer(ast.NodeVisitor):
    """Analyze Python AST to extract contract structure"""

    def __init__(self):
        self.contracts: List[ContractAnalysis] = []
        self.current_contract: Optional[ContractAnalysis] = None
        self.slot_counter = 0

    def analyze(self, source_code: str) -> List[ContractAnalysis]:
        """Analyze Python source code"""
        tree = ast.parse(source_code)
        self.visit(tree)
        return self.contracts

    def visit_ClassDef(self, node: ast.ClassDef):
        """Visit class definition (contract)"""
        # Check if it inherits from PySmartContract
        is_contract = False
        inherits = []
        for base in node.bases:
            if isinstance(base, ast.Name):
                if base.id == "PySmartContract":
                    is_contract = True
                inherits.append(base.id)
            elif isinstance(base, ast.Attribute):
                if base.attr == "PySmartContract":
                    is_contract = True
                inherits.append(base.attr)

        if not is_contract:
            return

        self.current_contract = ContractAnalysis(
            name=node.name,
            inherits=inherits
        )
        self.slot_counter = 0

        # Visit all class members
        for item in node.body:
            if isinstance(item, ast.FunctionDef):
                self._visit_function(item)

        self.contracts.append(self.current_contract)
        self.current_contract = None

    def _visit_function(self, node: ast.FunctionDef):
        """Visit function definition"""
        if not self.current_contract:
            return

        func_name = node.name

        # Check for constructor
        if func_name == "__init__":
            self._analyze_constructor(node)
            return

        # Check decorators
        is_public = False
        is_view = False
        is_payable = False

        for decorator in node.decorator_list:
            if isinstance(decorator, ast.Name):
                if decorator.id == "public_function":
                    is_public = True
                elif decorator.id == "view_function":
                    is_public = True
                    is_view = True
                elif decorator.id == "payable_function":
                    is_public = True
                    is_payable = True
                elif decorator.id == "internal_function":
                    is_public = False

        # Parse parameters (skip self)
        params = []
        for arg in node.args.args[1:]:  # Skip 'self'
            param_name = arg.arg
            param_type = "uint256"  # Default type

            if arg.annotation:
                param_type = self._get_type_from_annotation(arg.annotation)

            params.append((param_name, param_type))

        # Parse return type
        return_type = ""
        if node.returns:
            return_type = self._get_type_from_annotation(node.returns)

        # Generate function selector
        param_types = ",".join([p[1] for p in params])
        signature = f"{func_name}({param_types})"
        selector = self._compute_selector(signature)

        # Convert body to Solidity
        body = self._convert_function_body(node)

        func_def = FunctionDef(
            name=func_name,
            params=params,
            return_type=return_type,
            is_public=is_public,
            is_view=is_view,
            is_payable=is_payable,
            body=body,
            selector=selector
        )

        self.current_contract.functions.append(func_def)

    def _analyze_constructor(self, node: ast.FunctionDef):
        """Analyze constructor to extract state variables"""
        for stmt in node.body:
            # Look for self.x = self.state_var(...) patterns
            if isinstance(stmt, ast.Assign):
                for target in stmt.targets:
                    if isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name):
                        if target.value.id == "self":
                            var_name = target.attr
                            self._extract_state_var(var_name, stmt.value)

            # Look for self.x = self.mapping(...) patterns
            elif isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call):
                pass  # Already handled in Assign

        # Convert constructor body
        self.current_contract.constructor_body = self._convert_constructor_body(node)

    def _extract_state_var(self, name: str, value: ast.expr):
        """Extract state variable from AST"""
        if isinstance(value, ast.Call):
            if isinstance(value.func, ast.Attribute):
                func_name = value.func.attr

                if func_name == "state_var":
                    # self.state_var(name, initial_value, type)
                    var_type = "uint256"
                    initial = None

                    if len(value.args) >= 3:
                        type_arg = value.args[2]
                        if isinstance(type_arg, ast.Constant):
                            var_type = str(type_arg.value)

                    if len(value.args) >= 2:
                        initial = self._ast_to_value(value.args[1])

                    self.current_contract.state_vars.append(StateVariable(
                        name=name,
                        var_type=var_type,
                        initial_value=initial,
                        slot=self.slot_counter
                    ))
                    self.slot_counter += 1

                elif func_name == "mapping":
                    # self.mapping(name, key_type, value_type)
                    key_type = "address"
                    value_type = "uint256"

                    if len(value.args) >= 2:
                        if isinstance(value.args[1], ast.Constant):
                            key_type = str(value.args[1].value)
                    if len(value.args) >= 3:
                        if isinstance(value.args[2], ast.Constant):
                            value_type = str(value.args[2].value)

                    self.current_contract.state_vars.append(StateVariable(
                        name=name,
                        var_type=f"mapping({key_type} => {value_type})",
                        initial_value=None,
                        slot=self.slot_counter,
                        is_mapping=True,
                        key_type=key_type,
                        value_type=value_type
                    ))
                    self.slot_counter += 1

    def _get_type_from_annotation(self, annotation: ast.expr) -> str:
        """Convert Python type annotation to Solidity type"""
        if isinstance(annotation, ast.Name):
            py_type = annotation.id
            return PYTHON_TO_SOLIDITY_TYPES.get(py_type, py_type)
        elif isinstance(annotation, ast.Constant):
            return str(annotation.value)
        return "uint256"

    def _compute_selector(self, signature: str) -> str:
        """Compute 4-byte function selector"""
        # Use keccak256 (sha3)
        h = hashlib.sha3_256(signature.encode()).hexdigest()
        return "0x" + h[:8]

    def _ast_to_value(self, node: ast.expr) -> Any:
        """Convert AST node to Python value"""
        if isinstance(node, ast.Constant):
            return node.value
        elif isinstance(node, ast.Num):
            return node.n
        elif isinstance(node, ast.Str):
            return node.s
        elif isinstance(node, ast.Call):
            # Handle self.msg_sender() etc
            if isinstance(node.func, ast.Attribute):
                return f"self.{node.func.attr}()"
        return None

    def _convert_function_body(self, node: ast.FunctionDef) -> str:
        """Convert Python function body to Solidity-like code"""
        lines = []
        for stmt in node.body:
            converted = self._convert_statement(stmt)
            if converted:
                lines.append(converted)
        return "\n        ".join(lines)

    def _convert_constructor_body(self, node: ast.FunctionDef) -> str:
        """Convert constructor body, skipping state_var declarations"""
        lines = []
        for stmt in node.body:
            # Skip state_var and mapping declarations
            if isinstance(stmt, ast.Assign):
                if isinstance(stmt.value, ast.Call):
                    if isinstance(stmt.value.func, ast.Attribute):
                        if stmt.value.func.attr in ["state_var", "mapping"]:
                            continue
            # Skip super().__init__()
            if isinstance(stmt, ast.Expr):
                if isinstance(stmt.value, ast.Call):
                    if isinstance(stmt.value.func, ast.Attribute):
                        if stmt.value.func.attr == "__init__":
                            continue

            converted = self._convert_statement(stmt)
            if converted:
                lines.append(converted)
        return "\n        ".join(lines)

    def _convert_statement(self, stmt: ast.stmt) -> str:
        """Convert a single Python statement to Solidity"""
        if isinstance(stmt, ast.Expr):
            return self._convert_expr(stmt.value) + ";"

        elif isinstance(stmt, ast.Assign):
            targets = [self._convert_expr(t) for t in stmt.targets]
            value = self._convert_expr(stmt.value)
            return f"{targets[0]} = {value};"

        elif isinstance(stmt, ast.Return):
            if stmt.value:
                return f"return {self._convert_expr(stmt.value)};"
            return "return;"

        elif isinstance(stmt, ast.If):
            cond = self._convert_expr(stmt.test)
            body = self._convert_statement(stmt.body[0]) if stmt.body else ""
            return f"if ({cond}) {{ {body} }}"

        return ""

    def _convert_expr(self, expr: ast.expr) -> str:
        """Convert Python expression to Solidity"""
        if isinstance(expr, ast.Constant):
            if isinstance(expr.value, str):
                return f'"{expr.value}"'
            return str(expr.value)

        elif isinstance(expr, ast.Name):
            return expr.id

        elif isinstance(expr, ast.Attribute):
            if isinstance(expr.value, ast.Name) and expr.value.id == "self":
                return expr.attr
            return f"{self._convert_expr(expr.value)}.{expr.attr}"

        elif isinstance(expr, ast.Call):
            func = self._convert_expr(expr.func)
            args = ", ".join([self._convert_expr(a) for a in expr.args])

            # Handle special methods
            if func == "self.msg_sender":
                return "msg.sender"
            elif func == "self.msg_value":
                return "msg.value"
            elif func == "self.block_timestamp":
                return "block.timestamp"
            elif func == "self.require":
                return f"require({args})"
            elif func == "self.event":
                return f"emit {args}"
            elif func == "self.get_state":
                # self.get_state("name") -> name
                if expr.args and isinstance(expr.args[0], ast.Constant):
                    return expr.args[0].value
            elif func == "self.set_state":
                # self.set_state("name", value) -> name = value
                if len(expr.args) >= 2:
                    var_name = expr.args[0].value if isinstance(expr.args[0], ast.Constant) else ""
                    value = self._convert_expr(expr.args[1])
                    return f"{var_name} = {value}"

            return f"{func}({args})"

        elif isinstance(expr, ast.BinOp):
            left = self._convert_expr(expr.left)
            right = self._convert_expr(expr.right)
            op = self._get_binop(expr.op)
            return f"({left} {op} {right})"

        elif isinstance(expr, ast.Compare):
            left = self._convert_expr(expr.left)
            right = self._convert_expr(expr.comparators[0])
            op = self._get_cmpop(expr.ops[0])
            return f"{left} {op} {right}"

        elif isinstance(expr, ast.Subscript):
            value = self._convert_expr(expr.value)
            slice_val = self._convert_expr(expr.slice)
            return f"{value}[{slice_val}]"

        return str(expr)

    def _get_binop(self, op: ast.operator) -> str:
        """Get binary operator string"""
        ops = {
            ast.Add: "+",
            ast.Sub: "-",
            ast.Mult: "*",
            ast.Div: "/",
            ast.Mod: "%",
            ast.Pow: "**",
            ast.BitAnd: "&",
            ast.BitOr: "|",
            ast.BitXor: "^",
        }
        return ops.get(type(op), "+")

    def _get_cmpop(self, op: ast.cmpop) -> str:
        """Get comparison operator string"""
        ops = {
            ast.Eq: "==",
            ast.NotEq: "!=",
            ast.Lt: "<",
            ast.LtE: "<=",
            ast.Gt: ">",
            ast.GtE: ">=",
        }
        return ops.get(type(op), "==")


# ============= SOLIDITY CODE GENERATOR =============

class SolidityGenerator:
    """Generate Solidity code from contract analysis"""

    def generate(self, contract: ContractAnalysis) -> str:
        """Generate complete Solidity contract"""
        lines = []

        # Header
        lines.append("// SPDX-License-Identifier: MIT")
        lines.append("// Generated by PyMon Transpiler for Monsmith")
        lines.append("pragma solidity ^0.8.20;")
        lines.append("")

        # Contract definition
        lines.append(f"contract {contract.name} {{")

        # State variables
        for var in contract.state_vars:
            if var.is_mapping:
                lines.append(f"    {var.var_type} public {var.name};")
            else:
                if var.initial_value is not None:
                    lines.append(f"    {var.var_type} public {var.name} = {self._format_value(var.initial_value, var.var_type)};")
                else:
                    lines.append(f"    {var.var_type} public {var.name};")

        lines.append("")

        # Events
        for func in contract.functions:
            # Extract events from function bodies
            pass

        # Constructor
        if contract.constructor_body:
            lines.append("    constructor() {")
            lines.append(f"        {contract.constructor_body}")
            lines.append("    }")
            lines.append("")

        # Functions
        for func in contract.functions:
            visibility = "public" if func.is_public else "internal"
            modifiers = []
            if func.is_view:
                modifiers.append("view")
            if func.is_payable:
                modifiers.append("payable")

            params = ", ".join([f"{t} {n}" for n, t in func.params])
            returns = f" returns ({func.return_type})" if func.return_type else ""
            mods = " " + " ".join(modifiers) if modifiers else ""

            lines.append(f"    function {func.name}({params}) {visibility}{mods}{returns} {{")
            if func.body:
                lines.append(f"        {func.body}")
            lines.append("    }")
            lines.append("")

        # Receive function for payable contracts
        has_payable = any(f.is_payable for f in contract.functions)
        if has_payable:
            lines.append("    receive() external payable {}")

        lines.append("}")

        return "\n".join(lines)

    def _format_value(self, value: Any, var_type: str) -> str:
        """Format value for Solidity"""
        if value is None:
            return "0"
        if isinstance(value, str):
            if value.startswith("self."):
                # Handle msg.sender, etc.
                if value == "self.msg_sender()":
                    return "msg.sender"
                return value.replace("self.", "")
            if value.startswith("0x"):
                return value
            return f'"{value}"'
        if isinstance(value, bool):
            return "true" if value else "false"
        return str(value)


# ============= ABI GENERATOR =============

class ABIGenerator:
    """Generate ABI from contract analysis"""

    def generate(self, contract: ContractAnalysis) -> List[Dict]:
        """Generate ABI JSON"""
        abi = []

        # Constructor
        abi.append({
            "type": "constructor",
            "inputs": [],
            "stateMutability": "nonpayable"
        })

        # Functions
        for func in contract.functions:
            if not func.is_public:
                continue

            func_abi = {
                "type": "function",
                "name": func.name,
                "inputs": [
                    {"name": name, "type": self._to_abi_type(typ)}
                    for name, typ in func.params
                ],
                "outputs": [],
                "stateMutability": self._get_state_mutability(func)
            }

            if func.return_type:
                func_abi["outputs"] = [{"name": "", "type": self._to_abi_type(func.return_type)}]

            abi.append(func_abi)

        # State variable getters
        for var in contract.state_vars:
            if not var.is_mapping:
                abi.append({
                    "type": "function",
                    "name": var.name,
                    "inputs": [],
                    "outputs": [{"name": "", "type": self._to_abi_type(var.var_type)}],
                    "stateMutability": "view"
                })

        # Receive function
        has_payable = any(f.is_payable for f in contract.functions)
        if has_payable:
            abi.append({
                "type": "receive",
                "stateMutability": "payable"
            })

        return abi

    def _to_abi_type(self, py_type: str) -> str:
        """Convert to ABI type"""
        if py_type.startswith("mapping"):
            return py_type
        return PYTHON_TO_SOLIDITY_TYPES.get(py_type, py_type)

    def _get_state_mutability(self, func: FunctionDef) -> str:
        """Get state mutability"""
        if func.is_payable:
            return "payable"
        if func.is_view:
            return "view"
        return "nonpayable"


# ============= MAIN TRANSPILER =============

class PyMonTranspiler:
    """Main transpiler class"""

    def __init__(self):
        self.analyzer = PythonContractAnalyzer()
        self.sol_generator = SolidityGenerator()
        self.abi_generator = ABIGenerator()

    def transpile(self, source_code: str) -> Dict[str, Any]:
        """
        Transpile Python contract to Solidity.

        Args:
            source_code: Python contract source code

        Returns:
            Dictionary with solidity code, ABI, and metadata
        """
        try:
            # Analyze Python code
            contracts = self.analyzer.analyze(source_code)

            if not contracts:
                raise ValueError("No valid PySmartContract classes found in source code")

            results = []
            for contract in contracts:
                # Generate Solidity
                solidity_code = self.sol_generator.generate(contract)

                # Generate ABI
                abi = self.abi_generator.generate(contract)

                results.append({
                    "contractName": contract.name,
                    "solidity": solidity_code,
                    "abi": abi,
                    "stateVariables": [
                        {
                            "name": v.name,
                            "type": v.var_type,
                            "slot": v.slot
                        }
                        for v in contract.state_vars
                    ],
                    "functions": [
                        {
                            "name": f.name,
                            "selector": f.selector,
                            "params": f.params,
                            "returnType": f.return_type,
                            "visibility": "public" if f.is_public else "internal",
                            "stateMutability": "payable" if f.is_payable else ("view" if f.is_view else "nonpayable")
                        }
                        for f in contract.functions
                    ]
                })

            return {
                "success": True,
                "contracts": results,
                "primaryContract": results[0] if results else None
            }

        except SyntaxError as e:
            return {
                "success": False,
                "error": f"Python syntax error: {str(e)}",
                "line": e.lineno,
                "offset": e.offset
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    def validate_contract(self, source_code: str) -> Dict[str, Any]:
        """Validate Python contract without full transpilation"""
        try:
            tree = ast.parse(source_code)

            has_contract = False
            has_import = False
            contract_names = []

            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    if "py_contracts" in (node.module or ""):
                        has_import = True
                elif isinstance(node, ast.ClassDef):
                    for base in node.bases:
                        if isinstance(base, ast.Name) and base.id == "PySmartContract":
                            has_contract = True
                            contract_names.append(node.name)
                        elif isinstance(base, ast.Attribute) and base.attr == "PySmartContract":
                            has_contract = True
                            contract_names.append(node.name)

            return {
                "valid": has_contract,
                "hasImport": has_import,
                "contracts": contract_names,
                "message": "Valid PyMon contract" if has_contract else "No PySmartContract class found"
            }

        except SyntaxError as e:
            return {
                "valid": False,
                "error": f"Syntax error at line {e.lineno}: {e.msg}",
                "line": e.lineno
            }


# ============= CONVENIENCE FUNCTIONS =============

def transpile_python_contract(source_code: str) -> Dict[str, Any]:
    """Convenience function to transpile Python contract"""
    transpiler = PyMonTranspiler()
    return transpiler.transpile(source_code)


def validate_python_contract(source_code: str) -> Dict[str, Any]:
    """Convenience function to validate Python contract"""
    transpiler = PyMonTranspiler()
    return transpiler.validate_contract(source_code)
