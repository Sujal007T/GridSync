CREATE TABLE op_log (
    seq         BIGSERIAL PRIMARY KEY,
    sheet_id    UUID NOT NULL,
    op_id       UUID NOT NULL,
    op_type     TEXT NOT NULL,
    payload     JSONB NOT NULL,
    hlc_physical BIGINT NOT NULL,
    hlc_logical  INT NOT NULL,
    replica_id  UUID NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_op_log_sheet_op UNIQUE (sheet_id, op_id)
);

CREATE INDEX idx_op_log_sheet_seq ON op_log(sheet_id, seq);

CREATE TABLE grid_state (
    sheet_id UUID,
    row_id   UUID,
    col_id   UUID,
    value    TEXT,
    hlc_physical BIGINT,
    hlc_logical  INT,
    replica_id   UUID,
    PRIMARY KEY (sheet_id, row_id, col_id)
);

CREATE TABLE snapshots (
    sheet_id UUID,
    seq      BIGINT,
    state    JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);
