"""
User-related dependencies (role checks, etc) for FastAPI routes.

This module avoids circular imports by separating dependencies from models and routers.
"""

from fastapi import Depends, HTTPException, status

from backend.models.user import User
from backend.routers.auth import get_current_user


def require_role(role: str):
    async def dependency(user: User = Depends(get_current_user)):
        if user.role != role:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user
    return dependency
