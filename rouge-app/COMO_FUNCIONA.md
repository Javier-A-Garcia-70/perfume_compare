# Cómo funciona el proyecto — para explicar en clase

---

## 1. Scraping — cómo se consiguen los datos

**Tecnología:** Python + `requests`

Ambas tiendas (Rouge y Juleriaque) usan una plataforma de e-commerce llamada **VTEX**. Esa plataforma expone una API pública no documentada que devuelve los productos en JSON. El scraper simplemente hace peticiones HTTP a esa API en páginas de 50 productos.

```
GET https://www.perfumeriasrouge.com/api/catalog_system/pub/products/search/fragancias?_from=0&_to=49
```

Por cada producto que devuelve la API se extrae: marca, nombre, tipo (EDT/EDP/etc.), tamaño, precio, descuento, imagen, descripción y género.

El **género** se detecta mirando las categorías del producto ("femeninas", "masculino", etc.).

El **nombre base** se limpia quitando el tipo y el tamaño del nombre completo: `"Sauvage EDP 100ml"` → `"Sauvage"`.

Una vez scrapeados los dos catálogos, se **deduplicán** los productos por una clave `marca|nombre|tipo|tamaño` para saber qué perfumes están en las dos tiendas y poder comparar precios.

Finalmente, para cada producto se genera un **embedding** (ver punto 2) y todo se guarda en **Supabase** (PostgreSQL en la nube).

---

## 2. Búsqueda por texto — búsqueda vectorial semántica

**Tecnología:** `sentence-transformers` (Python) + `pgvector` (PostgreSQL) + `FastAPI`

### El concepto clave: embedding

Un **embedding** es un vector numérico (lista de ~384 números) que representa el *significado* de un texto. Dos textos similares en significado tienen vectores cercanos en el espacio matemático.

Ejemplo:
- `"fresco cítrico verano"` → `[0.12, -0.34, 0.87, ...]`
- `"bergamota limón aire libre"` → `[0.11, -0.31, 0.85, ...]` ← parecido!
- `"oriental amaderado intenso"` → `[-0.45, 0.92, -0.21, ...]` ← distinto

### Cómo se construyó el índice (cuando corre el scraper)

Por cada perfume se arma un texto descriptivo con sus notas olfativas y se lo convierte en un vector con el modelo **`paraphrase-multilingual-MiniLM-L12-v2`** (multilingüe, funciona en español). Ese vector se guarda en Supabase junto al producto, en una columna de tipo `vector(384)` que maneja la extensión **pgvector**.

### Cómo funciona cuando el usuario busca

1. El usuario escribe, por ejemplo: `"algo fresco para verano"`.
2. El frontend detecta si hay palabras exactas de marca/nombre → si las hay, filtra directamente.
3. Si no hay match exacto, llama al backend FastAPI (`POST /api/search`).
4. El backend usa **Claude** para *expandir* la query a vocabulario de perfumería:  
   `"algo fresco para verano"` → `"cítrico bergamota marino acuático verde fresco ligero"`.
5. Ese texto expandido se convierte en un vector con el mismo modelo.
6. Se hace una consulta a Supabase llamando a la función `buscar_perfumes` (stored procedure en PostgreSQL) que calcula la **similitud coseno** entre el vector de búsqueda y todos los vectores guardados, y devuelve los más cercanos.

   Esta es la función SQL que vive en Supabase (no en el código local):

   ```sql
   SELECT
     p.id,
     1 - (p.embedding <=> query_embedding) AS similarity
   FROM perfumes p
   WHERE
     p.embedding IS NOT NULL
     AND (filtro_genero = '' OR p.genero = filtro_genero)
     AND (filtro_marca  = '' OR p.marca ILIKE filtro_marca)
   ORDER BY p.embedding <=> query_embedding
   LIMIT match_count;
   ```

   Línea por línea:
   - `p.embedding <=> query_embedding` — el operador `<=>` es de `pgvector` y calcula la **distancia coseno** entre el vector del perfume y el vector de búsqueda. Cuanto más cerca de 0, más parecidos son los significados.
   - `1 - (distancia)` — convierte esa distancia en **similitud**: 1 = idéntico, 0 = nada que ver. Se devuelve como columna `similarity`.
   - `WHERE embedding IS NOT NULL` — descarta perfumes que no tienen vector calculado todavía.
   - `filtro_genero = '' OR p.genero = filtro_genero` — si el usuario buscó "para mujer", solo devuelve Femenino; si no filtró, devuelve todos.
   - `ILIKE filtro_marca` — búsqueda de marca sin distinguir mayúsculas/minúsculas.
   - `ORDER BY embedding <=> query_embedding` — ordena del más parecido al menos.
   - `LIMIT match_count` — devuelve solo los N mejores resultados.

