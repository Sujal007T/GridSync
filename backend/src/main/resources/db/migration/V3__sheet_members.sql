CREATE TABLE sheet_members (
    sheet_id UUID NOT NULL,
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (sheet_id, user_id)
);
