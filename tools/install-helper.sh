#!/usr/bin/env bash
# One-time setup for the rubar.charge-limit widget: installs the root-owned
# write helper and a strict passwordless sudo rule scoped to that helper.
# Run interactively (you will be asked for your password once):
#   tools/install-helper.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER_SRC="$HERE/charge-limit-apply"
HELPER_DST="/usr/local/bin/charge-limit-apply"
RULE_FILE="/etc/sudoers.d/charge-limit"

if [[ ! -f "$HELPER_SRC" ]]; then
  echo "missing $HELPER_SRC" >&2
  exit 1
fi

echo "Installing $HELPER_DST (needs sudo)..."
sudo install -o root -g root -m 0755 "$HELPER_SRC" "$HELPER_DST"

echo "Adding passwordless sudo rule for the helper only..."
RULE="$(whoami) ALL=(root) NOPASSWD: $HELPER_DST check, $HELPER_DST saver, $HELPER_DST full"
echo "$RULE" | sudo tee "$RULE_FILE" > /dev/null
sudo chmod 0440 "$RULE_FILE"
sudo visudo -c

echo "Verifying..."
if sudo -n "$HELPER_DST" check; then
  echo "OK: helper works without a password."
else
  echo "FAILED: helper still asks for a password." >&2
  exit 1
fi

echo "Done. Add the widget to your bar: omarchy plugin enable rubar.charge-limit"
