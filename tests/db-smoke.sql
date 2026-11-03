-- Disposable PostgreSQL smoke test. No production connection or production credentials.
DO $$
DECLARE n integer;
BEGIN
  SELECT COUNT(*) INTO n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';
  IF n <> 9 THEN RAISE EXCEPTION 'Expected exactly nine application tables, got %', n; END IF;
END $$;

INSERT INTO users(email, email_verified_at) VALUES ('ledger-test@example.invalid', now());
INSERT INTO credits(user_id, balance, reserved)
SELECT id, 100, 0 FROM users WHERE email='ledger-test@example.invalid';

-- Reserve forty, then settle twenty, leaving eighty available.
UPDATE credits SET reserved = reserved + 40
WHERE user_id = (SELECT id FROM users WHERE email='ledger-test@example.invalid')
  AND balance - reserved >= 40;
INSERT INTO usage_ledger(user_id, idem_key, model, reserved_amount)
SELECT id, 'request-1', 'test', 40 FROM users WHERE email='ledger-test@example.invalid';
UPDATE credits SET balance = balance - 20, reserved = reserved - 40
WHERE user_id = (SELECT id FROM users WHERE email='ledger-test@example.invalid') AND reserved >= 40;
UPDATE usage_ledger SET status='settled', settled_amount=20 WHERE idem_key='request-1';

-- Duplicate idempotency key must not create another chargeable row.
INSERT INTO usage_ledger(user_id, idem_key, model, reserved_amount)
SELECT id, 'request-1', 'test', 40 FROM users WHERE email='ledger-test@example.invalid'
ON CONFLICT (user_id, idem_key) DO NOTHING;

DO $$
DECLARE c integer; b integer; r integer; n integer; u uuid;
BEGIN
  SELECT balance, reserved INTO b, r FROM credits
  WHERE user_id = (SELECT id FROM users WHERE email='ledger-test@example.invalid');
  IF b <> 80 OR r <> 0 THEN RAISE EXCEPTION 'Bad credits: balance %, reserved %', b, r; END IF;
  SELECT COUNT(*) INTO c FROM usage_ledger WHERE idem_key='request-1';
  IF c <> 1 THEN RAISE EXCEPTION 'Duplicate ledger row'; END IF;
  SELECT id INTO u FROM users WHERE email='ledger-test@example.invalid';
  -- A reservation bigger than the available balance must affect zero rows.
  UPDATE credits SET reserved = reserved + 100
  WHERE user_id=u AND balance - reserved >= 100;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'Oversubscription accepted'; END IF;
  BEGIN
    INSERT INTO usage_ledger(user_id, idem_key, model, reserved_amount, settled_amount)
    VALUES (u, 'invalid-overcharge', 'test', 1, 2);
    RAISE EXCEPTION 'Over-settlement accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO model_registry(provider, upstream_id, tier_min, ctx, price_in, price_out)
    VALUES ('openrouter', 'test', 'free', 1024, -1, 0);
    RAISE EXCEPTION 'Negative model price accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

BEGIN;
INSERT INTO users(email) VALUES ('rollback-test@example.invalid');
ROLLBACK;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE email='rollback-test@example.invalid') THEN
    RAISE EXCEPTION 'Rollback did not undo insert';
  END IF;
END $$;
