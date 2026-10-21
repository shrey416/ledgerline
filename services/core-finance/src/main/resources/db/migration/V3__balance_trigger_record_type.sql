-- CASE resolves both record fields during planning, even when a branch is unused.
-- Use separate statements for the two distinct trigger row types.
CREATE OR REPLACE FUNCTION verify_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; total numeric; line_count bigint;
BEGIN
  IF TG_TABLE_NAME='journal_transaction' THEN
    target := NEW.id;
  ELSE
    target := NEW.transaction_id;
  END IF;
  SELECT COALESCE(SUM(signed_amount),0),COUNT(*) INTO total,line_count
    FROM journal_line WHERE transaction_id=target;
  IF total<>0 OR line_count<2 THEN
    RAISE EXCEPTION 'Unbalanced journal transaction %',target;
  END IF;
  RETURN NULL;
END $$;
