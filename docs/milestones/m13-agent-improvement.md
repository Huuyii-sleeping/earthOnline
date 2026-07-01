# Agent 完善路线图

> 生成时间：2026-07-01
> 基于 Agent 全架构调研（TS Agent 服务 + Go API + 前端）制定
> 前序里程碑：m12-agent-implementation.md（生产级 Agent 实现）

---

## 一、已实现但未接入的功能（投入小、收益大）

这三个模块代码已完整写好，只需接线即可启用。

### #1 质量检查接入 react-loop.ts

**现状**：`apps/agent/src/agent/quality-check.ts` 已实现两层质量检查（Tier1 规则 + Tier2 LLM-as-judge），但 `react-loop.ts` 从未调用。Agent 回复质量完全依赖 LLM 一次性输出。

**实现方案**：

- 在 `runReActLoopStream` 的 `done` 事件前插入 `checkQuality()` 调用
- 回复不达标时用 `buildCorrectionMessage()` 构造修正提示，重试一次（`maxRetries=1` 已定义）
- high severity 问题直接重试，low severity 问题走 LLM judge
- 流式场景：先完成第一轮输出，质量检查失败后重新流式输出第二轮

**关键文件**：

- `apps/agent/src/agent/quality-check.ts` — 已实现，无需改动
- `apps/agent/src/agent/react-loop.ts` — 在 `runReActLoopStream` 的 done 分支插入质量检查逻辑

**预期工时**：0.5 天

---

### #2 LLM 语义安全检查接入（safety Layer 2）

**现状**：`apps/agent/src/safety/index.ts` 中 `semanticSafetyCheck()` 已完整实现，但只有 Layer 1 关键词匹配在运行。像"觉得活着没意思"这类需语义理解的风险内容不会触发保护。

**实现方案**：

- 在 `conversation.ts` 流式路由中，当 `checkSafety()` 返回 `needsSemanticCheck: true` 时，调用 `semanticSafetyCheck()` 做二次判断
- Layer 2 返回 `riskLevel: "high"` 时拦截并返回安全提示
- 注意：Layer 2 会增加 1-2s 延迟，只在 Layer 1 标记了负面情绪信号时才触发

**关键文件**：

- `apps/agent/src/safety/index.ts` — 已实现 `semanticSafetyCheck()`，无需改动
- `apps/agent/src/server/routes/conversation.ts` — 在 safety check 后加 Layer 2 条件调用

**预期工时**：0.5 天

---

### #3 会话历史回看

**现状**：后端 `listMessages(sessionId)` 和 `listExperiences()` API 已就绪，前端从未调用。用户刷新页面后对话全部丢失。

**实现方案**：

- 新增"历史经历"页面或侧边栏入口，调用 `listExperiences()` 展示经历列表
- 点击某条经历后调用 `listMessages(sessionId)` 加载对话历史
- CreateExperiencePage 刷新时检测 URL 参数 `?session=xxx`，有则从后端恢复历史
- 复用现有 `AssistantMarkdown` 组件渲染历史消息

**关键文件**：

- `apps/web/src/features/agent/conversationApi.ts` — `listExperiences` 和 `listMessages` 已定义，需接入 UI
- `apps/web/src/pages/CreateExperiencePage.tsx` — 加载时从后端恢复历史
- `apps/web/src/app/routes.tsx` — 可能需要新增历史路由

**预期工时**：1-2 天

---

## 二、前端体验优化（用户感知最强）

### #4 流式渲染性能优化

**现状**：每个 token 触发一次 `setMessages(prev => prev.map(...))`，长回复时全量 map + 重渲染，可能卡顿。

**实现方案**：

- 用 `useRef` 缓存当前流式消息的内容，token 追加到 ref
- 用 `requestAnimationFrame` 或 16ms 节流批量更新 state
- 或用 `useReducer` + 批量 dispatch 替代逐 token setState

**关键文件**：

- `apps/web/src/pages/CreateExperiencePage.tsx` — `onToken` 回调优化

**预期工时**：0.5 天

---

### #5 停止生成按钮

