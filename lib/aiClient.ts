/**
 * Shared AI provider chain.
 *
 * Every AI-backed route needs the same thing: try the configured providers in
 * order, give each one a hard timeout, and stay inside a single wall-clock
 * budget so the platform returns JSON instead of killing the function and
 * handing the browser an HTML error page to parse. This used to live inside the
 * agent route, which meant a second route could only have it by copying it.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CHAINGPT_API_KEY = process.env.CHAINGPT_API_KEY;
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
/** Optional comma-separated override; empty means use OPENROUTER_FALLBACKS as-is. */
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const CHAINGPT_API_URL = "https://api.chaingpt.org/chat/stream";

/** True when at least one provider is configured. */
export function hasAIProvider(): boolean {
    return Boolean(OPENAI_API_KEY || OPENROUTER_API_KEY || GROQ_API_KEY || CHAINGPT_API_KEY);
}

export const MISSING_PROVIDER_MESSAGE =
    "No AI provider configured. Set OPENAI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY or CHAINGPT_API_KEY in .env.local.";

/**
 * Per-call tuning. Rewriting a whole contract needs a far larger completion and
 * a longer leash than answering a chat question, and defaults sized for chat
 * silently truncate it half way through a function body.
 */
export interface AIOptions {
    maxTokens?: number;
    temperature?: number;
    modelTimeoutMs?: number;
    /**
     * How hard a reasoning model thinks before answering, where the provider
     * supports it. Left unset, some models spend the whole token budget
     * thinking on a long prompt and return an empty answer.
     */
    reasoningEffort?: "low" | "medium" | "high";
}

type ResolvedOptions = Required<Omit<AIOptions, "reasoningEffort">> & Pick<AIOptions, "reasoningEffort">;

const DEFAULT_OPTIONS: ResolvedOptions = {
    maxTokens: 4096,
    temperature: 0.3,
    modelTimeoutMs: 20_000,
};

function addressToUUID(address: string) {
    const clean = address.replace("0x", "").toLowerCase().padEnd(32, "0");
    return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20, 32)}`;
}

// --- OPENAI API HELPER (Primary - Most Powerful) ---
async function callOpenAIAPI(
    prompt: string,
    systemRole: string = "You are a helpful AI assistant.",
    options: ResolvedOptions = DEFAULT_OPTIONS
): Promise<string> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured");


    const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gpt-4o",
            messages: [
                { role: "system", content: systemRole },
                { role: "user", content: prompt }
            ],
            temperature: options.temperature,
            max_tokens: options.maxTokens
        })
    });

    if (!response.ok) {
        const err = await response.text();
        console.error("❌ OpenAI API error:", err);
        throw new Error(`OpenAI API error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
}

// --- OPENROUTER API HELPER (OpenAI-compatible, multi-provider) ---

/**
 * Models tried in order, fastest first.
 *
 * Ordering is measured, not guessed: gpt-4o-mini and gemini-2.5-flash both
 * return compilable Solidity in ~2.5s, while the free 550B model takes ~15s.
 * Three slow attempts overran the 60s function limit, and the client then got
 * a plain-text platform error page instead of JSON. Free models sit last as a
 * safety net rather than the default.
 *
 * OPENROUTER_MODEL accepts a comma-separated list to override the order.
 */
const OPENROUTER_FALLBACKS = [
    "openai/gpt-4o-mini",
    "google/gemini-2.5-flash",
    "deepseek/deepseek-chat",
];

/**
 * Whole-request budget, kept under the 60s serverless function limit. Exceeding
 * it means the platform returns a plain-text error page, which the browser then
 * fails to parse as JSON.
 */
export const REQUEST_BUDGET_MS = 50_000;

function openRouterModels(offset = 0): string[] {
    const configured = OPENROUTER_MODEL.split(",").map((m) => m.trim()).filter(Boolean);
    const all = [...configured, ...OPENROUTER_FALLBACKS.filter((m) => !configured.includes(m))];
    // Rotating on retry means a model that just produced broken output is not the
    // one asked to fix it. Different models fail in different places.
    const start = offset % all.length;
    return [...all.slice(start), ...all.slice(0, start)];
}

async function callOpenRouterModel(
    model: string,
    prompt: string,
    systemRole: string,
    timeoutMs: number,
    options: ResolvedOptions
): Promise<string> {
    // Without an abort, one hung provider consumes the entire request budget and
    // the platform kills the function before any fallback is reached.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(OPENROUTER_API_URL, {
            method: "POST",
            signal: controller.signal,
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                // OpenRouter attributes usage to these; both are optional but recommended.
                "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
                "X-Title": "Monsmith"
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: systemRole },
                    { role: "user", content: prompt }
                ],
                temperature: options.temperature,
                max_tokens: options.maxTokens,
                ...(options.reasoningEffort === undefined ? {} : { reasoning: { effort: options.reasoningEffort } })
            })
        });

        if (!response.ok) {
            throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        // Reasoning models can spend the whole budget on reasoning and return nothing.
        if (!content) throw new Error("empty completion");
        // A completion cut off at the token cap is half an answer, and half a
        // JSON answer parses as nothing. Failing here lets the next model try.
        if (data.choices?.[0]?.finish_reason === "length") {
            throw new Error(`cut off at the token cap after ${data.usage?.completion_tokens ?? "?"} tokens (${data.usage?.completion_tokens_details?.reasoning_tokens ?? 0} reasoning)`);
        }
        return content;
    } finally {
        clearTimeout(timer);
    }
}

