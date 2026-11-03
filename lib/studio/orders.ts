import { getPool } from "@/db/pool";
import { calculateQuote, type QuoteInput } from "@/lib/studio/quote";
import { StudioInputError } from "@/lib/studio/workflow";

export interface StudioOrderInput {
  service:string;
  price_krw:number;
  paid_krw:number;
  cash_cost_krw:number;
  labor_minutes:number;
  labor_rate_krw:number;
  fee_krw:number;
  revisions:number;
  refund_krw:number;
  external_customer_flag:boolean;
  rights_checked:boolean;
  delivery_accepted:boolean;
  conflict_declared:boolean;
  consent_recorded:boolean;
}
interface OrderRow {
  order_id:string;user_id:string;revision:number;
  service:string;price_krw:number;paid_krw:number;cash_cost_krw:number;
  labor_minutes:number;labor_rate_krw:number;labor_cost_krw:number;
  fee_krw:number;revisions:number;refund_krw:number;contribution_krw:number;
  external_customer_flag:boolean;rights_checked:boolean;delivery_accepted:boolean;
  conflict_declared:boolean;consent_recorded:boolean;
}
export type StudioOrder = OrderRow;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields=["external_customer_flag","rights_checked","delivery_accepted","conflict_declared","consent_recorded"] as const;
const columns="order_id,user_id,revision,service,price_krw,paid_krw,cash_cost_krw,labor_minutes,labor_rate_krw,labor_cost_krw,fee_krw,revisions,refund_krw,contribution_krw,external_customer_flag,rights_checked,delivery_accepted,conflict_declared,consent_recorded";
export function validateOrder(value:unknown): StudioOrderInput & {labor_cost_krw:number;contribution_krw:number} {
  if(!value || typeof value!=="object" || Array.isArray(value)) throw new StudioInputError(400,"주문 형식이 잘못되었습니다.");
  const input=value as Record<string,unknown>;
  if(typeof input.service!=="string" || input.service.trim().length<1 || input.service.length>128 ||
      /[\u0000-\u001f\u007f]/.test(input.service)) throw new StudioInputError(400,"서비스명을 확인하세요.");
  if(!Number.isSafeInteger(input.price_krw) || (input.price_krw as number)<0 ||
     (input.price_krw as number)>50_000_000 ||
     !Number.isSafeInteger(input.revisions) || (input.revisions as number)<0 ||
     (input.revisions as number)>10000) throw new StudioInputError(400,"주문 금액·수정 횟수를 확인하세요.");
  if(!Number.isSafeInteger(input.paid_krw) || (input.paid_krw as number)>(input.price_krw as number)) {
    throw new StudioInputError(400,"수금 기록은 계약금액을 초과할 수 없습니다.");
  }
  for(const key of fields) {
    if(typeof input[key]!=="boolean") throw new StudioInputError(400,"주문 검수 상태를 확인하세요.");
  }
  let quote;
  try {
    // Order costs are exclusive categories. AI and revision costs are included in cash_cost_krw.
    quote=calculateQuote({
      paid_krw:input.paid_krw,cash_cost_krw:input.cash_cost_krw,
      labor_minutes:input.labor_minutes,labor_rate_krw:input.labor_rate_krw,
      fee_krw:input.fee_krw,refund_krw:input.refund_krw,
    } as QuoteInput);
  } catch {throw new StudioInputError(400,"주문 원가·시간·환불을 확인하세요.");}
  return {
    service:input.service.trim(),price_krw:input.price_krw as number,
    paid_krw:input.paid_krw as number,cash_cost_krw:input.cash_cost_krw as number,
    labor_minutes:input.labor_minutes as number,labor_rate_krw:input.labor_rate_krw as number,
    fee_krw:input.fee_krw as number,revisions:input.revisions as number,
    refund_krw:input.refund_krw as number,
    external_customer_flag:input.external_customer_flag as boolean,
    rights_checked:input.rights_checked as boolean,
    delivery_accepted:input.delivery_accepted as boolean,
    conflict_declared:input.conflict_declared as boolean,
    consent_recorded:input.consent_recorded as boolean,
    labor_cost_krw:quote.labor_cost_krw,contribution_krw:quote.contribution_krw,
  };
}
export function verifyOrderId(id:string) {
  if(!UUID.test(id)) throw new StudioInputError(404,"주문을 찾을 수 없습니다.");
}
export async function listOrders(userId:string):Promise<StudioOrder[]> {
  const r=await getPool().query<OrderRow>(`SELECT ${columns} FROM studio_orders WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50`,[userId]);
  return r.rows;
}
export async function getOrder(userId:string,id:string):Promise<StudioOrder> {
  verifyOrderId(id);
  const r=await getPool().query<OrderRow>(`SELECT ${columns} FROM studio_orders WHERE order_id=$1 AND user_id=$2 LIMIT 1`,[id,userId]);
  if(!r.rows[0]) throw new StudioInputError(404,"주문을 찾을 수 없습니다.");
  return r.rows[0];
}
export async function createOrder(userId:string,input:unknown):Promise<StudioOrder> {
  const x=validateOrder(input);
  const r=await getPool().query<OrderRow>(
    `INSERT INTO studio_orders (user_id,service,price_krw,paid_krw,cash_cost_krw,labor_minutes,
    labor_rate_krw,labor_cost_krw,fee_krw,revisions,refund_krw,contribution_krw,
    external_customer_flag,rights_checked,delivery_accepted,conflict_declared,consent_recorded)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING ${columns}`,
    [userId,x.service,x.price_krw,x.paid_krw,x.cash_cost_krw,x.labor_minutes,
      x.labor_rate_krw,x.labor_cost_krw,x.fee_krw,x.revisions,x.refund_krw,x.contribution_krw,
      x.external_customer_flag,x.rights_checked,x.delivery_accepted,x.conflict_declared,x.consent_recorded]);
  if(!r.rows[0])throw new Error("STUDIO_ORDER_INSERT_FAILED");
  return r.rows[0];
}
export async function updateOrder(userId:string,id:string,revision:number,input:unknown):Promise<StudioOrder> {
  await getOrder(userId,id);
  if(!Number.isSafeInteger(revision)||revision<1)throw new StudioInputError(400,"버전을 확인하세요.");
  const x=validateOrder(input);
  const r=await getPool().query<OrderRow>(
    `UPDATE studio_orders SET revision=revision+1,
    service=$4,price_krw=$5,paid_krw=$6,cash_cost_krw=$7,labor_minutes=$8,labor_rate_krw=$9,
    labor_cost_krw=$10,fee_krw=$11,revisions=$12,refund_krw=$13,contribution_krw=$14,
    external_customer_flag=$15,rights_checked=$16,delivery_accepted=$17,conflict_declared=$18,
    consent_recorded=$19,updated_at=now()
    WHERE order_id=$1 AND user_id=$2 AND revision=$3 RETURNING ${columns}`,
    [id,userId,revision,x.service,x.price_krw,x.paid_krw,x.cash_cost_krw,x.labor_minutes,
      x.labor_rate_krw,x.labor_cost_krw,x.fee_krw,x.revisions,x.refund_krw,x.contribution_krw,
      x.external_customer_flag,x.rights_checked,x.delivery_accepted,x.conflict_declared,x.consent_recorded]);
  if(!r.rows[0])throw new StudioInputError(409,"주문 버전이 변경됐습니다.");
  return r.rows[0];
}
