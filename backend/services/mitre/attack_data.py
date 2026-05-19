"""MITRE ATT&CK Enterprise matrix — embedded subset for fast lookup.

Covers the most common ICS/OT and Enterprise tactics and techniques.
Full matrix can be loaded from MITRE's STIX data if needed.
"""

from typing import Optional

# Enterprise + ICS Tactics
TACTICS = {
    "TA0001": {"name": "Initial Access", "description": "Techniques to gain initial foothold"},
    "TA0002": {"name": "Execution", "description": "Techniques to run malicious code"},
    "TA0003": {"name": "Persistence", "description": "Techniques to maintain access"},
    "TA0004": {"name": "Privilege Escalation", "description": "Techniques to gain higher permissions"},
    "TA0005": {"name": "Defense Evasion", "description": "Techniques to avoid detection"},
    "TA0006": {"name": "Credential Access", "description": "Techniques to steal credentials"},
    "TA0007": {"name": "Discovery", "description": "Techniques to learn about the environment"},
    "TA0008": {"name": "Lateral Movement", "description": "Techniques to move through the network"},
    "TA0009": {"name": "Collection", "description": "Techniques to gather data of interest"},
    "TA0010": {"name": "Exfiltration", "description": "Techniques to steal data"},
    "TA0011": {"name": "Command and Control", "description": "Techniques to communicate with compromised systems"},
    "TA0040": {"name": "Impact", "description": "Techniques to disrupt availability or integrity"},
    # ICS-specific
    "TA0100": {"name": "Initial Access (ICS)", "description": "Techniques for initial ICS access"},
    "TA0104": {"name": "Lateral Movement (ICS)", "description": "Techniques to move within ICS networks"},
    "TA0106": {"name": "Inhibit Response Function", "description": "Techniques to prevent safety responses"},
    "TA0107": {"name": "Impair Process Control", "description": "Techniques to disrupt physical processes"},
}

# Top techniques relevant to OT/ICS + Enterprise
TECHNIQUES = {
    "T1078": {"name": "Valid Accounts", "tactics": ["TA0001", "TA0003", "TA0004", "TA0005"], "description": "Use of legitimate credentials"},
    "T1190": {"name": "Exploit Public-Facing Application", "tactics": ["TA0001"], "description": "Exploit vulnerabilities in internet-facing apps"},
    "T1133": {"name": "External Remote Services", "tactics": ["TA0001", "TA0003"], "description": "Use of VPN, RDP, or other remote services"},
    "T1059": {"name": "Command and Scripting Interpreter", "tactics": ["TA0002"], "description": "Use of command-line or script interpreters"},
    "T1053": {"name": "Scheduled Task/Job", "tactics": ["TA0002", "TA0003"], "description": "Abuse of task schedulers for execution"},
    "T1021": {"name": "Remote Services", "tactics": ["TA0008"], "description": "Use of remote services for lateral movement"},
    "T1021.001": {"name": "Remote Desktop Protocol", "tactics": ["TA0008"], "description": "Use of RDP for lateral movement"},
    "T1021.002": {"name": "SMB/Windows Admin Shares", "tactics": ["TA0008"], "description": "Use of SMB shares for lateral movement"},
    "T1046": {"name": "Network Service Discovery", "tactics": ["TA0007"], "description": "Scanning for network services"},
    "T1040": {"name": "Network Sniffing", "tactics": ["TA0006", "TA0007"], "description": "Capture of network traffic"},
    "T1110": {"name": "Brute Force", "tactics": ["TA0006"], "description": "Brute force credential attacks"},
    "T1003": {"name": "OS Credential Dumping", "tactics": ["TA0006"], "description": "Dump credentials from the OS"},
    "T1071": {"name": "Application Layer Protocol", "tactics": ["TA0011"], "description": "Use of standard protocols for C2"},
    "T1071.001": {"name": "Web Protocols", "tactics": ["TA0011"], "description": "Use of HTTP/HTTPS for C2"},
    "T1071.004": {"name": "DNS", "tactics": ["TA0011"], "description": "Use of DNS for C2"},
    "T1048": {"name": "Exfiltration Over Alternative Protocol", "tactics": ["TA0010"], "description": "Use of non-standard protocols for data theft"},
    "T1041": {"name": "Exfiltration Over C2 Channel", "tactics": ["TA0010"], "description": "Data exfiltration over existing C2"},
    "T1486": {"name": "Data Encrypted for Impact", "tactics": ["TA0040"], "description": "Ransomware encryption"},
    "T1489": {"name": "Service Stop", "tactics": ["TA0040"], "description": "Stop critical services"},
    "T1562": {"name": "Impair Defenses", "tactics": ["TA0005"], "description": "Disable security tools"},
    "T1098": {"name": "Account Manipulation", "tactics": ["TA0003"], "description": "Modify accounts for persistence"},
    "T1105": {"name": "Ingress Tool Transfer", "tactics": ["TA0011"], "description": "Transfer tools to compromised host"},
    "T1090": {"name": "Proxy", "tactics": ["TA0011"], "description": "Use of proxy for C2"},
    "T1027": {"name": "Obfuscated Files or Information", "tactics": ["TA0005"], "description": "Obfuscation to evade detection"},
    # ICS-specific techniques
    "T0800": {"name": "Activate Firmware Update Mode", "tactics": ["TA0107"], "description": "Force device into firmware update mode"},
    "T0836": {"name": "Modify Parameter", "tactics": ["TA0107"], "description": "Modify PLC/RTU parameters"},
    "T0843": {"name": "Program Download", "tactics": ["TA0107"], "description": "Download new program to PLC"},
    "T0855": {"name": "Unauthorized Command Message", "tactics": ["TA0107"], "description": "Send unauthorized commands to ICS devices"},
    "T0826": {"name": "Loss of Availability", "tactics": ["TA0107"], "description": "Cause loss of ICS availability"},
    "T0831": {"name": "Manipulation of Control", "tactics": ["TA0107"], "description": "Manipulate physical process control"},
    "T0886": {"name": "Remote Services (ICS)", "tactics": ["TA0100", "TA0104"], "description": "Use of remote services in ICS"},
}

