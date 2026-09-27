<div align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-blue.svg" alt="Python"/>
  <img src="https://img.shields.io/badge/Next.js-16-black.svg" alt="Next.js"/>
  <img src="https://img.shields.io/badge/LangGraph-1.1.10-purple.svg" alt="LangGraph"/>
  <img src="https://img.shields.io/badge/Database-Supabase-green.svg" alt="Supabase"/>
  <img src="https://img.shields.io/badge/Queue-Upstash_Redis-red.svg" alt="Redis"/>
  <img src="https://img.shields.io/badge/LLM-Llama_3.3_70B-orange.svg" alt="Llama"/>
  <img src="https://img.shields.io/badge/Backend-HuggingFace_Spaces-yellow.svg" alt="HuggingFace"/>

  <h1>🧠 Distributed AI Researcher</h1>
  <p><em>Sumang's Signature Edition</em></p>
  <p>An asynchronous, distributed Swarm Intelligence platform for autonomous deep-web research, parallel synthesis, and structured Markdown reporting — deployed at production scale.</p>
</div>

---

## 📖 Overview

**Distributed AI Researcher** was born out of a simple problem: LLM inference is slow. HTTP has timeouts. Blocking a web request for 30–120 seconds of LLM work causes 504 Gateway Timeouts and a terrible user experience.

This system replaces the single-threaded LLM call model with a genuine multi-agent swarm using a **fire-and-forget job queue pattern**. A **LangGraph** pipeline coordinates three specialized agents: an Architect that decomposes the query, Scout agents that search the web concurrently, and a Synthesizer that fuses all findings into a professional report. 

**Key design properties:**
- **Non-blocking**: FastAPI returns a `job_id` immediately; work happens asynchronously in the worker daemon. The frontend stays completely responsive.
- **Persistent**: Every report is archived to Supabase (PostgreSQL) and surfaced in the sidebar history.
- **Secure**: API keys never reach the browser — all backend requests flow through a Next.js BFF proxy.
- **Resilient**: HuggingFace Spaces cold-start is handled gracefully in the UI with an animated inline toast.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        VERCEL (Frontend)                        │
│                                                                 │
│   Next.js 16 (App Router)                                       │
│   ├── /app/page.tsx        — Main UI: search, sidebar, report   │
│   ├── /app/api/proxy/      — BFF server-side proxy              │
│   └── /app/globals.css     — Professional typography system     │
└──────────────────────────┬──────────────────────────────────────┘
                           │  HTTPS + x-api-key (injected server-side)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│               HUGGINGFACE SPACES (Backend — Docker)             │
│                                                                 │
│   FastAPI  (main.py) — Port 7860                                │
│   ├── POST /research     → Enqueue job, return job_id           │
│   └── GET  /job/{id}     → Poll Redis for status + result       │
│                                                                 │
│   Python Worker Daemon  (worker.py)                             │
│   └── BRPOP Redis queue → triggers LangGraph pipeline           │
│                                                                 │
│   LangGraph AI Swarm  (ai_swarm.py)                             │
│   ├── Architect Agent    — Query decomposition (Llama 3.3 70B)  │
│   ├── Scout Agents       — Parallel DuckDuckGo search           │
│   └── Synthesizer Agent  — Final Markdown report generation     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   Upstash Redis     Supabase DB       Groq Cloud API
   (job queue)    (report archive)   (Llama 3.3 70B)
```

### 🔄 The Data Flow

1. **Request**: You type a query and hit Execute. Next.js instantly proxies this to FastAPI, which pushes the job to Redis and returns a UUID in < 100ms.
2. **Polling**: The UI spins up a `SwarmLoader` and pings for updates every 2 seconds.
3. **Execution**: A background Python worker wakes up from its `BRPOP` sleep, grabs the job, and unleashes the AI swarm.
4. **Delivery**: The report is saved to Redis and permanently archived in Supabase. The frontend catches the completed status, kills the polling loop, and renders the Markdown.

---

## 🤖 The AI Swarm Pipeline

We use a Directed Acyclic Graph (DAG) via LangGraph to route intelligence through specialized agents, backed by a **Multi-Model Fallback Chain**. If the primary model (Qwen) is rate-limited or unavailable, the system cascades through Llama 3 8B, Mixtral 8x7B, Llama 3.3 70B, and Gemma 2.

1. **The Architect**: Takes your raw query and breaks it into exactly 5 targeted sub-queries using structured JSON. A robust Regex engine parses the output to handle varying LLM markdown formats.
2. **The Scouts**: We fire off DuckDuckGo or Tavily searches *in parallel* via `asyncio.gather`. There is no blocking I/O here; 5 searches take the exact same time as 1. Each search pulls the top 6 results for maximum context.
3. **The Synthesizer**: Armed with a truncated context window (up to 30 results) and a strict output token limit, this agent fuses all the scout data into a master Markdown report with citations — safely tuned to operate within free tier API constraints.

---

## 🎨 UI & Design System

The aesthetics are designed to be clean, professional, and readable for long-form data.

- **Deep Aesthetics**: Built on a `#030000` true-black canvas with subtle red gradients, floating ember particles, and a scanning laser line powered by custom CSS `@keyframes`.
- **Typography System**: We completely bypassed Tailwind's prose modifiers to build a hand-tuned `.report-body` class. It features lightweight Zinc-400 fonts for editorial elegance, refined gradients on H1 headings, dark red accent bars for H2s, Catppuccin-styled code blocks, and ghost-underlined links.
- **Smart Components**: The `ErrorToast` handles backend cold-starts gracefully via Framer Motion, and the `SidebarContent` is deeply memoized to prevent React re-render flashes during typing.
- **Agentic UX**: Features a "New Research" button for instant context-clearing, and professional telemetry status badges with pulsing indicators to expose system state (e.g., active model, search engine status).

