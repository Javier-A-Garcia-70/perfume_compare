import os
from pathlib import Path
import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
import requests as http_requests

# Siempre carga el .env del mismo directorio que este archivo
load_dotenv(Path(__file__).parent / ".env")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_KEY"), timeout=60.0)

# Cargados una vez al iniciar — no por request
_model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
def supabase_rpc(function_name: str, params: dict) -> list:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise HTTPException(status_code=500, detail="SUPABASE_URL / SUPABASE_ANON_KEY no configurados en .env")
    r = http_requests.post(
        f"{url}/rest/v1/rpc/{function_name}",
        json=params,
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


class ClaudeRequest(BaseModel):
    model: str = "claude-sonnet-4-20250514"
    max_tokens: int = 1024
    messages: list


@app.post("/api/claude")
def claude_proxy(body: ClaudeRequest):
    try:
        msg = client.messages.create(
            model=body.model,
            max_tokens=body.max_tokens,
            messages=body.messages,
        )
        return {"content": [{"type": "text", "text": msg.content[0].text}]}
    except anthropic.APITimeoutError:
        raise HTTPException(status_code=504, detail="Timeout al conectar con Anthropic. Reintentá en unos segundos.")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


class SearchRequest(BaseModel):
    query: str
    limit: int = 15
    filtro_genero: str = ""
    filtro_marca: str = ""
    solo_ofertas: bool = False


def expandir_query(query: str) -> str:
    """Usa Claude para traducir la query a vocabulario de perfumería."""
    try:
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=80,
            messages=[{
                "role": "user",
                "content": (
                    f"Sos un experto en perfumería. Dada esta búsqueda: \"{query}\"\n"
                    "Devolvé SOLO una lista de 8-12 palabras clave de perfumería en español "
                    "(notas olfativas, familias, descriptores) que representen esa búsqueda. "
                    "Sin explicaciones, solo las palabras separadas por espacios."
                )
            }]
        )
        expandido = msg.content[0].text.strip()
        return expandido
    except Exception:
        return query


@app.post("/api/search")
def vector_search(body: SearchRequest):
    try:
        print(f"\n{'='*50}")
        print(f"[search] query original: '{body.query}'")

        query_embedding = expandir_query(body.query)
        print(f"[search] query expandida: '{query_embedding}'")

        embedding = _model.encode(query_embedding).tolist()
        print(f"[search] embedding generado ({len(embedding)} dims)")

        results = supabase_rpc("buscar_perfumes", {
            "query_embedding": embedding,
            "match_count": body.limit,
            "filtro_genero": body.filtro_genero,
            "filtro_marca": body.filtro_marca,
            "solo_ofertas": body.solo_ofertas,
        })

        print(f"[search] resultados: {len(results)}")
        for r in results[:10]:
            print(f"  id={r.get('id')}  sim={r.get('similarity', 0):.3f}")

        return {"results": results, "query": body.query, "total": len(results)}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health():
    return {"status": "ok"}
