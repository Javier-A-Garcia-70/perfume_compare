FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
# Instala torch CPU-only (~200 MB) en lugar de la versión CUDA (~2 GB)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir requests==2.31.0 sentence-transformers==3.0.1 supabase==2.7.0 python-dotenv==1.0.1

COPY scraper_rouge.py .

CMD ["python", "scraper_rouge.py"]
