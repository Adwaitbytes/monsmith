import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { verifyPayment, settlePayment } from "../../../lib/q402";
import { paywallEnabled } from "@/lib/report/entitlement";
import { createWalletClient, createPublicClient, http, defineChain, getAddress, parseEther, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compileForDeploy, type ProjectInput } from "@/lib/solc/compile";
import { CONTRACT_TEMPLATES, generateFromTemplate } from "../../../lib/contractTemplates";
import { REQUEST_BUDGET_MS, callAI, hasAIProvider } from "../../../lib/aiClient";

// --- CHAIN DEFINITIONS ---
const monadTestnet = defineChain({
    id: 10143,
    name: 'Monad Testnet',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
});

const monadMainnet = defineChain({
    id: 10143, // Update when mainnet launches
    name: 'Monad Mainnet',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: ['https://mainnet-rpc.monad.xyz'] } },
});

// --- CONFIG ---
const RPC_TESTNET = "https://testnet-rpc.monad.xyz";
const RPC_MAINNET = "https://mainnet-rpc.monad.xyz";

// --- Q402 PAYMENT TERMS (server-authoritative) ---
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MONAD_CHAIN_ID = 10143;
const Q402_PRICE_WEI = "100000000000000"; // 0.0001 MON
const Q402_PAYEE = "0x9dF95D6b0Fa0F09C6a90B60D1B7F79167195EDB1";

/**
 * The bundled OpenZeppelin is v5, whose constructor signatures differ from v4.
 * Models default to v4 syntax from training data and produce contracts that do
 * not compile, so the differences are spelled out in every generation prompt.
 */
const OPENZEPPELIN_V5_RULES = `
The available OpenZeppelin is version 5. Follow these rules exactly or the contract will not compile.

MUST:
- Ownable takes an initial owner: Ownable(msg.sender). Never write Ownable().
- Constructor takes NO parameters. Hardcode any initial values.
- Include: receive() external payable {}
- Start with: // SPDX-License-Identifier: MIT
- pragma solidity ^0.8.20;

MUST NOT (these are the most common causes of failure):
- Do NOT use "unchecked" blocks anywhere.
- Do NOT use Counters.sol, it was removed in v5.
- Do NOT use _beforeTokenTransfer, it was removed in v5. Use _update.
- Do NOT inherit more than two OpenZeppelin contracts. Prefer plain state variables over extra base contracts.
- Do NOT use Pausable unless the user explicitly asks for pausing.
- Do NOT declare the same event twice.
- Do NOT write @param or @return doc tags.
- Do NOT mark a function "override" unless it genuinely overrides a base function.

Prefer simple, direct code over clever code. A short contract that compiles is
better than a sophisticated one that does not.

This is the shape of a correct contract:

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Example is ERC20, Ownable {
    uint256 public constant PRICE = 0.01 ether;
    mapping(address => uint256) public balances;

    event Recorded(address indexed user, uint256 amount);

    constructor() ERC20("Example", "EXM") Ownable(msg.sender) {
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }

    function record(uint256 amount) external {
        balances[msg.sender] += amount;
        emit Recorded(msg.sender, amount);
    }

    function withdraw() external onlyOwner {
        (bool sent, ) = payable(owner()).call{value: address(this).balance}("");
        require(sent, "withdraw failed");
    }

    receive() external payable {}
}
`;

/**
 * Deterministically fixes the mistakes models make most often.
 *
 * Measured over a batch of generations, two faults caused most first-attempt
 * compile failures: `Ownable()` written with no argument (v4 habit), and NatSpec
 * @param/@return tags that do not match the signature they document, which solc
 * treats as a hard error. Both are mechanical, so they are corrected here rather
 * than by asking the model again, which costs a round trip and often fails anyway.
 */
