# Monsmith

A browser-based smart contract development environment for Monad Network.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-45%2F45%20passing-success)](#testing)

## About

Monsmith is an integrated development environment designed specifically for building smart contracts on Monad Network. It provides a complete toolchain including code editing, compilation, security analysis, and deployment capabilities - all accessible through a web browser without requiring local setup.

The IDE is optimized for Monad's parallel execution architecture, offering unique analysis tools to help developers write contracts that take full advantage of Monad's 10,000 TPS throughput.

## Founder

Monsmith is founded and built by **[Adwait Keshari](https://www.monsmith.com/about)**, a full-stack and blockchain engineer building developer tools for Monad in public.

- LinkedIn: https://www.linkedin.com/in/adwait-keshari-b5793b294/
- X (Twitter): https://x.com/AdwaitKeshari
- GitHub: https://github.com/Adwaitbytes
- Portfolio: https://adwait-portfolio-blond.vercel.app/
- YouTube: https://www.youtube.com/@Iitmbs2024
- Instagram: https://www.instagram.com/adwaitkeshari
- TikTok: https://www.tiktok.com/@adwait503

Live product: https://monsmith.com

## Key Features

**Development Environment**
- Monaco code editor with Solidity syntax highlighting and autocomplete
- Multi-file project support for organizing complex contract systems
- Real-time error detection and validation
- Dark and light theme support

**Compilation Pipeline**
- solc-js compiled in-process, with OpenZeppelin imports resolved from a bundled source set
- The compiler version is chosen from the pragma, so 0.5 and 0.8 sources both build
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

**Chain Fit**
- Runs your contract in a real EVM and reprices that exact execution under each chain's published gas schedule
- Per-function cost on Monad, Ethereum, Base, Arbitrum, Polygon and BNB, in gas and in USD
- Block time, block gas limit and gas price probed live from each chain's public RPC, no API keys
- Findings tied to measurements from your contract, including the cases where Monad is the more expensive answer

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
- PyMon: a constrained Python DSL for writing contracts, transpiled to Solidity
- Start from a bundled Python template; it reads that shape, not arbitrary Python
- The generated Solidity is shown before it is compiled, so it can be checked

**Contract Templates**
- Pre-built templates for common patterns (ERC20, ERC721, DAO, Staking, DEX)
- Production-tested implementations
- Customizable parameters

**Analytics** (Optional)
- First-party events in Neon Postgres, PostHog for product analytics
- Stored reports, so a run can be reopened instead of paid for twice

## Installation

### Local Development

Clone the repository and install dependencies:

```bash
git clone https://github.com/Adwaitbytes/monad-studio.git
cd monad-studio
npm install
```

Create a `.env.local` file with your configuration:

```env
# AI provider - at least one is needed for generate/audit/explain/research.
# Compile, deploy and transfer work without any of these.
OPENAI_API_KEY=your_openai_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
GROQ_API_KEY=your_groq_api_key

# Optional: stored reports, analytics and the request limiter.
# Without it the studio still runs; reports live only in the tab that made them
# and the limiter falls back to counting in memory.
DATABASE_URL=your_neon_connection_string

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

### Neon Postgres (Optional)

For stored reports, analytics and durable rate limiting:
1. Create a database at neon.tech
2. Put its connection string in `DATABASE_URL`

The tables create themselves on first use, so there is no migration step.

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

### Chain Fit

The Chain Fit panel answers a narrower question than a comparison table: what does
*this* contract cost, and how does it behave, on each chain you might ship it to.

1. Compiles the contract and deploys it into a local EVM
2. Calls every state-changing function and traces it opcode by opcode
3. Reprices that one trace under each chain's gas schedule
4. Converts gas into money at the gas price read from each chain's RPC just now

Monad keeps Ethereum's gas costs everywhere except four places, so only four
things are recomputed and everything else cancels:

| | Ethereum and the L2s | Monad |
|---|---|---|
| Cold account access | 2,600 | 10,100 |
| Cold storage | 2,100 per slot | 8,100 per 128-slot page |
| Memory expansion | 3w + w²/512 | w/2, capped at 8 MB |
| ecRecover / ecMul / ecPairing / point eval | baseline | 2x to 5x |
| Max contract size | 24 KB | 128 KB |
| Gas charged | gas used | gas limit |

The Ethereum figure is what a real EVM charged, not an estimate, and the Monad
figure is that measurement adjusted by the published MIP-8 schedule. The schedule
is checked against the worked examples in Monad's own specification by
`npm run test:chainfit`, so a repricing upstream shows up as a failing test rather
than as a wrong number in a report.

A public version, with sample contracts and the live network matrix, is at `/compare`.

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
- Viem for chain reads, wallet calls and deployment
- OpenZeppelin contract libraries, bundled for import resolution

**Backend Services**
- Next.js API routes on the Node runtime
- solc-js, bundled at 0.8.31 with older versions fetched on demand
- Neon Postgres for stored reports and rate limits

**AI Services** (Optional)
- Groq API
- OpenAI API

**Python (PyMon)**
- A constrained Python DSL transpiled to Solidity in `app/api/pymon`
- Covers the shape the bundled templates use, not arbitrary Python

**Testing**
- `tests/` runs on the Node test runner: engines, report pipeline, workspace, rate limits
- `test/` runs on Hardhat against the fixture contracts in `contracts/`

**Analytics** (Optional)
- Neon Postgres for first-party events, PostHog for product analytics

## Monad Network

Monsmith is built for Monad, an EVM-compatible blockchain with 10,000 TPS throughput via parallel execution.

**Network Configuration**

| Network | Chain ID | RPC Endpoint | Explorer |
|---------|----------|--------------|----------|
| Testnet | 10143 | https://testnet-rpc.monad.xyz | https://testnet.monadvision.com |
| Mainnet | 143 | https://rpc.monad.xyz | https://monadvision.com |

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
monad-studio/
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
│   ├── parallelAnalyzer.ts       # Public entry point for lib/parallel
│   ├── rateLimit.ts              # Per-caller ceiling on the expensive routes
│   ├── securityAnalyzer.js       # Security scanner
│   └── store.ts                  # State management
├── scripts/                      # Deployment scripts
├── test/                         # Test suite
├── tutorials/                    # Tutorial content
├── hardhat.config.cjs            # Hardhat configuration
└── package.json                  # Dependencies
```

## Testing

Run the test suite:

```bash
npm run test:unit           # Node test runner: engines, report pipeline, workspace, limits
npm test                    # Hardhat: the fixture contracts in contracts/
npm run test:all            # Both
npm run test:coverage       # Hardhat with coverage
```

Two suites, because there are two kinds of thing to test. `tests/` covers the
TypeScript that makes this product work: the gas model, the EVM tracer, the
audit pipeline, the workspace store, the rate limiter. `test/` covers the
Solidity fixtures in `contracts/`, which is what Hardhat is for.

243 passing: 198 in `tests/`, 45 in `test/`.

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

**Python (PyMon)**
- Needs no separate service: the transpiler runs in `app/api/pymon`
- It reads the constrained DSL the bundled templates use, so start from one
  rather than from arbitrary Python

## License

Proprietary. Copyright (c) 2026 Adwait Keshari. All rights reserved.

Monsmith is a hosted product, not an open-source project. No licence is granted
to copy, modify, redistribute, or run this source, in whole or in part.

## Acknowledgments

Built with:
- Monad Network
- OpenZeppelin contracts
- Hardhat development environment
- Monaco Editor
- Groq and OpenAI APIs

## Support

- Documentation: [DEPLOYMENT.md](DEPLOYMENT.md)
- Issues: [GitHub Issues](https://github.com/Adwaitbytes/monad-studio/issues)
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
- Runs inside the Next.js app; there is no separate Python process to start
- It handles the `PySmartContract` DSL, not arbitrary Python

---

## License

Proprietary. Copyright (c) 2026 Adwait Keshari. All rights reserved.

Monsmith is a hosted product, not an open-source project. No licence is granted
to copy, modify, redistribute, or run this source, in whole or in part.

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