async function callOpenRouterAPI(
    prompt: string,
    systemRole: string = "You are a helpful AI assistant.",
    deadline: number = Date.now() + REQUEST_BUDGET_MS,
    modelOffset = 0,
    options: ResolvedOptions = DEFAULT_OPTIONS
): Promise<string> {
    if (!OPENROUTER_API_KEY) throw new Error("OpenRouter API key not configured");

    const failures: string[] = [];

    for (const model of openRouterModels(modelOffset)) {
        const remaining = deadline - Date.now();
        // Stop rather than start an attempt that cannot finish before the
        // platform terminates the function.
        if (remaining < 3_000) {
            failures.push("out of time budget");
            break;
        }

        try {
            return await callOpenRouterModel(
                model,
                prompt,
                systemRole,
                Math.min(options.modelTimeoutMs, remaining),
                options
            );
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            console.warn(`[ai] OpenRouter model ${model} failed: ${reason}`);
            failures.push(`${model}: ${reason}`);
        }
    }

    throw new Error(`All OpenRouter models failed. ${failures.join(" | ")}`);
}

// --- GROQ API HELPER (Fast Fallback) ---
async function callGroqAPI(
    prompt: string,
    systemRole: string = "You are a helpful AI assistant.",
    options: ResolvedOptions = DEFAULT_OPTIONS
): Promise<string> {
    if (!GROQ_API_KEY) throw new Error("Groq API key not configured");


    const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${GROQ_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: systemRole },
                { role: "user", content: prompt }
            ],
            temperature: options.temperature,
            max_tokens: options.maxTokens
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Groq API error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
}

// --- CHAINGPT API HELPER (Web3 Specialized Fallback) ---
async function callChainGPTAPI(model: string, question: string, userAddress?: string): Promise<string> {
    if (!CHAINGPT_API_KEY) throw new Error("ChainGPT API key not configured");

    const response = await fetch(CHAINGPT_API_URL, {
        method: "POST",
        headers: { "Authorization": `Bearer ${CHAINGPT_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            question,
            chatHistory: "on",
            sdkUniqueId: userAddress ? addressToUUID(userAddress) : undefined
        })
    });
    const raw = await response.text();
    try { return JSON.parse(raw).data?.bot || raw; } catch { return raw; }
}

// --- UNIFIED AI CALL (OpenAI Primary -> Groq -> ChainGPT) ---
/**
 * Named models first, then the usual chain.
 *
 * The default chain is tuned for speed and cost, which suits chat and triage.
 * Some work, like rewriting a contract that people will deploy, is worth a
 * stronger model, so the caller names the models it wants tried first and only
 * falls back to the default chain if all of them fail.
 */
export async function callPreferredAI(
    preferred: readonly string[],
    prompt: string,
    systemRole: string,
    deadline: number,
    overrides: AIOptions = {}
): Promise<string> {
    return (await callPreferredAIAnswered(preferred, prompt, systemRole, deadline, overrides)).text;
}

/**
 * The same, saying which named model answered, or null when none did and the
 * default chain took over. A report that credits a model with checking its
 * findings has to know that model is the one that actually did.
 */
export async function callPreferredAIAnswered(
    preferred: readonly string[],
    prompt: string,
    systemRole: string,
    deadline: number,
    overrides: AIOptions = {}
): Promise<{ text: string; model: string | null }> {
    const options: ResolvedOptions = { ...DEFAULT_OPTIONS, ...overrides };
    if (OPENROUTER_API_KEY) {
        for (const model of preferred) {
            const remaining = deadline - Date.now();
            if (remaining < 3_000) break;
            try {
                return { text: await callOpenRouterModel(model, prompt, systemRole, Math.min(options.modelTimeoutMs, remaining), options), model };
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                console.warn(`[ai] Preferred model ${model} failed, falling back: ${reason}`);
            }
        }
    }
    return { text: await callAI(prompt, systemRole, undefined, deadline, 0, overrides), model: null };
}

export async function callAI(
    prompt: string,
    systemRole: string,
    userAddress?: string,
    deadline: number = Date.now() + REQUEST_BUDGET_MS,
    modelOffset = 0,
    overrides: AIOptions = {}
): Promise<string> {
    const options: ResolvedOptions = { ...DEFAULT_OPTIONS, ...overrides };
    // Try OpenAI first (most powerful)
    if (OPENAI_API_KEY) {
        try {
            return await callOpenAIAPI(prompt, systemRole, options);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[ai] OpenAI failed, falling back: ${message}`);
        }
    }

    // Try OpenRouter second (broad model access, free tiers)
    if (OPENROUTER_API_KEY) {
        try {
            return await callOpenRouterAPI(prompt, systemRole, deadline, modelOffset, options);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[ai] OpenRouter failed, falling back: ${message}`);
        }
    }

    // Try Groq third (fast)
    if (GROQ_API_KEY) {
        try {
            return await callGroqAPI(prompt, systemRole, options);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[ai] Groq failed, falling back: ${message}`);
        }
    }

    // Try ChainGPT last
    if (CHAINGPT_API_KEY) {
        try {
            return await callChainGPTAPI("general_assistant", prompt, userAddress);
        } catch (error) {
            console.error("❌ ChainGPT also failed:", error);
        }
    }

    throw new Error("All AI services unavailable");
}
