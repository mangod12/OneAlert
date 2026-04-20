"""Rule-based remediation engine for OT/ICS vulnerability alerts."""

from typing import List


def generate_remediations(alert, asset) -> List[dict]:
    """Generate remediation actions based on alert + asset context.

    Rules:
    1. If patch available (has remediation field or vendor advisory) -> suggest patch
    2. If OT asset in control/field zone -> suggest compensating control
       (network segmentation) INSTEAD of direct patch
    3. If CISA KEV source -> flag urgent, suggest immediate isolation if no patch
    4. If unencrypted protocol (Modbus/DNP3/BACnet) -> suggest encrypted
       alternative or VPN overlay
    5. Always: suggest accept_risk as lowest priority fallback
    """
    remediations = []
    priority = 1

    is_ot = getattr(asset, 'is_ot_asset', False) if asset else False
    zone = (getattr(asset, 'network_zone', None) or '') if asset else ''
    protocol = (getattr(asset, 'primary_protocol', None) or '') if asset else ''
    source = (getattr(alert, 'source_url', None) or '')
    has_patch = bool(getattr(alert, 'remediation', None))
    severity = getattr(alert, 'severity', 'medium') or 'medium'

    is_critical_zone = zone in ('control', 'field', 'safety_system')
    is_kev = 'kev' in source.lower() or 'cisa' in source.lower()
    unencrypted_protocols = ('modbus', 'dnp3', 'bacnet', 'profinet', 'ethercat')
    is_unencrypted = protocol.lower() in unencrypted_protocols if protocol else False

    # Rule 1+2: Patch vs compensating control
    if has_patch and not is_critical_zone:
        remediations.append({
            'action_type': 'patch',
            'description': f'Apply vendor patch. {alert.remediation}',
            'estimated_downtime_minutes': 30,
            'requires_maintenance_window': False,
            'priority': priority,
            'ai_confidence': 0.95,
        })
        priority += 1
    elif has_patch and is_critical_zone:
        remediations.append({
            'action_type': 'compensating_control',
            'description': (
                f'Asset is in {zone} zone — direct patching risks process disruption. '
                'Apply network segmentation to isolate the asset, then schedule patch '
                'during maintenance window.'
            ),
            'estimated_downtime_minutes': 0,
            'requires_maintenance_window': False,
            'priority': priority,
            'ai_confidence': 0.90,
        })
        priority += 1
        remediations.append({
            'action_type': 'patch',
            'description': f'Schedule patch during next maintenance window: {alert.remediation}',
            'estimated_downtime_minutes': 60,
            'requires_maintenance_window': True,
            'priority': priority,
            'ai_confidence': 0.85,
        })
        priority += 1

    # Rule 3: CISA KEV urgency
    if is_kev and severity in ('critical', 'high'):
        remediations.insert(0, {
            'action_type': 'network_segmentation',
            'description': (
                'CISA KEV alert — this vulnerability is actively exploited. '
                'Immediately isolate this asset from network access until patched.'
            ),
            'estimated_downtime_minutes': 15,
            'requires_maintenance_window': False,
            'priority': 1,
            'ai_confidence': 0.98,
        })
        # Reorder priorities
        for i, r in enumerate(remediations):
            r['priority'] = i + 1
        priority = len(remediations) + 1

    # Rule 4: Unencrypted protocol
    if is_unencrypted:
        remediations.append({
            'action_type': 'network_segmentation',
            'description': (
                f'Protocol "{protocol}" is unencrypted. Deploy a VPN overlay or '
                'encrypted tunnel between this device and its controller to prevent '
                'exploitation via network interception.'
            ),
            'estimated_downtime_minutes': 120,
            'requires_maintenance_window': True,
            'priority': priority,
            'ai_confidence': 0.80,
        })
        priority += 1

    # Rule 5: Accept risk fallback
    remediations.append({
        'action_type': 'accept_risk',
        'description': (
            'If remediation is not feasible, document risk acceptance with '
            'justification and compensating monitoring controls.'
        ),
        'estimated_downtime_minutes': 0,
        'requires_maintenance_window': False,
        'priority': priority,
        'ai_confidence': 0.50,
    })

    return remediations
