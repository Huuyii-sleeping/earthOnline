# Agent

TypeScript Agent service based on Fastify, LangChain.js, and LangGraph.js.

## Development

```bash
pnpm --filter @earth-online/agent dev
```

The service exposes:

- `GET /healthz`
- `GET /sessions/:sessionId/stream`
