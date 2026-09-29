#!/usr/bin/env bash
# Stele CMS starten: legt bei Bedarf .venv an, installiert Abhängigkeiten und startet server/run.py.
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-python3}"
if [ ! -x .venv/bin/python ]; then
  echo "Lege virtuelle Umgebung .venv an …"
  "$PY" -m venv .venv
fi
if ! .venv/bin/python -c "import flask, PIL, waitress" 2>/dev/null; then
  echo "Installiere Abhängigkeiten …"
  .venv/bin/python -m pip install -q -r requirements.txt
fi
exec .venv/bin/python server/run.py "$@"
