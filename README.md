# Monsmith

A browser-based smart contract development environment for Monad Network.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-45%2F45%20passing-success)](#testing)

## About

Monsmith is an integrated development environment designed specifically for building smart contracts on Monad Network. It provides a complete toolchain including code editing, compilation, security analysis, and deployment capabilities - all accessible through a web browser without requiring local setup.

The IDE is optimized for Monad's parallel execution architecture, offering unique analysis tools to help developers write contracts that take full advantage of Monad's 10,000 TPS throughput.

## Key Features

**Development Environment**
- Monaco code editor with Solidity syntax highlighting and autocomplete
- Multi-file project support for organizing complex contract systems
- Real-time error detection and validation
- Dark and light theme support

**Compilation Pipeline**
- Hardhat-based compilation with OpenZeppelin contract resolution
- Solidity 0.8.24 with optimizer support (200 runs default)
- Detailed error messages with contextual information
- ABI and bytecode generation for deployment

**Security Analysis**
- Vulnerability scanning for common attack vectors (reentrancy, overflow, access control)
- Pattern-based security recommendations
- Risk assessment scoring
- Automated suggestions for security improvements

**Monad Parallel Profiler**
- Storage dependency analysis for parallel execution optimization
- Function-level parallelization scoring
- Dependency graph visualization
- Specific recommendations for improving contract throughput on Monad

**Deployment**
- MetaMask wallet integration
- Support for Monad Testnet and Mainnet
- Transaction confirmation with block explorer links
- Deployment history tracking

**AI Assistance** (Optional)
- Natural language contract generation using OpenAI or Groq APIs
- Code explanation and documentation generation
- Optimization suggestions based on gas usage patterns
- Debugging assistance for compilation errors

**Python Transpiler** (Experimental)
- PyMon service for writing contracts in Python syntax
- Automatic transpilation to Solidity
- Type inference and validation
- Flask-based compilation API

**Contract Templates**
- Pre-built templates for common patterns (ERC20, ERC721, DAO, Staking, DEX)
- Production-tested implementations
- Customizable parameters

**Analytics** (Optional)
- Supabase integration for deployment tracking
- Usage metrics and performance monitoring
- Historical data visualization

## Installation

### Local Development

Clone the repository and install dependencies:

```bash
git clone https://github.com/yourusername/monad-ide.git
cd monad-ide
npm install
```

Create a `.env.local` file with your configuration:

```env
# AI provider - at least one is needed for generate/audit/explain/research.
# Compile, deploy and transfer work without any of these.
OPENAI_API_KEY=your_openai_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
GROQ_API_KEY=your_groq_api_key

# Optional: Analytics
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_key

# Optional: Deployment
PRIVATE_KEY=your_private_key
```

Start the development server:

```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

### Production Deployment

Monsmith can be deployed to Vercel, Netlify, or any Node.js hosting platform.

For Vercel:
```bash
npm i -g vercel
vercel
```

Add environment variables through your hosting platform's dashboard.

## Configuration

### AI Provider Setup

**Groq** (Recommended)
- Fast inference with free tier available
- Sign up at console.groq.com
- Generate API key in dashboard
- Add `GROQ_API_KEY` to environment variables

**OpenAI** (Alternative)
- Higher quality responses for complex tasks
- Requires paid API access
- Create key at platform.openai.com
- Add `OPENAI_API_KEY` to environment variables

### Supabase (Optional)

For analytics and deployment tracking:
1. Create project at supabase.com
2. Execute SQL schema from `supabase/schema.sql`
3. Copy project URL and anon key to environment variables

## Usage

### Writing Contracts

The IDE provides three ways to start:

1. **From Template** - Select from pre-built contracts (ERC20, NFT, DAO, Staking)
2. **AI Generation** - Describe requirements in natural language
3. **Blank File** - Write Solidity code from scratch

The Monaco editor includes:
- Syntax highlighting for Solidity
- Autocomplete for language keywords
- Error underlining
- Code folding and minimap

### Compilation

Click the Compile button to build your contract. The system:
- Resolves OpenZeppelin imports automatically
- Runs Solidity compiler with optimization
- Generates ABI and bytecode
- Reports errors with line numbers and descriptions

If AI features are enabled, compilation errors include contextual explanations and suggestions.

### Security Auditing

The Audit button triggers analysis that checks for:
- Reentrancy vulnerabilities
- Integer overflow/underflow risks
- Access control issues
- Unsafe external calls
- Gas optimization opportunities

Results include severity ratings and remediation recommendations.

### Parallel Analysis

The Parallel Profiler analyzes contracts for Monad-specific optimizations:

1. Maps storage variable access patterns
2. Identifies read/write conflicts between functions
3. Calculates parallelization potential
4. Generates dependency graph visualization
5. Provides optimization suggestions

This helps you write contracts that leverage Monad's parallel execution architecture.

### Deployment

To deploy a contract:

1. Ensure the contract compiles successfully
2. Connect MetaMask wallet
3. Select target network (Monad Testnet or Mainnet)
4. Click Deploy
5. Confirm transaction in MetaMask
6. Receive contract address and explorer link

## Technical Stack

**Frontend**
- Next.js 16 with App Router
- React 19
- TypeScript
- Tailwind CSS 4
- Framer Motion for animations
- Monaco Editor (VS Code engine)
- Lucide React icons

**State Management**
- Zustand for application state
- LocalStorage persistence

**Blockchain Integration**
- Viem for modern Web3 interactions
- Ethers.js for wallet connectivity
- Hardhat for compilation
- OpenZeppelin contract libraries

**Backend Services**
- Next.js API routes
- Hardhat compiler integration
- Solc 0.8.31

**AI Services** (Optional)
- Groq API
- OpenAI API

**Python Transpiler**
- Flask API server
- Python AST parser
- Solidity code generator

**Testing**
- Mocha test framework
- Chai assertions
- Hardhat network
- 45 passing tests

**Analytics** (Optional)
- Supabase PostgreSQL
- Real-time subscriptions

## Monad Network

Monsmith is built for Monad, an EVM-compatible blockchain with 10,000 TPS throughput via parallel execution.

**Network Configuration**

| Network | Chain ID | RPC Endpoint |
|---------|----------|--------------|
| Testnet | 10143 | https://testnet-rpc.monad.xyz |
| Mainnet | 10143 | https://mainnet-rpc.monad.xyz |

**Adding to MetaMask**

The IDE prompts for network addition during deployment. Manual configuration:

- Network Name: Monad Testnet
- RPC URL: https://testnet-rpc.monad.xyz
- Chain ID: 10143
- Currency Symbol: MON

**Parallel Execution**

Monad's architecture executes transactions in parallel rather than sequentially. The Parallel Profiler helps identify:
- Functions that can execute concurrently
- Storage dependencies that create conflicts
- Optimization opportunities for higher throughput

## Project Structure

```
monad-ide/
├── app/
│   ├── api/                      # API routes
│   │   ├── agent/                # AI generation endpoint
│   │   ├── analytics/            # Analytics tracking
│   │   ├── parallel/             # Parallel analysis
│   │   ├── pymon/                # Python transpiler
│   │   ├── security/             # Security audit
│   │   └── templates/            # Contract templates
│   ├── landing/                  # Landing page
│   ├── studio/                   # Main IDE
│   │   └── components/           # IDE components
│   └── tutorials/                # Tutorial pages
├── contracts/                    # Contract templates
│   └── templates/                # Pre-built contracts
├── lib/                          # Core libraries
│   ├── contractTemplates.ts      # Template definitions
│   ├── dependencyGraph.ts        # Graph generation
│   ├── openzeppelin-bundle.ts    # Bundled OZ contracts
│   ├── parallelAnalyzer.ts       # Parallel analysis
│   ├── securityAnalyzer.js       # Security scanner
│   ├── store.ts                  # State management
│   └── supabase.ts               # Analytics client
├── pymon_service/                # Python transpiler
│   ├── auditor.py
│   ├── compiler.py
│   ├── py_contracts.py
│   ├── server.py
│   └── transpiler.py
├── scripts/                      # Deployment scripts
├── test/                         # Test suite
├── tutorials/                    # Tutorial content
├── hardhat.config.cjs            # Hardhat configuration
└── package.json                  # Dependencies
```

## Testing

Run the test suite:

```bash
npm test                    # Run all tests
npm run test:coverage       # With coverage report
```

Test coverage:
- ERC20 token operations
- NFT minting and transfers
- DEX pool functionality
- Gas optimization validation
- Security pattern checks

45/45 tests passing.

## Development Commands

```bash
npm run dev                 # Start development server
npm run build               # Build for production
npm run start               # Run production build
npm run compile             # Compile Solidity contracts
npm run clean               # Clean build artifacts
npm run lint                # Run linter
npm run type-check          # TypeScript validation
```

## Deployment

### Vercel

```bash
npm i -g vercel
vercel
```

Add environment variables in Vercel dashboard.

### Other Platforms

Compatible with:
- Netlify (build command: `npm run build`)
- Railway (GitHub integration)
- DigitalOcean (Node.js droplet)
- Self-hosted (Docker or PM2)

Refer to [DEPLOYMENT.md](DEPLOYMENT.md) for platform-specific instructions.

## Contributing

Contributions welcome. To contribute:

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit pull request

## Troubleshooting

**Compilation fails**
- Check OpenZeppelin import paths use `@openzeppelin/contracts`
- Verify Solidity version 0.8.24
- Clear cache with `npm run clean`

**Deployment issues**
- Confirm MetaMask connected to correct network
- Verify sufficient MON balance for gas
- Ensure contract compiled successfully

**AI features not working**
- Check API keys in `.env.local`
- Verify API key validity and credits
- Try alternative provider (Groq or OpenAI)

**Python transpiler**
- Install dependencies: `pip install -r pymon_service/requirements.txt`
- Start Flask server: `python pymon_service/server.py`
- Service runs on port 5000

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

Built with:
- Monad Network
- OpenZeppelin contracts
- Hardhat development environment
- Monaco Editor
- Groq and OpenAI APIs

## Support

- Documentation: [DEPLOYMENT.md](DEPLOYMENT.md)
- Issues: [GitHub Issues](https://github.com/yourusername/monad-ide/issues)
- Monad: [docs.monad.xyz](https://docs.monad.xyz)
- Check Solidity version compatibility (0.8.24)
- Clear Hardhat cache: `npm run clean`

**Deployment Issues:**
- Verify MetaMask is connected to correct network
- Ensure wallet has sufficient MON for gas
- Check contract compiled successfully before deploying

**AI Not Working:**
- Verify API keys in `.env.local`
- Check API key has sufficient credits
- Try alternative AI provider

**PyMon Transpiler:**
- Python service runs on separate port (5000)
- Install Python dependencies: `pip install -r pymon_service/requirements.txt`
- Start Flask server: `python pymon_service/server.py`

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

Monsmith is built with and for the Monad ecosystem:

- **Monad Labs** - For building the fastest EVM-compatible blockchain
- **OpenZeppelin** - For secure, audited smart contract libraries
- **Hardhat** - For the best Solidity development experience
- **Monaco Editor** - For bringing VS Code to the browser
- **Groq** - For blazing-fast AI inference
- **Vercel** - For seamless deployment and hosting

---

*Ship smart contracts at 10,000 TPS*