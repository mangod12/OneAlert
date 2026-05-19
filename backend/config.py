"""
Application configuration management using Pydantic Settings.

This module defines the application's configuration settings, loading them
from environment variables and a .env file. It uses Pydantic's BaseSettings
for robust validation and type checking.

Key Features:
- Loads settings from .env file and environment variables.
- Provides default values for settings if not specified.
- Validates data types of configuration values.
- Automatically generates an asynchronous database URL if not explicitly set.
- Centralized configuration access throughout the application.
"""

from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
import os # Standard library for OS-related functionalities, not directly used for settings loading here but often useful.

class Settings(BaseSettings):
    """
    Application settings class.

    Attributes are defined with type hints and default values.
    Pydantic automatically reads values from environment variables
    (case-insensitive) or a .env file.
    """
    
    # Database Configuration
    # Defines the connection URL for the primary synchronous database.
    # Example for SQLite: "sqlite:///./cybersec_alerts.db"
    # Example for PostgreSQL: "postgresql://user:password@host:port/dbname"
    database_url: str = "sqlite:///./cybersec_alerts.db" 
    
    # Defines the connection URL for the asynchronous database.
    # Automatically derived from `database_url` if not provided.
    # Example for SQLite: "sqlite+aiosqlite:///./cybersec_alerts.db"
    # Example for PostgreSQL: "postgresql+asyncpg://user:password@host:port/dbname"
    async_database_url: Optional[str] = None

    # JWT (JSON Web Token) Configuration
    # Secret key used to sign and verify JWTs. CRITICAL for security.
    # Should be a long, random, and unique string in production.
    secret_key: str = "dev-secret-key-change-in-production" # Default for development only.

    # Environment flag: "production", "staging", or "development"
    environment: str = "development"
    
    # Algorithm used for JWT signing (e.g., HS256, RS256).
    algorithm: str = "HS256"
    
    # Expiration time for access tokens in minutes.
    access_token_expire_minutes: int = 30
    
    # Email Configuration (using Mailgun as an example)
    # API key for the Mailgun service. Required for sending email alerts.
    mailgun_api_key: Optional[str] = None
    
    # Domain configured with Mailgun for sending emails.
    mailgun_domain: Optional[str] = None
    
    # Default "From" email address for outgoing alert emails.
    from_email: str = "alerts@example.com" # Replace with your actual sender email.
    
    # CVE/NVD (National Vulnerability Database) API Configuration
    # Optional API key for NVD services to get higher rate limits.
    nvd_api_key: Optional[str] = None
    
    # Base URL for the NVD CVE API.
    nvd_api_base_url: str = "https://services.nvd.nist.gov/rest/json/cves/2.0"

    # Application Core Configuration
    # Name of the application.
    app_name: str = "CyberSec Alert SaaS"
    
    # Current version of the application.
    app_version: str = "1.0.0"
    
    # Debug mode flag. Set to False in production for security and performance.
    debug: bool = False
    
    # List of allowed origins for CORS (Cross-Origin Resource Sharing).
    # Important for frontend applications running on different domains/ports.
    cors_origins: List[str] = ["http://localhost:3000", "http://localhost:8080", "http://127.0.0.1:8000", "http://localhost:8000", "http://localhost:8001"]
    
    # Scheduler Configuration
    # Interval in hours for the vulnerability scraper to run.
    scraper_interval_hours: int = 6

    # Stripe Configuration (Optional - if payment processing is integrated)
    # Secret key for Stripe API.
    stripe_secret_key: Optional[str] = None
    
    # Publishable key for Stripe API (used on the frontend).
    stripe_publishable_key: Optional[str] = None

    # GitHub OAuth Configuration
    # GitHub OAuth App Client ID
    github_client_id: Optional[str] = None
    
    # GitHub OAuth App Client Secret
    github_client_secret: Optional[str] = None
    
    # GitHub OAuth redirect URI (port 8000 for local, 8001 for Docker)
    github_redirect_uri: str = "http://localhost:8000/api/v1/auth/github/callback"

    # AI Provider Configuration
    ai_provider: str = "anthropic"  # anthropic | openai | ollama | vllm | groq | together | llamacpp
    ai_base_url: Optional[str] = None
    ai_api_key: Optional[str] = None  # Falls back to ANTHROPIC_API_KEY
    ai_triage_model: Optional[str] = None
    ai_code_model: Optional[str] = None
    ai_embedding_model: Optional[str] = None
    ai_default_model: Optional[str] = None
    anthropic_api_key: Optional[str] = None

    # Pydantic Model Configuration
    # Tells Pydantic how to load and manage settings.
    model_config = SettingsConfigDict(
        env_file=".env",  # Specifies the .env file to load variables from.
        env_file_encoding='utf-8', # Encoding for the .env file.
        extra="ignore",  # Ignores extra fields not defined in the model.
        case_sensitive=False # Allows environment variables to be UPPERCASE.
    )

    # Post-initialization logic using Pydantic's model_post_init
    # This method is called after the model is initialized with values.
    def model_post_init(self, __context) -> None:
        """
        Derives `async_database_url` from `database_url` if not set.
        This ensures that an async database connection string is available
        if only the sync one is provided, adapting it for common database types.
        """
        # Check if async_database_url needs to be generated
        if self.database_url and not self.async_database_url:
            normalized_url = self.database_url.strip()

            if normalized_url.startswith("sqlite:///"):
                # For SQLite, replace "sqlite:///" with "sqlite+aiosqlite:///
                # This uses the aiosqlite driver for async operations.
                # Handles relative paths like "sqlite:///./file.db" correctly.
                self.async_database_url = "sqlite+aiosqlite:///" + normalized_url[len("sqlite:///"):]
            elif normalized_url.startswith("postgresql+asyncpg://"):
                # URL is already configured for async PostgreSQL.
                self.async_database_url = normalized_url
            elif normalized_url.startswith("postgresql+psycopg2://"):
                # Convert SQLAlchemy sync Postgres URL to asyncpg URL.
                self.async_database_url = normalized_url.replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)
            elif normalized_url.startswith("postgresql://"):
                # For PostgreSQL, replace "postgresql://" with "postgresql+asyncpg://"
                # This uses the asyncpg driver for async operations.
                self.async_database_url = normalized_url.replace("postgresql://", "postgresql+asyncpg://", 1)
            elif normalized_url.startswith("postgres://"):
                # Common shorthand used by managed platforms.
                self.async_database_url = normalized_url.replace("postgres://", "postgresql+asyncpg://", 1)
            # Add similar conversions for other database types (e.g., MySQL) if needed.
            # else:
            #     logger.warning(f"Unsupported database_url for async conversion: {self.database_url}")


# Global instance of the Settings class.
# This instance is imported by other modules to access configuration values.
settings = Settings()

# Guard: refuse to start in production with the default secret key
if settings.environment == "production" and settings.secret_key == "dev-secret-key-change-in-production":
    raise RuntimeError(
        "FATAL: SECRET_KEY is still the default dev value. "
        "Set a strong, unique SECRET_KEY environment variable before running in production."
    )

# Example of how to access settings in other modules:
#
# from backend.config import settings
#
# db_url = settings.database_url
# api_key = settings.nvd_api_key
# print(f"Database URL: {db_url}")
# print(f"Async Database URL: {settings.async_database_url}")