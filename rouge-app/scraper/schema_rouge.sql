-- COMPARADOR DE PERFUMES - Schema completo
-- Ejecutar TODO junto en Supabase SQL Editor

create extension if not exists vector;

-- TABLA PERFUMES
create table perfumes (
  id            bigserial primary key,
  marca         text not null,
  nombre_base   text not null,
  tipo          text not null,
  tamaño        text not null,
  genero        text,
  descripcion   text,
  imagen        text,
  embedding     vector(384),
  clave_unica   text unique,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- TABLA PRECIOS POR TIENDA
create table perfume_tiendas (
  id            bigserial primary key,
  perfume_id    bigint not null references perfumes(id) on delete cascade,
  tienda        text not null,
  id_sku        text not null,
  id_producto   text,
  precio_lista  numeric(12,2),
  precio_final  numeric(12,2),
  descuento     int default 0,
  stock_estado  text default 'Con Stock',
  link          text,
  scraped_at    timestamptz default now(),
  unique(tienda, id_sku)
);

-- TABLA HISTORIAL
create table precio_historial (
  id            bigserial primary key,
  tienda        text not null,
  id_sku        text not null,
  precio_final  numeric(12,2),
  descuento     int,
  stock_estado  text,
  registrado_at timestamptz default now()
);

-- TABLA FAVORITOS
create table favoritos (
  id                  bigserial primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  perfume_id          bigint not null references perfumes(id) on delete cascade,
  seguimiento_semanas int default 1,
  precio_al_guardar   jsonb,
  notificado_at       timestamptz,
  created_at          timestamptz default now(),
  unique(user_id, perfume_id)
);

-- TABLA PUSH
create table push_suscripciones (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  key_p256dh  text not null,
  key_auth    text not null,
  created_at  timestamptz default now(),
  unique(user_id, endpoint)
);

-- ÍNDICES
create index perfumes_embedding_idx on perfumes using ivfflat (embedding vector_cosine_ops) with (lists = 50);
create index perfumes_marca_idx     on perfumes(marca);
create index perfumes_genero_idx    on perfumes(genero);
create index perfumes_clave_idx     on perfumes(clave_unica);
create index tiendas_perfume_idx    on perfume_tiendas(perfume_id);
create index tiendas_tienda_idx     on perfume_tiendas(tienda);
create index tiendas_desc_idx       on perfume_tiendas(descuento desc);
create index historial_sku_idx      on precio_historial(id_sku, registrado_at desc);

-- VISTA
create view perfumes_con_precios as
select
  p.id, p.marca, p.nombre_base, p.tipo, p.tamaño, p.genero,
  p.descripcion, p.imagen, p.clave_unica,
  max(case when t.tienda = 'rouge'      then t.precio_final  end) as rouge_precio,
  max(case when t.tienda = 'rouge'      then t.precio_lista  end) as rouge_precio_lista,
  max(case when t.tienda = 'rouge'      then t.descuento     end) as rouge_descuento,
  max(case when t.tienda = 'rouge'      then t.link          end) as rouge_link,
  max(case when t.tienda = 'rouge'      then t.stock_estado  end) as rouge_stock,
  max(case when t.tienda = 'juleriaque' then t.precio_final  end) as juleriaque_precio,
  max(case when t.tienda = 'juleriaque' then t.precio_lista  end) as juleriaque_precio_lista,
  max(case when t.tienda = 'juleriaque' then t.descuento     end) as juleriaque_descuento,
  max(case when t.tienda = 'juleriaque' then t.link          end) as juleriaque_link,
  max(case when t.tienda = 'juleriaque' then t.stock_estado  end) as juleriaque_stock,
  bool_or(t.tienda = 'rouge')      as en_rouge,
  bool_or(t.tienda = 'juleriaque') as en_juleriaque,
  bool_or(t.descuento > 0)         as tiene_oferta,
  min(t.precio_final)              as precio_min
from perfumes p
left join perfume_tiendas t on t.perfume_id = p.id
group by p.id, p.marca, p.nombre_base, p.tipo, p.tamaño,
         p.genero, p.descripcion, p.imagen, p.clave_unica;

-- RLS
alter table perfumes           enable row level security;
alter table perfume_tiendas    enable row level security;
alter table precio_historial   enable row level security;
alter table favoritos          enable row level security;
alter table push_suscripciones enable row level security;

create policy "perfumes_public"   on perfumes        for select using (true);
create policy "tiendas_public"    on perfume_tiendas for select using (true);
create policy "historial_public"  on precio_historial for select using (true);
create policy "favoritos_usuario" on favoritos        for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "push_usuario"      on push_suscripciones for all using (auth.uid() = user_id) with check (auth.uid() = user_id);