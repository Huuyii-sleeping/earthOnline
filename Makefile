.PHONY: install dev dev-web dev-agent api worker infra-up infra-down lint typecheck test build format format-check ci

install:
	pnpm install

dev:
	pnpm dev

dev-web:
	pnpm dev:web

dev-agent:
	pnpm dev:agent

api:
	go run ./apps/api/cmd/server

worker:
	go run ./apps/api/cmd/worker

infra-up:
	docker compose -f infra/docker-compose.yml up -d

infra-down:
	docker compose -f infra/docker-compose.yml down

lint:
	pnpm lint

typecheck:
	pnpm typecheck

test:
	pnpm test
	go test ./apps/api/...

build:
	pnpm build
	go test ./apps/api/...

format:
	pnpm format
	gofmt -w apps/api

format-check:
	pnpm format:check

ci:
	pnpm format:check
	pnpm lint
	pnpm typecheck
	pnpm test
	pnpm build
	go test ./apps/api/...
