# Worker

MVP 阶段异步任务入口先放在 `apps/api/cmd/worker`，便于共享 Go 业务代码和配置。

当任务量和部署复杂度上升后，再把 worker 拆到当前目录下作为独立服务。
