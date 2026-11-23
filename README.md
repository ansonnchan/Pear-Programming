# Pear Programming

[![CI](https://github.com/ansonnchan/Pear-Programming/actions/workflows/ci.yml/badge.svg)](https://github.com/ansonnchan/Pear-Programming/actions/workflows/ci.yml)

A real-time collaborative code editor in the browser. Share a room code, and up to five people can write, run, and talk about code together. 

**And yes, the name is intentional—it’s a pun. I’m not even that into pears.**

**[Try it live here](https://pear-programming.vercel.app)** (free hosting, so the first visit can take a minute to wake up)

<p align="center">
  <img src="assets/pear-program-demo.gif" alt="Two people editing, running, and chatting in a Pear Programming room" width="800">
</p>

## Why I built this

Pairing over a screen share always felt one-sided: one person types while the other watches. I wanted a space where everyone has their own cursor in the same file, and I wanted to learn how tools like Google Docs keep several people's edits in sync without conflicts.

## What it does

- **Shared editing**: everyone edits the same files live, with conflicts merged automatically (Yjs CRDTs)
- **Rooms**: create one, share the six-letter code, and see who's online
- **Chat**: talk next to the code, and mention `@PearAI` for an assistant that can see the file
- **Run code**: run 14 languages in a sandbox and see the output together
- **Workspaces**: upload a project, organize folders and tabs, and download it again

## How it works

```text
React + Monaco
  ├─ REST and STOMP ──> Spring Boot ──> PostgreSQL
  │                         ├─────────> Redis
  │                         ├─────────> Code runner (Wandbox)
  │                         └─────────> AI provider
  └─ Yjs WebSocket ──> Realtime service ──> Redis
```

- **Frontend**: React, TypeScript, Vite, and Monaco
- **Backend**: Spring Boot for sign-in, rooms, chat, presence, files, and code execution
- **Realtime service**: Node and Yjs to sync edits and save snapshots
- **Storage**: PostgreSQL holds workspaces, files, and sessions; Redis holds presence, live update fan-out, and the execution queue

## Performance

Measured on one laptop with the scripts in [bench/](bench/); [docs/performance.md](docs/performance.md) has the method and full results.

- **Edit latency**: 10.2 ms p95 from a keystroke to the other four browsers in a room
- **Load**: one realtime instance sustained 400 rooms (2,000 editing clients, 4,000 edits/s) at 2.7 ms p95 with no lost edits
- **Crash recovery**: when a backend is killed mid-run, another one requeues the job in 6.7 s p95 and finishes it before the deadline

## Run locally

Needs Java 21, Maven, Node 20, and Docker.

```bash
docker compose up -d postgres redis
```

Create `frontend/.env.local`:

```env
VITE_API_URL=http://localhost:8081
VITE_STOMP_URL=http://localhost:8081/ws
VITE_YJS_URL=ws://localhost:1235
```

Create `realtime/.env`:

```env
REDIS_HOST=localhost
SNAPSHOT_ENDPOINT=http://localhost:8081/internal/files
```

Then start each service in its own terminal:

```bash
cd backend && mvn spring-boot:run
```

```bash
cd realtime && npm install && npm run dev
```

```bash
cd frontend && npm install && npm run dev
```

Open http://localhost:5174.

## What I'd improve next

- **Real accounts**: guests are anonymous today, so a room's lead role can't follow you to another device
- **My own code runner**: the free public runner has rate limits and no Kotlin or Swift support
- **Always-on hosting**: the free tier sleeps, so the first visit waits for the servers to wake up
- **Follow mode**: jump to wherever a teammate is editing
- **Better mobile layout**: the editor is built for laptop and desktop screens
