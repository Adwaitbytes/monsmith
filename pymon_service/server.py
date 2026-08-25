# pymon_service/server.py
# Flask API Server for PyMon Integration with Monsmith

from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import traceback
from typing import Dict, Any

from .compiler import compile_python_contract, get_solidity_from_python
from .auditor import audit_python_contract
from .transpiler import validate_python_contract
from .py_contracts import get_sample_contracts

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend integration

# Configuration
MONAD_TESTNET_RPC = os.getenv("MONAD_RPC_URL", "https://testnet-rpc.monad.xyz")
MONAD_CHAIN_ID = int(os.getenv("MONAD_CHAIN_ID", "10143"))


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "pymon",
        "version": "1.0.0"
    })


@app.route('/api/pymon/compile', methods=['POST'])
def compile_contract():
    """
    Compile Python contract to EVM bytecode.

    Request body:
        {
            "code": "Python contract source code",
            "optimize": true/false (optional, default true)
        }

    Response:
        {
            "success": true/false,
            "contractName": "MyContract",
            "abi": [...],
            "bytecode": "0x...",
            "solidityCode": "// Generated Solidity...",
            "metadata": {...}
        }
    """
    try:
        data = request.get_json()

        if not data or 'code' not in data:
            return jsonify({
                "success": False,
                "error": "Missing 'code' in request body"
            }), 400

        source_code = data['code']
        optimize = data.get('optimize', True)

        # Compile the contract
        result = compile_python_contract(source_code, optimize)

        if result.get("success"):
            return jsonify(result)
        else:
            return jsonify(result), 400

    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route('/api/pymon/transpile', methods=['POST'])
def transpile_contract():
    """
    Transpile Python to Solidity without full compilation.

    Request body:
        {
            "code": "Python contract source code"
        }

    Response:
        {
            "success": true/false,
            "solidity": "// Generated Solidity code",
            "contractName": "MyContract",
            "abi": [...]
        }
    """
    try:
        data = request.get_json()

        if not data or 'code' not in data:
            return jsonify({
                "success": False,
                "error": "Missing 'code' in request body"
            }), 400

        result = get_solidity_from_python(data['code'])

        if result.get("success"):
            return jsonify(result)
        else:
            return jsonify(result), 400

    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route('/api/pymon/validate', methods=['POST'])
def validate_contract():
    """
    Validate Python contract syntax and structure.

    Request body:
        {
            "code": "Python contract source code"
        }

    Response:
        {
            "valid": true/false,
            "contracts": ["ContractName1", "ContractName2"],
            "message": "Validation message"
        }
    """
    try:
        data = request.get_json()

        if not data or 'code' not in data:
            return jsonify({
                "valid": False,
                "error": "Missing 'code' in request body"
            }), 400

        result = validate_python_contract(data['code'])
        return jsonify(result)

    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "valid": False,
            "error": str(e)
        }), 500


@app.route('/api/pymon/audit', methods=['POST'])
def audit_contract():
    """
    Run security audit on Python contract.

    Request body:
        {
            "code": "Python contract source code"
        }

    Response:
        {
            "success": true/false,
            "score": 85,
            "riskLevel": "LOW/MEDIUM/HIGH/CRITICAL",
            "findings": [...],
            "summary": "..."
        }
    """
    try:
        data = request.get_json()

        if not data or 'code' not in data:
            return jsonify({
                "success": False,
                "error": "Missing 'code' in request body"
            }), 400

        result = audit_python_contract(data['code'])
        return jsonify(result)

    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route('/api/pymon/templates', methods=['GET'])
def get_templates():
    """
    Get available Python contract templates.

    Response:
        {
            "templates": {
                "SimpleStorage": "...",
                "Counter": "...",
                "BasicToken": "..."
            }
        }
    """
    try:
        templates = get_sample_contracts()
        return jsonify({
            "success": True,
            "templates": templates
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route('/api/pymon/config', methods=['GET'])
def get_config():
    """Get PyMon configuration"""
    return jsonify({
        "network": {
            "name": "Monad Testnet",
            "rpc": MONAD_TESTNET_RPC,
            "chainId": MONAD_CHAIN_ID,
            "explorer": "https://testnet.monadexplorer.com",
            "currency": "MON"
        },
        "compiler": {
            "version": "0.8.20",
            "optimizer": True,
            "runs": 200
        },
        "features": {
            "compile": True,
            "transpile": True,
            "audit": True,
            "deploy": True,
            "interact": True
        }
    })


# ============= ERROR HANDLERS =============

@app.errorhandler(400)
def bad_request(e):
    return jsonify({
        "success": False,
        "error": "Bad request",
        "details": str(e)
    }), 400


@app.errorhandler(500)
def server_error(e):
    return jsonify({
        "success": False,
        "error": "Internal server error",
        "details": str(e)
    }), 500


# ============= MAIN =============

def run_server(host: str = "0.0.0.0", port: int = 5001, debug: bool = False):
    """Run the PyMon API server"""
    print(f"""
    ╔═══════════════════════════════════════════╗
    ║       PyMon API Server for Monsmith       ║
    ╠═══════════════════════════════════════════╣
    ║  Endpoints:                               ║
    ║  POST /api/pymon/compile   - Compile      ║
    ║  POST /api/pymon/transpile - Transpile    ║
    ║  POST /api/pymon/validate  - Validate     ║
    ║  POST /api/pymon/audit     - Security     ║
    ║  GET  /api/pymon/templates - Templates    ║
    ║  GET  /api/pymon/config    - Config       ║
    ╚═══════════════════════════════════════════╝
    """)
    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    run_server(debug=True)
