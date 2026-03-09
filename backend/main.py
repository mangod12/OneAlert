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
from backend.routers import auth, assets, alerts
from backend.scheduler.cron import scheduler


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    logger.info("Starting CyberSec Alert SaaS...")
    
    # Initialize database tables and seed demo data
    try:
        from backend.database.db import get_async_engine, Base
        from backend.database.seed import seed_database
        
        logger.info("Initializing database tables...")
        async_engine = get_async_engine()
        
        # Create tables if they don't exist
        async with async_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        
        logger.info("Database tables initialized")
        
        # Seed demo user if needed
        await seed_database()
        logger.info("Database seeding complete")
        
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

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Exception handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Handle HTTP exceptions."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "status_code": exc.status_code}
    )


@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Handle general exceptions."""
    logger.error(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "status_code": 500}
    )


# Include routers
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(assets.router, prefix="/api/v1/assets", tags=["Assets"])
app.include_router(alerts.router, prefix="/api/v1/alerts", tags=["Alerts"])


# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "app_name": settings.app_name,
        "version": settings.app_version
    }


# Root endpoint - redirect to frontend
@app.get("/")
async def root():
    """Root endpoint - redirects to frontend."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/app/")


# Serve static files from frontend directory
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
frontend_dir = os.path.join(project_root, "frontend")

if os.path.isdir(frontend_dir):
    app.mount("/app", StaticFiles(directory=frontend_dir, html=True), name="frontend")
    logger.info(f"Serving frontend from {frontend_dir}")
else:
    logger.warning(f"Frontend directory not found at {frontend_dir}")