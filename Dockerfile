# Stage 1: Build React frontend
FROM node:22-alpine AS frontend-build
WORKDIR /frontend
COPY frontend-v2/package.json frontend-v2/package-lock.json ./
RUN npm ci --silent
COPY frontend-v2/ .
RUN npm run build

# Stage 2: Python runtime
FROM python:3.11-slim

WORKDIR /app

# Install system deps for psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/ ./backend/
COPY alembic/ ./alembic/
COPY alembic.ini ./
COPY start-app.sh ./

# Copy built frontend from Stage 1
COPY --from=frontend-build /frontend/dist ./frontend-v2/dist/

# Create non-root user
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

# Cloud Run sets PORT env var (default 8080)
EXPOSE 8080
ENV PORT=8080

CMD ["bash", "start-app.sh"]
