-- Disposable PostgreSQL only: Studio ownership, CAS, wallets and job TTL.
DO $$
DECLARE
  owner_id uuid;
  draft_id uuid;
  ledger_id uuid;
  affected integer;
  credits_before integer;
  credits_after integer;
BEGIN
  INSERT INTO users(email) VALUES ('studio-ci-owner@example.invalid') RETURNING id INTO owner_id;
  INSERT INTO credits(user_id,balance,image_balance,video_balance)
    VALUES (owner_id,100,20,200);
  SELECT balance INTO credits_before FROM credits WHERE user_id=owner_id;

  INSERT INTO studio_drafts(user_id,brief,content)
    VALUES(owner_id,'{"brand":"CI"}'::jsonb,'{"post":"draft"}'::jsonb)
    RETURNING id INTO draft_id;
  UPDATE studio_drafts SET revision=revision+1,state='REVIEW_REQUIRED'
    WHERE id=draft_id AND user_id=owner_id AND revision=1;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Draft CAS should succeed once'; END IF;
  UPDATE studio_drafts SET revision=revision+1 WHERE id=draft_id AND user_id=owner_id AND revision=1;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'Stale CAS was accepted'; END IF;

  INSERT INTO studio_orders(user_id,service,price_krw,paid_krw,cash_cost_krw,
    labor_minutes,labor_rate_krw,labor_cost_krw,fee_krw,contribution_krw)
  VALUES(owner_id,'synthetic',100,100,10,60,20,20,5,65);
  SELECT balance INTO credits_after FROM credits WHERE user_id=owner_id;
  IF credits_after<>credits_before THEN RAISE EXCEPTION 'Order mutated credits'; END IF;

  INSERT INTO wallet_grants(user_id,day,text_granted,image_granted,video_granted)
  VALUES(owner_id,(now() AT TIME ZONE 'UTC')::date,10,2,0);
  INSERT INTO wallet_grants(user_id,day,text_granted,image_granted,video_granted)
  VALUES(owner_id,(now() AT TIME ZONE 'UTC')::date,10,2,0)
  ON CONFLICT(user_id,day) DO NOTHING;
  IF (SELECT COUNT(*) FROM wallet_grants WHERE user_id=owner_id)<>1 THEN
    RAISE EXCEPTION 'Grant day uniqueness broken';
  END IF;

  UPDATE credits SET video_reserved=80 WHERE user_id=owner_id;
  INSERT INTO usage_ledger(user_id,idem_key,reserved_amount,modality,
    reserved_until,price_snapshot,model)
  VALUES(owner_id,'studio-synthetic-video',80,'video',now()+interval '3600 seconds','mock-only','test-model')
  RETURNING id INTO ledger_id;
  INSERT INTO studio_jobs(user_id,ledger_id,modality,model,status)
  VALUES(owner_id,ledger_id,'video','test-model','running');

  IF EXISTS(SELECT 1 FROM usage_ledger WHERE id=ledger_id AND reserved_until < now()+interval '600 seconds') THEN
    RAISE EXCEPTION 'Video unexpectedly expires at 600 seconds';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM usage_ledger WHERE id=ledger_id AND reserved_until < now()+interval '3601 seconds') THEN
    RAISE EXCEPTION 'Video does not expire after 3600 seconds';
  END IF;
  IF (SELECT text_balance=balance AND text_reserved=reserved FROM credits WHERE user_id=owner_id) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Generated text wallet aliases are inconsistent';
  END IF;
END $$;
