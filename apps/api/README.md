# API

Go + Gin + GORM 业务后端。

## Development

```bash
go run ./cmd/server
go run ./cmd/worker
go test ./...
```

本地运行前需要启动 PostgreSQL 和 Redis：

```bash
docker compose -f ../../infra/docker-compose.yml up -d
```
