# Contributing

## Branches

- `main` 是稳定主分支。
- 功能分支使用 `feature/<short-name>`。
- 修复分支使用 `fix/<short-name>`。
- 文档分支使用 `docs/<short-name>`。

## Commit Convention

本仓库使用 Conventional Commits。

格式：

```text
<type>(<scope>): <subject>
```

常用 type：

- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档
- `refactor`: 重构
- `test`: 测试
- `chore`: 工程杂项
- `ci`: CI/CD
- `build`: 构建系统

允许 scope：

- `repo`
- `docs`
- `web`
- `api`
- `agent`
- `worker`
- `shared`
- `infra`
- `ci`
- `deps`

示例：

```text
feat(web): add medal card layout
fix(api): validate refresh token expiry
docs(docs): update MVP milestone
```

## Pull Request Checklist

- 代码已通过 `pnpm lint`。
- TypeScript 已通过 `pnpm typecheck`。
- 相关测试已通过。
- Go 代码已通过 `gofmt` 和 `go test`。
- 涉及产品行为变化时，同步更新 `docs/prd.md` 或 `docs/technical-plan.md`。
- 涉及环境变量变化时，同步更新 `.env.example`。

## Local Hooks

安装依赖后，Husky 会启用：

- `pre-commit`: 运行 lint-staged，格式化 staged 文件。
- `commit-msg`: 校验 Conventional Commits。
