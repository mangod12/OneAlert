#!/usr/bin/env python3
"""
Deployment script for CyberSec Alert SaaS.
Supports multiple deployment options: Docker, Heroku, and local production.
"""

import os
import sys
import subprocess
import argparse
import shlex
from pathlib import Path

def run_command(command, check=True, sensitive=False):
    """Run a shell command and return the result."""
    command_args = shlex.split(command) if isinstance(command, str) else command
    command_name = command_args[0] if command_args else "command"
    print("Running: [redacted sensitive command]" if sensitive else f"Running: {command_name}")
    try:
        result = subprocess.run(command_args, check=check, capture_output=True, text=True)
        if result.stdout and not sensitive:
            print(result.stdout)
        return result
    except subprocess.CalledProcessError as e:
        print(f"Command failed: {e}")
        if e.stderr and not sensitive:
            print(f"Error: {e.stderr}")
        if check:
            sys.exit(1)
        return e

def check_docker():
    """Check if Docker is available."""
    try:
        result = subprocess.run(["docker", "--version"], capture_output=True, text=True)
        return result.returncode == 0
    except FileNotFoundError:
        return False

def check_docker_compose():
    """Check if Docker Compose is available."""
    try:
        result = subprocess.run(["docker-compose", "--version"], capture_output=True, text=True)
        return result.returncode == 0
    except FileNotFoundError:
        return False

def deploy_docker():
    """Deploy using Docker Compose."""
    print("Deploying with Docker Compose...")
    
    if not check_docker():
        print("Docker is not installed or not available")
        sys.exit(1)
    
    if not check_docker_compose():
        print("Docker Compose is not installed or not available")
        sys.exit(1)
    
    # Build and start services
    run_command(["docker-compose", "build"])
    run_command(["docker-compose", "up", "-d"])
    
    print("Docker deployment completed!")
    print("Application is running at:")
    print("   • Main app: http://localhost:8001")
    print("   • Nginx: http://localhost:80")
    print("   • API docs: http://localhost:8001/docs")
    print("   • Health check: http://localhost:8001/health")

def deploy_heroku():
    """Deploy to Heroku."""
    print("Deploying to Heroku...")
    
    # Check if Heroku CLI is installed
    try:
        result = subprocess.run(["heroku", "--version"], capture_output=True, text=True)
        if result.returncode != 0:
            print("Heroku CLI is not installed")
            print("Please install Heroku CLI: https://devcenter.heroku.com/articles/heroku-cli")
            sys.exit(1)
    except FileNotFoundError:
        print("Heroku CLI is not installed")
        print("Please install Heroku CLI: https://devcenter.heroku.com/articles/heroku-cli")
        sys.exit(1)
    
    # Check if git repository is initialized
    if not Path(".git").exists():
        print("Git repository not found")
        print("Please initialize git: git init")
        sys.exit(1)
    
    # Create Heroku app if it doesn't exist
    try:
        run_command(["heroku", "apps:info"], check=False)
    except:
        app_name = input("Enter Heroku app name (or press Enter for auto-generated): ").strip()
        if app_name:
            run_command(["heroku", "create", app_name])
        else:
            run_command(["heroku", "create"])
    
    # Set environment variables
    secret_key = os.urandom(32).hex()
    run_command(["heroku", "config:set", f"SECRET_KEY={secret_key}"], sensitive=True)
    run_command(["heroku", "config:set", "DATABASE_URL=sqlite:///cybersec_alerts.db"], sensitive=True)
    
    # Deploy
    run_command(["git", "add", "."])
    run_command(["git", "commit", "-m", "Deploy to Heroku"])
    run_command(["git", "push", "heroku", "main"])
    
    # Open the app
    run_command(["heroku", "open"])
    
    print("Heroku deployment completed!")

def deploy_local_production():
    """Deploy locally in production mode."""
    print("Deploying locally in production mode...")
    
    # Set production environment variables
    os.environ["SECRET_KEY"] = os.urandom(32).hex()
    os.environ["DATABASE_URL"] = "sqlite:///cybersec_alerts.db"
    
    # Install dependencies
    run_command(["pip", "install", "-r", "requirements.txt"])
    
    # Initialize database
    run_command(["python", "scripts/setup_database.py"])
    
    # Start production server
    print("Starting production server...")
    run_command(["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"])
    
    print("Local production deployment completed!")
    print("Application is running at:")
    print("   • Main app: http://localhost:8000")
    print("   • API docs: http://localhost:8000/docs")
    print("   • Health check: http://localhost:8000/health")

def main():
    parser = argparse.ArgumentParser(description="Deploy CyberSec Alert SaaS")
    parser.add_argument(
        "method",
        choices=["docker", "heroku", "local"],
        help="Deployment method"
    )
    parser.add_argument(
        "--env-file",
        help="Path to environment file"
    )
    
    args = parser.parse_args()
    
    print("CyberSec Alert SaaS - Deployment")
    print("=" * 40)
    
    # Load environment file if provided
    if args.env_file and os.path.exists(args.env_file):
        print(f"Loading environment from {args.env_file}")
        with open(args.env_file, 'r') as f:
            for line in f:
                if line.strip() and not line.startswith('#'):
                    key, value = line.strip().split('=', 1)
                    os.environ[key] = value
    
    if args.method == "docker":
        deploy_docker()
    elif args.method == "heroku":
        deploy_heroku()
    elif args.method == "local":
        deploy_local_production()
    else:
        print("Invalid deployment method")
        sys.exit(1)

if __name__ == "__main__":
    main()
