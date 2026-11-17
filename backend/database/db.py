"""
Database connection and session management.

This module handles the setup of SQLAlchemy database engines and sessions
for both synchronous and asynchronous operations. It supports SQLite for
development and PostgreSQL for production, configured via environment variables.

Key components:
- `Base`: Declarative base for SQLAlchemy models.
- `get_engine()`: Returns a lazily initialized synchronous SQLAlchemy engine.
- `get_async_engine()`: Returns a lazily initialized asynchronous SQLAlchemy engine.
- `SessionLocal`: A factory for creating synchronous database sessions.
- `AsyncSessionLocal`: A factory for creating asynchronous database sessions.
- `get_db()`: FastAPI dependency for synchronous database sessions.
- `get_async_db()`: FastAPI dependency for asynchronous database sessions.
"""

from collections.abc import AsyncGenerator  # For typing asynchronous generators

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import (
    declarative_base,  # Standard import for declarative base
    sessionmaker,
)

from backend.config import settings  # Application settings, including DATABASE_URL

# `Base` is the superclass for all SQLAlchemy ORM models.
# Models inherit from this to be mapped to database tables.
Base = declarative_base()

# Global engine instances, initialized lazily to avoid setup overhead
# until they are actually needed.
_engine = None  # For synchronous operations
_async_engine = None  # For asynchronous operations

def get_engine():
    """
    Returns the synchronous SQLAlchemy engine.

    Creates the engine on its first call based on `settings.database_url`.
    Includes specific connect arguments for SQLite to allow multi-threaded access.
    """
    global _engine
    if _engine is None:
        if settings.database_url.startswith("sqlite"):
            # For SQLite, `check_same_thread` is False to allow usage across multiple threads,
            # which can happen in a web server environment (though FastAPI typically uses async).
            _engine = create_engine(
                settings.database_url,
                connect_args={"check_same_thread": False} # Specific to SQLite
            )
        else:
            # For other databases like PostgreSQL, standard engine creation.
            _engine = create_engine(settings.database_url)
    return _engine

def get_async_engine():
    """
    Returns the asynchronous SQLAlchemy engine.

    Creates the engine on its first call based on `settings.async_database_url`.
    Raises an error if `async_database_url` is not configured.
    Includes specific connect arguments for aiosqlite.
    """
    global _async_engine
    if _async_engine is None:
        if not settings.async_database_url:
            # This check ensures that the async database URL was properly derived or set.
            raise ValueError("ASYNC_DATABASE_URL is not set in settings. Ensure config.py derived it.")

        if settings.async_database_url.startswith("sqlite+aiosqlite"):
            # For async SQLite with aiosqlite driver.
            _async_engine = create_async_engine(
                settings.async_database_url,
                connect_args={"check_same_thread": False} # Specific to SQLite
            )
        else:
            # For other async drivers like asyncpg (PostgreSQL).
            _async_engine = create_async_engine(settings.async_database_url)
    return _async_engine

# Session maker factories.
# These are functions that return sessionmaker instances, ensuring engines are initialized.

def get_session_local():
    """Returns a sessionmaker for synchronous sessions, bound to the sync engine."""
    engine = get_engine() # Ensures sync engine is initialized
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_async_session_local():
    """Returns an async_sessionmaker for asynchronous sessions, bound to the async engine."""
    async_engine_instance = get_async_engine() # Ensures async engine is initialized
    return async_sessionmaker(
        bind=async_engine_instance,
        class_=AsyncSession, # Specifies the session class to use
        expire_on_commit=False # Prevents SQLAlchemy from expiring instances after commit
    )

# Instantiate session makers. These are callable and will create new sessions.
SessionLocal = get_session_local()
AsyncSessionLocal = get_async_session_local()

# For backward compatibility and script usage
engine = get_engine()
async_engine = get_async_engine()

# FastAPI Dependency for synchronous database sessions
def get_db():
    """
    FastAPI dependency that provides a synchronous database session.

    Ensures the session is closed after the request is handled, even if errors occur.
    It re-fetches `SessionLocal` to ensure it uses the latest engine configuration,
    though this is typically stable.
    """
    current_session_local = get_session_local() # Get the configured session factory
    db = current_session_local() # Create a new session
    try:
        yield db # Provide the session to the endpoint
    finally:
        db.close() # Close the session after use

# FastAPI Dependency for asynchronous database sessions
async def get_async_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency that provides an asynchronous database session.

    Ensures the session is closed after the request is handled.
    Uses `AsyncGenerator` for proper async context management with `yield`.
    """
    current_async_session_local = get_async_session_local() # Get the configured async session factory
    async_session = current_async_session_local() # Create a new async session
    try:
        yield async_session # Provide the async session to the endpoint
    finally:
        await async_session.close() # Close the async session after use

# Note for script usage (e.g., init_db.py):
# Scripts that need direct database engine access (outside of FastAPI request cycle)
# can call `get_engine()` or `get_async_engine()` directly to obtain the engine instance.
# This allows them to perform operations like creating tables (Base.metadata.create_all).
