CREATE TABLE user_workbench (
    oidc_subject text PRIMARY KEY,
    document jsonb NOT NULL,
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (jsonb_typeof(document) = 'array')
);
CREATE TABLE workbench_change (
    id uuid PRIMARY KEY,
    oidc_subject text NOT NULL REFERENCES user_workbench(oidc_subject),
    revision bigint NOT NULL,
    request_id uuid NOT NULL,
    prior_document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (oidc_subject, revision),
    UNIQUE (oidc_subject, request_id)
);
CREATE INDEX workbench_history ON workbench_change(oidc_subject, created_at DESC);
