#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")" || exit 1
XTTS_DIR="${XTTS_DIR:-$HOME/Documents/human reader/lecteur-studio-xtts/xtts}"
WITH_XTTS=0; [ "$1" = "xtts" ] && WITH_XTTS=1
mkdir -p logs; PIDS=""
arreter(){ echo; echo "Arrêt des services..."; for p in $PIDS; do kill "$p" 2>/dev/null; done; exit 0; }
trap arreter INT TERM
liberer_port(){ old=$(lsof -ti :"$1" 2>/dev/null); [ -n "$old" ] && kill $old 2>/dev/null && sleep 1; }
attendre(){ for _ in $(seq 1 "$2"); do curl -s "http://127.0.0.1:$1/health" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }
[ -x kokoro/venv/bin/python ] || { echo "kokoro/venv introuvable"; exit 1; }
command -v node >/dev/null || { echo "node introuvable"; exit 1; }
liberer_port 8787; liberer_port 8788
echo "Démarrage de Kokoro..."
( cd kokoro && ./venv/bin/python kokoro_server.py ) > logs/kokoro.log 2>&1 &
PIDS="$PIDS $!"
if [ $WITH_XTTS = 1 ]; then
  liberer_port 8789
  echo "Démarrage de XTTS (lent à charger)..."
  ( cd "$XTTS_DIR" && XTTS_PORT=8789 ./venv/bin/python xtts_server.py ) > logs/xtts.log 2>&1 &
  PIDS="$PIDS $!"
fi
attendre 8788 180 || { echo "Kokoro ne répond pas, voir logs/kokoro.log"; arreter; }
node server.mjs > logs/app.log 2>&1 &
PIDS="$PIDS $!"
sleep 2
open http://127.0.0.1:8787
echo "Prêt : http://127.0.0.1:8787  (Ctrl+C pour tout arrêter)"
wait
