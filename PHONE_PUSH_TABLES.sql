-- Safe to run on existing SmartExpiry D1. Does not delete device records.
CREATE TABLE IF NOT EXISTS push_tokens (uid TEXT NOT NULL, token TEXT NOT NULL PRIMARY KEY);
CREATE INDEX IF NOT EXISTS push_tokens_uid ON push_tokens(uid);
CREATE TABLE IF NOT EXISTS push_products (uid TEXT PRIMARY KEY, products_json TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS push_sent (uid TEXT NOT NULL, token TEXT NOT NULL, product_id TEXT NOT NULL, expiry TEXT NOT NULL, sent_day TEXT NOT NULL, PRIMARY KEY(uid,token,product_id,expiry,sent_day));