function repairCommonMistakes(code: string): string {
    let fixed = code;

    // OpenZeppelin v5 requires an initial owner.
    fixed = fixed.replace(/\bOwnable\s*\(\s*\)/g, "Ownable(msg.sender)");

    // Models add `unchecked` for gas and frequently place it where the grammar
    // does not allow it. Dropping the keyword leaves a plain block and restores
    // 0.8's overflow checks, which is the safer behaviour anyway.
    fixed = fixed.replace(/\bunchecked\s*\{/g, "{");

    // Drop parameter and return docs; they document nothing the compiler needs
    // and a stale tag aborts the whole compile.
    fixed = fixed
        .split("\n")
        .filter((line) => !/^\s*(\/\/\/|\s*\*)\s*@(param|return)\b/.test(line))
        .join("\n");

    return fixed;
}

/** Strips the markdown and stray prefixes models add despite being told not to. */
function cleanGeneratedCode(raw: string): string {
    let code = raw.replace(/```solidity/gi, "").replace(/```/g, "").trim();
    if (code.startsWith("SPDX-License-Identifier")) code = "// " + code;
    code = code.replace(/MITpragma/, "MIT\npragma");

    // Some models prepend a sentence before the licence header.
    const spdx = code.indexOf("// SPDX");
    if (spdx > 0) code = code.slice(spdx);

    return code.trim();
}

/**
 * Returns compilable Solidity, or throws.
 *
 * A contract that does not compile is worthless to the user, so the model's
 * first answer is verified rather than trusted. On failure the compiler's own
 * error is handed back to the model, which fixes its mistake far more reliably
 * than re-rolling the same prompt. Retries stop when the time budget runs out.
 */
async function generateVerifiedContract(
    codePrompt: string,
    systemRole: string,
    userAddress: string | undefined,
    deadline: number
): Promise<{ code: string; attempts: number; repaired: boolean; fromTemplate?: string }> {
    let lastError = "";

    for (let attempt = 1; attempt <= 3; attempt++) {
        if (Date.now() > deadline - 5_000) break;

        const prompt = lastError
            ? `${codePrompt}\n\nYour previous attempt failed to compile with this exact error:\n${lastError}\n\nReturn the corrected full contract. Output ONLY Solidity.`
            : codePrompt;

        // Each attempt starts from a different model in the chain.
        const raw = await callAI(prompt, systemRole, userAddress, deadline, attempt - 1);
        const code = repairCommonMistakes(cleanGeneratedCode(raw));

        try {
            await compileForDeploy(code);
            return { code, attempts: attempt, repaired: attempt > 1 };
        } catch (error) {
            lastError = (error instanceof Error ? error.message : String(error)).slice(0, 600);
            console.warn(`⚠️ Generated contract failed to compile (attempt ${attempt}): ${lastError.slice(0, 140)}`);
        }
    }

    // Every model attempt produced something that will not compile. Returning an
    // error would leave the user with nothing, so fall back to the hand-written
    // template closest to their request. These are known to compile.
    const fallbackId = pickTemplateFor(codePrompt);
    console.warn(`⚠️ Falling back to template "${fallbackId}" after ${lastError.slice(0, 120)}`);

    const templateCode = generateFromTemplate(fallbackId, CONTRACT_TEMPLATES[fallbackId].defaults);
    await compileForDeploy(templateCode);

    return { code: templateCode, attempts: 3, repaired: true, fromTemplate: fallbackId };
}

/** Chooses the closest built-in template from the words in the request. */
function pickTemplateFor(request: string): string {
    const text = request.toLowerCase();
    const rules: [RegExp, string][] = [
        [/\bnft|erc-?721|collectible|ticket|art|badge\b/, "nft-collection"],
        [/\bdao|govern|vote|voting|proposal|ballot\b/, "dao-governance"],
        [/\bstake|staking|yield|reward|vault|farm\b/, "staking-vault"],
        [/\bmultisig|multi-sig|treasury|signers?\b/, "multisig-wallet"],
    ];
    for (const [pattern, id] of rules) {
        if (pattern.test(text)) return id;
    }
    return "defi-token";
}


/**
 * The caller's whole workspace, when it sent one.
 *
 * The studio compiles every Solidity file it holds rather than just the open
 * one, so a contract can import another file the user wrote. Validated here
 * rather than trusted: this is request data, and a malformed `sources` would
 * otherwise reach solc as-is.
 */
function readProject(body: unknown): ProjectInput | undefined {
    if (typeof body !== "object" || body === null) return undefined;
    const { sources, entry } = body as { sources?: unknown; entry?: unknown };

    if (typeof sources !== "object" || sources === null) return undefined;
    if (typeof entry !== "string" || entry.length === 0) return undefined;

    const clean: Record<string, string> = {};
    for (const [path, content] of Object.entries(sources)) {
        if (typeof content === "string" && path.endsWith(".sol")) clean[path] = content;
    }

    if (clean[entry] === undefined) return undefined;
    return { sources: clean, entry };
}

export async function POST(req: Request) {
    // Every AI path shares one wall-clock budget so the function returns JSON
    // rather than being killed mid-flight by the platform.
    const deadline = Date.now() + REQUEST_BUDGET_MS;

    try {
        const body = await req.json();
        const { action, prompt, code, userAddress, network, toAddress, amount } = body;

        console.log(`🔹 API Request: [${action}] from [${userAddress?.slice(0, 10)}...]`);

        // Only the LLM-backed actions need a model provider. compile/deploy/transfer
        // run entirely on solc and viem, so they must stay available without one.
        const AI_ACTIONS = ["research", "generate", "architect", "audit", "explain_error"];
        /*
         * What costs money, and when.
         *
         * This charged for `audit` unconditionally while `/api/report` ran a
         * strictly deeper audit for free: security, gas, parallel fitness, a
         * chain comparison and a threat model, with no wallet at all. Two
         * audits under two rules, and the one behind the paywall was the worse
         * of them. Whatever the pricing turns out to be, it cannot be that.
         *
         * Both now answer to the same switch, so turning the paywall on turns
         * it on everywhere rather than in whichever route remembered.
         */
        const PAID_ACTIONS = paywallEnabled() ? ["audit", "deploy"] : ["deploy"];
        const aiAvailable = hasAIProvider();
        if (AI_ACTIONS.includes(action) && !aiAvailable) {
            return NextResponse.json({
                error: `"${action}" needs an AI provider. Set OPENAI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, or CHAINGPT_API_KEY in .env.local.`
            }, { status: 503 });
        }

        /*
         * A wallet is required only where one is actually used.
         *
         * Every action was gated behind this, compile included, which made the
         * most basic operation in the product refuse to run for anyone who had
         * not connected a wallet first. Compiling runs solc on this server and
         * charges nothing; it has no use for an address. The actions that do
         * are the ones that spend: a deploy signs from that wallet, a transfer
         * sends from it, and the paid actions settle against it.
         */
        const WALLET_ACTIONS = ["deploy", "transfer", ...PAID_ACTIONS];
        if (WALLET_ACTIONS.includes(action) && !userAddress) {
            return NextResponse.json(
                { error: `"${action}" needs a connected wallet.` },
                { status: 403 },
            );
        }

        // Deny list check, for the actions that carry a wallet at all.
        const incomingUser = (userAddress ?? "").toLowerCase();
        const DENY_LIST = ["0xdead00000000000000000000000000000000beef"];
        if (DENY_LIST.includes(incomingUser)) {
            return NextResponse.json({ error: "This wallet address is not permitted." }, { status: 403 });
        }

        // Q402 Payment gate for premium actions
        if (PAID_ACTIONS.includes(action)) {
            const paymentHeader = req.headers.get("x-payment");
            if (!paymentHeader) {
                const witnessData = {
                    domain: {
                        name: "q402", version: "1",
                        chainId: MONAD_CHAIN_ID,
                        verifyingContract: ZERO_ADDRESS
                    },
                    types: {
                        Witness: [
                            { name: "owner", type: "address" },
                            { name: "token", type: "address" },
                            { name: "amount", type: "uint256" },
                            { name: "to", type: "address" },
                            { name: "deadline", type: "uint256" },
                            { name: "paymentId", type: "bytes32" },
                            { name: "nonce", type: "uint256" }
                        ]
                    },
                    primaryType: "Witness",
                    message: {
                        owner: userAddress,
                        token: ZERO_ADDRESS,
                        amount: Q402_PRICE_WEI,
                        to: Q402_PAYEE,
                        deadline: Math.floor(Date.now() / 1000) + 3600,
                        // Unguessable payment id - a predictable one lets a third party
                        // pre-sign a witness for someone else's session.
                        paymentId: `0x${randomBytes(32).toString("hex")}`,
                        nonce: `0x${randomBytes(8).toString("hex")}`
                    }
                };
                return NextResponse.json({
                    error: "Payment Required",
                    paymentDetails: {
                        scheme: "evm/eip7702-delegated-payment",
                        networkId: network === "mainnet" ? "monad-mainnet" : "monad-testnet",
                        amount: witnessData.message.amount,
                        witness: witnessData
                    }
                }, { status: 402 });
            }

            let payload;
            try {
                payload = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf-8'));
            } catch {
                return NextResponse.json({ error: "Malformed payment header" }, { status: 400 });
            }

            // The terms are re-asserted server-side; a client-supplied witness that
            // names a different payee, a smaller amount or another wallet is rejected.
            const isValid = await verifyPayment(payload, {
                payer: userAddress,
                payee: Q402_PAYEE,
                minAmount: BigInt(Q402_PRICE_WEI),
                chainId: MONAD_CHAIN_ID,
            });
            if (!isValid) {
                return NextResponse.json({ error: "Invalid Payment Signature" }, { status: 403 });
            }

            try {
                await settlePayment(payload);
                console.log("✅ Q402: Payment Verified & Settled.");
            } catch (e) {
                // Settlement failing is a server-side configuration problem. Reporting
                // it as a bad signature sends the user hunting the wrong thing.
                const reason = e instanceof Error ? e.message : "Settlement failed";
                console.error("❌ Q402 Settlement Failed:", reason);
                return NextResponse.json({ error: `Payment settlement failed: ${reason}` }, { status: 503 });
            }
        }

        // =========================================================
        // ACTION HANDLERS
        // =========================================================

        if (action === "research") {
            console.log(`🔍 Research query: ${prompt?.slice(0, 50)}...`);
            const result = await callAI(
                prompt,
                "You are a helpful Web3 and blockchain expert. Answer questions clearly and concisely.",
                userAddress
            );
            return NextResponse.json({ success: true, result, answer: result, response: result });
        }

        if (action === "generate") {
            console.log(`🧠 Generating code for: ${prompt?.slice(0, 50)}...`);

            const codePrompt = `You are a Senior Solidity Architect. Write a production-grade, error-free smart contract.

STRICT REQUIREMENTS:
1. **Contract Name**: MUST be 'GenContract' (e.g. 'contract GenContract is ...'). This is required for our deployment scripts.
2. **Pragma**: Use '^0.8.20'.
3. **Logic**: Implement EXACTLY what the user asks.
4. **No Constructor Args**: Hardcode all initial values. Constructor should take NO parameters.
5. **Receive Function**: Include 'receive() external payable {}'.
6. **SPDX**: Start with '// SPDX-License-Identifier: MIT'.
7. **Output**: ONLY valid Solidity code. NO markdown, NO explanations, NO code blocks.
8. **OpenZeppelin**: You can use these imports:
   - @openzeppelin/contracts/token/ERC20/ERC20.sol
   - @openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol
   - @openzeppelin/contracts/token/ERC721/ERC721.sol
   - @openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol
   - @openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol
   - @openzeppelin/contracts/access/Ownable.sol
   - @openzeppelin/contracts/utils/ReentrancyGuard.sol

${OPENZEPPELIN_V5_RULES}

USER REQUEST: "${prompt}"

Generate the contract now:`;

            const generated = await generateVerifiedContract(
                codePrompt,
                "You are a Solidity expert. Generate ONLY pure Solidity code. No markdown, no explanations, no code blocks.",
                userAddress,
                deadline
            );

            return NextResponse.json({
                success: true,
                code: generated.code,
                verified: true,
                attempts: generated.attempts,
                repaired: generated.repaired,
                fromTemplate: generated.fromTemplate,
            });
        }

        if (action === "architect") {
            console.log(`🏗️ Architect generating contract: ${body.contractType}`);

            const architectSystemRole = `You are a senior blockchain architect specializing in Solidity smart contract development for the Monad Network.

Your contracts are:
- Production-ready and thoroughly tested patterns
- Gas-optimized for Monad's parallel EVM
- Following all security best practices (ReentrancyGuard, access control, input validation)
- Compliant with OpenZeppelin standards
- Fully documented with NatSpec comments

CRITICAL REQUIREMENTS:
1. Use Solidity ^0.8.24
2. All contracts MUST compile without errors
3. Include comprehensive events for all state changes
4. Use OpenZeppelin imports where applicable:
   - @openzeppelin/contracts/token/ERC20/ERC20.sol
   - @openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol
   - @openzeppelin/contracts/token/ERC721/ERC721.sol
   - @openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol
   - @openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol
   - @openzeppelin/contracts/access/Ownable.sol
   - @openzeppelin/contracts/access/AccessControl.sol
   - @openzeppelin/contracts/utils/ReentrancyGuard.sol
   - @openzeppelin/contracts/utils/Pausable.sol

${OPENZEPPELIN_V5_RULES}

The contract MUST compile with no constructor arguments, so hardcode initial values.

OUTPUT FORMAT: Return ONLY valid Solidity code starting with "// SPDX-License-Identifier: MIT".
NO markdown code blocks, NO explanations, NO additional text.`;

            const architected = await generateVerifiedContract(
                prompt,
                architectSystemRole,
                userAddress,
                deadline
            );

            console.log(`✅ Architect generated ${architected.code.length} characters of verified code`);

            return NextResponse.json({
                success: true,
                code: architected.code,
                verified: true,
                attempts: architected.attempts,
                repaired: architected.repaired,
                fromTemplate: architected.fromTemplate,
                contractType: body.contractType,
                params: body.params
            });
        }

        if (action === "audit") {
            console.log("🛡️ Auditing contract...");

            const auditPrompt = `You are a smart contract security auditor. Analyze this Solidity code:

CODE TO AUDIT:
${code}

Provide a structured audit report with:
1. Critical Issues (if any)
2. Medium Issues (if any)
3. Low Issues (if any)
4. Gas Optimizations
5. Overall Assessment`;

            const report = await callAI(
                auditPrompt,
                "You are a smart contract security auditor. Analyze code for vulnerabilities and best practices.",
                userAddress
            );

            return NextResponse.json({ success: true, report });
        }

        if (action === "compile") {
            console.log("🔨 Compiling contract...");

            try {
                const { abi, bytecode, contractName, linkReferences, libraries } =
                    await compileForDeploy(code, readProject(body));

                return NextResponse.json({
                    success: true,
                    contractName,
                    abi,
                    bytecode: bytecode.startsWith('0x') ? bytecode : `0x${bytecode}`,
                    contractSize: bytecode.length / 2,
                    // Only sent when there is something to link, so the client
                    // does not have to distinguish absent from empty.
                    ...(libraries.length > 0 ? { linkReferences, libraries } : {}),
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : "Compilation failed";
                console.error("❌ Compilation failed:", message);
                return NextResponse.json({
                    success: false,
                    errors: [{ message, severity: "error", type: "CompilerError" }],
                    message
                });
            }
        }

        if (action === "explain_error") {
            console.log("🤖 Explaining error...");

            const { errors } = body;
            const errorMessages =
                (errors as { message: string }[] | undefined)?.map((e) => e.message).join("\n") || "Unknown error";

            const explainPrompt = `You are a Solidity teacher. A developer has these compilation errors:

ERRORS:
${errorMessages}

CODE:
${code}

Provide:
1. A clear explanation of what went wrong
2. The exact fix with code
3. A brief lesson on avoiding this error

Format as JSON:
{
  "explanation": "...",
  "fix": "...",
  "teachMode": { "title": "...", "steps": ["step1", "step2", "step3"] }
}`;

            const result = await callAI(
                explainPrompt,
                "You are a friendly Solidity teacher. Always respond with valid JSON.",
                userAddress
            );

            try {
                const parsed = JSON.parse(result);
                return NextResponse.json({ success: true, ...parsed });
            } catch {
                return NextResponse.json({ success: true, explanation: result, teachMode: null });
            }
        }

        if (action === "deploy") {
            const isMainnet = network === "mainnet";
            const targetRpc = isMainnet ? RPC_MAINNET : RPC_TESTNET;
            const chain = isMainnet ? monadMainnet : monadTestnet;

            console.log(`🚀 Deploying to ${chain.name}...`);

            const privateKey = process.env.PRIVATE_KEY;
            if (!privateKey) {
                return NextResponse.json({ error: "Server Error: Missing PRIVATE_KEY" }, { status: 500 });
            }

            try {
                // The same project the studio compiled. Deploying from a
                // single-source build would silently drop the user's imports.
                console.log("📦 Compiling contract...");
                const { abi, bytecode } = await compileForDeploy(code, readProject(body));

                if (!bytecode || bytecode.length < 10) {
                    throw new Error("Compilation produced invalid bytecode");
                }

                // Create clients
                const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey as `0x${string}` : `0x${privateKey}`);

                const publicClient = createPublicClient({
                    chain,
                    transport: http(targetRpc),
                });

                const walletClient = createWalletClient({
                    account,
                    chain,
                    transport: http(targetRpc),
                });

                // Deploy
                console.log("🚀 Sending deployment transaction...");
                const formattedBytecode = bytecode.startsWith('0x') ? bytecode : `0x${bytecode}`;

                const hash = await walletClient.deployContract({
                    abi,
                    bytecode: formattedBytecode as `0x${string}`,
                    args: [],
                });

                console.log(`📝 TX Hash: ${hash}`);

                // Wait for receipt
                const receipt = await publicClient.waitForTransactionReceipt({ hash });
                const address = receipt.contractAddress;

                console.log(`✅ Deployed to: ${address}`);

                return NextResponse.json({
                    success: true,
                    address,
                    txHash: hash,
                    logs: `Contract deployed to: ${address}\nTransaction: ${hash}`,
                    gasUsed: receipt.gasUsed?.toString()
                });
            } catch (error) {
                console.error("❌ Deployment failed:", error);
                return NextResponse.json({
                    success: false,
                    error: error instanceof Error ? error.message : "Deployment Failed"
                }, { status: 500 });
            }
        }

        if (action === "transfer") {
            console.log(`💸 Transfer: ${amount} to ${toAddress}`);
            const isMainnet = network === "mainnet";
            const targetRpc = isMainnet ? RPC_MAINNET : RPC_TESTNET;
            const chain = isMainnet ? monadMainnet : monadTestnet;

            // Validate caller input before reporting server configuration, so a
            // typo'd address always surfaces as a 400 rather than a 500.
            if (!isAddress(toAddress ?? "")) {
                return NextResponse.json({ error: "Invalid recipient address" }, { status: 400 });
            }
            if (!/^\d+(\.\d+)?$/.test(String(amount)) || Number(amount) <= 0) {
                return NextResponse.json({ error: "Amount must be a positive decimal number" }, { status: 400 });
            }

            const privateKey = process.env.PRIVATE_KEY;
            if (!privateKey) {
                return NextResponse.json({ error: "Server Error: Missing PRIVATE_KEY" }, { status: 500 });
            }

            try {
                const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey as `0x${string}` : `0x${privateKey}`);

                const publicClient = createPublicClient({ chain, transport: http(targetRpc) });
                const walletClient = createWalletClient({ account, chain, transport: http(targetRpc) });

                const hash = await walletClient.sendTransaction({
                    to: getAddress(toAddress),
                    // parseEther keeps full wei precision; float maths silently corrupts
                    // amounts like 1.1 into 1100000000000000100 wei.
                    value: parseEther(String(amount)),
                });

                await publicClient.waitForTransactionReceipt({ hash });
                return NextResponse.json({ success: true, txHash: hash });
            } catch (error) {
                const message = error instanceof Error ? error.message : "Transfer Failed";
                return NextResponse.json({ error: message }, { status: 500 });
            }
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });

    } catch (error) {
        console.error("❌ API Error:", error);
        const message = error instanceof Error ? error.message : "Unexpected server error";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
