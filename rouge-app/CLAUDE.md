# CLAUDE.md — Comparador de Perfumes (Rouge & Juleriaque)

> App web que scrapea los catálogos de **Perfumerías Rouge** y **Juleriaque** (Argentina), deduplica productos, genera embeddings vectoriales y los expone en un frontend React con búsqueda semántica, comparación de precios, favoritos y alertas de bajada de precio.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│  scraper_rouge.py  (Python, cron semanal)                   │
│  └─ VTEX API → deduplicar → embeddings → upsert Supabase   │
└────────────────────────┬────────────────────────────────────┘
                         │ PostgreSQL + pgvector
                ┌────────▼────────┐
                │    Supabase     │
                │  perfumes       │
                │  perfume_tiendas│
                │  precio_historial│
                │  favoritos      │
                └────────┬────────┘
                         │ REST API + RPC
         ┌───────────────┴──────────────────┐
         │   main.py  (FastAPI, puerto 8001) │
         │   /api/claude  → proxy Anthropic  │
         │   /api/search  → vector search    │
         └───────────────┬──────────────────┘
                         │ HTTP (localhost:8001)
         ┌───────────────┴──────────────────┐
         │  Frontend React + Vite (:5173)   │
         │  Catálogo / Ofertas / Buscador   │
         └──────────────────────────────────┘
```

---

## Estructura del proyecto

```
rouge-app/
├── scraper/
│   ├── scraper_rouge.py     # Scraper + embedder + carga a Supabase
│   ├── main.py              # FastAPI backend proxy (Anthropic + vector search)
│   ├── schema_rouge.sql     # Schema completo — ejecutar en Supabase SQL Editor
│   ├── requirements.txt     # Dependencias Python
│   ├── .env                 # Keys (NO subir al repo)
│   ├── venv/                # Virtualenv Python compartido entre scraper y FastAPI
│   ├── catalogo_rouge.json  # Backup local del scraper (Rouge)
│   └── catalogo_comparador.json  # Backup local unificado
│
└── frontend/
    ├── src/
    │   ├── App.jsx          # Lógica central: búsqueda IA, imagen, filtros, UI
    │   ├── lib/
    │   │   └── supabase.js  # createClient con VITE_SUPABASE_URL + ANON_KEY
    │   ├── hooks/
    │   │   ├── useAuth.js           # Google OAuth con Supabase
    │   │   ├── useFavoritos.js      # Guardar/quitar favoritos + seguimiento
    │   │   └── useNotificaciones.js # Push notifications
    │   ├── pages/
    │   │   ├── Catalogo.jsx   # Grilla con filtros (marca, género, tipo, tienda, precio)
    │   │   └── Ofertas.jsx    # Solo productos con descuento > 0
    │   └── components/
    │       ├── ProductCard.jsx
    │       ├── ProductDetail.jsx
    │       ├── Buscador.jsx         # Input texto + upload foto
    │       ├── FavoritoBtn.jsx
    │       ├── Navbar.jsx
    │       └── SeguimientoModal.jsx # Elegir 1 o 2 semanas de alerta
    ├── package.json
    ├── vite.config.js
    └── .env                  # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
```

---

## Stack & Dependencias

| Capa | Tecnología |
|---|---|
| Scraper | Python 3.11+, `requests`, `sentence-transformers`, `supabase-py` |
| Backend proxy | FastAPI + uvicorn, `anthropic`, `sentence-transformers` |
| Embeddings | `paraphrase-multilingual-MiniLM-L12-v2` (384 dims, multilingüe) |
| AI / LLM | Claude `claude-sonnet-4-20250514` (imagen + proxy texto); `claude-haiku-4-5-20251001` (expansión de query) |
| Base de datos | Supabase (PostgreSQL + extensión `pgvector`) |
| Índice vectorial | `ivfflat` con `vector_cosine_ops`, 50 lists |
| Frontend | React 18, Vite 5, `lucide-react`, `@supabase/supabase-js` |
| Auth | Supabase Auth — Google OAuth |

---

cd rouge-app/scraper

# Crear y activar entorno virtual
python -m venv venv
venv\Scripts\Activate.ps1        # Windows PowerShell
# source venv/bin/activate        # Mac/Linux

# Instalar dependencias
pip install -r requirements.txt

---
## Cómo levantar en local

### 1. Backend FastAPI (imprescindible para búsqueda IA)

```powershell
cd rouge-app/scraper
.\venv\Scripts\Activate.ps1
uvicorn main:app --port 8001
```

> **Importante:** el puerto 8000 está ocupado permanentemente por Docker (PID 6256). Siempre usar 8001.

El servidor queda en `http://localhost:8001`.
Rutas disponibles:
- `POST /api/claude` — proxy Anthropic (imagen + texto)
- `POST /api/search` — búsqueda vectorial vía pgvector
- `GET  /health`

