"""
Database initialization for local deployment.
Creates tables and seeds sample data.
"""

import asyncio
import sys
import os
from pathlib import Path

# Add project root to Python path
project_root = Path(__file__).resolve().parent.parent # Modified path
sys.path.insert(0, str(project_root))

from sqlalchemy import text

async def create_database():
    """Create database tables and seed data."""
    try:
        print("Initializing database...")
        
        # Import after path is set
        from backend.database.db import get_async_engine, Base
        from backend.models import user, asset, alert, discovered_device
        
        # Get the async engine
        async_engine = get_async_engine()
        
        # Create all tables
        async with async_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        
        print("Database tables created successfully")
        
        # Import and run seeding
        from backend.database.seed import seed_database
        await seed_database()
        
        print("Sample data seeded successfully")
        print("\nSample user created:")
        print("   Email: admin@example.com")
        print("   Password: password123")
        
        return True
        
    except Exception as e:
        print(f"Database initialization failed: {e}")
        import traceback
        traceback.print_exc()
        return False

# --- DB Migration for Alert enrichment fields ---
def migrate_alert_table_for_enrichment(engine):
    with engine.connect() as conn:
        conn.execute(text('ALTER TABLE alerts ADD COLUMN IF NOT EXISTS exploitability FLOAT'))
        conn.execute(text('ALTER TABLE alerts ADD COLUMN IF NOT EXISTS remediation VARCHAR'))
        conn.commit()

def migrate_user_table_for_role(engine):
    with engine.connect() as conn:
        try:
            conn.execute(text('ALTER TABLE users ADD COLUMN role VARCHAR DEFAULT "viewer"'))
            conn.commit()
        except Exception as e:
            print(f"[INFO] Could not add 'role' column (may already exist): {e}")

def migrate_user_table_for_webhooks(engine):
    with engine.connect() as conn:
        try:
            conn.execute(text('ALTER TABLE users ADD COLUMN slack_webhook_url VARCHAR'))
        except Exception as e:
            print(f"[INFO] Could not add 'slack_webhook_url' column (may already exist): {e}")
        try:
            conn.execute(text('ALTER TABLE users ADD COLUMN webhook_url VARCHAR'))
        except Exception as e:
            print(f"[INFO] Could not add 'webhook_url' column (may already exist): {e}")
        conn.commit()

def migrate_user_table_for_mfa(engine):
    with engine.connect() as conn:
        try:
            conn.execute(text('ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN DEFAULT 0'))
        except Exception as e:
            print(f"[INFO] Could not add 'mfa_enabled' column (may already exist): {e}")
        try:
            conn.execute(text('ALTER TABLE users ADD COLUMN mfa_secret VARCHAR'))
        except Exception as e:
            print(f"[INFO] Could not add 'mfa_secret' column (may already exist): {e}")
        conn.commit()

async def main():
    """Main initialization function."""
    print("CVE Alert SaaS - Database Initialization")
    print("=" * 45)
    
    success = await create_database()
    
    if success:
        print("\nDatabase initialization complete!")
        print("\nYour CVE Alert SaaS is ready:")
        print("   • Dashboard: http://localhost:8000/")
        print("   • API Docs:  http://localhost:8000/docs")
        print("   • Health:    http://localhost:8000/health")
    else:
        print("\nDatabase initialization failed")
        return 1
    
    return 0

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
