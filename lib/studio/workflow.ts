export const CHANNELS = ["naver-cafe", "naver-blog", "discord"] as const;
export const REVIEW_CHECKS = ["edited", "rights", "facts", "commercial", "likeness"] as const;
export type Channel = (typeof CHANNELS)[number];
export type StudioState = "DRAFT" | "REVIEW_REQUIRED" | "APPROVED" | "EXPORTED";
export interface Brief { brand: string; industry: string; purpose: string; audience: string; channel: Channel; length: "short" | "medium" | "long"; }
export interface Content { post: string; hashtags: string; imagePrompt: string; }
export interface StudioRecord { id: string; userId: string; revision: number; state: StudioState; brief: Brief; content: Content; checks: Record<(typeof REVIEW_CHECKS)[number], boolean> | null; }
export class StudioInputError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function bounded(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
export function validateBrief(value: unknown): Brief {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StudioInputError(400, "브리프를 확인하세요.");
  const v = value as Record<string, unknown>;
  if (!CHANNELS.includes(v.channel as Channel) || !["short", "medium", "long"].includes(String(v.length))) throw new StudioInputError(400, "채널과 분량을 확인하세요.");
  for (const [key, max] of [["brand", 80], ["industry", 80], ["purpose", 300], ["audience", 200]] as const) {
    if (!bounded(v[key], 1, max)) throw new StudioInputError(400, "브리프 입력 길이를 확인하세요.");
  }
  return {brand:(v.brand as string).trim(),industry:(v.industry as string).trim(),purpose:(v.purpose as string).trim(),audience:(v.audience as string).trim(),channel:v.channel as Channel,length:v.length as Brief["length"]};
}
export function validateContent(value: unknown): Content {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StudioInputError(400, "내용을 확인하세요.");
  const v = value as Record<string, unknown>;
  for (const [key, min, max] of [["post",1,15000],["hashtags",0,300],["imagePrompt",1,2000]] as const) {
    if (!bounded(v[key],min,max)) throw new StudioInputError(400, "제작 내용의 길이를 확인하세요.");
  }
  return {post:(v.post as string).trim(),hashtags:(v.hashtags as string).trim(),imagePrompt:(v.imagePrompt as string).trim()};
}
export function demoContent(brief: Brief): Content {
  const limits = {short:250,medium:600,long:1200};
  const label = brief.brand.replace(/[^\p{L}\p{N}]/gu,"").slice(0,40) || "브랜드";
  return {post:("[DEMO · 수동 편집용 초안]\n"+brief.brand+" | "+brief.industry+"\n대상: "+brief.audience+"\n목적: "+brief.purpose+"\n\n[제목] [검증된 사실] [행동 요청]\n실제 게시·납품 전 사람이 검수해야 합니다.").slice(0,limits[brief.length]), hashtags:"#"+label, imagePrompt:brief.brand+"의 독창적인 브랜드 비주얼 지시서. 제3자 권리·초상권 확인 전 생성·게시 금지."};
}
export type Action = "edit" | "review" | "approve" | "export";
export function applyAction(record: StudioRecord, action: Action, revision: number, payload: { content?: unknown; checks?: unknown } = {}): StudioRecord {
  if (!Number.isSafeInteger(revision) || revision !== record.revision) throw new StudioInputError(409,"버전이 변경됐습니다.");
  if (action === "edit") return {...record,content:validateContent(payload.content),state:"DRAFT",checks:null,revision:revision+1};
  if (action === "review" && record.state === "DRAFT") return {...record,state:"REVIEW_REQUIRED",revision:revision+1};
  if (action === "approve" && record.state === "REVIEW_REQUIRED") {
    const checks = payload.checks as Record<string,unknown> | undefined;
    if (!checks || !REVIEW_CHECKS.every(key=>checks[key]===true)) throw new StudioInputError(400,"5개 검수 항목을 확인하세요.");
    return {...record,state:"APPROVED",checks:checks as StudioRecord["checks"],revision:revision+1};
  }
  if (action === "export" && (record.state === "APPROVED" || record.state === "EXPORTED")) return {...record,state:"EXPORTED",revision:revision+1};
  throw new StudioInputError(409,"현재 상태에서 실행할 수 없습니다.");
}
export function exportApproved(record: StudioRecord): string {
  if (record.state !== "APPROVED" && record.state !== "EXPORTED") throw new StudioInputError(409,"승인되지 않았습니다.");
  const block=(value:string)=>value.split("\n").map(line=>"    "+line).join("\n");
  return "# 승인된 콘텐츠 · 수동 전달용\n\n게시/전송 미실행\n\n"+(["post","hashtags","imagePrompt"] as const).map(k=>"## "+k+"\n\n"+block(record.content[k])).join("\n\n");
}
