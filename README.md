# liv-ai-scripts

CLI tool that generates a complete set of GCSE-level teaching materials from a topic and syllabus file.

## What it does

Given a topic and a syllabus document, the tool produces:

- A 15-minute presentation script written by Claude, calibrated to the student level
- Text-to-speech audio narration using a teacher's cloned ElevenLabs voice
- A branded PowerPoint presentation with stock images sourced from Unsplash
- An MP4 video combining the slides and audio narration (via ffmpeg + LibreOffice)
- All artifacts bundled into a single zip archive

## Prerequisites

- Node.js 18+
- ffmpeg (required — used for audio/video assembly)
- LibreOffice (optional — converts PPTX to images for higher-fidelity slides; falls back to sharp image compositing if absent)

## Setup

```bash
npm install
cp .env.example .env
# Fill in API keys in .env
```

### Required environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `ELEVENLABS_API_KEY` | Yes | ElevenLabs API key |
| `UNSPLASH_ACCESS_KEY` | No | Unsplash API key — uses placeholder images if absent |

## Usage

```bash
npx tsx src/index.ts \
  --topic "Photosynthesis" \
  --syllabus ./syllabus/aqa-biology-unit3.pdf \
  --level struggling \
  --config ./brand-config.json \
  --output ./output/photosynthesis.zip
```

### CLI options

| Option | Required | Description |
|--------|----------|-------------|
| `-t, --topic` | Yes | Lesson topic |
| `-s, --syllabus` | Yes | Path to syllabus file (`.pdf`, `.md`, `.txt`) |
| `-l, --level` | No | Student level: `high-performing`, `struggling`, `mixed-ability` (default) |
| `-c, --config` | Yes | Path to brand config JSON |
| `-o, --output` | No | Output zip path — defaults to `./output/<topic>-<timestamp>.zip` |

## Brand config format

```json
{
  "logo": "./assets/logo.png",
  "assetsDir": "./assets",
  "colors": {
    "primary": "#1a2e5a",
    "secondary": "#f4a020",
    "background": "#ffffff",
    "text": "#1a1a1a"
  },
  "fonts": {
    "heading": "Montserrat",
    "body": "Open Sans"
  },
  "elevenlabs": {
    "voiceId": "your-voice-id-here",
    "modelId": "eleven_turbo_v2"
  }
}
```

## Output archive contents

```
<topic>-<timestamp>.zip
├── presentation.pptx     # Branded PowerPoint
├── video.mp4             # Presentation video with narration
├── script.json           # Structured script data (per-slide)
├── script.txt            # Human-readable script
└── audio/
    ├── slide-01.mp3
    ├── slide-02.mp3
    └── ...
```

## Pipeline overview

The tool runs seven sequential steps:

1. **Parse syllabus** — Extracts text from the provided `.pdf`, `.md`, or `.txt` file
2. **Generate script** — Sends topic, syllabus content, and student level to Claude; receives a structured per-slide script
3. **Fetch images** — Queries Unsplash for each slide topic; falls back to placeholder images if the key is absent or a query returns no results
4. **Synthesise audio** — Sends each slide's narration text to ElevenLabs and saves per-slide MP3 files
5. **Build presentation** — Assembles the PowerPoint using pptxgenjs with brand colours, fonts, logo, and slide images
6. **Render video** — Converts slides to images (LibreOffice preferred, sharp fallback), then uses ffmpeg to combine each image with its audio track into a single MP4
7. **Bundle archive** — Zips all artifacts into the output file
