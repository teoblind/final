#!/usr/bin/env bash
#
# Backup Script: Per-Tenant SQLite DBs + system.db
#
# Creates timestamped backups using sqlite3 .backup command (safe for WAL mode).
# Keeps last 48 backups per database.
#
# Usage:
#   ./scripts/backup-tenant-dbs.sh [backup_dir]
#
# Default backup_dir: data/backups/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/../data"
BACKUP_DIR="${1:-$DATA_DIR/backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
MAX_BACKUPS=48

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

echo "[Backup] Starting backup at $TIMESTAMP"
echo "[Backup] Data dir: $DATA_DIR"
echo "[Backup] Backup dir: $BACKUP_DIR"

backup_count=0
error_count=0

# Backup a single DB file
backup_db() {
  local db_path="$1"
  local label="$2"

  if [ ! -f "$db_path" ]; then
    echo "[Backup] SKIP: $label — file not found"
    return
  fi

  local backup_subdir="$BACKUP_DIR/$label"
  mkdir -p "$backup_subdir"

  local backup_file="$backup_subdir/${label}_${TIMESTAMP}.db"

  # Use sqlite3 .backup command for WAL-safe backup
  if command -v sqlite3 &>/dev/null; then
    if sqlite3 "$db_path" ".backup '$backup_file'" 2>/dev/null; then
      echo "[Backup] OK: $label → $backup_file ($(du -h "$backup_file" | cut -f1))"
      backup_count=$((backup_count + 1))
    else
      # Fallback to cp if .backup fails
      cp "$db_path" "$backup_file"
      echo "[Backup] OK (cp): $label → $backup_file"
      backup_count=$((backup_count + 1))
    fi
  else
    # No sqlite3 binary — use cp
    cp "$db_path" "$backup_file"
    echo "[Backup] OK (cp): $label → $backup_file"
    backup_count=$((backup_count + 1))
  fi

  # Prune old backups (keep last MAX_BACKUPS)
  local count
  count=$(ls -1 "$backup_subdir"/*.db 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" -gt "$MAX_BACKUPS" ]; then
    local to_delete=$((count - MAX_BACKUPS))
    ls -1t "$backup_subdir"/*.db | tail -n "$to_delete" | while read -r old_file; do
      rm -f "$old_file"
      echo "[Backup] Pruned: $(basename "$old_file")"
    done
  fi
}

# 1. Backup system.db
backup_db "$DATA_DIR/system.db" "system"

# 2. Backup each tenant DB
for tenant_dir in "$DATA_DIR"/*/; do
  [ -d "$tenant_dir" ] || continue

  # Skip the backups directory itself
  dir_name="$(basename "$tenant_dir")"
  [ "$dir_name" = "backups" ] && continue
  [ "$dir_name" = "dacp" ] && continue  # Skip non-DB data dirs

  db_file="$tenant_dir/${dir_name}.db"
  if [ -f "$db_file" ]; then
    backup_db "$db_file" "$dir_name"
  fi
done

# 3. Backup old cache.db if it still exists
if [ -f "$DATA_DIR/cache.db" ]; then
  backup_db "$DATA_DIR/cache.db" "cache-legacy"
fi

echo ""
echo "[Backup] Complete: $backup_count databases backed up, $error_count errors"
echo "[Backup] Retention: last $MAX_BACKUPS backups per database"
