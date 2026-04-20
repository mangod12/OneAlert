"""
FastAPI main application entry point.
Configures the API, middleware, routers, and startup/shutdown events.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import logging
import os

from backend.config import settings
from backend.routers import auth, assets, alerts, ot, organizations, compliance, sbom, topology, billing
from backend.routers import sensor_ingest, integrations
from backend.scheduler.cron import scheduler
from backend.middleware.security_headers import SecurityHeadersMiddleware
from backend.middleware.rate_limiter import limiter, SlowAPIMiddleware, RateLimitExceeded, rate_limit_exceeded_handler
from backend.middleware.request_id import RequestIDMiddleware
from backend.middleware.metrics import MetricsMiddleware, get_metrics_summary
from backend.logging_config import setup_logging, get_logger as get_struct_logger


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize structured logging
setup_logging(debug=os.getenv("DEBUG", "").lower() in ("1", "true"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    logger.info("Starting CyberSec Alert SaaS...")
    
    # Initialize database tables and seed demo data
    try:
        from backend.database.db import get_async_engine, AsyncSessionLocal, Base
        from backend.database.seed import seed_database
        from backend.services.compliance_seed import seed_compliance_data
        
        logger.info("Initializing database tables...")
        async_engine = get_async_engine()
        
        # NOTE: In production, use `alembic upgrade head` instead of create_all.
        # create_all is kept for development convenience.
        async with async_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        
        logger.info("Database tables initialized")
        
        # Seed demo user if needed
        await seed_database()
        logger.info("Database seeding complete")

        # Seed compliance frameworks and controls
        async with AsyncSessionLocal() as session:
            await seed_compliance_data(session)
        logger.info("Compliance data seeding complete")
        
    except Exception as e:
        logger.error(f"Database initialization error: {e}")
        # Continue startup even if seeding fails
    
    # Start scheduler
    if not os.getenv("DISABLE_SCHEDULER"):
        scheduler.start()
        logger.info("Scheduler started")
    
    yield
    
    # Shutdown
    logger.info("Shutting down...")
    if not os.getenv("DISABLE_SCHEDULER"):
        scheduler.shutdown()
        logger.info("Scheduler stopped")


# Create FastAPI application
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="CVE and OEM vulnerability notification SaaS for SMBs",
    lifespan=lifespan
)

app.state.limiter = limiter

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(SlowAPIMiddleware)

# Security headers on all responses
app.add_middleware(SecurityHeadersMiddleware)

# Request ID tracing
app.add_middleware(RequestIDMiddleware)

# Request metrics
app.add_middleware(MetricsMiddleware)


# Exception handlers with standardized envelope
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Handle HTTP exceptions with standardized envelope."""
    request_id = getattr(request.state, "request_id", "unknown")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "data": None,
            "error": {
                "code": f"HTTP_{exc.status_code}",
                "message": exc.detail,
            },
            "metadata": {"request_id": request_id},
        },
    )


@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Handle general exceptions with standardized envelope."""
    request_id = getattr(request.state, "request_id", "unknown")
    logger.error(f"Unhandled exception [request_id={request_id}]: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "Internal server error",
            },
            "metadata": {"request_id": request_id},
        },
    )


app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)


# Include routers
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(assets.router, prefix="/api/v1/assets", tags=["Assets"])
app.include_router(alerts.router, prefix="/api/v1/alerts", tags=["Alerts"])
app.include_router(ot.router, prefix="/api/v1/ot", tags=["OT/ICS"])
app.include_router(sensor_ingest.router, prefix="/api/v1/ot", tags=["OT/ICS"])
app.include_router(organizations.router, prefix="/api/v1/orgs", tags=["Organizations"])
app.include_router(compliance.router, prefix="/api/v1/compliance", tags=["Compliance"])
app.include_router(sbom.router, prefix="/api/v1/sbom", tags=["SBOM"])
app.include_router(topology.router, prefix="/api/v1/topology", tags=["Network Topology"])
app.include_router(billing.router, prefix="/api/v1/billing", tags=["Billing"])
app.include_router(integrations.router, prefix="/api/v1/integrations", tags=["Integrations"])


# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "app_name": settings.app_name,
        "version": settings.app_version
    }


@app.get("/health/live")
async def health_live():
    """Liveness probe — always returns OK if the process is running."""
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready():
    """Readiness probe — checks database connectivity."""
    try:
        from backend.database.db import get_async_engine
        async_engine = get_async_engine()
        async with async_engine.connect() as conn:
            await conn.execute(
                __import__("sqlalchemy").text("SELECT 1")
            )
        return {"status": "ready", "database": "connected"}
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "database": str(e)},
        )


@app.get("/metrics")
async def metrics_endpoint():
    """Return in-memory request metrics summary."""
    return {"success": True, "data": get_metrics_summary()}


# Root endpoint - redirect to frontend
@app.get("/")
async def root():
    """Root endpoint - redirects to frontend."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/app/")


# Serve static files from frontend directory
# Prefer React build (frontend-v2/dist) over legacy vanilla frontend
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
react_dist_dir = os.path.join(project_root, "frontend-v2", "dist")
legacy_frontend_dir = os.path.join(project_root, "frontend")

if os.path.isdir(react_dist_dir):
    app.mount("/app", StaticFiles(directory=react_dist_dir, html=True), name="frontend")
    logger.info(f"Serving React frontend from {react_dist_dir}")
elif os.path.isdir(legacy_frontend_dir):
    app.mount("/app", StaticFiles(directory=legacy_frontend_dir, html=True), name="frontend")
    logger.info(f"Serving legacy frontend from {legacy_frontend_dir}")
else:
    logger.warning("No frontend directory found")