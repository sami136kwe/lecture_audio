# Lecteur Studio

Application web personnelle et locale qui lit des PDF à voix haute avec des voix naturelles en français et en anglais. Elle est pensée pour l'étude : lecture fiable de documents complexes, notes et écoute en continu.

## Fonctionnalités

- Lecture de PDF (et Word) avec voix naturelles, en français et en anglais
- Analyse de la mise en page des PDF LaTeX : colonnes, en-têtes et pieds de page ignorés, accents et ligatures corrigés, ordre de lecture reconstitué
- Clic sur un paragraphe pour lire à partir de là, ou sélection d'une zone à lire
- Modes de langue : français seulement, anglais seulement ou automatique
- Choix de la voix (homme ou femme) pour chaque langue
- Notes pendant la lecture
- Repli automatique sur la voix du navigateur si un service vocal est indisponible

## Moteurs vocaux

| Moteur | Rôle | Fonctionnement |
|---|---|---|
| Kokoro-82M | Voix principales (1 française, 28 anglaises) | Local |
| Edge TTS | Voix françaises naturelles, dont québécoises | Internet requis |
| XTTS-v2 | Voix françaises et anglaises supplémentaires (optionnel) | Local, lent sur CPU |

## Architecture

- `public/lecteur.html` : interface (PDF.js, analyse de mise en page, segmentation en phrases, lecture audio avec préchargement)
- `server.mjs` : serveur Node (port 8787) qui sert l'interface et dirige les requêtes vocales vers le bon moteur
- `kokoro/kokoro_server.py` : service FastAPI (port 8788) pour Kokoro et Edge TTS
- XTTS : service FastAPI séparé (port 8789, optionnel)

## Installation

Prérequis : Node.js, Python 3.12, ffmpeg.

```bash
python3.12 -m venv kokoro/venv
kokoro/venv/bin/pip install -r kokoro/requirements.txt
kokoro/venv/bin/pip install edge-tts
```

## Lancement

```bash
./lancer.command
```

Puis ouvrir http://127.0.0.1:8787

## Notes

- Projet personnel, usage non commercial
- Les modèles Kokoro sont téléchargés automatiquement au premier lancement
- XTTS-v2 est sous licence non commerciale (CPML)
- Edge TTS utilise un service de Microsoft de façon non officielle
