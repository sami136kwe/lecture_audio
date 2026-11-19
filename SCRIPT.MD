# Lecteur Studio : guide complet (depuis la racine du projet)

**[Ouvrir l'application : http://127.0.0.1:8787](http://127.0.0.1:8787)**

Ports : Kokoro 8788, app 8787, XTTS 8789 (optionnel).
Voix françaises : Edge TTS (Internet requis), Kokoro (local), XTTS (local, optionnel).

## Installation (une seule fois, à copier d'un bloc)

```bash
brew install python@3.12 ffmpeg
rm -rf kokoro/venv
python3.12 -m venv kokoro/venv
kokoro/venv/bin/pip install -r kokoro/requirements.txt
kokoro/venv/bin/pip install edge-tts
kokoro/venv/bin/python -c "import numpy, kokoro_onnx, fastapi, edge_tts; print('ok')"
chmod +x lancer.command lancer-avec-xtts.command
```

Doit afficher `ok` à la fin.

## Terminal 1 : Kokoro (inclut les voix Edge)

```bash
kill $(lsof -ti :8788) 2>/dev/null
(cd kokoro && ./venv/bin/python kokoro_server.py)
```

Attendre : Uvicorn running on http://127.0.0.1:8788

## Terminal 2 : l'app

```bash
kill $(lsof -ti :8787) 2>/dev/null
node server.mjs
```

[Ouvrir l'application](http://127.0.0.1:8787), puis Shift + clic sur recharger dans Safari.

## Terminal 3 : XTTS (optionnel)

```bash
kill $(lsof -ti :8789) 2>/dev/null
(cd "../human reader/lecteur-studio-xtts/xtts" && XTTS_PORT=8789 ./venv/bin/python xtts_server.py)
```

## Lancement en un clic (remplace les 3 terminaux)

```bash
./lancer.command
```

Avec XTTS :

```bash
./lancer-avec-xtts.command
```

## Voix

- Edge (Internet requis) : Rémy, Vivienne, Henri, Denise, Antoine, Sylvie, Jean (les trois derniers sont québécois)
- Kokoro (local) : 1 voix française (ff_siwis) + 28 voix anglaises, lisibles aussi en français avec un accent
- XTTS (local, optionnel) : Damien Black, Andrew Chipper, Craig Gutsy, Viktor Eka, Claribel Dervla, Ana Florence, Gracie Wise, Daisy Studious

Si Internet coupe, la lecture bascule sur la voix du navigateur.

## Dépannage

Vérifier les services :

```bash
curl http://127.0.0.1:8788/health
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:8789/health
```

Voir les logs (avec lancer.command) :

```bash
cat logs/kokoro.log
cat logs/app.log
cat logs/xtts.log
```

Débloquer les scripts bloqués par macOS :

```bash
xattr -d com.apple.quarantine lancer.command lancer-avec-xtts.command
```

Module manquant (numpy, fastapi, edge_tts...) :

```bash
deactivate
kokoro/venv/bin/pip install -r kokoro/requirements.txt
kokoro/venv/bin/pip install edge-tts
```