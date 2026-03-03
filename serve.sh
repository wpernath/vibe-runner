#!/usr/bin/env bash
# Starts a local web server for Running Out – reachable on the network for phone/iPad.

PORT="${1:-8080}"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Get local IP (macOS)
if [[ "$(uname)" == "Darwin" ]]; then
  IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")
else
  IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
fi

echo ""
echo "  Running Out – Retro Racer"
echo "  ========================="
echo ""
echo "  Local:      http://localhost:$PORT/run.html"
echo "  On network: http://$IP:$PORT/run.html"
echo ""
echo "  Phone/iPad: Open in same Wi‑Fi: http://$IP:$PORT/run.html"
echo ""
echo "  Stop:       Ctrl+C"
echo ""

# Python 3 (macOS default)
if command -v python3 &>/dev/null; then
  exec python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$DIR"
fi

# Python 2 fallback
if command -v python &>/dev/null; then
  exec python -m SimpleHTTPServer "$PORT"
fi

echo "Python not found. Please install Python 3." >&2
exit 1
