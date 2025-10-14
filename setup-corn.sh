#!/bin/bash
# setup-cron.sh - Setup automated daily backups

echo "🔧 Setting up automated backups..."

# Get the current directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Create backup directory
mkdir -p "$SCRIPT_DIR/backups"

# Create log directory
mkdir -p "$SCRIPT_DIR/logs"

# Make backup script executable
chmod +x "$SCRIPT_DIR/backup.js"

# Create wrapper script for cron
cat > "$SCRIPT_DIR/backup-cron.sh" << 'EOF'
#!/bin/bash
# Wrapper script for cron job

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/logs/backup_$(date +\%Y\%m\%d).log"

echo "========================================" >> "$LOG_FILE"
echo "Backup started at $(date)" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"

cd "$SCRIPT_DIR"
/usr/bin/node backup.js create >> "$LOG_FILE" 2>&1

echo "========================================" >> "$LOG_FILE"
echo "Backup finished at $(date)" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"
EOF

chmod +x "$SCRIPT_DIR/backup-cron.sh"

# Add cron job (runs daily at 2 AM)
CRON_JOB="0 2 * * * $SCRIPT_DIR/backup-cron.sh"

# Check if cron job already exists
(crontab -l 2>/dev/null | grep -v "$SCRIPT_DIR/backup-cron.sh"; echo "$CRON_JOB") | crontab -

echo "✅ Automated backup setup complete!"
echo ""
echo "📅 Backup schedule: Daily at 2:00 AM"
echo "📁 Backup location: $SCRIPT_DIR/backups"
echo "📝 Logs location: $SCRIPT_DIR/logs"
echo ""
echo "To verify cron job:"
echo "  crontab -l"
echo ""
echo "To manually run backup:"
echo "  node backup.js create"
echo ""
echo "To list backups:"
echo "  node backup.js list"
echo ""
echo "To restore a backup:"
echo "  node backup.js restore backup_YYYYMMDD_HHMM"