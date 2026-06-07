"""
Comparador de Perfumes - Scraper unificado
Rouge + Juleriaque → deduplicación → Supabase

Correr con: python scraper_comparador.py
"""

import requests
import json
import re
import time
import os
from datetime import datetime, timezone
from sentence_transformers import SentenceTransformer
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
MODEL_NAME   = "paraphrase-multilingual-MiniLM-L12-v2"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
}

TIENDAS = {
    "rouge": {
        "base_url": "https://www.perfumeriasrouge.com/api/catalog_system/pub/products/search/fragancias",
        "base_link": "https://www.perfumeriasrouge.com",
    },
    "juleriaque": {
        "base_url": "https://www.juleriaque.com.ar/api/catalog_system/pub/products/search/fragancias",
        "base_link": "https://www.juleriaque.com.ar",
    },
        "farmacity": {
        "base_url": "https://www.farmacity.com/api/catalog_system/pub/products/search/fragancias",
        "base_link": "https://www.farmacity.com",
    },

    "simplicity": {
        "base_url": "https://www.simplicity.com.ar/api/catalog_system/pub/products/search/fragancias",
        "base_link": "https://www.simplicity.com.ar",
    },

    "beauty24": {
        "base_url": "https://www.beauty24.com.ar/api/catalog_system/pub/products/search/fragancias",
        "base_link": "https://www.beauty24.com.ar",
    },
    "farmaciadelpueblo": {
        "base_url": "https://www.farmaciadelpueblo.com.ar/api/catalog_system/pub/products/search/fragancias",
        "base_link": "https://www.farmaciadelpueblo.com.ar",
    },
}

COLORES_TIENDA = {
    "rouge":      "#c9393e",
    "juleriaque": "#1a5fa8",
    "farmacity":  "#e8312a",
    "simplicity": "#e91e8c",
    "beauty24":          "#ff6b9d",
    "farmaciadelpueblo": "#0066cc",  
}

# ─── NORMALIZACIÓN ───────────────────────────────────────────────

TIPOS_MAP = {
    "eau de parfum": "Eau de Parfum",
    "edp":           "Eau de Parfum",
    "parfum":        "Eau de Parfum",
    "eau de toilette": "Eau de Toilette",
    "edt":           "Eau de Toilette",
    "toilette":      "Eau de Toilette",
    "eau de cologne": "Eau de Cologne",
    "edc":           "Eau de Cologne",
    "colonia":       "Eau de Cologne",
    "cologne":       "Eau de Cologne",
    "cofre":         "Cofre / Set",
    "cofret":        "Cofre / Set",
    "set":           "Cofre / Set",
    "body":          "Body / Splash",
    "splash":        "Body / Splash",
}

def normalizar_tipo(nombre: str) -> str:
    n = nombre.lower()
    for k, v in TIPOS_MAP.items():
        if k in n:
            return v
    return "Fragancia"

def normalizar_tamaño(texto: str) -> str:
    """Extrae y normaliza el tamaño: '100ML' → '100 ml'"""
    match = re.search(r'(\d+(?:\.\d+)?)\s*ml', texto, re.IGNORECASE)
    if match:
        return f"{match.group(1)} ml"
    return texto.strip().lower()

def normalizar_nombre_base(nombre: str, tipo: str, tamaño: str) -> str:
    """
    Elimina del nombre el tipo, tamaño y otras partículas para quedarse
    con el nombre base del perfume.
    Ej: 'Blue Jeans EDT 75 ml' → 'Blue Jeans'
    """
    base = nombre
    # Quitar tamaño
    base = re.sub(r'\d+(?:\.\d+)?\s*ml', '', base, flags=re.IGNORECASE)
    # Quitar tipo
    for k in TIPOS_MAP:
        base = re.sub(re.escape(k), '', base, flags=re.IGNORECASE)
    # Quitar siglas comunes
    for sig in ["EDP", "EDT", "EDC", "EAU"]:
        base = re.sub(r'\b' + sig + r'\b', '', base, flags=re.IGNORECASE)
    # Quitar "Ed. Limitada", "Ed. Especial", "X"
    base = re.sub(r'Ed\.?\s*(Limitada|Especial|Ltda\.?)', '', base, flags=re.IGNORECASE)
    base = re.sub(r'\bx\b', '', base, flags=re.IGNORECASE)
    # Limpiar espacios y puntuación sobrante
    base = re.sub(r'[,;.\-]+$', '', base.strip())
    base = ' '.join(base.split())
    return base.title()

def generar_clave(marca: str, nombre_base: str, tipo: str, tamaño: str) -> str:
    """Clave única normalizada para deduplicar entre tiendas."""
    def norm(s):
        return re.sub(r'\s+', ' ', s.lower().strip())
    return f"{norm(marca)}|{norm(nombre_base)}|{norm(tipo)}|{norm(tamaño)}"

