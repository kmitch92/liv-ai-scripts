# liv-ai-scripts

CLI pipeline that generates branded teaching materials (PPTX, narrated video, audio) from a topic and reference documents using AI.

---

## How It Works

The pipeline runs 8 sequential steps:

1. **Context extraction** — reads PDF, markdown, or text reference files provided via `contextFiles`
2. **Script generation** — Claude generates a structured per-slide presentation script based on topic, context, and system prompt
3. **Phonetics pass** — LLM preprocesses narration text for natural TTS pronunciation; manual overrides take priority
4. **Image fetch** — Unsplash stock photos fetched per slide and cached locally per topic to avoid repeat API calls
5. **TTS generation** — ElevenLabs converts per-slide narration to MP3 audio
6. **PPTX generation** — branded PowerPoint built with pptxgenjs (colours, fonts, logo, images)
7. **Video assembly** — LibreOffice converts PPTX to frames; ffmpeg muxes frames with audio into MP4
8. **Archive** — all artifacts bundled into a zip

---

## Prerequisites

- Node.js 18+
- ffmpeg (required)
- LibreOffice Impress (required for high-fidelity video; falls back to sharp compositing if absent)

System dependencies can be installed via:

```bash
npm run setup
```

---

## Quick Start

```bash
git clone git@github.com:kmitch92/liv-ai-scripts.git
cd liv-ai-scripts
npm install          # also runs postinstall dep check
npm run setup        # installs ffmpeg + libreoffice
cp .env.example .env # fill in API keys
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | One of these two | Claude API (direct) |
| `OPENROUTER_API_KEY` | One of these two | Claude API via OpenRouter |
| `ELEVENLABS_API_KEY` | Yes | Text-to-speech |
| `UNSPLASH_ACCESS_KEY` | No | Stock images (placeholder used if absent) |

If both `OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY` are set, OpenRouter takes priority.

---

## CLI Usage

```bash
npx tsx src/index.ts --topic "Ozymandias by Percy Bysshe Shelley" --config ./config.json
```

| Option | Required | Description |
|---|---|---|
| `-t, --topic` | Yes | Topic for the presentation |
| `-c, --config` | Yes | Path to config JSON |
| `-o, --output` | No | Custom output path (defaults to `output/<topic>/<timestamp>/<topic>.zip`) |

---

## Config Reference

The config JSON is a single object with three top-level sections: `branding`, `elevenlabs`, and `script`.

### branding

| Field | Type | Default | Description |
|---|---|---|---|
| `branding.logo` | `string` | — | Logo image path relative to `assetsDir` |
| `branding.assetsDir` | `string` | — | Base directory for brand assets |
| `branding.templatePptx` | `string` | — | Optional template PPTX for branding overlay |
| `branding.colors.primary` | `string` | — | Primary brand colour (hex) |
| `branding.colors.secondary` | `string` | — | Secondary brand colour (hex) |
| `branding.colors.background` | `string` | `#FFFFFF` | Slide background colour |
| `branding.colors.text` | `string` | `#1A1A1A` | Text colour |
| `branding.fonts.heading` | `string` | `Arial` | Heading font |
| `branding.fonts.body` | `string` | `Calibri` | Body font |

### elevenlabs

| Field | Type | Default | Description |
|---|---|---|---|
| `elevenlabs.voiceId` | `string` | — | ElevenLabs voice ID |
| `elevenlabs.modelId` | `string` | `eleven_multilingual_v2` | TTS model |
| `elevenlabs.stability` | `number` (0–1) | `0.5` | Voice stability |
| `elevenlabs.similarityBoost` | `number` (0–1) | `0.75` | Voice similarity boost |
| `elevenlabs.style` | `number` (0–1) | `0` | Style exaggeration — higher values are more emotive |
| `elevenlabs.speed` | `number` (0.5–2) | `1.0` | Speech speed |
| `elevenlabs.useSpeakerBoost` | `boolean` | `true` | Enhances clarity and presence |

### script

| Field | Type | Default | Description |
|---|---|---|---|
| `script.speakerIdentity` | `string` | — | Persona description for the AI speaker |
| `script.targetAudience` | `string` | — | Who the presentation is for |
| `script.systemPrompt` | `string` | — | Detailed instructions for script generation (tone, structure, content requirements) |
| `script.contextFiles` | `string[]` | `[]` | Paths to reference documents (PDF, txt, md) |
| `script.durationMinutes` | `number` (1–60) | `15` | Target presentation length in minutes |
| `script.phoneticsOverrides` | `Record<string, string>` | `{}` | Manual word-to-phonetic mappings (e.g. `"Ozymandias": "Ozzy-man-dee-us"`). Applied before and after the LLM phonetics pass to guarantee correct TTS pronunciation. |

---

## Output Structure

```
output/
  <topic>/
    images/                   # Cached Unsplash images (shared across runs)
      slide-0.jpg
      slide-1.jpg
    20260330-143025/           # Timestamped run directory
      <topic>.zip
        ├── presentation.pptx
        ├── video.mp4
        ├── script.json
        ├── script.txt
        └── audio/
            ├── slide-0.mp3
            └── ...
```

Images are fetched once per topic and cached in `output/<topic>/images/`. Subsequent runs reuse the cache.

---

## Best Practices

### System prompt engineering

- Be specific about tone, register, and audience level
- Use concrete examples of transitions and phrasing style
- Specify content that MUST be included (e.g. "read the full poem before analysis")
- Reference exam boards or frameworks if applicable
- Literary technique factoid cards can be mandated via the system prompt

### Phonetics overrides

- Test TTS output and add overrides for any mispronounced words
- Keep respellings compact — match the syllable count of the original word
- Overrides are applied before and after the LLM pass, so they always win

### Voice tuning (ElevenLabs)

- Lower stability (0.2–0.4) = more expressive, natural variation
- Higher stability (0.7–1.0) = consistent, formal delivery
- Speed 0.9–1.1 is the sweet spot for teaching content
- Style exaggeration above 0.5 can sound theatrical — use sparingly

### Image caching

- Images are cached in `output/<topic>/images/` after the first run
- Delete the `images/` directory to force a fresh Unsplash fetch
- If Unsplash is rate-limited and no cache exists, placeholder images are used

### Duration

- 5–10 minutes works well for single-poem or single-concept revision
- 15–20 minutes for broader topic coverage
- The LLM targets the duration but actual output may vary by ~20%

---

## LLM Providers

Two providers are supported:

| Provider | Key | Notes |
|---|---|---|
| Anthropic (direct) | `ANTHROPIC_API_KEY` | Uses Claude Sonnet |
| OpenRouter | `OPENROUTER_API_KEY` | Routes to Claude Sonnet via OpenRouter. Takes priority if both keys are set. |

---

## Future Development

- **Dark mode / theme variants** — neumorphic or alternative slide themes
- **Batch processing** — generate materials for multiple topics from a manifest file
- **CMS integration** — pull topics and syllabi from a headless CMS
- **Interactive quizzes** — generate end-of-lesson quiz slides with answer reveals
- **Multi-language support** — generate presentations in other languages via multilingual TTS
- **Custom slide layouts** — user-defined slide templates beyond the current 2-column layout
- **Subtitle/caption track** — SRT generation from narration timestamps for accessibility
- **Progress resumption** — resume interrupted pipeline runs from the last completed step
- **Analytics integration** — track which topics have been generated and review engagement data
- **Alternative image sources** — Pexels, Pixabay, or user-provided image libraries
- **SCORM export** — package as SCORM-compliant learning objects for LMS platforms
- **Video chapter markers** — embed chapter metadata in MP4 for easy navigation

---

## License

MIT
