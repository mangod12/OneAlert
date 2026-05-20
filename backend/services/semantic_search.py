"""Lightweight semantic search for cases and events using TF-IDF.

No external dependencies (pgvector, Neo4j). Uses scikit-learn-style TF-IDF
with pure Python fallback. Provides similar-incident retrieval and
blast-radius graph queries.
"""

import re
import math
import logging
from collections import Counter
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

logger = logging.getLogger(__name__)


def _tokenize(text: str) -> list[str]:
    """Simple tokenizer: lowercase, split on non-alphanumeric, filter stopwords."""
    STOPWORDS = {"the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "to",
                 "for", "of", "with", "and", "or", "not", "this", "that", "it", "be",
                 "has", "have", "had", "do", "does", "did", "will", "would", "could",
                 "should", "may", "might", "from", "by", "as", "but", "if", "no", "so"}
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    return [t for t in tokens if t not in STOPWORDS and len(t) > 1]


def _compute_tf(tokens: list[str]) -> dict[str, float]:
    """Term frequency: count / total tokens."""
    counts = Counter(tokens)
    total = len(tokens)
    if total == 0:
        return {}
    return {term: count / total for term, count in counts.items()}


def _compute_idf(documents: list[list[str]]) -> dict[str, float]:
    """Inverse document frequency: log(N / df)."""
    n = len(documents)
    if n == 0:
        return {}
    df = Counter()
    for doc in documents:
        unique_terms = set(doc)
        for term in unique_terms:
            df[term] += 1
    return {term: math.log(n / count) for term, count in df.items()}


def _tfidf_vector(tokens: list[str], idf: dict[str, float]) -> dict[str, float]:
    """Compute TF-IDF vector for a document."""
    tf = _compute_tf(tokens)
    return {term: tf_val * idf.get(term, 0) for term, tf_val in tf.items()}


def _cosine_similarity(vec_a: dict[str, float], vec_b: dict[str, float]) -> float:
    """Cosine similarity between two sparse vectors."""
    common_terms = set(vec_a.keys()) & set(vec_b.keys())
    if not common_terms:
        return 0.0

    dot = sum(vec_a[t] * vec_b[t] for t in common_terms)
    mag_a = math.sqrt(sum(v ** 2 for v in vec_a.values()))
    mag_b = math.sqrt(sum(v ** 2 for v in vec_b.values()))

    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def _case_to_text(case) -> str:
    """Convert a case to searchable text."""
    def _to_str_list(items):
        if not items:
            return []
        return [str(i) if not isinstance(i, dict) else i.get("id", i.get("name", str(i))) for i in items]

    parts = [
        case.title or "",
        case.summary or "",
        case.attack_narrative or "",
        " ".join(_to_str_list(case.mitre_tactics)),
        " ".join(_to_str_list(case.mitre_techniques)),
        case.severity or "",
    ]
    return " ".join(parts)


async def find_similar_cases(
    db: AsyncSession,
    user_id: int,
    target_case_id: int,
    max_results: int = 5,
    min_similarity: float = 0.1,
) -> list[dict]:
    """Find cases similar to a target case using TF-IDF cosine similarity.

    Returns: list of {"case_id": int, "title": str, "similarity": float, "shared_techniques": list}
    """
    from backend.models.alert import Alert  # noqa: F401 — ensure relationship target loaded
    from backend.models.case import Case

    # Load all cases
    result = await db.execute(
        select(Case).where(Case.user_id == user_id)
    )
    all_cases = result.scalars().all()

    if len(all_cases) < 2:
        return []

    # Find target
    target = None
    others = []
    for c in all_cases:
        if c.id == target_case_id:
            target = c
        else:
            others.append(c)

    if not target:
        return []

    # Tokenize all documents
    target_tokens = _tokenize(_case_to_text(target))
    other_tokens = [_tokenize(_case_to_text(c)) for c in others]

    # Compute IDF across all documents
    all_docs = [target_tokens] + other_tokens
    idf = _compute_idf(all_docs)

    # Compute TF-IDF vectors
    target_vec = _tfidf_vector(target_tokens, idf)

    similarities = []
    target_techniques = set(target.mitre_techniques or [])

    for case, tokens in zip(others, other_tokens):
        vec = _tfidf_vector(tokens, idf)
        sim = _cosine_similarity(target_vec, vec)

        if sim >= min_similarity:
            case_techniques = set(case.mitre_techniques or [])
            shared = list(target_techniques & case_techniques)
            similarities.append({
                "case_id": case.id,
                "title": case.title,
                "severity": case.severity,
                "similarity": round(sim, 3),
                "shared_techniques": shared,
                "status": case.status,
            })

    # Sort by similarity descending
    similarities.sort(key=lambda x: x["similarity"], reverse=True)
    return similarities[:max_results]


