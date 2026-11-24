#!/usr/bin/env bash
set -euo pipefail

readonly backup_root="/var/backups/riftbound-online"
readonly source_root="/var/lib/riftbound-online"
readonly timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
readonly temporary="${backup_root}/.${timestamp}.tar.gz.tmp"
readonly destination="${backup_root}/riftbound-online-${timestamp}.tar.gz"

install -d -m 0700 -o root -g root "${backup_root}"
tar --create --gzip --file "${temporary}" --directory "$(dirname "${source_root}")" "$(basename "${source_root}")"
chmod 0600 "${temporary}"
mv "${temporary}" "${destination}"

# Keep one month of daily backups. The target is deliberately restricted to
# timestamped archives created by this script.
find "${backup_root}" -maxdepth 1 -type f -name 'riftbound-online-*.tar.gz' -mtime +30 -delete

