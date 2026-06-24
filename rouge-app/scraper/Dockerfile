FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir requests==2.31.0 sentence-transformers==3.0.1 supabase==2.7.0 python-dotenv==1.0.1

COPY scraper_rouge.py .

CMD ["python", "scraper_rouge.py"]
