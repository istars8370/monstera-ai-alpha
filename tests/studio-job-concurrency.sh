#!/usr/bin/env bash
# Runs only against the PostgreSQL 16 service created for GitHub Actions.
# This proves row-lock / SKIP LOCKED behavior on real PostgreSQL, not a mock.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  echo "Refusing to run Studio race test outside GitHub Actions disposable DB" >&2
  exit 1
fi
PSQL=(docker run --rm -i --network host -e PGPASSWORD=ephemeral_only postgres:16
  psql -h 127.0.0.1 -U integration_user -d monstera_integration -X -v ON_ERROR_STOP=1 -qAt)
"${PSQL[@]}" <<'SQL'
INSERT INTO users(email) VALUES ('studio-race@example.invalid');
INSERT INTO credits(user_id,video_balance,video_reserved)
  SELECT id,100,80 FROM users WHERE email='studio-race@example.invalid';
INSERT INTO usage_ledger(user_id,idem_key,modality,reserved_amount,reserved_until,model,price_snapshot)
  SELECT id,'race-job','video',80,now()-interval '5 seconds','fake-video','offline'
  FROM users WHERE email='studio-race@example.invalid';
INSERT INTO studio_jobs(user_id,ledger_id,modality,model,status)
  SELECT l.user_id,l.id,'video','fake-video','running' FROM usage_ledger l WHERE l.idem_key='race-job';
SQL

# Transaction A holds the same ledger + job locks used by finalizeStudioJob.
# Its advisory lock is only a test handshake indicating both row locks are held.
"${PSQL[@]}" > /tmp/studio-job-finalize.log 2>&1 <<'SQL' &
BEGIN;
SELECT l.id FROM usage_ledger l JOIN studio_jobs j ON j.ledger_id=l.id
 WHERE l.idem_key='race-job' FOR UPDATE OF l,j;
SELECT pg_advisory_xact_lock(17031703);
SELECT pg_sleep(6);
UPDATE credits SET video_balance=video_balance-30,video_reserved=video_reserved-80
 WHERE user_id=(SELECT id FROM users WHERE email='studio-race@example.invalid') AND video_reserved>=80;
UPDATE usage_ledger SET status='settled',settled_amount=30 WHERE idem_key='race-job' AND status='held';
UPDATE studio_jobs SET status='succeeded',finished_at=now()
 WHERE ledger_id=(SELECT id FROM usage_ledger WHERE idem_key='race-job') AND status='running';
COMMIT;
SQL
FINALIZER_PID=$!
trap 'kill "$FINALIZER_PID" 2>/dev/null || true' EXIT
ready=0
for attempt in $(seq 1 25); do
  state=$("${PSQL[@]}" -c "SELECT CASE WHEN pg_try_advisory_lock(17031703) THEN 'free' ELSE 'locked' END")
  if [[ "$state" == "locked" ]]; then ready=1; break; fi
  sleep 0.1
done
if [[ "$ready" != "1" ]]; then
  cat /tmp/studio-job-finalize.log >&2
  echo "Row-lock holder never reached the concurrency barrier" >&2
  exit 1
fi

# While A is inside the critical section, a reclaimer must skip that row.
skipped=$("${PSQL[@]}" -c "
 SELECT count(*) FROM (
  SELECT j.id FROM usage_ledger l JOIN studio_jobs j ON j.ledger_id=l.id
   WHERE l.status='held' AND j.status IN ('queued','running')
    AND l.reserved_until < now() AND j.created_at < now()
   ORDER BY l.reserved_until FOR UPDATE OF l,j SKIP LOCKED LIMIT 100
 ) locked_jobs;")
[[ "$skipped" == "0" ]] || { echo "SKIP LOCKED returned a job being finalized" >&2; exit 1; }
kill -0 "$FINALIZER_PID" || { echo "Finalizer finished before SKIP LOCKED checked" >&2; exit 1; }
wait "$FINALIZER_PID"
trap - EXIT

state=$("${PSQL[@]}" -c "
 SELECT CASE WHEN c.video_balance=70 AND c.video_reserved=0 AND
   l.status='settled' AND l.settled_amount=30 AND j.status='succeeded'
   THEN 'ATOMIC_SUCCESS' ELSE 'BROKEN' END
 FROM users u JOIN credits c ON c.user_id=u.id
 JOIN usage_ledger l ON l.user_id=u.id
 JOIN studio_jobs j ON j.ledger_id=l.id
 WHERE u.email='studio-race@example.invalid' AND l.idem_key='race-job';")
[[ "$state" == "ATOMIC_SUCCESS" ]] || { echo "Job and wallet did not reach one consistent terminal state" >&2; exit 1; }
echo "STUDIO_JOB_SKIPPED_LOCKED_RACE_PASS"