### 2. Frontend

```powershell
cd rouge-app/frontend
npm install
npm run dev
```

Queda en `http://localhost:5173`.

### 3. Scraper (actualizar catálogo)

```powershell
cd rouge-app/scraper
.\venv\Scripts\Activate.ps1
python scraper_rouge.py
```

Tarda ~5–10 min. Hace upsert — no duplica. Deja backup en `catalogo_comparador.json`.

---

## Variables de entorno

### `rouge-app/scraper/.env`

| Variable | Descripción | Requerida |
|---|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase (`https://xxx.supabase.co`) | ✅ |
| `SUPABASE_KEY` | Service key (escritura completa) | ✅ |
| `ANTHROPIC_KEY` | API key de Anthropic | ✅ |
| `CORS_ORIGINS` | Orígenes permitidos separados por coma | Opcional (default: `http://localhost:5173`) |

### `rouge-app/frontend/.env`

| Variable | Descripción | Requerida |
|---|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase | ✅ |
| `VITE_SUPABASE_ANON_KEY` | Anon key (solo lectura pública + RLS) | ✅ |

> El frontend **NO** tiene `ANTHROPIC_KEY`. Toda llamada a Anthropic pasa por el backend FastAPI para que la key nunca llegue al browser. La URL del backend (`http://localhost:8001`) sí está en el código — no es un secreto.

---

## Base de datos (Supabase)

Schema en `rouge-app/scraper/schema_rouge.sql`. Ejecutar completo en Supabase SQL Editor.

### Tablas principales

- **`perfumes`** — entidad única por producto. Columna `embedding vector(384)`. Clave de deduplicación: `clave_unica = marca|nombre_base|tipo|tamaño`.
- **`perfume_tiendas`** — precio y stock por tienda (`rouge` / `juleriaque`), vinculada por `perfume_id`.
- **`precio_historial`** — registro histórico de precios para detectar bajadas.
- **`favoritos`** — favoritos por usuario (`user_id` referencia `auth.users`), incluye `seguimiento_semanas`.
- **`push_suscripciones`** — endpoints Web Push por usuario.

### Vista

**`perfumes_con_precios`** — join pivoteado entre `perfumes` y `perfume_tiendas`. El frontend lee esta vista vía `sbFetch("perfumes_con_precios?...")`. Devuelve columnas como `rouge_precio`, `juleriaque_precio`, `tiene_oferta`, `precio_min`, etc.

### Stored procedure (en Supabase, NO en código local)

```sql
-- buscar_perfumes(query_embedding, match_count, filtro_genero, filtro_marca, solo_ofertas)
SELECT p.id, 1 - (p.embedding <=> query_embedding) AS similarity
FROM perfumes p
WHERE p.embedding IS NOT NULL
  AND (filtro_genero = '' OR p.genero = filtro_genero)
  AND (filtro_marca  = '' OR p.marca ILIKE filtro_marca)
ORDER BY p.embedding <=> query_embedding
LIMIT match_count;
```

Llamado desde FastAPI via `POST /rest/v1/rpc/buscar_perfumes`.

### RLS

- `perfumes`, `perfume_tiendas`, `precio_historial` — lectura pública (`for select using (true)`).
- `favoritos`, `push_suscripciones` — solo el propio usuario (`auth.uid() = user_id`).

---

## Búsqueda: cómo funciona

### Texto (`buscarConIA` en App.jsx)

1. Intenta match exacto de todas las palabras en `marca + nombre_base`.
2. Detecta género en la query para pasar como filtro SQL.
3. Llama a `POST /api/search` (FastAPI):
   - FastAPI expande la query con `claude-haiku` → vocabulario de perfumería.
   - Genera embedding 384-dims con `sentence-transformers`.
   - Llama al stored procedure `buscar_perfumes` en Supabase vía RPC.
4. Si hay matches exactos de texto, los usa primero; si no, usa los vectoriales ordenados por similitud coseno.
5. Fallback (si el backend no responde): substring match en memoria.

### Imagen (`buscarPorImagen` en App.jsx)