**现状**：`sendMessageStream` 已返回 `AbortController`，但 `handleSend` 没有接收和使用它。用户无法中断长回复。

**实现方案**：

- 在 `handleSend` 中保存 `AbortController` 到 state
- `isSending` 时在输入框旁显示"停止"按钮
- 点击停止调用 `controller.abort()`，保留已收到的部分回复
- 前端 SSE 解析中 `AbortError` 需静默处理（不显示错误）

**关键文件**：

- `apps/web/src/pages/CreateExperiencePage.tsx` — 保存 controller + 停止按钮
- `apps/web/src/features/agent/conversationApi.ts` — 已返回 controller，无需改动

**预期工时**：0.5 天

---

### #6 消息重试按钮

**现状**：流式失败后只显示兜底文案"抱歉，我暂时无法回复"，用户必须重新打字。

**实现方案**：

- 在 `onError` 中保存失败消息的原始内容到 state
- 在错误消息下方渲染"重试"按钮
- 点击重试时用原始内容重新调用 `sendMessageStream`

**关键文件**：

- `apps/web/src/pages/CreateExperiencePage.tsx` — 消息类型加 `retryContent` 字段 + 重试按钮

**预期工时**：0.5 天

---

### #7 输入框状态优化

**现状**：`isSending` 时输入框 `disabled`，用户无法在等待时编辑下一条。

**实现方案**：

- 将输入框的 `disabled` 改为 `readOnly`，允许选中复制
- 或完全去掉 disable，只禁用发送按钮
- 发送按钮单独用 `disabled={isSending}` 控制

**关键文件**：

- `apps/web/src/pages/CreateExperiencePage.tsx` — Input 组件属性调整

**预期工时**：0.5 天

---

## 三、安全与架构加固

### #8 Agent 工具回调鉴权

**现状**：`/agent/tools/*` 端点仅校验 `X-Internal-User-Id` 头存在，无共享密钥。任何人知道用户 ID 就能调用。

**实现方案**：

- 在 Agent 服务和 Go API 之间约定一个共享密钥（环境变量 `INTERNAL_API_KEY`）
- Agent 工具请求加 `X-Internal-API-Key` 头
- Go 中间件校验该头，不匹配返回 403
- 代码注释已指出此问题（`agent_tools.go` 第 40-48 行）

**关键文件**：

- `apps/api/internal/http/middleware/` — 新增内部鉴权中间件
- `apps/api/internal/http/handlers/agent_tools.go` — 替换现有 `internalAuthMiddleware`
- `apps/agent/src/tools/registry.ts` — 请求头加 `X-Internal-API-Key`
- `apps/agent/src/server/env.ts` — 加 `INTERNAL_API_KEY` 环境变量

**预期工时**：0.5 天

---

### #9 统一 401 刷新逻辑

**现状**：`interceptors.ts`（axios）和 `sendMessageStream`（fetch）各实现了一套 token 刷新，行为可能不一致。

**实现方案**：

- 从 `interceptors.ts` 导出 `refreshAccessToken()` 函数
- `sendMessageStream` 中调用该函数替代手写的 `tryRefreshToken()`
- 确保刷新状态锁 `isRefreshing` 被共享，避免并发刷新

**关键文件**：

- `apps/web/src/lib/api/interceptors.ts` — 导出 `refreshAccessToken`
- `apps/web/src/features/agent/conversationApi.ts` — 替换 `tryRefreshToken` 为导入

**预期工时**：0.5 天

---

### #10 API Key 存储安全

**现状**：`runtimeConfig.ts` 把 API Key 明文存 localStorage，代码注释自己也提示了风险。

**实现方案**：

- 生产环境改为服务端托管：前端只存 `isConfigured` 标记，Key 存在 Go 后端
- Go 新增 `POST /api/v1/agent-runtime/config` 端点，加密存 Key
- Agent 服务通过 `agent_runtime` 字段从 Go 获取 Key（而非前端直传）
- 开发环境保持 localStorage 不变

**关键文件**：

