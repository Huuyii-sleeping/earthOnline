# Earth Online

经历成就官是一个把用户真实生活经历转化为个人奖章、人生档案和社交展示内容的 AI 产品。

## Monorepo

```text
apps/web      Vite + React 前端
apps/api      Go + Gin + GORM 业务后端
apps/agent    TypeScript Agent 服务
apps/worker   后续独立 worker 入口
packages/shared 共享类型与协议
docs          PRD 和技术方案
infra         本地中间件和部署配置
```

## Local Setup

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d
pnpm dev:web
pnpm dev:agent
go run ./apps/api/cmd/server
```

本地 Go API 需要安装 Go 1.23+。

## Useful Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format
```

## Documentation

- [PRD](docs/prd.md)
- [Technical Plan](docs/technical-plan.md)
- [Git Workflow](docs/git-workflow.md)
