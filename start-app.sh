#!/usr/bin/env bash
set -eu

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
WORKERS="${WEB_CONCURRENCY:-2}"

# Build React frontend if source is newer than dist
FRONTEND_DIR="frontend-v2"
if [ -d "$FRONTEND_DIR/src" ]; then
  if [ ! -d "$FRONTEND_DIR/dist" ] || \
     [ "$(find "$FRONTEND_DIR/src" -newer "$FRONTEND_DIR/dist/index.html" 2>/dev/null | head -1)" ]; then
    echo "Building React frontend..."
    (cd "$FRONTEND_DIR" && npm install --silent && npm run build)
    echo "Frontend build complete."
  else
    echo "Frontend dist is up to date."
  fi
fi

# Run Alembic migrations if configured for PostgreSQL
if echo "${DATABASE_URL:-}" | grep -q "postgresql"; then
  echo "Running database migrations..."
  python -m alembic upgrade head
fi

echo "Starting OneAlert on ${HOST}:${PORT} (workers=${WORKERS})"

exec gunicorn backend.main:app \
  -k uvicorn.workers.UvicornWorker \
  --bind "${HOST}:${PORT}" \
  --workers "${WORKERS}" \
  --timeout 120 \
  --access-logfile -
