export interface QuoteInput { paid_krw: number; cash_cost_krw: number; labor_minutes: number; labor_rate_krw: number; fee_krw: number; refund_krw: number; ai_cost_krw?: number; revision_cost_krw?: number; }
export interface QuoteResult { net_revenue_krw: number; labor_cost_krw: number; contribution_krw: number; margin_pct: number | null; }
export function calculateQuote(input: QuoteInput): QuoteResult {
  if (!input || typeof input !== "object") throw new RangeError("INVALID_QUOTE");
  const fields = ["paid_krw","cash_cost_krw","labor_minutes","labor_rate_krw","fee_krw","refund_krw","ai_cost_krw","revision_cost_krw"] as const;
  for (const key of fields) {
    const value = input[key] === undefined && (key === "ai_cost_krw" || key === "revision_cost_krw") ? 0 : input[key];
    if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0 || value > 50_000_000) throw new RangeError("INVALID_"+key.toUpperCase());
  }
  if (input.labor_minutes > 30_000 || input.labor_rate_krw > 1_000_000 || input.refund_krw > input.paid_krw) throw new RangeError("INVALID_QUOTE_LIMIT");
  // Nonnegative integer KRW; labor cost rounds to nearest won, with .5 rounded upward.
  const labor_cost_krw = Math.floor((input.labor_minutes * input.labor_rate_krw + 30) / 60);
  const net_revenue_krw = input.paid_krw - input.refund_krw;
  const contribution_krw = net_revenue_krw - input.cash_cost_krw - labor_cost_krw - input.fee_krw - (input.ai_cost_krw ?? 0) - (input.revision_cost_krw ?? 0);
  if (![labor_cost_krw,net_revenue_krw,contribution_krw].every(Number.isSafeInteger)) throw new RangeError("UNSAFE_QUOTE");
  return { net_revenue_krw,labor_cost_krw,contribution_krw,margin_pct:net_revenue_krw===0?null:Math.round(contribution_krw/net_revenue_krw*1000)/10 };
}