1. Usuario sube una foto → se convierte a base64.
2. Se detecta el media_type por el prefijo base64:
   - `iVBORw` → `image/png`
   - `UklGR` → `image/webp`
   - `R0lGOD` → `image/gif`
   - default → `image/jpeg`
3. Se envía a `POST /api/claude` (proxy FastAPI → Anthropic Vision).
4. Prompt pide devolver `{marca, nombre, tipo}` como JSON.
5. Se filtra el catálogo local por `marca` + `nombre_base`, ordenando por tipo matching y frecuencia de palabras.
6. Si no hay resultados exactos, muestra misma marca como fallback.

---

## Scraper: lógica de deduplicación

El mismo perfume puede estar en ambas tiendas. La clave de deduplicación es:

```
clave_unica = f"{marca}|{nombre_base}|{tipo}|{tamaño}"
```

Se hace **upsert** en `perfumes` por `clave_unica`, y upsert separado en `perfume_tiendas` por `(tienda, id_sku)`. Así un producto puede tener una o dos filas en `perfume_tiendas` (una por tienda).

### Detección de género (gotcha crítico)

El scraper detecta género revisando substrings en el nombre del producto. **El orden importa**: se chequea femenino **antes** que masculino, porque `"femeninas"` contiene `"men"` como substring. La condición masculina usa `"for men"`, no `"men"` solo.

---

## Agrupación de variantes (frontend)

El frontend agrupa los SKUs por `marca||nombre_base||tipo` en `agruparVariantes()` (App.jsx). Cada "tarjeta" en la grilla representa una variante agrupada que puede tener múltiples tamaños. El detalle del producto muestra las variantes individuales con sus precios por tienda.

---

## Despliegue (producción)

| Pieza | Plataforma | Notas |
|---|---|---|
| Frontend React | **Vercel** | `npm run build` → `dist/`. Variables VITE_* en Vercel dashboard. |
| Backend FastAPI | **DigitalOcean App Platform** | ~$24/mes. Actualizar `ANTHROPIC_URL` en App.jsx al URL del App Platform. Agregar dominio Vercel a `CORS_ORIGINS`. |
| Scraper semanal | **DigitalOcean Functions** | ~$0 (serverless). Env vars: `SUPABASE_URL`, `SUPABASE_KEY`. |
| Base de datos | **Supabase** | Free tier suficiente para catálogo de ~5000 SKUs. |

---

## Estado actual y pendientes

- ✅ Búsqueda vectorial por texto funcionando (vector search + fallback texto)
- ✅ Búsqueda por imagen con detección de media_type
- ✅ Scraper con fix de género (`femeninas` no matchea `men`)
- ✅ Backend FastAPI con proxy Anthropic y vector search
- ⚠️ `buscarPorImagen` puede retornar vacío si Claude devuelve nombre con variaciones — revisar `console.log("[imagen] Claude identificó:", info)` en DevTools
- ⚠️ `buscarConIA` con 5000+ SKUs puede tocar rate limit de Anthropic (30k tokens/min) — actualmente usa `/api/search` (vector), no envía catálogo completo a Claude
- ⏳ Producción no desplegada aún

---

## Gotchas importantes

1. **Puerto 8001, no 8000**: Docker ocupa 8000 permanentemente. El backend FastAPI corre siempre en 8001.
2. **URL del backend hardcodeada en App.jsx**: `"http://localhost:8001/api/claude"` y `"/api/search"`. Al desplegar a producción, cambiar estas dos URLs a la URL del App Platform de DigitalOcean.
3. **`buscar_perfumes` vive en Supabase**: El stored procedure NO está en el código local. Si se recrea la DB, hay que volver a crear la función manualmente.
4. **El modelo sentence-transformers se carga al iniciar FastAPI**: La primera request después de arrancar uvicorn puede tardar 3–5s mientras carga el modelo en RAM. Requests subsiguientes son instantáneas.
5. **Datos mock en App.jsx**: Existe un array `MOCK` con 4 productos hardcodeados que se usa como fallback si Supabase no está configurado (`!SUPABASE_URL`). No borrarlo.
6. **`agruparVariantes` y `variantes` array**: Los componentes asumen que cada producto puede tener `.variantes` (array). Siempre hacer `p.variantes || [p]` antes de iterar.
7. **`auth.js` está vacío**: El archivo `src/lib/auth.js` existe pero está vacío. La lógica de auth está en `src/hooks/useAuth.js`.
