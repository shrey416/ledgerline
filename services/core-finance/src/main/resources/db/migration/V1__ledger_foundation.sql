CREATE TABLE workspace(id uuid PRIMARY KEY,name text NOT NULL,currency char(3) NOT NULL CHECK(currency='INR'));
CREATE TABLE membership(workspace_id uuid REFERENCES workspace(id),oidc_subject text,role text NOT NULL CHECK(role IN ('owner','finance','viewer')),PRIMARY KEY(workspace_id,oidc_subject));
CREATE TABLE finance_account(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspace(id),name text NOT NULL,currency char(3) NOT NULL CHECK(currency='INR'),kind text NOT NULL CHECK(kind IN ('asset','liability','expense','income')),archived boolean NOT NULL DEFAULT false,UNIQUE(workspace_id,id));
CREATE UNIQUE INDEX unique_system_account ON finance_account(workspace_id,kind,currency) WHERE kind IN ('expense','income');
CREATE TABLE journal_transaction(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspace(id),actor text NOT NULL,kind text NOT NULL CHECK(kind IN ('expense','income','transfer')),merchant text NOT NULL,amount numeric(18,2) NOT NULL CHECK(amount>0),currency char(3) NOT NULL CHECK(currency='INR'),effective_date date NOT NULL,category text NOT NULL,note text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,id));
CREATE TABLE journal_line(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace_id uuid NOT NULL,transaction_id uuid NOT NULL,account_id uuid NOT NULL,signed_amount numeric(18,2) NOT NULL CHECK(signed_amount<>0),FOREIGN KEY(workspace_id,transaction_id) REFERENCES journal_transaction(workspace_id,id),FOREIGN KEY(workspace_id,account_id) REFERENCES finance_account(workspace_id,id));
CREATE INDEX journal_account ON journal_line(workspace_id,account_id);
CREATE INDEX journal_date ON journal_transaction(workspace_id,effective_date DESC,id DESC);
CREATE TABLE command_result(workspace_id uuid NOT NULL REFERENCES workspace(id),actor text NOT NULL,key text NOT NULL,payload text NOT NULL,result_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,actor,key));
CREATE TABLE outbox_event(id uuid PRIMARY KEY,aggregatetype text NOT NULL,aggregateid text NOT NULL,type text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION verify_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; total numeric; line_count bigint;
BEGIN
  target := CASE WHEN TG_TABLE_NAME='journal_transaction' THEN NEW.id ELSE NEW.transaction_id END;
  SELECT COALESCE(SUM(signed_amount),0),COUNT(*) INTO total,line_count FROM journal_line WHERE transaction_id=target;
  IF total<>0 OR line_count<2 THEN RAISE EXCEPTION 'Unbalanced journal transaction %',target; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER balanced_transaction AFTER INSERT ON journal_transaction DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_balance();
CREATE CONSTRAINT TRIGGER balanced_lines AFTER INSERT ON journal_line DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_balance();
CREATE FUNCTION prohibit_journal_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Posted journal facts are immutable; use a reversal'; END $$;
CREATE TRIGGER immutable_transactions BEFORE UPDATE OR DELETE ON journal_transaction FOR EACH ROW EXECUTE FUNCTION prohibit_journal_mutation();
CREATE TRIGGER immutable_lines BEFORE UPDATE OR DELETE ON journal_line FOR EACH ROW EXECUTE FUNCTION prohibit_journal_mutation();
