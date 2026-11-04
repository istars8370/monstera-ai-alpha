import { getPool } from "@/db/pool";
import type { RegistryModel, RegistryReader, Tier } from "@/lib/router";

const validTiers = new Set<Tier>(["free", "creator", "studio"]);

// 모델 목록은 DB의 활성화 상태와 최소 등급을 기준으로 조회한다.
export class DatabaseModelRegistry implements RegistryReader {
  async findEnabled(id: string): Promise<RegistryModel | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    const result = await getPool().query<{
      id: string;
      provider: string;
      upstream_id: string;
      tier_min: string;
      enabled: boolean;
    }>(
      `SELECT id, provider, upstream_id, tier_min, enabled
       FROM model_registry WHERE id = $1 AND enabled = true LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    if (!row || !validTiers.has(row.tier_min as Tier)) return null;
    return {
      id: row.id,
      provider: row.provider,
      upstreamId: row.upstream_id,
      tierMin: row.tier_min as Tier,
      enabled: row.enabled,
    };
  }
}
