"""Exercise the deployment conflict wrapper without any Azure access or secrets."""
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts' / 'ci' / 'retry-containerapp-operation.sh'


def run_command(tmp_path, failures, message, status=17):
    counter = tmp_path / 'calls'
    counter.write_text('0')
    command = tmp_path / 'fake-az'
    command.write_text('''#!/usr/bin/env bash
set -euo pipefail
count=$(cat "$CALLS")
count=$((count + 1))
printf '%s' "$count" > "$CALLS"
printf '%s\\n' "$@" > "$ARGS"
if (( count <= FAILURES )); then
  printf '%s\\n' "$FAILURE_MESSAGE" >&2
  exit "$FAILURE_STATUS"
fi
printf '%s\\n' 'deployment command completed'
''')
    command.chmod(0o700)
    sleep = tmp_path / 'sleep'
    sleep.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "$@" >> "$SLEEPS"\n')
    sleep.chmod(0o700)
    env = {**os.environ, 'PATH': f'{tmp_path}:{os.environ["PATH"]}', 'CALLS': str(counter),
           'ARGS': str(tmp_path / 'args'), 'SLEEPS': str(tmp_path / 'sleeps'),
           'FAILURES': str(failures), 'FAILURE_MESSAGE': message, 'FAILURE_STATUS': str(status)}
    result = subprocess.run(['bash', str(SCRIPT), str(command), 'containerapp', 'update',
                             '--image', 'registry.example/app:exact-sha', '--name', 'an app'],
                            capture_output=True, text=True, env=env, timeout=5, check=False)
    return result, int(counter.read_text())


def test_success_does_not_retry_and_preserves_arguments(tmp_path):
    result, calls = run_command(tmp_path, 0, '')
    assert result.returncode == 0
    assert calls == 1
    assert 'deployment command completed' in result.stdout
    assert not (tmp_path / 'sleeps').exists()
    assert (tmp_path / 'args').read_text().splitlines() == [
        'containerapp', 'update', '--image', 'registry.example/app:exact-sha', '--name', 'an app']


def test_retries_only_provisioning_conflict_then_succeeds(tmp_path):
    result, calls = run_command(tmp_path, 2, 'ERROR: (ContainerAppOperationInProgress) active operation')
    assert result.returncode == 0
    assert calls == 3
    assert (tmp_path / 'sleeps').read_text().splitlines() == ['10', '10']
    assert 'deployment command completed' in result.stdout


def test_terminal_error_is_not_retried_or_reported_as_success(tmp_path):
    result, calls = run_command(tmp_path, 10, 'ERROR: (AuthorizationFailed) denied', 23)
    assert result.returncode == 23
    assert calls == 1
    assert 'AuthorizationFailed' in result.stderr
    assert not (tmp_path / 'sleeps').exists()


def test_conflict_exhaustion_remains_failure(tmp_path):
    result, calls = run_command(tmp_path, 99, 'ERROR: (ContainerAppOperationInProgress) active operation')
    assert result.returncode == 17
    assert calls == 7
    assert (tmp_path / 'sleeps').read_text().splitlines() == ['10'] * 6
    assert 'deployment command completed' not in result.stdout


def test_missing_command_is_an_error():
    result = subprocess.run(['bash', str(SCRIPT)], capture_output=True, text=True, check=False)
    assert result.returncode == 2


def test_workflow_serializes_runs_and_wraps_only_app_mutation():
    workflow = (ROOT / '.github' / 'workflows' / 'deploy-azure.yml').read_text()
    assert 'concurrency:\n  group: onealert-demo-azure-deployment\n  cancel-in-progress: false' in workflow
    assert 'environment: azure-production\n    steps:\n      - uses: actions/checkout@v4' in workflow
    assert workflow.count('bash scripts/ci/retry-containerapp-operation.sh az containerapp ') == 2
    assert 'bash scripts/ci/retry-containerapp-operation.sh az containerapp update' in workflow
    assert 'bash scripts/ci/retry-containerapp-operation.sh az containerapp create' in workflow