---

## 🔐 Security Model

| Layer | Mechanism |
|---|---|
| **Browser → Next.js** | Public request — zero secrets exposed. |
| **Next.js → FastAPI** | The BFF proxy injects an `x-api-key` header server-side. |
| **FastAPI** | Validates the key via a `Security` dependency; rejects unauthorized traffic with a 401. |
| **Env vars** | `.env` never committed; `.env.example` is the contract. |
| **Supabase** | Anon key only on client (Row Level Security enforced server-side). |

---

## 🛠️ Technology Stack

### Frontend
- **Framework**: Next.js 16.2 (App Router, SSR, API proxy)
- **Styling**: Tailwind CSS 4.x + Framer Motion 12.x
- **Rendering**: `react-markdown` (v9) + `remark-gfm` (v4) with native ESM resolution via `serverExternalPackages`.
- **Database Client**: Supabase JS

### Backend
- **Core**: FastAPI + Uvicorn
- **AI/LLM**: LangGraph + LangChain-Groq (Llama 3.3 70B Versatile)
- **Search**: DuckDuckGo Async + Tavily
- **Data Layer**: Upstash Redis + Supabase (PostgreSQL)

---

## 🌐 Production Deployment

| Component | Platform | Notes |
|---|---|---|
| **Frontend** | Vercel | Auto-deploys on every push to `main` |
| **Backend** | HuggingFace Spaces (Docker) | Auto-synced via `.github/workflows/sync-to-hf.yml` |

### ⚠️ Known Behaviours & Quirks
- **HuggingFace Cold-Start**: Free-tier Spaces sleep after inactivity. The first request may take 30–60 seconds. The UI displays an animated inline toast noting the cold-start. This is expected behaviour.
- **Groq Free Tier 8000 TPM Limit**: The system is explicitly designed to stay under Groq's 8,000 Tokens Per Minute limit on the free tier. Context is automatically truncated to ~12k characters and output is capped at 4096 tokens to prevent 413 Rate Limit crashes.
- **Reasoning Models**: If switched to a model like Qwen3, it emits `<think>` blocks. We dynamically strip these out before rendering to keep the report clean.
- **Redis TTL**: Job results expire from the Redis cache after 1 hour, but remain permanently in the Supabase history.
- **History Fallback UI**: If a backend job crashes mid-run and saves an empty/null report to Supabase, the React UI catches this gracefully and displays an `Error: Report data was empty or corrupted` message instead of breaking the layout. Clicking history items instantly updates both the search bar and the result area seamlessly via Framer Motion without visual layout-thrashing or blinking.

---

## 🚀 Local Development

### Prerequisites
- Python 3.11+ and Node.js 18+
- Upstash Redis instance (free tier)
- Supabase project with a `research_history` table
- Groq API key

### 1. Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS/Linux
pip install -r requirements.txt
```

Create `backend/.env`:
```env
GROQ_API_KEY=gsk_...
UPSTASH_REDIS_URI=rediss://...
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_KEY=your_service_role_key
API_SECRET_KEY=any_strong_random_string
```

Run both services:
```bash
# Terminal 1 — FastAPI orchestrator
uvicorn main:app --reload --port 7860

# Terminal 2 — Worker daemon (must stay running)
python worker.py
```

### 2. Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
API_BASE=http://localhost:7860
INTERNAL_API_KEY=any_strong_random_string   # must match backend API_SECRET_KEY
```

```bash
npm run dev
# → http://localhost:3000
```

---

## 📜 License

Distributed under the MIT License.