def limpiar_html(texto: str) -> str:
    if not texto:
        return ""
    sin_tags = re.sub(r"<[^>]+>", " ", texto)
    return ' '.join(sin_tags.split()).strip()

def detectar_genero(categorias: list) -> str:
    rutas = [c.lower() for c in categorias]
    for r in rutas:
        # Femenino primero: evita que "femeninas" matchee el substring "men"
        if any(x in r for x in ["femenin", "mujer", "women", "femme", "para ella"]):
            return "Femenino"
        if any(x in r for x in ["masculin", "hombre", "for men", "homme", "para él"]):
            return "Masculino"
        if "unisex" in r:
            return "Unisex"
    return "Unisex"

# ─── SCRAPING ────────────────────────────────────────────────────

def scrape_tienda(nombre_tienda: str) -> list:
    cfg    = TIENDAS[nombre_tienda]
    url    = cfg["base_url"]
    base   = cfg["base_link"]
    desde, paso = 0, 50
    items  = []

    print(f"\nScrapeando {nombre_tienda}...")
    while True:
        endpoint = f"{url}?_from={desde}&_to={desde+paso-1}"
        print(f"  {desde}–{desde+paso-1}...")
        try:
            r = requests.get(endpoint, headers=HEADERS, timeout=15)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            print(f"  Error: {e}")
            break

        if not data:
            break

        for prod in data:
            categorias        = prod.get("categories", [])
            genero            = detectar_genero(categorias)
            descripcion_html  = prod.get("description", "").strip()
            descripcion       = limpiar_html(descripcion_html)
            nombre_producto   = prod.get("productName", "")

            for item in prod.get("items", []):
                oferta       = item["sellers"][0]["commertialOffer"]
                precio_final = oferta.get("Price", 0)
                if nombre_tienda == "rouge":
                    precio_lista = oferta.get("PriceWithoutDiscount", 0)
                else:
                    precio_lista = oferta.get("ListPrice", 0)
                stock        = oferta.get("AvailableQuantity", 0)
                if stock == 0:
                    continue

                descuento = 0
                if precio_lista > precio_final > 0:
                    descuento = int(100 - (precio_final / precio_lista * 100))

                imagenes = item.get("images", [])
                imagen   = imagenes[0].get("imageUrl", "") if imagenes else ""

                tamaño_raw   = item.get("name", "")
                tipo         = normalizar_tipo(nombre_producto + " " + tamaño_raw)
                tamaño       = normalizar_tamaño(tamaño_raw if tamaño_raw else nombre_producto)
                nombre_base  = normalizar_nombre_base(nombre_producto, tipo, tamaño)
                marca        = prod.get("brand", "")
                clave        = generar_clave(marca, nombre_base, tipo, tamaño)

                link = prod.get("link", "")
                if link and not link.startswith("http"):
                    link = base + link

                items.append({
                    "tienda":        nombre_tienda,
                    "id_producto":   prod.get("productId"),
                    "id_sku":        item.get("itemId"),
                    "marca":         marca,
                    "nombre_base":   nombre_base,
                    "tipo":          tipo,
                    "tamaño":        tamaño,
                    "genero":        genero,
                    "descripcion":   descripcion,
                    "imagen":        imagen,
                    "precio_lista":  precio_lista,
                    "precio_final":  precio_final,
                    "descuento":     descuento,
                    "stock_estado":  "Con Stock" if stock > 0 else "Sin Stock",
                    "link":          link,
                    "clave_unica":   clave,
                    "scraped_at":    datetime.now(timezone.utc).isoformat(),
                })

        desde += paso
        time.sleep(0.4)

    print(f"  Total {nombre_tienda}: {len(items)} variantes")
    return items


# ─── DEDUPLICACIÓN ───────────────────────────────────────────────

def deduplicar(todos_items: list) -> tuple[list, list]:
    perfumes_map = {}

    for item in todos_items:
        clave = item["clave_unica"]
        if clave not in perfumes_map:
            perfumes_map[clave] = {
                "marca":       item["marca"],
                "nombre_base": item["nombre_base"],
                "tipo":        item["tipo"],
                "tamaño":      item["tamaño"],
                "genero":      item["genero"],
                "descripcion": item["descripcion"],
                "imagen":      item["imagen"],
                "clave_unica": clave,
            }
        else:
            existing = perfumes_map[clave]
            if item["tienda"] == "rouge":
                if item["imagen"]:      existing["imagen"]      = item["imagen"]
                if item["descripcion"]: existing["descripcion"] = item["descripcion"]
            else:
                if not existing["imagen"]      and item["imagen"]:      existing["imagen"]      = item["imagen"]
                if not existing["descripcion"] and item["descripcion"]: existing["descripcion"] = item["descripcion"]

    perfumes_unicos = list(perfumes_map.values())
    print(f"\nDeduplicación:")
    print(f"  Total variantes: {len(todos_items)}")
    print(f"  Únicos:          {len(perfumes_unicos)}")
    for tienda in TIENDAS:
        count = len([i for i in todos_items if i["tienda"] == tienda])
        print(f"  {tienda}: {count} variantes")

    return perfumes_unicos, todos_items


