import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
export const OPENROUTER_MODEL = "anthropic/claude-sonnet-4";
export const MAX_TOKENS = 8192;

export type Provider = "anthropic" | "openrouter";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function detectProvider(): Provider {
  if (process.env["OPENROUTER_API_KEY"]) return "openrouter";
  return "anthropic";
}

export async function callAnthropic(
  messages: ChatMessage[],
  system: string,
  client: Anthropic,
): Promise<string> {
  const anthropicMessages: Anthropic.Messages.MessageParam[] = messages.map(
    (m) => ({ role: m.role, content: m.content }),
  );

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: anthropicMessages,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content in response");
  }
  return textBlock.text;
}

export async function callOpenRouter(
  messages: ChatMessage[],
  system: string,
): Promise<string> {
  const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env["OPENROUTER_API_KEY"],
  });

  const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system" as const, content: system },
    ...messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const response = await client.chat.completions.create({
    model: OPENROUTER_MODEL,
    max_tokens: MAX_TOKENS,
    messages: openaiMessages,
  });

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error("OpenRouter returned no text content in response");
  }
  return text;
}

export async function callLLM(
  messages: ChatMessage[],
  system: string,
  client?: Anthropic,
): Promise<string> {
  const provider = detectProvider();
  if (provider === "openrouter") {
    return callOpenRouter(messages, system);
  }
  const anthropicClient = client ?? new Anthropic();
  return callAnthropic(messages, system, anthropicClient);
}
