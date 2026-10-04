-- One row per page view or download. No cookies, no IPs: `visitor` is a hash
-- of IP + browser + day + secret, so it only counts unique visitors within a day.
CREATE TABLE IF NOT EXISTS hits (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,          -- ms since epoch
  day     TEXT    NOT NULL,          -- YYYY-MM-DD, Asia/Taipei
  kind    TEXT    NOT NULL,          -- 'view' | 'download'
  path    TEXT    NOT NULL,
  ref     TEXT,                      -- referrer host, e.g. notion.so
  country TEXT,
  device  TEXT,                      -- mac | windows | iphone | android | other
  visitor TEXT
);
CREATE INDEX IF NOT EXISTS hits_day ON hits (day, kind);
