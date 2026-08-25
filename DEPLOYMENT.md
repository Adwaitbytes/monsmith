# Monsmith - AI-Powered Smart Contract IDE

Build, compile, audit, and deploy smart contracts on Monad Network with AI assistance.

## 🚀 Features

- **AI Code Generation** - Generate smart contracts using natural language
- **Browser IDE** - Monaco editor with Solidity syntax highlighting
- **Smart Compilation** - Hardhat-powered compilation with OpenZeppelin support
- **Security Auditing** - Built-in security analysis for your contracts
- **One-Click Deploy** - Deploy to Monad Testnet or Mainnet
- **Template Library** - Pre-built templates (ERC20, NFT, DAO, Staking)
- **AI Teaching Mode** - Learn from your errors with AI explanations
- **Quick Actions** - Explain, Optimize, Secure, Debug your contracts
- **Multi-File Support** - Create and manage multiple contract files
- **Analytics Dashboard** - Track deployments and usage (with Supabase)

## 📋 Prerequisites

- Node.js 18+ and npm
- MetaMask or compatible Web3 wallet
- API keys for AI services (optional but recommended)
- Supabase account (optional, for analytics)

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Adwaitbytes/monsmith.git
   cd monsmith
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env.local
   ```

4. **Edit `.env.local` with your credentials:**

   ```env
   # AI Services - at least one is needed for generate/audit/explain/research.
   # Compile, deploy and transfer work without any of these.
   OPENROUTER_API_KEY=sk-or-v1-your_openrouter_key_here
   OPENAI_API_KEY=sk-your_openai_key_here
   GROQ_API_KEY=gsk_your_groq_key_here
   CHAINGPT_API_KEY=your_chaingpt_key_here

   # Supabase (optional, for analytics)
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

   # Deployment (optional)
   PRIVATE_KEY=your_wallet_private_key_for_backend_deployments
   ```

5. **Run development server**
   ```bash
   npm run dev
   ```

6. **Open in browser**
   ```
   http://localhost:3000
   ```

## 🔑 Getting API Keys

### Groq API (Recommended - Fast & Free)
1. Visit [https://console.groq.com](https://console.groq.com)
2. Sign up for a free account
3. Navigate to API Keys
4. Create a new API key
5. Copy and add to `.env.local`

### ChainGPT (Alternative)
1. Visit [https://app.chaingpt.org](https://app.chaingpt.org)
2. Sign up and verify your account
3. Go to API section
4. Generate an API key
5. Copy and add to `.env.local`

### Supabase (Optional - For Analytics)
1. Visit [https://supabase.com](https://supabase.com)
2. Create a new project
3. Wait for project initialization (~2 minutes)
4. Go to Project Settings > API
5. Copy `Project URL` and `anon/public key`
6. Run the database schema:
   - Go to SQL Editor
   - Copy contents from `supabase/schema.sql`
   - Run the SQL
7. Add credentials to `.env.local`

## 📊 Database Setup (Optional)

If using Supabase for analytics:

1. **Create Supabase project** (see above)

2. **Run the schema**
   - Open Supabase SQL Editor
   - Copy entire contents of `supabase/schema.sql`
   - Execute the SQL

3. **Verify tables created:**
   - users
   - projects
   - files
   - compile_runs
   - deployments
   - ai_interactions
   - events
   - sessions
   - templates
   - template_usage

The app will work without Supabase, but you won't have analytics/tracking.

## 🚢 Deployment

### Vercel (Recommended)

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Ready for deployment"
   git push origin main
   ```

