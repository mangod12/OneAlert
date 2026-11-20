"""Deterministic checklist proposals from saved response actions, without execution."""

import json
import math


def checklist_proposals(actions: list, existing_titles: set[str]) -> list[dict]:
    """Keep original action indexes while sorting usable numeric priorities first."""

    def priority(item):
        value = item[1].get("priority") if isinstance(item[1], dict) else None
        return (
            value
            if (isinstance(value, int) and not isinstance(value, bool))
            or (isinstance(value, float) and math.isfinite(value))
            else float("inf")
        )

    seen = set(existing_titles)
    rows = []
    for index, action in sorted(enumerate(actions), key=priority):
        if not isinstance(action, dict):
            rows.append(
                {
                    "action_index": index,
                    "title": "",
                    "reason": "Malformed saved action",
                    "priority": None,
                    "available": False,
                    "already_present": False,
                }
            )
            continue
        action_type, target = action.get("action_type"), action.get("target", "")
        usable = isinstance(action_type, str) and bool(action_type.strip()) and isinstance(target, str)
        title = (f"{action_type}: {target}" if target else str(action_type or "action"))[:300] if usable else ""
        present = bool(title) and title in seen
        reason = action.get("reason")
        if reason is not None and not isinstance(reason, str):
            reason = json.dumps(reason, ensure_ascii=True, sort_keys=True)
        rows.append(
            {
                "action_index": index,
                "title": title,
                "reason": reason,
                "priority": action.get("priority"),
                "available": usable and not present,
                "already_present": present,
            }
        )
        if title:
            seen.add(title)
    return rows
