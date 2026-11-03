#!/usr/bin/env bash
# Real PostgreSQL worker lease contention. Disposable GitHub Actions database only.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  echo "This test is permitted only on disposable CI PostgreSQL." >&2
  exit 1
fi
PSQL=(docker run --rm -i --network host -e PGPASSWORD=ephemeral_only postgres:16
  psql -h 127.0.0.1 -U integration_user -d monstera_integration -X -v ON_ERROR_STOP=1 -qAt)

"${PSQL[@]}" <<'SQL'
INSERT INTO users(email) VALUES ('studio-lease-ci@example.invalid');
INSERT INTO credits(user_id,balance,reserved)
 SELECT id,500,100 FROM users WHERE email='studio-lease-ci@example.invalid';
INSERT INTO usage_ledger(user_id,idem_key,modality,reserved_amount,reserved_until,model,price_snapshot)
 SELECT id,'studio-lease-ci-job','text',100,now()+interval '120 seconds','fake-model','mock'
 FROM users WHERE email='studio-lease-ci@example.invalid';
INSERT INTO studio_jobs(user_id,ledger_id,modality,model,status,prompt,max_tokens,execution_mode)
 SELECT l.user_id,l.id,'text','fake-model','queued','synthetic-ci-prompt',32,'mock'
 FROM usage_ledger l WHERE l.idem_key='studio-lease-ci-job';
SQL

# Worker A holds the ledger/job row locks. Worker B must SKIP them, not block.
"${PSQL[@]}" > /tmp/studio-lease-holder.log 2>&1 <<'SQL' &
BEGIN;
SELECT j.id FROM usage_ledger l JOIN studio_jobs j ON j.ledger_id=l.id
 WHERE l.idem_key='studio-lease-ci-job' AND j.status='queued'
 FOR UPDATE OF l,j SKIP LOCKED;
SELECT pg_advisory_xact_lock(17031704);
SELECT pg_sleep(8);
UPDATE studio_jobs SET status='running',attempt_count=attempt_count+1,
 lease_token='dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 lease_until=now()+interval '60 seconds'
 WHERE ledger_id=(SELECT id FROM usage_ledger WHERE idem_key='studio-lease-ci-job');
COMMIT;
SQL
HOLDER=$!
trap 'kill "$HOLDER" 2>/dev/null || true' EXIT
ready=0
for attempt in $(seq 1 30); do
  ready_state=$("${PSQL[@]}" -c "SELECT CASE WHEN pg_try_advisory_lock(17031704) THEN 'free' ELSE 'locked' END")
  if [[ "$ready_state" == "locked" ]]; then ready=1; break; fi
  sleep 0.1
done
if [[ "$ready" != "1" ]]; then cat /tmp/studio-lease-holder.log; exit 1; fi

start=$(date +%s)
n=$("${PSQL[@]}" -c "
 SELECT count(*) FROM (
  SELECT j.id FROM usage_ledger l JOIN studio_jobs j ON j.ledger_id=l.id
  WHERE j.status='queued' AND l.idem_key='studio-lease-ci-job' AND l.status='held'
  FOR UPDATE OF l,j SKIP LOCKED LIMIT 1
 ) candidate;")
elapsed=$(( $(date +%s)-start ))
[[ "$n" == "0" && "$elapsed" -le 5 ]] ||
  { echo "Double claim or blocking on leased job" >&2; exit 1; }
wait "$HOLDER"
trap - EXIT

state=$("${PSQL[@]}" -c "
 SELECT CASE WHEN j.status='running' AND j.attempt_count=1 AND
    j.lease_token IS NOT NULL AND j.lease_until>now() THEN 'CLAIMED'
    ELSE 'BROKEN' END
 FROM studio_jobs j JOIN usage_ledger l ON l.id=j.ledger_id
 WHERE l.idem_key='studio-lease-ci-job';")
[[ "$state" == "CLAIMED" ]] || { echo "Worker claim not committed" >&2; exit 1; }

# Simulate a crash: expired lease requeues without altering the held wallet.
"${PSQL[@]}" <<'SQL'
UPDATE studio_jobs SET lease_until=now()-interval '1 second'
 WHERE lease_token='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
BEGIN;
SELECT j.id FROM usage_ledger l JOIN studio_jobs j ON j.ledger_id=l.id
 WHERE j.lease_until<now() AND j.status='running' AND l.status='held'
 FOR UPDATE OF l,j SKIP LOCKED;
UPDATE studio_jobs SET status='queued',lease_token=NULL,lease_until=NULL,last_error_code='MOCK_LEASE_EXPIRED'
 WHERE lease_token='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
COMMIT;
SQL
state=$("${PSQL[@]}" -c "
 SELECT CASE WHEN j.status='queued' AND j.attempt_count=1 AND
    j.lease_token IS NULL AND l.status='held' AND c.reserved=100
    THEN 'RECOVERED' ELSE 'BROKEN' END
 FROM studio_jobs j JOIN usage_ledger l ON l.id=j.ledger_id
 JOIN credits c ON c.user_id=j.user_id WHERE l.idem_key='studio-lease-ci-job';")
[[ "$state" == "RECOVERED" ]] || { echo "Lease recovery did not preserve hold" >&2; exit 1; }
echo "STUDIO_MOCK_WORKER_LEASE_RACE_PASS"