# Keyword → technique mapping for rule-based mapping
KEYWORD_MAP = {
    "port scan": ["T1046"],
    "network scan": ["T1046"],
    "scan": ["T1046"],
    "brute force": ["T1110"],
    "credential": ["T1003", "T1110"],
    "password": ["T1110", "T1003"],
    "rdp": ["T1021.001"],
    "smb": ["T1021.002"],
    "lateral": ["T1021"],
    "dns": ["T1071.004"],
    "c2": ["T1071", "T1105"],
    "command and control": ["T1071"],
    "beacon": ["T1071.001"],
    "exfil": ["T1048", "T1041"],
    "ransomware": ["T1486"],
    "encrypt": ["T1486"],
    "vpn": ["T1133"],
    "remote": ["T1133", "T1021"],
    "modbus": ["T0855", "T0836"],
    "plc": ["T0843", "T0836"],
    "scada": ["T0831"],
    "firmware": ["T0800"],
    "opc": ["T0855"],
    "dnp3": ["T0855"],
    "profinet": ["T0855"],
    "valid account": ["T1078"],
    "privilege": ["T1078"],
    "service stop": ["T1489"],
    "proxy": ["T1090"],
    "obfuscate": ["T1027"],
}


def get_tactic(tactic_id: str) -> Optional[dict]:
    """Get tactic info by ID."""
    info = TACTICS.get(tactic_id)
    if info:
        return {"id": tactic_id, **info}
    return None


def get_technique(technique_id: str) -> Optional[dict]:
    """Get technique info by ID."""
    info = TECHNIQUES.get(technique_id)
    if info:
        return {"id": technique_id, **info}
    return None


def search_techniques(query: str) -> list[dict]:
    """Search techniques by keyword."""
    query_lower = query.lower()
    results = []

    # Check keyword map first
    for keyword, technique_ids in KEYWORD_MAP.items():
        if keyword in query_lower:
            for tid in technique_ids:
                tech = get_technique(tid)
                if tech and tech not in results:
                    results.append(tech)

    # Also search technique names/descriptions
    if not results:
        for tid, info in TECHNIQUES.items():
            if query_lower in info["name"].lower() or query_lower in info.get("description", "").lower():
                results.append({"id": tid, **info})

    return results


def map_signature_to_techniques(signature: str) -> list[dict]:
    """Map a Suricata/Zeek signature to MITRE techniques."""
    if not signature:
        return []
    return search_techniques(signature)


def compute_coverage(detected_techniques: set[str]) -> dict:
    """Compute MITRE ATT&CK detection coverage."""
    total = len(TECHNIQUES)
    covered = len(detected_techniques & set(TECHNIQUES.keys()))
    by_tactic = {}

    for tactic_id, tactic_info in TACTICS.items():
        tactic_techniques = [tid for tid, t in TECHNIQUES.items() if tactic_id in t["tactics"]]
        tactic_covered = len(set(tactic_techniques) & detected_techniques)
        by_tactic[tactic_id] = {
            "name": tactic_info["name"],
            "total": len(tactic_techniques),
            "covered": tactic_covered,
            "percentage": round(tactic_covered / len(tactic_techniques) * 100, 1) if tactic_techniques else 0,
        }

    return {
        "total_techniques": total,
        "covered_techniques": covered,
        "coverage_percentage": round(covered / total * 100, 1) if total else 0,
        "by_tactic": by_tactic,
    }
