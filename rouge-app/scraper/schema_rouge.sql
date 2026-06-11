-- COMPARADOR DE PERFUMES - Schema completo
-- Idempotente: seguro de ejecutar múltiples veces
-- Ejecutar TODO junto en Supabase SQL Editor

create extension if not exists vector;

-- TABLA PERFUMES
create table if not exists perfumes (
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
create table if not exists perfume_tiendas (
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
create table if not exists precio_historial (
  id            bigserial primary key,
  tienda        text not null,
  id_sku        text not null,
  precio_final  numeric(12,2),
  descuento     int,
  stock_estado  text,
  registrado_at timestamptz default now()
);

-- TABLA FAVORITOS
create table if not exists favoritos (
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
create table if not exists push_suscripciones (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  key_p256dh  text not null,
  key_auth    text not null,
  created_at  timestamptz default now(),
  unique(user_id, endpoint)
);

-- ÍNDICES
create index if not exists perfumes_embedding_idx on perfumes using ivfflat (embedding vector_cosine_ops) with (lists = 50);
create index if not exists perfumes_marca_idx     on perfumes(marca);
create index if not exists perfumes_genero_idx    on perfumes(genero);
create index if not exists perfumes_clave_idx     on perfumes(clave_unica);
create index if not exists tiendas_perfume_idx    on perfume_tiendas(perfume_id);
create index if not exists tiendas_tienda_idx     on perfume_tiendas(tienda);
create index if not exists tiendas_desc_idx       on perfume_tiendas(descuento desc);
create index if not exists historial_sku_idx      on precio_historial(id_sku, registrado_at desc);

-- VISTA (drop if exists para recrearla)
drop view if exists perfumes_con_precios;
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

drop policy if exists "perfumes_public" on perfumes;
drop policy if exists "tiendas_public" on perfume_tiendas;
drop policy if exists "historial_public" on precio_historial;
drop policy if exists "favoritos_usuario" on favoritos;
drop policy if exists "push_usuario" on push_suscripciones;

create policy "perfumes_public"   on perfumes        for select using (true);
create policy "tiendas_public"    on perfume_tiendas for select using (true);
create policy "historial_public"  on precio_historial for select using (true);
create policy "favoritos_usuario" on favoritos        for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "push_usuario"      on push_suscripciones for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- FUNCIÓN RPC: Búsqueda vectorial con filtros
create or replace function buscar_perfumes(
  query_embedding vector,
  match_count int default 15,
  filtro_genero text default '',
  filtro_marca text default '',
  solo_ofertas boolean default false
)
returns table (
  id bigint,
  marca text,
  nombre_base text,
  tipo text,
  tamaño text,
  genero text,
  descripcion text,
  imagen text,
  clave_unica text,
  similarity float
) as $$
begin
  return query
  select
    p.id,
    p.marca,
    p.nombre_base,
    p.tipo,
    p.tamaño,
    p.genero,
    p.descripcion,
    p.imagen,
    p.clave_unica,
    (1 - (p.embedding <=> query_embedding))::float as similarity
  from perfumes p
  where
    p.embedding is not null
    and (filtro_genero = '' or p.genero = filtro_genero)
    and (filtro_marca = '' or p.marca ilike filtro_marca || '%')
    and (not solo_ofertas or exists (
      select 1 from perfume_tiendas pt
      where pt.perfume_id = p.id and pt.descuento > 0
    ))
  order by p.embedding <=> query_embedding
  limit match_count;
end;
$$ language plpgsql;