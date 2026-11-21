"""Validate generated investigation evidence before any case or link is staged."""
import math


def validate_triage_output(value):
    if not isinstance(value, dict) or type(value.get('is_incident')) is not bool:
        raise ValueError('Generated triage requires an explicit boolean incident decision')
    if value['is_incident'] is False:
        return value
    for field in ('title', 'summary', 'attack_narrative'):
        item = value.get(field)
        if item is not None and (not isinstance(item, str) or not item.strip()):
            raise ValueError(f'Generated triage {field} must be nonempty text when present')
    if 'title' in value and value['title'] is None:
        raise ValueError('Generated triage title cannot be null')
    if value.get('severity', 'medium') not in ('info', 'low', 'medium', 'high', 'critical'):
        raise ValueError('Generated triage severity is not recognized')
    confidence = value.get('confidence', 0.5)
    if (type(confidence) not in (int, float) or not 0 <= confidence <= 1 or not math.isfinite(confidence)):
        raise ValueError('Generated triage confidence must be a finite number from zero to one')
    for field in ('mitre_tactics', 'recommended_actions'):
        items = value.get(field)
        if items is not None and (not isinstance(items, list) or len(items) > 100
                                  or any(not isinstance(item, str) or not item.strip() for item in items)):
            raise ValueError(f'Generated triage {field} must contain at most 100 nonempty text values')
    techniques = value.get('mitre_techniques')
    if techniques is not None:
        if not isinstance(techniques, list) or len(techniques) > 100:
            raise ValueError('Generated triage techniques must contain at most 100 records')
        for technique in techniques:
            if isinstance(technique, str) and technique.strip():
                continue
            if (not isinstance(technique, dict) or not isinstance(technique.get('id'), str)
                    or not technique['id'].strip()):
                raise ValueError('Generated triage technique requires an explicit text ID')
            if 'name' in technique and not isinstance(technique['name'], str):
                raise ValueError('Generated triage technique name must be text')
            if 'confidence' in technique:
                score = technique['confidence']
                if type(score) not in (int, float) or not 0 <= score <= 1 or not math.isfinite(score):
                    raise ValueError('Generated triage technique confidence must be a finite number from zero to one')
    return value