async def search_cases(
    db: AsyncSession,
    user_id: int,
    query: str,
    max_results: int = 10,
) -> list[dict]:
    """Search cases by natural language query using TF-IDF ranking.

    Returns: list of {"case_id": int, "title": str, "score": float, "snippet": str}
    """
    from backend.models.alert import Alert  # noqa: F401
    from backend.models.case import Case

    result = await db.execute(
        select(Case).where(Case.user_id == user_id)
    )
    cases = result.scalars().all()

    if not cases:
        return []

    query_tokens = _tokenize(query)
    if not query_tokens:
        return []

    case_tokens = [_tokenize(_case_to_text(c)) for c in cases]
    all_docs = [query_tokens] + case_tokens
    idf = _compute_idf(all_docs)

    query_vec = _tfidf_vector(query_tokens, idf)

    results = []
    for case, tokens in zip(cases, case_tokens):
        vec = _tfidf_vector(tokens, idf)
        score = _cosine_similarity(query_vec, vec)

        if score > 0:
            snippet = (case.summary or case.title or "")[:200]
            results.append({
                "case_id": case.id,
                "title": case.title,
                "score": round(score, 3),
                "snippet": snippet,
                "severity": case.severity,
            })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:max_results]


async def get_blast_radius(
    db: AsyncSession,
    user_id: int,
    case_id: int,
) -> dict:
    """Compute blast radius for a case based on linked assets, events, and topology.

    Returns graph of affected entities and their relationships.
    """
    from backend.models.case import CaseAlert, CaseEvent
    from backend.models.alert import Alert
    from backend.models.security_event import SecurityEvent
    from backend.models.asset import Asset

    # Get case
    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == user_id)
    )).scalar_one_or_none()

    if not case:
        return {"error": "Case not found"}

    # Get linked alerts and their assets
    alert_rows = await db.execute(
        select(Alert, Asset)
        .join(CaseAlert, CaseAlert.alert_id == Alert.id)
        .outerjoin(Asset, Alert.asset_id == Asset.id)
        .where(CaseAlert.case_id == case_id)
    )
    alert_assets = alert_rows.all()

    # Get linked events
    event_rows = await db.execute(
        select(SecurityEvent)
        .join(CaseEvent, CaseEvent.event_id == SecurityEvent.id)
        .where(CaseEvent.case_id == case_id)
    )
    events = event_rows.scalars().all()

    # Build graph
    nodes = []
    edges = []
    seen_nodes = set()

    # Case node
    nodes.append({"id": f"case-{case.id}", "type": "case", "label": case.title, "severity": case.severity})
    seen_nodes.add(f"case-{case.id}")

    # Asset nodes
    for alert, asset in alert_assets:
        if asset and f"asset-{asset.id}" not in seen_nodes:
            nodes.append({
                "id": f"asset-{asset.id}",
                "type": "asset",
                "label": asset.name,
                "asset_type": asset.asset_type,
                "zone": asset.network_zone,
                "is_ot": asset.is_ot_asset,
                "criticality": asset.criticality,
            })
            seen_nodes.add(f"asset-{asset.id}")
            edges.append({"from": f"case-{case.id}", "to": f"asset-{asset.id}", "label": "affects"})

    # IP nodes from events
    ip_set = set()
    for event in events:
        for ip_field, direction in [(event.source_ip, "source"), (event.dest_ip, "destination")]:
            if ip_field and f"ip-{ip_field}" not in seen_nodes:
                nodes.append({"id": f"ip-{ip_field}", "type": "ip", "label": ip_field, "direction": direction})
                seen_nodes.add(f"ip-{ip_field}")
                edges.append({"from": f"case-{case.id}", "to": f"ip-{ip_field}", "label": direction})
                ip_set.add(ip_field)

    # MITRE technique nodes
    for tech in (case.mitre_techniques or []):
        tech_id = f"mitre-{tech}"
        if tech_id not in seen_nodes:
            nodes.append({"id": tech_id, "type": "mitre", "label": tech})
            seen_nodes.add(tech_id)
            edges.append({"from": f"case-{case.id}", "to": tech_id, "label": "uses_technique"})

    return {
        "case_id": case.id,
        "nodes": nodes,
        "edges": edges,
        "summary": {
            "total_nodes": len(nodes),
            "assets_affected": sum(1 for n in nodes if n["type"] == "asset"),
            "ips_involved": sum(1 for n in nodes if n["type"] == "ip"),
            "techniques_used": sum(1 for n in nodes if n["type"] == "mitre"),
        },
    }
