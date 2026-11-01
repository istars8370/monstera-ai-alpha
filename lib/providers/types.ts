// 공급자별 구현체는 이 계약을 준수하며, 이 파일에는 구현 로직을 두지 않는다.
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface ChatRequest {
  model: string;
  messages: readonly ChatMessage[];
  signal?: AbortSignal;
}
export interface Chunk {
  type: "delta" | "usage" | "done";
  text?: string;
  usage?: { inputTokens: number; outputTokens: number };
}
export interface ModelInfo {
  id: string;
  name: string;
}
export interface HealthStatus {
  healthy: boolean;
  latencyMs?: number;
}
export interface ProviderAdapter {
  chatStream(req: ChatRequest): AsyncIterable<Chunk>;
  listModels(): Promise<readonly ModelInfo[]>;
  healthCheck(): Promise<HealthStatus>;
}