# ─── EMBEDDINGS ──────────────────────────────────────────────────

def generar_embeddings(perfumes: list) -> list:
    print(f"\nCargando modelo {MODEL_NAME}...")
    model = SentenceTransformer(MODEL_NAME)

    textos = []
    for p in perfumes:
        texto = f"{p['marca']} {p['nombre_base']} {p['tipo']} {p['genero']} {p.get('descripcion','')[:300]}"
        textos.append(texto)

    print(f"Generando embeddings para {len(textos)} perfumes...")
    embeddings = model.encode(textos, show_progress_bar=True, batch_size=64)

    for p, emb in zip(perfumes, embeddings):
        p["embedding"] = emb.tolist()

    return perfumes


# ─── SUPABASE ────────────────────────────────────────────────────

def subir_supabase(perfumes_unicos: list, tiendas_items: list):
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # 1. Upsert perfumes únicos
    print(f"\nSubiendo {len(perfumes_unicos)} perfumes únicos...")
    batch = 50
    clave_to_id = {}

    for i in range(0, len(perfumes_unicos), batch):
        lote = perfumes_unicos[i:i+batch]
        rows = [{
            "marca":        p["marca"],
            "nombre_base":  p["nombre_base"],
            "tipo":         p["tipo"],
            "tamaño":       p["tamaño"],
            "genero":       p["genero"],
            "descripcion":  p.get("descripcion"),
            "imagen":       p.get("imagen"),
            "embedding":    p.get("embedding"),
            "clave_unica":  p["clave_unica"],
            "updated_at":   datetime.now(timezone.utc).isoformat(),
        } for p in lote]

        res = supabase.table("perfumes").upsert(rows, on_conflict="clave_unica").execute()
        print(f"  Batch {i//batch+1}: {len(lote)} perfumes")

    # Obtener IDs generados
    res = supabase.table("perfumes").select("id, clave_unica").execute()
    for row in res.data:
        clave_to_id[row["clave_unica"]] = row["id"]

    # 2. Upsert precios por tienda
    print(f"\nSubiendo {len(tiendas_items)} registros de tiendas...")
    tiendas_rows = []
    for item in tiendas_items:
        pid = clave_to_id.get(item["clave_unica"])
        if not pid:
            continue
        tiendas_rows.append({
            "perfume_id":   pid,
            "tienda":       item["tienda"],
            "id_sku":       item["id_sku"],
            "id_producto":  item["id_producto"],
            "precio_lista": item["precio_lista"],
            "precio_final": item["precio_final"],
            "descuento":    item["descuento"],
            "stock_estado": item["stock_estado"],
            "link":         item["link"],
            "scraped_at":   item["scraped_at"],
        })

    # Deduplicar por (tienda, id_sku) antes de enviar
    seen = {}
    for row in tiendas_rows:
        seen[(row["tienda"], row["id_sku"])] = row
    tiendas_rows = list(seen.values())

    for i in range(0, len(tiendas_rows), batch):
        lote = tiendas_rows[i:i+batch]
        supabase.table("perfume_tiendas").upsert(lote, on_conflict="tienda,id_sku").execute()
        print(f"  Batch {i//batch+1}: {len(lote)} registros")

    # 3. Historial de precios
    print("\nGuardando historial...")
    hist = [{
        "tienda":       item["tienda"],
        "id_sku":       item["id_sku"],
        "precio_final": item["precio_final"],
        "descuento":    item["descuento"],
        "stock_estado": item["stock_estado"],
        "registrado_at": item["scraped_at"],
    } for item in tiendas_items]

    for i in range(0, len(hist), 100):
        supabase.table("precio_historial").insert(hist[i:i+100]).execute()

    print("\nCarga completa.")


# ─── MAIN ────────────────────────────────────────────────────────

def main():
    todos_items = []
    for nombre_tienda in TIENDAS:
        todos_items += scrape_tienda(nombre_tienda)

    perfumes_unicos, tiendas_items = deduplicar(todos_items)

    with open("catalogo_comparador.json", "w", encoding="utf-8") as f:
        json.dump({
            "perfumes": [{k:v for k,v in p.items() if k != "embedding"} for p in perfumes_unicos],
            "tiendas":  tiendas_items,
        }, f, ensure_ascii=False, indent=2)
    print("Backup en catalogo_comparador.json")

    perfumes_unicos = generar_embeddings(perfumes_unicos)
    subir_supabase(perfumes_unicos, tiendas_items)

    print("\nListo.")


if __name__ == "__main__":
    main()