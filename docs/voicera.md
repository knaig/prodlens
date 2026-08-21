# VoiceEra, through the Prodlens lens

VoiceEra ([COSS-India/voicera_mono_repository](https://github.com/COSS-India/voicera_mono_repository))
is a complete voice AI building block: a Next.js dashboard, a FastAPI backend, a
real-time Pipecat voice server, and MongoDB + MinIO underneath, built for India
at population scale. This page documents how Prodlens mapped it, how the stack
runs, and what the run produced.

## Architecture

```
Browser (Next.js :3200)
   │  JWT in localStorage (access_token, org_id)
   ▼
app/api/*  (Next.js route handlers proxy to FastAPI)
   ▼
FastAPI (:8000) ─ routers mounted under /api/v1
   │  users, agents, meetings, campaigns, audience, call_recordings,
   │  phone_numbers, vobiz, plivo, analytics, integrations,
   │  custom_llm_integrations, members, knowledge, rag, batches
   ▼
MongoDB (:27017)      MinIO (:9000)        Pipecat voice server (:7860)
                                                    AI4Bharat STT/TTS (:8001/:8002)
```

- **Frontend**: auth surfaces (`/`, `/signup`, `/forgot-password`, `/reset-password`)
  plus a nine-screen dashboard: `/assistants`, `/numbers`, `/knowledge-base`,
  `/batches`, `/history`, `/analytics`, `/telemetry`, `/members`, `/integrations`.
- **Auth**: `POST /api/v1/users/signup` + `login` return a JWT (`sub` = email,
  `org_id` claim) stored in localStorage by the frontend.
- **Backend**: `app/main.py` mounts all routers under `API_V1_PREFIX`. Models are
  MongoDB documents; an APScheduler polls due batches every 5s.

## Running the stack

| service | port | run |
| --- | --- | --- |
| Frontend (Next.js) | 3200 | `cd voicera_frontend && npm run dev -p 3200` (hermes holds :3000) |
| Backend (FastAPI) | 8000 | `cd voicera_backend && uv run python run.py` |
| MongoDB | 27017 | local brew; create `admin/admin123` + `voicera` db for the backend env |

`.env` for the backend: copy `voicera_backend/env.example` and set
`MONGODB_USER=admin MONGODB_PASSWORD=admin123 MONGODB_DATABASE=voicera`.

## The Prodlens run

The app uses its own JWT auth (no Clerk), so Prodlens's `custom-login` strategy
fills the real sign-in form, stores the JWT, and caches the session:

```
# create a test account once, then:
prodlens discover --base-url http://localhost:3200 --entry /assistants \
  --auth custom-login --auth-token-in-localstorage \
  --out data/projects/voicera/discovery
prodlens prioritize --graph data/projects/voicera/discovery/graph.json --out data/projects/voicera/discovery
prodlens run --paths ... --graph ... --base-url http://localhost:3200 --auth custom-login --auth-token-in-localstorage
prodlens demo --script data/projects/voicera/demos/voicera-demo/demo-script.json \
  --auth custom-login --auth-token-in-localstorage --data-dir data/projects/voicera/discovery
```

**Results (current run):**
- `scan` - 16 routes including the full API layer.
- `discover` - 9 dashboard screens, 147 edges (the sidebar links every screen to
  every other).
- `prioritize` - 6 LLM-synthesized journeys; all passed live execution.
- `demo` - narrated walkthrough with the real OS cursor (`--os-cursor`).

## Artifacts

- Discovery: `data/projects/voicera/discovery/`
- Demo video + screenplay: `data/projects/voicera/demos/voicera-demo/videos/`
- Tutorial video + slides: `data/projects/voicera/tutorial/`
  (`voicera-tutorial.mp4` - narrated, cursor points at each service)
