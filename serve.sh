#!/usr/bin/env bash
# Startet einen lokalen Webserver für Running Out – im Netzwerk erreichbar für Handy/iPad.

PORT="${1:-8080}"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Lokale IP ermitteln (macOS)
if [[ "$(uname)" == "Darwin" ]]; then
  IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")
else
  IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
fi

echo ""
echo "  Running Out – Retro Racer"
echo "  ========================="
echo ""
echo "  Lokal:      http://localhost:$PORT/run.html"
echo "  Im Netz:    http://$IP:$PORT/run.html"
echo ""
echo "  Handy/iPad: Im selben WLAN öffnen: http://$IP:$PORT/run.html"
echo ""
echo "  Beenden:    Ctrl+C"
echo ""

# Python 3 (macOS Standard)
if command -v python3 &>/dev/null; then
  exec python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$DIR"
fi

# Python 2 Fallback
if command -v python &>/dev/null; then
  exec python -m SimpleHTTPServer "$PORT"
fi

echo "Python nicht gefunden. Bitte Python 3 installieren." >&2
exit 1