2. **Deploy to Vercel**
   - Visit [vercel.com](https://vercel.com)
   - Import your GitHub repository
   - Add environment variables from `.env.local`
   - Deploy!

3. **Configure Environment Variables in Vercel:**
   - Go to Project Settings > Environment Variables
   - Add all variables from `.env.local`
   - Redeploy if needed

### Other Platforms

The app can be deployed to any Next.js hosting platform:
- **Netlify**: Use Next.js build plugin
- **Railway**: Add all env vars, automatic deployment
- **Render**: Configure as Node.js web service
- **Self-hosted**: `npm run build && npm start`

## 🧪 Testing Contracts

1. **Test contracts locally:**
   ```bash
   npm test
   ```

2. **Run specific test file:**
   ```bash
   npm test test/GenContract.test.cjs
   ```

All 45 tests should pass.

## 📁 Project Structure

```
├── app/
│   ├── landing/           # Landing page
│   ├── studio/            # Main IDE interface
│   ├── api/
│   │   ├── agent/         # AI & compilation endpoints
│   │   ├── security/      # Security analysis
│   │   └── templates/     # Template serving
├── contracts/
│   ├── templates/         # Pre-built contract templates
│   └── GenContract.sol    # Dynamic compilation target
├── lib/
│   ├── store.ts           # Zustand state management
│   ├── supabase.ts        # Supabase client & analytics
│   └── q402.ts            # Payment verification
├── supabase/
│   └── schema.sql         # Database schema
└── test/                  # Contract unit tests
```

## 🎨 Tech Stack

- **Frontend**: Next.js 16, React, TypeScript, Tailwind CSS
- **Editor**: Monaco Editor (VS Code engine)
- **Animation**: Framer Motion
- **State**: Zustand with persistence
- **Blockchain**: Viem, Ethers.js
- **Compilation**: Hardhat, Solc
- **Testing**: Mocha, Chai
- **AI**: Groq API, ChainGPT
- **Analytics**: Supabase (PostgreSQL)
- **Icons**: Lucide React

## 🌐 Monad Network

This IDE is built for Monad - a high-performance EVM-compatible blockchain.

- **Testnet**: Chain ID 10143
- **Mainnet**: not yet launched
- **RPC Testnet**: https://testnet-rpc.monad.xyz
- **RPC Mainnet**: https://rpc.monad.xyz
- **Explorer Testnet**: https://testnet.monadexplorer.com
- **Explorer Mainnet**: https://monadexplorer.com

## 🔧 Troubleshooting

### "Supabase not configured" warning
- This is normal if you haven't set up Supabase
- App will work without analytics
- Add Supabase credentials to remove warning

### Compilation fails with OpenZeppelin imports
- Make sure you ran `npm install`
- OpenZeppelin contracts are in `node_modules/@openzeppelin`
- Hardhat resolves imports automatically

### AI features not working
- Check that at least one AI API key is set
- Groq is recommended (free & fast)
- Check console for API errors

### MetaMask connection issues
- Make sure MetaMask is installed
- Add Monad network manually if not prompted
- Check you're on the correct network

## 📝 Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Optional | OpenAI, tried first for AI actions |
| `OPENROUTER_API_KEY` | Optional | OpenRouter, tried second |
| `OPENROUTER_MODEL` | Optional | Model slug (default `nvidia/nemotron-3-ultra-550b-a55b:free`) |
| `GROQ_API_KEY` | Optional | Groq, tried third |
| `CHAINGPT_API_KEY` | Optional | ChainGPT, final fallback |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional | Supabase anon key |
| `PRIVATE_KEY` | Required for deploy | Wallet key for backend deploys and q402 settlement |
| `ETHERSCAN_API_KEY` | Optional | Contract verification + ETH→Monad import |

**Note**: One AI key unlocks generate/architect/audit/explain/research. Compile,
deploy and transfer need no AI key at all.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Built for Monad Network
- Powered by OpenZeppelin contracts
- AI by Groq and ChainGPT
- Icons by Lucide

## 📞 Support

- GitHub Issues: [Report a bug](https://github.com/Adwaitbytes/monsmith/issues)
- Twitter: [@Adwaitbytes](https://twitter.com/Adwaitbytes)

---

**Made with 💜 for the Monad ecosystem**