7. Los resultados se ordenan por similitud y se muestran en el frontend.

**Resultado:** si buscás "regalo para ella, floral", encuentra perfumes femeninos con notas florales aunque no uses esas palabras exactas.

---

## 3. Búsqueda por imagen

**Tecnología:** API de Anthropic (Claude) + visión artificial (multimodal)

### Cómo funciona

1. El usuario sube una foto de un perfume desde su celular o computadora.
2. La imagen se convierte a **base64** (texto que representa los bytes de la imagen).
3. Ese base64 se manda al backend FastAPI, que lo reenvía a la API de **Anthropic** junto con el prompt:  
   *"Identificá el perfume en esta imagen. Devolvé un JSON con marca, nombre y tipo."*
4. Claude (modelo multimodal que puede ver imágenes) analiza la imagen y responde algo como:  
   `{"marca": "Dior", "nombre": "Sauvage", "tipo": "Eau de Toilette"}`.
5. Con esos datos el frontend filtra el catálogo local buscando coincidencias exactas de marca y nombre.
6. Si encuentra resultados exactos, los muestra. Si no, hace una búsqueda vectorial con esos datos como query.

### Por qué el backend y no directo desde el browser

La API de Anthropic requiere una **API key** (clave secreta). Si el frontend la usara directamente, cualquiera que abra las DevTools del navegador podría verla y usarla. Por eso existe el backend FastAPI como intermediario: el frontend le manda la imagen, el backend llama a Anthropic con la key que solo él conoce, y devuelve el resultado.

---

---

## 4. Despliegue — dónde vive cada pieza

| Pieza | Dónde | Costo |
|---|---|---|
| **Frontend React** | Vercel | Gratis |
| **Backend FastAPI** | DigitalOcean App Platform | ~$24/mes |
| **Scraper** (cron semanal) | DigitalOcean Functions | ~$0 |
| **Base de datos + vectores** | Supabase | Gratis (tier gratuito) |

### Backend FastAPI — DigitalOcean App Platform

App Platform detecta el repositorio de GitHub, instala las dependencias del `requirements.txt` y corre el servidor automáticamente. No hay que administrar ningún servidor. Cada push al repositorio hace un nuevo deploy.

### Scraper — DigitalOcean Functions (cron cada 5 días)

Una Function serverless que se activa cada 5 días. Solo existe mientras corre (minutos), luego se apaga. Se le configura un trigger de tipo cron:
```
0 3 */5 * *   # cada 5 días a las 3am UTC
```
Llama a la API de VTEX, actualiza precios y regenera embeddings en Supabase.

> **Nota:** La ejecución cada 5 días (en lugar de semanal) asegura que Supabase NO pausé automáticamente la base de datos por inactividad (que ocurre después de 7 días sin actividad en tier gratuito).

### Flujo completo en producción

```
[Vercel - Frontend React]
        │ llama a
        ▼
[DO App Platform - FastAPI]
        │ busca vectores        │ llama a Anthropic
        ▼                       ▼
[Supabase - PostgreSQL]    [Anthropic API]
        ▲
        │ actualiza precios/embeddings (cada 5 días)
[DO Functions - Scraper cron]
```

### Variable de entorno a cambiar en el frontend

Cuando el backend esté desplegado, actualizar en `App.jsx`:
```js
const ANTHROPIC_URL = "https://tu-app.ondigitalocean.app/api/claude";
```
Y agregar el dominio de Vercel al `CORS_ORIGINS` en las variables de entorno de App Platform.

---

## Resumen visual

```
SCRAPING
Rouge API ──┐
            ├──► Python (requests) ──► normalizar ──► embeddings ──► Supabase (PostgreSQL + pgvector)
Juleriaque ─┘

BÚSQUEDA POR TEXTO
Usuario escribe ──► Frontend React ──► FastAPI backend ──► Claude expande query
                                                        └──► sentence-transformers genera vector
                                                        └──► Supabase buscar_perfumes (similitud coseno)
                                                        └──► resultados ordenados por similitud

BÚSQUEDA POR IMAGEN
Usuario sube foto ──► Frontend React ──► FastAPI backend ──► Anthropic Claude (visión)
                                                         └──► JSON {marca, nombre, tipo}
                                                         └──► filtro local en el catálogo
```
