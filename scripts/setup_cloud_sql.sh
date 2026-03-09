#!/bin/bash
# Setup Cloud SQL PostgreSQL for CyberSec Alert SaaS
# Run this in Google Cloud Shell: https://console.cloud.google.com/welcome

set -e

PROJECT_ID="${1:-}"
DB_INSTANCE="cybersec-db"
DB_NAME="cybersec_alerts"
DB_USER="cybersec_user"
DB_REGION="us-central1"
CLOUD_RUN_SERVICE="cybersec-saas"

if [ -z "$PROJECT_ID" ]; then
    echo "Usage: ./setup_cloud_sql.sh <PROJECT_ID>"
    echo ""
    echo "Get your PROJECT_ID from: gcloud config get-value project"
    exit 1
fi

echo "=========================================="
echo "CyberSec Alert SaaS - Cloud SQL Setup"
echo "=========================================="
echo "Project ID: $PROJECT_ID"
echo "Region: $DB_REGION"
echo ""

# Set project
gcloud config set project "$PROJECT_ID"

# 1. Create Cloud SQL instance
echo "1. Creating Cloud SQL PostgreSQL instance..."
gcloud sql instances create "$DB_INSTANCE" \
    --database-version=POSTGRES_15 \
    --tier=db-f1-micro \
    --region="$DB_REGION" \
    --availability-type=regional \
    --backup-start-time=03:00 \
    || echo "   (Instance may already exist)"

echo "   ✓ Cloud SQL instance created/verified"

# 2. Create database
echo ""
echo "2. Creating database..."
gcloud sql databases create "$DB_NAME" \
    --instance="$DB_INSTANCE" \
    || echo "   (Database may already exist)"

echo "   ✓ Database created/verified"

# 3. Create database user
echo ""
echo "3. Creating database user..."
DB_PASSWORD=$(openssl rand -base64 32)
gcloud sql users create "$DB_USER" \
    --instance="$DB_INSTANCE" \
    --password="$DB_PASSWORD" \
    || {
        echo "   User may already exist. Getting password reset link..."
        gcloud sql users set-password "$DB_USER" \
            --instance="$DB_INSTANCE" \
            --password="$DB_PASSWORD"
    }

echo "   ✓ User created/updated"
echo "   Password: $DB_PASSWORD (save this!)"

# 4. Get Cloud SQL connection name
echo ""
echo "4. Getting Cloud SQL connection details..."
CONNECTION_NAME=$(gcloud sql instances describe "$DB_INSTANCE" \
    --format='value(connectionName)')

echo "   ✓ Connection name: $CONNECTION_NAME"

# 5. Update Cloud Run service
echo ""
echo "5. Updating Cloud Run service environment..."

# Build the DATABASE_URL
DATABASE_URL="postgresql+psycopg2://${DB_USER}:${DB_PASSWORD}@/${DB_NAME}?host=/cloudsql/${CONNECTION_NAME}"

# Update Cloud Run environment variables
gcloud run services update "$CLOUD_RUN_SERVICE" \
    --region="$DB_REGION" \
    --set-env-vars="DATABASE_URL=${DATABASE_URL},SECRET_KEY=$(openssl rand -base64 32)" \
    --set-cloudsql-instances="$CONNECTION_NAME"

echo "   ✓ Cloud Run updated with Cloud SQL connection"

# 6. Summary
echo ""
echo "=========================================="
echo "✅  Setup Complete!"
echo "=========================================="
echo ""
echo "Your service is now connected to PostgreSQL!"
echo ""
echo "Next steps:"
echo "1. Visit: https://cybersec-saas-zjfau6dqcq-uc.a.run.app/"
echo "2. Login with:"
echo "   Email: admin@example.com"
echo "   Password: password123"
echo ""
echo "Database credentials (save securely):"
echo "  - Host: /cloudsql/$CONNECTION_NAME"
echo "  - Database: $DB_NAME"
echo "  - User: $DB_USER"
echo "  - Password: $DB_PASSWORD"
echo ""
echo "Connection string:"
echo "  $DATABASE_URL"
echo ""