- `apps/web/src/features/agent/runtimeConfig.ts` — 生产环境改为 API 调用
- `apps/api/internal/http/handlers/` — 新增 runtime config handler
- `apps/api/internal/database/models.go` — AgentProfile 加 encrypted_api_key 字段

**预期工时**：1 天

---

## 四、功能扩展方向

### #11 奖章视觉生成

**现状**：`medal-visual.graph.ts` 只生成视觉指令文本（visualPrompt/styleTags），没有实际调用图像生成模型。`image_url` 字段存在但未填充。

**实现方案**：

- 在 Agent 服务新增图像生成 provider（支持 DALL-E / 智谱 CogView / Stability AI）
- 奖章生成流程末尾调用图像 API，传入 visualPrompt
- 图片上传 MinIO，回写 `medal_versions.image_url`
- 前端奖章预览用真实图片替代 Award 图标

**关键文件**：

- `apps/agent/src/graphs/medal-visual.graph.ts` — 扩展为调用图像 API
- `apps/agent/src/providers/` — 新增 image provider
- `apps/api/internal/http/handlers/medal.go` — 处理 image_url 回写

**预期工时**：2-3 天

---

### #12 主动对话提醒

**现状**：主动功能仅限于定时生成阶段回顾 + 应用内通知。没有主动发起对话。`proactive_level=2`（push）语义已定义但未实现。

**实现方案**：

- 新增 WebSocket 连接或复用 SSE 推送通道
- Worker 定时扫描长时间未记录经历的用户（如 3 天无新经历）
- 入队"主动对话"任务，Agent 根据用户近期奖章/成长画像生成个性化提醒
- `proactive_level=2` 的用户额外触发 push 通知

**关键文件**：

- `apps/api/cmd/worker/` — 新增 proactive check 调度
- `apps/api/internal/domain/` — 新增 proactive service
- `apps/web/src/` — WebSocket 客户端或 SSE 监听

**预期工时**：3-4 天

---

### #13 单元测试

**现状**：测试覆盖率 0%。`vitest` 已装好但无任何测试文件。

**实现方案**：

- 优先覆盖纯函数逻辑（无 LLM 依赖）：
  - 状态机转换：`conversation-state.ts` 的 `transition()` + `detectDimension()`
  - 工具决策：`react-loop.ts` 的 `shouldUseTools()`
  - 上下文压缩：`context-compressor.ts` 的压缩逻辑
  - 安全检查：`safety/index.ts` 的 `checkSafety()` 关键词匹配
  - Token 估算：`tokens.ts` 的 `estimateTokens()`
- 后续覆盖需要 mock LLM 的集成测试

**关键文件**：

- `apps/agent/src/agent/conversation-state.test.ts`
- `apps/agent/src/agent/react-loop.test.ts`
- `apps/agent/src/utils/context-compressor.test.ts`
- `apps/agent/src/safety/index.test.ts`
- `apps/agent/src/utils/tokens.test.ts`

**预期工时**：2-3 天

---

## 实施顺序

| 阶段   | 内容                                            | 预期工时 | 优先级 |
| ------ | ----------------------------------------------- | -------- | ------ |
| 第一步 | #1 质量检查 + #2 安全检查 + #3 会话历史         | 2-3 天   | 高     |
| 第二步 | #4 流式性能 + #5 停止生成 + #6 重试 + #7 输入框 | 1-2 天   | 中     |
| 第三步 | #8 工具鉴权 + #9 统一 401 + #10 Key 存储        | 1-2 天   | 中     |
| 第四步 | #11 奖章图片 + #12 主动提醒 + #13 测试          | 5-7 天   | 低     |

---

## 当前已完成的修复（CR + 回归 bug）

| 提交      | 内容                                                    |
| --------- | ------------------------------------------------------- |
| `384a191` | CR P1：12 个严重缺陷修复                                |
| `3c8beea` | CR P2：35 个中等缺陷修复                                |
| `b90ae7a` | 回归修复：客户端断连检测监听 reply.raw 而非 request.raw |
| `fcc8698` | 回归修复：流式请求 401 时自动刷新 token 并重试          |
