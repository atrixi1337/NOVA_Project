FROM python:3.12-slim

WORKDIR /app

# System deps for building Python packages + rendering (if needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend.py .
COPY static ./static

# Non-root user for security
RUN useradd -r -s /bin/false appuser && chown -R appuser:appuser /app
USER appuser

# SQLite DB lives in /app (mounted as a persistent volume in Fly.io)
ENV APP_HOST=0.0.0.0 \
    APP_PORT=8000 \
    NOVA_HISTORY_DB=/app/nova_history.db

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

CMD ["python3", "-m", "uvicorn", "backend:app", "--host", "0.0.0.0", "--port", "8000"]
