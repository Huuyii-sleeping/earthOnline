# Git 工作流规范

## 目标

仓库从第一天开始保持可追溯、可回滚、可协作。

## 分支策略

- `main`：稳定分支，保持可构建。
- `feature/*`：功能开发。
- `fix/*`：问题修复。
- `docs/*`：文档更新。
- `chore/*`：工程配置、依赖、脚手架。

## 提交规范

使用 Conventional Commits：

```text
<type>(<scope>): <subject>
```

示例：

```text
feat(agent): add medal generation graph
fix(web): prevent feed card overflow
chore(repo): configure lint staged hooks
```

## 推荐开发流程

```bash
git checkout main
git pull
git checkout -b feature/medal-detail

# 开发
pnpm lint
pnpm typecheck
pnpm test

git add .
git commit -m "feat(web): add medal detail page"
git push -u origin feature/medal-detail
```

## 合并要求

合并前至少满足：

- CI 通过。
- 没有无关格式化和大范围重排。
- 涉及架构或产品边界变化时同步更新文档。
- 任何敏感配置不得提交到仓库。

## 不允许提交

- `.env`
- API key
- 私密素材
- 大体积生成文件
- 本地数据库数据
- `node_modules`
- 构建产物
