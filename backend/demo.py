"""One-command demo launcher for OneAlert.

Usage: python -m backend.demo
"""

import uvicorn
import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./demo.db")
os.environ.setdefault("SECRET_KEY", "demo-secret-key-not-for-production")
os.environ.setdefault("DEMO_MODE", "true")

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  OneAlert AI Security OS — Demo Mode")
    print("=" * 60)
    print("\n  Starting with seeded attack scenario...")
    print("  Open: http://localhost:8000/app/")
    print("  Login: admin@example.com / password123")
    print("=" * 60 + "\n")

    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info",
    )
