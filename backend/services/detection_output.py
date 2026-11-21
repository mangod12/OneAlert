"""Reject malformed generated detection results instead of treating them as an empty review."""


def validate_detection_output(value):
    if not isinstance(value, dict) or not isinstance(value.get('findings'), list):
        raise ValueError('Generated detection requires an explicit findings list')
    findings = value['findings']
    if len(findings) > 100:
        raise ValueError('Generated detection may contain at most 100 findings')
    for finding in findings:
        if not isinstance(finding, dict):
            raise ValueError('Generated detection finding must be an object')
        for field in ('title', 'description'):
            text = finding.get(field)
            if not isinstance(text, str) or not text.strip():
                raise ValueError(f'Generated detection {field} requires nonempty text')
        if finding.get('severity') not in ('info', 'low', 'medium', 'high', 'critical'):
            raise ValueError('Generated detection severity is not recognized')
        for field in ('affected_ips', 'indicators', 'recommended_actions'):
            items = finding.get(field)
            if (not isinstance(items, list) or len(items) > 100
                    or any(not isinstance(item, str) or not item.strip() for item in items)):
                raise ValueError(f'Generated detection {field} requires at most 100 nonempty text values')
    return findings
