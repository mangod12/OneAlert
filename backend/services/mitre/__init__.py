"""MITRE ATT&CK integration for OneAlert."""
from backend.services.mitre.attack_data import TACTICS, TECHNIQUES, get_tactic, get_technique, search_techniques

__all__ = ["TACTICS", "TECHNIQUES", "get_tactic", "get_technique", "search_techniques"]
