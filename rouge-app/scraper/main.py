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

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_KEY"))

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


@app.post("/api/search")
def vector_search(body: SearchRequest):
    try:
        embedding = _model.encode(body.query).tolist()
        results = supabase_rpc("buscar_perfumes", {
            "query_embedding": embedding,
            "match_count": body.limit,
            "filtro_genero": body.filtro_genero,
            "filtro_marca": body.filtro_marca,
            "solo_ofertas": body.solo_ofertas,
        })
        return {"results": results}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health():
    return {"status": "ok"}
