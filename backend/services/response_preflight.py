"""Read-only handler and action-shape review, never an authorization decision."""
import math

from backend.services.action_executor import ACTION_HANDLERS


def simulation_preflight(plan):
    actions = plan.actions
    if not isinstance(actions, list):
        return {'action_count': 0, 'supported_count': 0, 'unsupported_count': 0,
                'invalid_count': 0, 'shape_valid': False, 'order_available': False, 'records': []}
    records = []
    for index, action in enumerate(actions):
        valid_object = isinstance(action, dict)
        action_type = action.get('action_type') if valid_object else None
        target = action.get('target') if valid_object else None
        priority = action.get('priority', 99) if valid_object else None
        priority_valid = (
            (isinstance(priority, int) and not isinstance(priority, bool) and abs(priority) <= 9007199254740991)
            or (isinstance(priority, float) and math.isfinite(priority) and abs(priority) <= 9007199254740991)
        )
        valid = (valid_object and isinstance(action_type, str) and bool(action_type.strip())
                 and isinstance(target, str) and bool(target.strip()) and priority_valid)
        supported = isinstance(action_type, str) and action_type in ACTION_HANDLERS
        policy = action.get('policy_check') if valid_object else None
        policy_flag = policy.get('approved') if isinstance(policy, dict) else None
        records.append({'source_position': index + 1,
                        'action_type': action_type if isinstance(action_type, str) else None,
                        'target': target if isinstance(target, str) else None,
                        'priority': priority if priority_valid else None,
                        'priority_defaulted': valid_object and 'priority' not in action,
                        'shape_valid': valid, 'handler_available': supported,
                        'recorded_policy_approved': policy_flag if isinstance(policy_flag, bool) else None,
                        'simulation_order': None})
    order_available = bool(records) and all(record['shape_valid'] for record in records)
    if order_available:
        for order, record in enumerate(sorted(records, key=lambda record: record['priority']), 1):
            record['simulation_order'] = order
    return {'action_count': len(records), 'supported_count': sum(row['handler_available'] for row in records),
            'unsupported_count': sum(not row['handler_available'] for row in records),
            'invalid_count': sum(not row['shape_valid'] for row in records),
            'shape_valid': bool(records) and all(row['shape_valid'] for row in records),
            'order_available': order_available, 'records': records}
