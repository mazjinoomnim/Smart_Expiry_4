-- Run once in the existing Cloudflare D1 database (smart-expiry-devices).
CREATE TABLE IF NOT EXISTS acknowledgements (
 uid TEXT NOT NULL,
 product_id TEXT NOT NULL,
 expiry TEXT NOT NULL,
 acknowledged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(uid,product_id,expiry)
);
