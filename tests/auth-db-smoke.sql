-- Disposable PostgreSQL Google identity and account isolation regression.
BEGIN;
INSERT INTO users(email) VALUES ('legacy@example.invalid');

DO $$
DECLARE first_id uuid; matched_id uuid; other_id uuid; credits_count integer;
BEGIN
  INSERT INTO users(email, google_sub, email_verified_at)
    VALUES ('alpha@example.invalid','google-immutable-alpha',now()) RETURNING id INTO first_id;
  INSERT INTO credits(user_id, balance, reserved) VALUES (first_id, 0, 0);
  -- A signed subject may update its verified email without changing identity or balance.
  INSERT INTO users(email, google_sub, email_verified_at)
    VALUES ('alpha-renamed@example.invalid','google-immutable-alpha',now())
    ON CONFLICT (google_sub) DO UPDATE SET email=excluded.email, email_verified_at=now()
    RETURNING id INTO matched_id;
  IF matched_id IS DISTINCT FROM first_id THEN RAISE EXCEPTION 'Google subject changed account ID'; END IF;
  SELECT COUNT(*) INTO credits_count FROM credits WHERE user_id = first_id;
  IF credits_count <> 1 THEN RAISE EXCEPTION 'Credits account reinitialized'; END IF;
  -- Another Google subject may NOT claim an email already owned by somebody else.
  BEGIN
    INSERT INTO users(email, google_sub, email_verified_at)
      VALUES ('alpha-renamed@example.invalid','google-impostor',now())
      ON CONFLICT (google_sub) DO UPDATE SET email=excluded.email, email_verified_at=now();
    RAISE EXCEPTION 'Email-based takeover was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- Legacy accounts (nullable google_sub) require explicit verified linking.
  BEGIN
    INSERT INTO users(email, google_sub, email_verified_at)
      VALUES ('legacy@example.invalid','google-new-owner',now())
      ON CONFLICT (google_sub) DO UPDATE SET email=excluded.email, email_verified_at=now();
    RAISE EXCEPTION 'Legacy email-only account was automatically linked';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- Multiple subjects are isolated, even if user tier differs.
  INSERT INTO users(email, google_sub, email_verified_at, tier)
    VALUES ('bravo@example.invalid','google-immutable-bravo',now(),'creator')
    RETURNING id INTO other_id;
  INSERT INTO credits(user_id, balance, reserved) VALUES (other_id, 55, 0);
  IF (SELECT balance FROM credits WHERE user_id=first_id) <> 0 THEN RAISE EXCEPTION 'Cross-account balance leak'; END IF;
  IF (SELECT COUNT(*) FROM credits WHERE user_id=first_id AND user_id=other_id) <> 0 THEN
    RAISE EXCEPTION 'Shared user identity';
  END IF;
END $$;
ROLLBACK;
