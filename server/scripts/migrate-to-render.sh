#!/usr/bin/env bash
# Copies data from the local Postgres database into the Render-hosted one.
#
# Local connection settings come from server/.env (DB_NAME, DB_USER, DB_PASSWORD,
# DB_HOST, DB_PORT). Render connection settings come from server/.env.render
# (RENDER_DB_HOST, RENDER_DB_PORT, RENDER_DB_NAME, RENDER_DB_USER, RENDER_DB_PASSWORD)
# — copy the values from your Render service's Environment tab into that file.
#
# This assumes the target tables already exist on Render (the server creates them
# on boot via sequelize.sync({ alter: true })). Data is dumped with --data-only
# and --inserts so it doesn't try to recreate the schema. pg_dump orders table
# data by foreign-key dependency automatically, so no --disable-triggers is
# needed (and Render's non-superuser DB role can't use that flag anyway).
#
# Usage: bash server/scripts/migrate-to-render.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

set -a
source "$SERVER_DIR/.env"
source "$SERVER_DIR/.env.render"
set +a

DUMP_FILE="$(mktemp -t japs-render-migration-XXXXXX.sql)"
trap 'rm -f "$DUMP_FILE"' EXIT

echo "Dumping data from local database ($DB_NAME @ $DB_HOST:$DB_PORT)..."
PGPASSWORD="$DB_PASSWORD" pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --data-only \
  --inserts \
  --no-owner \
  --no-privileges \
  > "$DUMP_FILE"

echo "Importing into Render database ($RENDER_DB_NAME @ $RENDER_DB_HOST:$RENDER_DB_PORT)..."
PGPASSWORD="$RENDER_DB_PASSWORD" psql \
  "sslmode=require host=$RENDER_DB_HOST port=$RENDER_DB_PORT dbname=$RENDER_DB_NAME user=$RENDER_DB_USER" \
  -v ON_ERROR_STOP=1 \
  -f "$DUMP_FILE"

echo "Done. Data migrated from local to Render."
