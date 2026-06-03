# Comparador de Perfumes — Rouge & Juleriaque

Aplicación web que scrapea los catálogos de **Perfumerías Rouge** y **Juleriaque** (Argentina), deduplica productos entre tiendas, genera embeddings para búsqueda semántica y expone todo en un frontend React con comparación de precios en tiempo real.

---

## Arquitectura

```
scraper_rouge.py
  └─ scrape Rouge + Juleriaque (API VTEX)
  └─ deduplicar por clave marca|nombre|tipo|tamaño
  └─ generar embeddings (paraphrase-multilingual-MiniLM-L12-v2)
  └─ upsert → Supabase (perfumes / perfume_tiendas / precio_historial)

Frontend React (Vite)
  └─ Catálogo: grilla de productos con filtros
  └─ Ofertas: productos con descuento activo
  └─ Buscador: texto + búsqueda semántica vectorial
  └─ Auth: Google OAuth via Supabase
  └─ Favoritos + notificaciones de cambio de precio
```

---

## Levantar en local

### Requisitos previos

- Python 3.11+
- Node.js 18+
- Proyecto en [Supabase](https://supabase.com) con el schema aplicado (ver paso 2)

---

### 1. Scraper (Python)

```bash
cd rouge-app/scraper

# Crear y activar entorno virtual
python -m venv venv
venv\Scripts\Activate.ps1        # Windows PowerShell
# source venv/bin/activate        # Mac/Linux

# Instalar dependencias
pip install -r requirements.txt
```

Crear el archivo `.env` en `rouge-app/scraper/`:

```env
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_KEY=sb_secret_...
```

#### 2. Aplicar el schema en Supabase

Abrir el **SQL Editor** del proyecto en Supabase y ejecutar el contenido de `schema_rouge.sql`.

Esto crea las tablas:
- `perfumes` — entidad única por producto (con embedding vectorial)
- `perfume_tiendas` — precio y stock por tienda
- `precio_historial` — historial de precios para detectar cambios
- `favoritos` — favoritos por usuario con seguimiento
- `push_suscripciones` — suscripciones a notificaciones push

#### 3. Correr el scraper

```bash
python scraper_rouge.py
```

El scraper tarda ~5–10 min en completar. Al finalizar deja un backup en `catalogo_comparador.json`.

---

### 4. Frontend (React + Vite)

```bash
cd rouge-app/frontend
npm install
```

Crear el archivo `.env` en `rouge-app/frontend/`:

```env
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

> Usar la **anon key** (no la service key) para el frontend.

```bash
npm run dev
```

La app queda disponible en `http://localhost:5173`.

---

### 5. Configurar autenticación con Google OAuth

Para que el login con Google funcione hay que configurar dos servicios: **Google Cloud Console** y **Supabase**. Seguir los pasos en orden.

#### 5.1 Crear credenciales en Google Cloud Console

1. Ir a [console.cloud.google.com](https://console.cloud.google.com)
2. Crear un proyecto nuevo (o seleccionar uno existente)
3. En el menú lateral ir a **APIs y servicios → Pantalla de consentimiento de OAuth**
   - Tipo de usuario: **Externo**
   - Completar nombre de la app, correo de soporte y correo del desarrollador
   - Guardar y continuar (el resto de los pasos se pueden dejar vacíos)
4. En el menú lateral ir a **APIs y servicios → Credenciales**
5. Click en **+ Crear credenciales → ID de cliente de OAuth 2.0**
6. Tipo de aplicación: **Aplicación web**
7. En **Orígenes autorizados de JavaScript** agregar:
   ```
   https://<tu-proyecto-id>.supabase.co
   ```
8. En **URIs de redireccionamiento autorizados** agregar:
   ```
   https://<tu-proyecto-id>.supabase.co/auth/v1/callback
   ```
   > El `<tu-proyecto-id>` se encuentra en Supabase → Settings → API → Project URL
9. Click en **Crear**
10. Copiar el **ID de cliente** y el **Secreto de cliente** que aparecen en el popup

#### 5.2 Habilitar Google como proveedor en Supabase

1. Ir a [supabase.com](https://supabase.com) → tu proyecto
2. En el menú lateral ir a **Authentication → Providers**
3. Buscar **Google** y hacer click para expandirlo
4. Activar el toggle **Enable**
5. Pegar el **Client ID** y el **Client Secret** copiados del paso anterior
6. Click en **Save**

Una vez completados estos pasos el botón "Iniciar sesión con Google" de la app funcionará correctamente.

---

### 6. Levantar el backend si tenés una API key de Anthropic

Si agregás una `ANTHROPIC_KEY` en `rouge-app/scraper/.env`, el backend FastAPI es necesario para que funcionen la búsqueda semántica y el reconocimiento de imágenes.

```bash
cd rouge-app/scraper
venv\Scripts\Activate.ps1        # Windows PowerShell
# source venv/bin/activate        # Mac/Linux

uvicorn main:app --port 8001
```

> Levantar en el puerto que corresponda según tu configuración local. Por defecto este proyecto usa **8001** porque el puerto 8000 puede estar ocupado (por ejemplo, por Docker). Verificar que la URL en el frontend apunte al puerto correcto.

El servidor queda disponible en `http://localhost:8001`. Sin él, la búsqueda por texto e imagen no funcionan.

---

## Variables de entorno

| Archivo | Variable | Descripción |
|---|---|---|
| `scraper/.env` | `SUPABASE_URL` | URL del proyecto Supabase |
| `scraper/.env` | `SUPABASE_KEY` | Service key (acceso completo para escritura) |
| `frontend/.env` | `VITE_SUPABASE_URL` | URL del proyecto Supabase |
| `frontend/.env` | `VITE_SUPABASE_ANON_KEY` | Anon key (solo lectura pública + RLS) |

---

## Estructura del proyecto

```
rouge-app/
├── scraper/
│   ├── scraper_rouge.py      # Scraper + embedder + carga a Supabase
│   ├── schema_rouge.sql      # Schema completo (ejecutar en Supabase)
│   ├── requirements.txt
│   └── .env                  # No subir al repo
│
└── frontend/
    ├── src/
    │   ├── lib/
    │   │   ├── supabase.js   # Cliente Supabase
    │   │   └── auth.js       # Google OAuth helpers
    │   ├── hooks/
    │   │   ├── useAuth.js
    │   │   ├── useFavoritos.js
    │   │   └── useNotificaciones.js
    │   ├── pages/
    │   │   ├── Catalogo.jsx  # Grilla con filtros
    │   │   └── Ofertas.jsx   # Productos con descuento
    │   └── components/
    │       ├── Navbar.jsx
    │       ├── ProductCard.jsx
    │       ├── ProductDetail.jsx
    │       ├── Buscador.jsx          # Búsqueda texto + foto
    │       ├── FavoritoBtn.jsx
    │       └── SeguimientoModal.jsx  # Seguimiento 1/2 semanas
    ├── package.json
    ├── vite.config.js
    └── .env                  # No subir al repo
```

---

## Cómo se usa

### Actualizar el catálogo

El scraper se corre manualmente (o con cron) desde `rouge-app/scraper/`:

```bash
python scraper_rouge.py
```

Hace upsert — no duplica, actualiza precios existentes y agrega productos nuevos.

### Navegación

| Sección | Descripción |
|---|---|
| **Catálogo** | Todos los productos. Filtros por marca, género, tipo, tienda y rango de precio. |
| **Ofertas** | Solo productos con descuento activo (`descuento > 0`). |
| **Buscador** | Búsqueda por texto o por foto. Usa similitud vectorial (`pgvector`). |

### Favoritos y alertas

1. Iniciar sesión con Google.
2. Clickear el corazón en cualquier producto.
3. Elegir seguimiento de **1 semana** o **2 semanas**.
4. Se recibe una notificación si el precio baja durante ese período.

---

## Stack

| Capa | Tecnología |
|---|---|
| Scraper | Python 3.13, `requests`, `sentence-transformers`, `supabase-py` |
| Embeddings | `paraphrase-multilingual-MiniLM-L12-v2` (384 dims) |
| Base de datos | Supabase (PostgreSQL + `pgvector`) |
| Frontend | React 18, Vite 5, `lucide-react` |
| Auth | Supabase Auth — Google OAuth |
| Búsqueda vectorial | `pgvector` con índice `ivfflat` (cosine) |
