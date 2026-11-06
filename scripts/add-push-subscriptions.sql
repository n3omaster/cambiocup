-- ─────────────────────────────────────────────────────────────────────────────
-- Push propio: aviso diario de tasas, sin OneSignal.
-- Pegar en el SQL editor de Supabase. Se puede correr más de una vez.
-- ─────────────────────────────────────────────────────────────────────────────

-- Una fila por navegador suscrito. Es lo que entrega el navegador al suscribirse y
-- lo único que hace falta para enviarle un push; no identifica a la persona.
create table if not exists push_subscriptions (
  id          bigint generated always as identity primary key,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

-- Un envío por día de La Habana. La fila se crea ANTES de enviar y la clave primaria
-- hace de candado: el cron de Vercel puede dispararse dos veces, y sin esto cada
-- suscriptor recibiría el aviso repetido. `finished_at` vacío = envío interrumpido.
create table if not exists push_sends (
  day          date primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  sent         int,
  gone         int,
  failed       int
);

-- RLS activo y sin políticas: solo service_role entra, y todo pasa por el API
alter table push_subscriptions enable row level security;
alter table push_sends enable row level security;
