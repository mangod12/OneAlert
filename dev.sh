#!/usr/bin/env bash
set -eu

# Development mode: runs Vite dev server + FastAPI backend in parallel.
# Vite proxies /api requests to the backend (configured in vite.config.ts).
#
# Usage:
#   ./dev.sh              # Starts both servers
#   ./dev.sh --backend    # Backend only (port 8000)
#   ./dev.sh --frontend   # Frontend only (port 3000)

BACKEND_PORT="${PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

start_backend() {
  echo "[backend] Starting FastAPI on port ${BACKEND_PORT}..."
  uvicorn backend.main:app \
    --reload \
    --host 0.0.0.0 \
    --port "${BACKEND_PORT}" \
    --log-level info
}

start_frontend() {
  echo "[frontend] Starting Vite dev server on port ${FRONTEND_PORT}..."
  (cd frontend-v2 && npm install --silent 2>/dev/null && npm run dev)
}

case "${1:-}" in
  --backend)
    start_backend
    ;;
  --frontend)
    start_frontend
    ;;
  *)
    # Run both in parallel; kill both when either exits
    trap 'kill 0' EXIT
    start_backend &
    start_frontend &
    wait
    ;;
esac
