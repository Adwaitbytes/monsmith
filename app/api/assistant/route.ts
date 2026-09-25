import { NextResponse } from "next/server";

import { callAI, hasAIProvider, MISSING_PROVIDER_MESSAGE } from "@/lib/aiClient";
import { getApiViewer } from "@/lib/auth/server";
import { LIMITS, rateLimit, tooManyRequests } from "@/lib/rateLimit";

/**
 * The assistant, answering about the contract actually on screen.
 *
 * A chat box that has not read your code is a worse search engine. What makes
 * this worth having is the context it is handed with every turn: the open file,
 * the findings the audit produced, the compiler's complaints. Asked "why is
 * this unsafe", it can answer about line 41 of the thing in front of you rather
 * than about reentrancy in general, and that difference is the whole feature.
 *
 * The conversation is kept by the client and replayed here. That keeps this
 * route stateless, which is what lets it run anywhere, and it means closing the
 * panel loses a chat rather than orphaning a row in a database.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are a smart contract engineer helping someone with the code in front of them.

How to answer:
- Lead with the answer. No preamble, no restating the question.
- Refer to their actual code by line and name. Never explain a concept in the
  abstract when their file shows a concrete case of it.
- Be concrete about consequences. "An attacker drains the pool" beats "this is
  a security risk".
- When you are not sure, say which part you are unsure about rather than
  hedging the whole answer.
- Short paragraphs. Code blocks for code. No bulleted lists of generic advice.
- Never open with "Great question" or close by offering further help.
- Do not use em dashes.

You are talking to a developer. Assume they know Solidity and skip the basics
unless they ask.`;

interface Turn {
    role: "user" | "assistant";
    content: string;
}

interface AssistantBody {
    message?: unknown;
    history?: unknown;
    /** The file the developer is looking at. */
    code?: unknown;
    fileName?: unknown;
    /** Findings already produced, so the assistant argues from the same facts. */
    findings?: unknown;
}

function readHistory(value: unknown): Turn[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((entry): entry is Turn => {
            if (typeof entry !== "object" || entry === null) return false;
            const turn = entry as { role?: unknown; content?: unknown };
            return (
                (turn.role === "user" || turn.role === "assistant") &&
                typeof turn.content === "string"
            );
        })
        // Only the recent past is worth the tokens, and an unbounded history is
        // how a long conversation starts costing more than it returns.
        .slice(-8);
}

function readFindings(value: unknown): string {
    if (!Array.isArray(value)) return "";
    const lines = value
        .filter((entry): entry is { severity?: string; title?: string; line?: number } => {
            return typeof entry === "object" && entry !== null;
        })
        .slice(0, 20)
        .map((finding) => {
            const where = typeof finding.line === "number" ? ` (line ${finding.line})` : "";
            return `- [${String(finding.severity ?? "info")}] ${String(finding.title ?? "")}${where}`;
        });
    return lines.length > 0 ? `\nThe audit already found:\n${lines.join("\n")}\n` : "";
}

export async function POST(req: Request) {
    // Metered before any work: this route spends real compute for
    // anyone who asks, and nothing was counting how often.
    const viewer = await getApiViewer();
    const budget = await rateLimit(req, LIMITS.assistant, viewer.userId);
    if (!budget.ok) return tooManyRequests(budget, "assistant messages");

    if (!hasAIProvider()) {
        return NextResponse.json({ error: MISSING_PROVIDER_MESSAGE }, { status: 503 });
    }

    let body: AssistantBody;
    try {
        body = (await req.json()) as AssistantBody;
    } catch {
        return NextResponse.json({ error: "Malformed request." }, { status: 400 });
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message.length === 0) {
        return NextResponse.json({ error: "Ask something first." }, { status: 400 });
    }

    const history = readHistory(body.history);
    const code = typeof body.code === "string" ? body.code : "";
    const fileName = typeof body.fileName === "string" ? body.fileName : "the open file";

    // Numbered, because an answer that cites a line is only useful if the model
    // was looking at the same numbering the editor shows.
    const numbered =
        code.length === 0
            ? "(no file is open)"
            : code
                  .split("\n")
                  .map((line, index) => `${String(index + 1).padStart(4)} | ${line}`)
                  .join("\n")
                  .slice(0, 18_000);

    const conversation = history
        .map((turn) => `${turn.role === "user" ? "Developer" : "You"}: ${turn.content}`)
        .join("\n\n");

    const prompt = `${fileName}:
\`\`\`
${numbered}
\`\`\`
${readFindings(body.findings)}
${conversation.length > 0 ? `Earlier in this conversation:\n${conversation}\n\n` : ""}Developer: ${message}`;

    try {
        const answer = await callAI(prompt, SYSTEM, undefined, Date.now() + 45_000, 0, {
            temperature: 0.4,
            maxTokens: 1400,
        });
        return NextResponse.json({ answer: answer.trim() });
    } catch (error) {
        console.error("Assistant failed:", error);
        return NextResponse.json(
            { error: "The assistant could not answer just now. Try again." },
            { status: 502 },
        );
    }
}
