"""Billing service for Stripe integration."""

import os
from typing import Optional
from backend.models.subscription import PLAN_LIMITS

# Stripe price IDs (would be configured in env vars in production)
STRIPE_PRICE_IDS = {
    "starter": os.getenv("STRIPE_PRICE_STARTER", "price_starter_placeholder"),
    "pro": os.getenv("STRIPE_PRICE_PRO", "price_pro_placeholder"),
    "enterprise": os.getenv("STRIPE_PRICE_ENTERPRISE", "price_enterprise_placeholder"),
}

PLAN_PRICES = {
    "free": 0,
    "starter": 49900,   # $499/mo in cents
    "pro": 199900,      # $1,999/mo
    "enterprise": 499900,  # $4,999/mo
}


def get_plan_info(plan: str) -> Optional[dict]:
    """Get plan details including limits and pricing."""
    limits = PLAN_LIMITS.get(plan)
    if not limits:
        return None
    return {
        "plan": plan,
        "max_assets": limits["max_assets"],
        "max_users": limits["max_users"],
        "features": limits["features"],
        "price_monthly": PLAN_PRICES.get(plan, 0),
    }


def check_feature_access(plan: str, feature: str) -> bool:
    """Check if a plan has access to a specific feature."""
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    features = limits["features"]
    return "all" in features or feature in features


def check_asset_limit(plan: str, current_count: int) -> bool:
    """Check if adding another asset would exceed the plan limit."""
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    return current_count < limits["max_assets"]


def check_user_limit(plan: str, current_count: int) -> bool:
    """Check if adding another user would exceed the plan limit."""
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    return current_count < limits["max_users"]
