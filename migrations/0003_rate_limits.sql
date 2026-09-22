CREATE TABLE rate_limits (
  subject TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (subject, window_start)
) STRICT;

CREATE INDEX rate_limits_window ON rate_limits(window_start);
