export type ChatConfig = { provider: "venice" | "openrouter"; key: string; models: string[] };

// A typo must never send messages to another vendor.
export function chatConfig(env: NodeJS.ProcessEnv = process.env): ChatConfig | null {
  const provider = env.ALPHA_CHAT_PROVIDER;
  if (provider !== "venice" && provider !== "openrouter") return null;
  const key = provider === "venice" ? env.VENICE_API_KEY : env.OPENROUTER_API_KEY;
  const configured = provider === "venice" ? env.VENICE_PRIVATE_MODEL_IDS || env.VENICE_PRIVATE_MODEL_ID : env.ALPHA_MODEL_ID;
  const models = [...new Set((configured || "").split(",").map(id => id.trim()).filter(Boolean))];
  if (!key || !models.length || models.length > 20 || models.some(id => id.length > 150 || !/^[\w./:-]+$/.test(id))) return null;
  return { provider, key, models };
}
