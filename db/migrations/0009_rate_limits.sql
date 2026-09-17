-- 0009 — Rate limiting durable (serverless: la memoria del proceso no sirve entre instancias).
create table rate_limit_buckets (
  key text not null check (length(key) <= 200),
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
create index rate_limit_buckets_window on rate_limit_buckets(window_start);
