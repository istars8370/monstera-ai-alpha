import { getPool } from "@/db/pool";
import {
  StudioInputError, applyAction, demoContent, exportApproved, validateBrief,
  type Action, type StudioRecord,
} from "@/lib/studio/workflow";

interface DraftRow {
  id: string;
  user_id: string;
  revision: number;
  state: StudioRecord["state"];
  brief: StudioRecord["brief"];
  content: StudioRecord["content"];
  checks: StudioRecord["checks"];
}

function fromRow(row: DraftRow): StudioRecord {
  return { id:row.id, userId:row.user_id, revision:row.revision, state:row.state,
    brief:row.brief, content:row.content, checks:row.checks };
}

const columns = "id, user_id, revision, state, brief, content, checks";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function verifyDraftId(id: string): void {
  if (!UUID.test(id)) throw new StudioInputError(404, "초안을 찾을 수 없습니다.");
}

export async function listDrafts(userId: string): Promise<StudioRecord[]> {
  const result = await getPool().query<DraftRow>(
    `SELECT ${columns} FROM studio_drafts WHERE user_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 50`,
    [userId],
  );
  return result.rows.map(fromRow);
}

export async function createDraft(userId: string, value: unknown): Promise<StudioRecord> {
  const brief = validateBrief(value);
  const content = demoContent(brief);
  const result = await getPool().query<DraftRow>(
    `INSERT INTO studio_drafts (user_id, brief, content)
     VALUES ($1, $2::jsonb, $3::jsonb) RETURNING ${columns}`,
    [userId, JSON.stringify(brief), JSON.stringify(content)],
  );
  if (!result.rows[0]) throw new Error("STUDIO_DRAFT_INSERT_FAILED");
  return fromRow(result.rows[0]);
}

export async function getDraft(userId: string, id: string): Promise<StudioRecord> {
  verifyDraftId(id);
  const result = await getPool().query<DraftRow>(
    `SELECT ${columns} FROM studio_drafts WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id,userId],
  );
  if (!result.rows[0]) throw new StudioInputError(404, "초안을 찾을 수 없습니다.");
  return fromRow(result.rows[0]);
}

/** Single conditional write is the compare-and-swap gate for revision transitions. */
export async function updateDraft(
  userId: string, id: string, action: Action, revision: number,
  payload: {content?: unknown; checks?: unknown} = {},
): Promise<StudioRecord> {
  const current = await getDraft(userId,id);
  if (!["edit","review","approve","export"].includes(action)) {
    throw new StudioInputError(400,"잘못된 작업입니다.");
  }
  const next = applyAction(current,action,revision,payload);
  const result = await getPool().query<DraftRow>(
    `UPDATE studio_drafts
     SET revision = $3, state = $4, content = $5::jsonb,
       checks = $6::jsonb, updated_at = now()
     WHERE id = $1 AND user_id = $2 AND revision = $7
     RETURNING ${columns}`,
    [id,userId,next.revision,next.state,JSON.stringify(next.content),
      next.checks ? JSON.stringify(next.checks) : null,revision],
  );
  if (!result.rows[0]) throw new StudioInputError(409,"버전 충돌: 새로고침 후 다시 시도하세요.");
  return fromRow(result.rows[0]);
}

export async function exportDraft(userId: string, id: string, revision: number): Promise<string> {
  const record = await updateDraft(userId,id,"export",revision);
  return exportApproved(record);
}
