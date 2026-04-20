"""Global test configuration. Sets environment variables before app import."""
import os

os.environ["TESTING"] = "1"
os.environ["DISABLE_SCHEDULER"] = "1"


def pytest_configure(config):
    """Remove stale test DBs before test run to avoid cross-file conflicts."""
    import pathlib
    for db_file in pathlib.Path(".").glob("test*.db"):
        try:
            db_file.unlink(missing_ok=True)
        except PermissionError:
            pass
