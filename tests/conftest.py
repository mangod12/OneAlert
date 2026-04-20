"""Global test configuration. Sets environment variables before app import."""
import os

os.environ["TESTING"] = "1"
os.environ["DISABLE_SCHEDULER"] = "1"
