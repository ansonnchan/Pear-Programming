# Pear Programming

[![CI](https://github.com/ansonnchan/Pear-Programming/actions/workflows/ci.yml/badge.svg)](https://github.com/ansonnchan/Pear-Programming/actions/workflows/ci.yml)

Pear Programming is a real-time collaborative browser IDE for pair programming. Users can create or join a room, edit shared files, chat, work with PearAI, and run code in a sandboxed environment.

## Highlights

- Real-time Monaco editing powered by Yjs
- Shared workspaces, file uploads, folders, tabs, and collaborative deletion
- Room presence, chat, lead controls, locking, and reconnect-safe cleanup
- Sandboxed code execution through a pluggable provider (free Wandbox by default, or Judge0), plus optional context-aware PearAI assistance
- Durable workspaces and files stored in PostgreSQL

## Preview

<p align="center">
  <img src="assets/pear-program-demo.gif" alt="Pear Programming collaborative IDE live demo" width="800">
  <br>
  Demo above. Don't mind the poor quality (it's the best I can do 😔)
</p>

## Architecture

```text
React + Monaco
  ├─ REST and STOMP ──> Spring Boot ──> PostgreSQL
  │                         ├─────────> Redis
  │                         ├─────────> Wandbox or Judge0
  │                         └─────────> AI provider
  └─ Yjs WebSocket ──> Realtime service ──> Redis
```

- `frontend/` — React, TypeScript, Vite, Monaco, and the IDE interface
- `backend/` — Spring Boot API, authentication, rooms, chat, presence, files, and execution
- `realtime/` — Node Yjs synchronization and snapshot service
- `docs/` — deployment and reliability documentation

PostgreSQL is the durable source of truth. Redis coordinates ephemeral presence, realtime fanout, Yjs updates, and execution jobs.

## Requirements

- Java 21+
- Maven 3.9+
- Node.js 20+
- npm 10+
- Docker Desktop

## Run Locally

Start PostgreSQL and Redis:

```bash
docker compose up -d postgres redis
```

Create `frontend/.env.local`:

```env
VITE_API_URL=http://localhost:8081
VITE_STOMP_URL=http://localhost:8081/ws
VITE_YJS_URL=ws://localhost:1235
```

For Redis-backed realtime synchronization, create `realtime/.env`:

```env
REDIS_HOST=localhost
SNAPSHOT_ENDPOINT=http://localhost:8081/internal/files
ROOM_CLEANUP_ENDPOINT=http://localhost:8081/internal/rooms
```

Run each service in a separate terminal:

```bash
cd backend
mvn spring-boot:run
```

```bash
cd realtime
npm install
npm run dev
```

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5174`.

## Environment Variables

The complete reference is [.env.example](.env.example). Production values are documented in [.env.production.example](.env.production.example).

| Service | Essential variables |
| --- | --- |
| Frontend | `VITE_API_URL`, `VITE_STOMP_URL`, `VITE_YJS_URL` |
| Backend database | `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` |
| Backend Redis | `SPRING_REDIS_HOST`, `SPRING_REDIS_PORT`, or `SPRING_REDIS_URL` |
| Execution | `EXECUTION_PROVIDER` (`wandbox` by default, needs no key; or `judge0` with `JUDGE0_BASE_URL`, plus `JUDGE0_API_KEY` and `JUDGE0_API_HOST` for RapidAPI) |
| PearAI | `GROQ_API_KEY` |
| Realtime Redis | `REDIS_URL`, or `REDIS_HOST` and `REDIS_PORT` |
| Realtime API | `AUTH_VALIDATION_ENDPOINT`, `SNAPSHOT_ENDPOINT`, `ROOM_CLEANUP_ENDPOINT` |
| Internal security | `INTERNAL_SERVICE_TOKEN`, shared by backend and realtime in deployed environments |

Code execution works out of the box through the free public Wandbox service. PearAI is optional for local editing and collaboration. Their related features show a configuration or availability message when not configured.

## Supported Execution Languages

| Provider | Languages |
| --- | --- |
| Wandbox (default) | Java, Python, JavaScript, C, C++, TypeScript, SQL, C#, PHP, Ruby, Go, Rust, R, and Bash |
| Judge0 | All of the above, plus Kotlin and Swift |

Wandbox has no Kotlin compiler, and its Swift compilers currently fail to start, so the language picker hides both when Wandbox is active. Wandbox is a free community service with rate limits and no uptime guarantee. To re-check every language against it:

```bash
cd backend && WANDBOX_LIVE=true mvn -Dtest=WandboxLiveCheckTests test
```

Judge0 language IDs vary between deployments. When using Judge0, compare the backend registry with the provider's `/languages` response.

## Testing

```bash
(cd frontend && npm run lint && npm test && npm run build)
(cd backend && mvn test)
(cd realtime && npm run lint && npm test)
```

Frontend and backend tests use mocked execution providers, so no execution service is required.

With Redis running locally, set `PEARPROGRAM_TEST_REDIS_HOST=localhost` before `mvn test` to also run the Redis room-admission test. CI runs all three suites on every pull request and push to `main`.

Execution latency definitions and repeatable benchmark commands are documented in
[docs/execution-performance.md](docs/execution-performance.md).

## Deployment

See [docs/deployment.md](docs/deployment.md) for the production Compose topology, HTTPS/WebSocket routing, secrets, migrations, backups, and recovery.
