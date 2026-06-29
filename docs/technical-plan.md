# 经历成就产品技术方案

## 1. 技术决策

根据当前 PRD，产品长期会包含经历记录、奖章生成、社交展示、隐私控制、多模态素材、Agent 对话、异步生成任务和阶段性总结。

### 1.1 已确认决策

- 前端框架：Vite + React
- 前端语言：TypeScript
- 后端语言：Go
- Go HTTP 框架：Gin
- Go ORM：GORM
- API 协议：REST + OpenAPI
- Agent 语言：TypeScript
- Agent 框架：LangChain.js + LangGraph.js
- 流式输出：SSE
- 队列：Redis + Asynq
- 认证：JWT access token + refresh token
- 文件上传：前端直传对象存储，Go API 签发 presigned URL
- 生成资产：图片保存到对象存储，数据库保存 URL、版本和生成参数
- Prompt 管理：代码内版本化 prompt 文件
- UI 组件：shadcn/ui + Tailwind CSS + lucide-react
- 登录方式：账号密码登录
- 密码哈希：bcrypt
- 本地开发：pnpm workspace + Go module + docker-compose
- 本地中间件：PostgreSQL、Redis、对象存储模拟服务通过 Docker 启动

### 1.2 技术栈

技术栈确定为：

- 前端：Vite + React + TypeScript
- 业务后端：Go
- Agent 服务：TypeScript + LangChain.js / LangGraph.js
- 数据库：PostgreSQL
- 缓存与队列：Redis
- 对象存储：S3 / Cloudflare R2 / 阿里 OSS 等兼容方案

核心原则：

> Go 后端是业务事实来源，负责核心数据、权限、状态和社交关系。TypeScript Agent 负责对话编排、模型调用和生成逻辑，不直接拥有核心业务数据。

## 2. 总体架构

```text
apps/web
  Vite + React + TypeScript 前端

apps/api
  Go 业务后端

apps/agent
  TypeScript Agent 服务

apps/worker
  异步任务 Worker，MVP 可先用 Go 实现

packages/shared
  OpenAPI schema、共享类型、常量、事件协议

infra
  本地开发、数据库、Redis、对象存储、队列中间件、部署配置
```

请求链路：

```text
用户
  -> React 前端
  -> Go API
  -> PostgreSQL / Redis / Object Storage

生成类请求
  -> React 前端
  -> Go API 创建任务和业务上下文
  -> TypeScript Agent 生成内容
  -> Go API 校验并写入结果
  -> React 前端展示结果
```

流式对话链路：

```text
React 前端
  -> Go API 创建或校验会话
  -> TypeScript Agent 进行流式对话
  -> Go API 持久化对话消息和生成结果
```

MVP 阶段可以先由前端连接 Go API，再由 Go API 调用 Agent 服务。后续如果流式体验需要更低延迟，可以让前端连接 Agent 的 SSE / WebSocket，但会话权限仍由 Go API 签发和校验。

## 3. 服务职责划分

### 3.1 React 前端

负责所有用户体验和交互状态。

核心页面：

- 首页 / 社交流
- 创建经历
- 奖章详情
- 个人主页
- 消息 / 通知
- Agent 设置

确定技术：

- Vite
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- lucide-react
- TanStack Query
- Zustand / Jotai
- React Hook Form + Zod
- OpenAPI generated client

说明：

> MVP 确定使用 Vite + React。当前产品重点是 App 型交互和 Agent 对话，不优先追求 SEO。公开主页 SEO 后续再评估是否增加独立 SSR 能力。

### 3.2 Go 业务后端

Go 后端负责稳定业务能力，是唯一可信的数据写入入口。

核心模块：

- auth：登录、注册、会话、Token
- users：用户资料、昵称、头像、简介
- agents：用户 Agent 配置
- experiences：经历、对话会话、原始输入
- medals：奖章、详情、版本、记忆重量
- assets：图片、音频、文件元数据
- visibility：公开范围、字段级隐藏
- social：关注、好友、轻互动
- feed：社交流查询
- notifications：消息、提醒、互动通知
- jobs：生成任务、任务状态、失败重试

确定技术：

- HTTP 框架：Gin
- ORM：GORM
- 数据库：PostgreSQL
- Migration：goose
- Redis：缓存、轻量队列、限流
- 日志：slog 或 zap
- 配置：环境变量 + cleanenv / viper
- API 文档：OpenAPI
- 鉴权：JWT access token + refresh token
- 密码哈希：bcrypt

选择 Gin + GORM 的原因：

- 入门成本低。
- MVP 开发速度快。
- 生态成熟，资料多。
- 适合先把业务闭环跑起来。

后续如果业务复杂度提高，可以在关键模块逐步引入更严格的数据访问模式，而不是一开始就使用过重架构。

### 3.3 TypeScript Agent 服务

Agent 服务负责智能生成和模型编排。

核心模块：

- conversation：对话状态、追问策略、生成前总结
- prompts：Prompt 模板、版本管理
- medal-planner：奖章意义重心判断
- medal-writer：奖章名称、短理由、详情叙事
- medal-visual：视觉生成指令、风格重生成
- multimodal：图片理解、语音转写结果整合
- regeneration：意义重生成、视觉重生成
- safety：敏感信息识别、公开前提醒
- streaming：SSE / WebSocket 流式输出

确定技术：

- Node.js
- TypeScript
- Fastify
- Zod
- OpenAI / Anthropic / 国内模型 Provider 抽象
- LangChain.js
- LangGraph.js

Agent 框架策略：

> MVP 可以直接使用 LangChain.js / LangGraph.js，但要限制使用边界：LangChain.js 主要用于模型、工具、结构化输出和 Provider 抽象；LangGraph.js 用于有状态 Agent 流程编排，例如追问、生成前确认、奖章生成、重生成和人工确认节点。

选择原因：

- Agent 对话天然是有状态流程，不只是单次模型调用。
- 产品需要流式输出、用户确认、重生成和历史版本。
- 后续会有语音转写、图片理解、视觉生成等多步骤任务。
- 使用成熟框架可以减少自研状态机和工具调用的成本。

约束：

- 不把业务数据所有权交给 Agent 框架。
- 不让 Agent 服务直接写数据库。
- Prompt、结构化输出 schema、流程节点必须版本化。
- LLM 输出一律视为不可信输入，由 Go API 做最终业务校验。

### 3.4 Worker

异步任务用于处理耗时生成和后台计算。

MVP 任务：

- 语音转写
- 图片理解
- 奖章视觉生成
- 阶段性大奖章生成
- 通知推送
- 失败重试

确定方案：

- MVP：Go worker + Redis + Asynq
- 后续复杂编排：Temporal

MVP 可以先把 worker 放在 `apps/api` 同仓库下运行，保持部署简单；当任务增长后再独立成 `apps/worker`。

## 4. 数据架构

### 4.1 核心实体

```text
User
AgentProfile
Experience
ConversationSession
ConversationMessage
Asset
Medal
MedalVersion
MedalStory
MedalVisibility
MedalInteraction
FollowRelation
FriendRelation
Notification
GenerationJob
StageSummary
```

### 4.2 建议数据表

#### users

- id
- nickname
- avatar_url
- bio
- created_at
- updated_at

#### agent_profiles

- id
- user_id
- name
- personality
- identity_prompt
- dialogue_style
- avatar_url
- proactive_level
- created_at
- updated_at

#### experiences

- id
- user_id
- title
- status
- occurred_at
- summary
- created_at
- updated_at

status 示例：

- collecting
- summarized
- medal_generating
- completed
- archived

#### conversation_sessions

- id
- user_id
- experience_id
- agent_profile_id
- status
- created_at
- updated_at

#### conversation_messages

- id
- session_id
- role
- content
- content_type
- asset_id
- created_at

role：

- user
- agent
- system

content_type：

- text
- image
- audio
- generated_summary

#### assets

- id
- user_id
- experience_id
- storage_key
- url
- mime_type
- asset_type
- size_bytes
- metadata
- visibility
- created_at

asset_type：

- image
- audio
- video
- document

#### medals

- id
- user_id
- experience_id
- current_version_id
- title
- short_reason
- memory_weight
- image_url
- visibility
- edited_by_user
- created_at
- updated_at

memory_weight：

- light
- medium
- heavy

#### medal_versions

- id
- medal_id
- version_type
- title
- short_reason
- meaning_focus
- story
- analysis_json
- visual_prompt
- image_url
- created_by
- created_at

version_type：

- initial
- meaning_regeneration
- visual_regeneration
- user_edit

created_by：

- agent
- user

#### medal_visibility

- id
- medal_id
- visibility
- hidden_fields
- created_at
- updated_at

visibility：

- public
- friends
- private

hidden_fields 示例：

```json
["people", "location", "raw_assets", "raw_conversation", "story", "emotion_tags"]
```

#### medal_interactions

- id
- medal_id
- user_id
- type
- created_at

type 示例：

- applaud
- relate
- brave
- memorable
- favorite

#### follows

- id
- follower_id
- following_id
- created_at

#### friendships

- id
- requester_id
- addressee_id
- status
- created_at
- updated_at

status：

- pending
- accepted
- rejected
- blocked

#### generation_jobs

- id
- user_id
- experience_id
- medal_id
- job_type
- status
- input_json
- output_json
- error_message
- created_at
- updated_at

job_type：

- speech_to_text
- image_understanding
- experience_summary
- medal_generation
- visual_generation
- meaning_regeneration
- visual_regeneration
- stage_summary

status：

- pending
- running
- succeeded
- failed
- cancelled

## 5. API 设计

API 协议确定为 REST + OpenAPI。

原则：

- Go API 维护 OpenAPI schema。
- 前端通过 OpenAPI 生成 TypeScript client。
- Agent 服务也通过 OpenAPI client 调用 Go API。
- 服务间传输数据使用明确 DTO，不直接暴露数据库模型。
- 外部输入使用 Go validator 校验，Agent 输出也必须经过 Go API 校验后才能入库。

### 5.1 认证

MVP 先做账号密码注册和登录。

```text
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /me
```

认证策略：

- 用户使用账号和密码注册。
- 密码使用 bcrypt 哈希后保存。
- 登录成功后签发 access token 和 refresh token。
- access token 用于访问 API。
- refresh token 用于续期。
- refresh token 需要服务端持久化或可撤销，支持登出和后续多端管理。

### 5.2 Agent 设置

```text
GET    /agent-profile
PUT    /agent-profile
POST   /agent-profile/avatar
```

### 5.3 经历创建

```text
POST /experiences
GET  /experiences/:id
GET  /experiences
PUT  /experiences/:id
```

### 5.4 对话

```text
POST /experiences/:id/sessions
GET  /sessions/:id/messages
POST /sessions/:id/messages
POST /sessions/:id/summary
```

流式对话：

```text
GET /agent/sessions/:id/stream
```

MVP 确定使用 SSE 做 Agent 单向流式输出。

MVP 可以由 Go API 代理到 TS Agent。后续如果需要降低流式延迟，可以由前端直连 Agent SSE，但必须先从 Go API 获取短期有效的会话授权 token。

### 5.5 素材

```text
POST /assets/presign
POST /assets
GET  /assets/:id
PUT  /assets/:id/visibility
DELETE /assets/:id
```

上传流程：

1. 前端向 Go API 请求预签名上传地址。
2. 前端直传对象存储。
3. 前端通知 Go API 创建 asset 记录。
4. Go API 触发转写、图片理解等任务。

本地开发使用 MinIO 模拟对象存储。

### 5.6 奖章

```text
POST /experiences/:id/medals/generate
GET  /medals/:id
PUT  /medals/:id
POST /medals/:id/regenerate/meaning
POST /medals/:id/regenerate/visual
GET  /medals/:id/versions
POST /medals/:id/versions/:version_id/restore
PUT  /medals/:id/visibility
```

### 5.7 社交

```text
GET  /feed?tab=following
GET  /feed?tab=latest
GET  /feed?tab=popular
GET  /feed?tab=similar
GET  /feed?tab=for-you

POST /medals/:id/interactions
DELETE /medals/:id/interactions/:type

POST /users/:id/follow
DELETE /users/:id/follow

POST /friends/:id/request
POST /friends/:id/accept
POST /friends/:id/reject
```

### 5.8 通知

```text
GET  /notifications
POST /notifications/:id/read
POST /notifications/read-all
```

## 6. Agent 生成流程

### 6.1 对话收集

输入：

- 用户文字
- 语音转写文本
- 图片理解结果
- 已有对话上下文
- 用户 Agent 设置

Agent 判断：

- 是否已经知道发生了什么
- 是否知道这件事对用户意味着什么
- 是否知道用户希望记住哪一部分
- 是否需要继续追问

输出：

- 追问问题
- 或生成前理解总结

### 6.2 生成前总结

Agent 输出结构化结果：

```json
{
  "experienceSummary": "这段经历的简短总结",
  "keyMoments": ["关键情节 1", "关键情节 2"],
  "detectedEmotions": ["紧张", "释然"],
  "possibleMeaning": "这件事值得记住的原因",
  "readyToGenerate": true
}
```

用户确认后进入奖章生成。

### 6.3 奖章意义生成

Agent 内部分析：

```json
{
  "action": "用户做了什么",
  "emotion": "用户经历了什么情绪",
  "meaning": "为什么值得记住",
  "traits": ["勇敢", "负责"],
  "memoryWeight": "medium",
  "meaningFocus": "行动突破"
}
```

对用户展示：

```json
{
  "title": "奖章名称",
  "shortReason": "一句话授奖理由",
  "memoryWeight": "medium",
  "story": "详情页叙事草稿"
}
```

### 6.4 视觉生成

Agent 生成视觉指令：

```json
{
  "visualPrompt": "用于图像生成的提示词",
  "styleTags": ["克制", "纪念章", "温暖光感"],
  "negativePrompt": "避免文字错误、避免杂乱构图",
  "aspectRatio": "1:1"
}
```

图像生成成功后，Go API 记录 image_url 并创建版本。

### 6.5 重生成

意义重生成：

- 改变奖章主题、名称、理由、详情叙事。
- 保留历史版本。

视觉重生成：

- 只改变图像和视觉提示。
- 不改变主题含义和核心授奖理由。
- 保留历史版本。

### 6.6 Prompt 版本管理

Prompt 第一版使用代码内版本化文件。

建议结构：

```text
apps/agent/src/prompts/
  conversation-followup.v1.ts
  experience-summary.v1.ts
  medal-generation.v1.ts
  medal-story.v1.ts
  medal-visual.v1.ts
  safety-review.v1.ts
```

每次 Agent 生成结果时，记录：

- prompt_name
- prompt_version
- model_provider
- model_name
- input_hash
- output_schema_version

这些字段用于后续调试、评估和回溯生成质量。

## 7. 隐私与权限

### 7.1 默认公开策略

产品默认偏公开展示，但仅默认公开外层奖章信息：

- 奖章图
- 奖章名称
- 短理由
- 记忆重量

详情叙事、原始素材、人物地点等敏感信息需要用户确认后公开。

### 7.2 可见范围

- public：所有人可见
- friends：好友可见
- private：仅自己可见

### 7.3 字段级隐藏

第一版支持隐藏：

- 人名
- 地点
- 原始图片 / 音频 / 视频
- 原始对话
- 详情叙事
- 情绪标签

权限判断由 Go API 统一处理。

前端和 Agent 不能绕过 Go API 读取私密数据。

## 8. 社交流实现

### 8.1 MVP Feed

MVP 首页包含 Tab：

- 关注
- 最新
- 热门
- 相似
- 为你推荐

实现优先级：

1. 最新：按公开时间倒序。
2. 关注：查询关注用户的公开奖章。
3. 热门：按轻互动数量和时间衰减排序。
4. 相似：先用经历类型 / 标签粗匹配。
5. 为你推荐：MVP 可先混合最新、热门、关注。

### 8.2 后续推荐升级

后续可以引入：

- 用户画像
- 奖章向量 embedding
- pgvector
- 互动行为权重
- 内容安全过滤

MVP 不建议一开始引入独立推荐服务。

## 9. 安全与内容治理

第一版至少需要：

- 上传文件类型和大小限制
- 登录态鉴权
- API rate limit
- 用户私密内容访问校验
- 敏感字段公开前提醒
- 基础内容审核接口预留
- 删除账号和删除内容的数据路径预留

Agent 安全策略：

- 不把 Agent 定位成心理治疗服务。
- 对极端自伤、暴力等内容触发安全回复和引导。
- 公开展示前提示用户检查敏感信息。

## 10. 本地开发环境

建议使用 monorepo。

```text
earthOnline/
  apps/
    web/
    api/
    agent/
    worker/
  packages/
    shared/
  docs/
    prd.md
    technical-plan.md
  infra/
    docker-compose.yml
```

本地依赖：

- Node.js
- pnpm
- Go
- Docker

本地中间件通过 Docker 启动：

- PostgreSQL
- Redis
- MinIO，模拟 S3 对象存储
- 可选：Redis Commander / pgAdmin，用于本地调试

本地启动：

```text
docker compose up -d postgres redis minio
pnpm dev:web
pnpm dev:agent
go run ./apps/api/cmd/server
```

### 10.1 本地端口约定

```text
web:        http://localhost:5173
api:        http://localhost:8080
agent:      http://localhost:8787
postgres:   localhost:5432
redis:      localhost:6379
minio:      http://localhost:9000
minio ui:   http://localhost:9001
```

### 10.2 环境变量

根目录保留 `.env.example`，各服务可以有自己的 `.env.example`。

关键环境变量：

```text
DATABASE_URL
REDIS_ADDR
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
AGENT_SERVICE_URL
OPENAI_API_KEY
```

真实 `.env` 不提交到仓库。

## 11. 项目结构约定

### 11.1 Go API

建议结构：

```text
apps/api/
  cmd/
    server/
      main.go
    worker/
      main.go
  internal/
    config/
    database/
    http/
      middleware/
      router/
      handlers/
    domain/
      auth/
      users/
      agents/
      experiences/
      medals/
      assets/
      social/
      notifications/
      jobs/
    integrations/
      agent/
      storage/
      queue/
    migrations/
```

约束：

- `internal/domain/*` 放业务逻辑。
- `internal/http/handlers` 只处理请求解析和响应。
- 数据库模型不要直接暴露给前端。
- 所有外部服务调用放在 `integrations`。
- migration 文件由 goose 管理。

### 11.2 TypeScript Agent

建议结构：

```text
apps/agent/
  src/
    server/
    graphs/
    chains/
    prompts/
    schemas/
    providers/
    tools/
    clients/
    safety/
    telemetry/
```

约束：

- `graphs` 放 LangGraph 流程。
- `prompts` 放版本化 prompt。
- `schemas` 放 Zod 输入输出结构。
- `clients` 放 Go API OpenAPI client。
- Agent 不直接连接业务数据库。

### 11.3 React Web

建议结构：

```text
apps/web/
  src/
    app/
    pages/
    routes/
    components/
      ui/
      medal/
      feed/
      agent/
    features/
      auth/
      experiences/
      medals/
      feed/
      profile/
      settings/
    lib/
      api/
      query/
      auth/
    styles/
```

约束：

- `components/ui` 放 shadcn/ui 基础组件。
- 业务组件按领域放在 `features` 或专属组件目录。
- API 调用通过 OpenAPI generated client。
- 服务端返回的权限结果决定前端展示，不在前端重复实现复杂权限判断。

## 12. 数据库与迁移规范

- 所有表使用 UUID 主键。
- 所有核心表包含 `created_at` 和 `updated_at`。
- 软删除按业务需要添加 `deleted_at`。
- 重要枚举先使用字符串枚举，便于迭代。
- JSON 字段用于 Agent 分析结果、素材 metadata、隐藏字段等半结构化数据。
- migration 文件进入版本管理。
- 不允许手动改线上表结构，必须通过 migration。

MVP 先使用 GORM model + goose migration。

后续如果查询复杂度提高，可以对高频查询手写 SQL 或引入专门 read model。

## 13. 部署方案

MVP 推荐部署：

- Web：Vercel / Cloudflare Pages / 静态站点托管
- Go API：Fly.io / Render / Railway / 云服务器
- Agent：Node 服务，和 Go API 分开部署
- PostgreSQL：托管数据库
- Redis：托管 Redis
- Object Storage：S3 / R2 / OSS

后续可以迁移到：

- Docker Compose 单机
- Kubernetes
- 云厂商容器服务

不建议 MVP 一开始上 Kubernetes。

## 14. MVP 开发里程碑

### Milestone 1：基础账户和框架

- Monorepo 初始化
- React 前端骨架
- Go API 骨架
- TS Agent 骨架
- PostgreSQL / Redis 本地环境
- 用户注册登录
- OpenAPI client 生成

### Milestone 2：创建经历与 Agent 对话

- 创建经历
- 创建对话会话
- 文字输入
- Agent 追问
- 生成前总结
- 对话消息持久化

### Milestone 3：奖章生成

- 奖章意义生成
- 奖章详情叙事生成
- 记忆重量
- Agent 判断依据
- 奖章版本记录

### Milestone 4：素材与视觉

- 图片上传
- 语音上传和转写
- 图片理解结果接入
- 奖章视觉生成
- 视觉重生成

### Milestone 5：个人主页和详情页

- 奖章墙
- 时间线
- 奖章详情
- 编辑奖章
- 隐私设置
- 历史版本恢复

### Milestone 6：社交流

- 公开奖章流
- 关注流
- 热门流基础排序
- 轻互动
- 关注 / 好友
- 通知

### Milestone 7：阶段性产出

- 阶段性大奖章
- 简短周 / 月总结
- Agent 主动提醒设置

## 15. 关键工程约束

- Go API 统一控制核心数据写入。
- Agent 服务不直接写数据库。
- 前端不直接访问对象存储私密资源，只使用 Go API 签发的授权 URL。
- 所有生成结果都要版本化。
- 所有公开内容都要经过可见性过滤。
- Prompt 需要版本管理，便于回溯生成质量。
- 异步任务必须有状态、错误信息和重试机制。

## 16. 暂不做的事情

MVP 不做：

- 微服务拆分
- Kubernetes
- 独立推荐系统
- 完整实时语音通话
- 可动虚拟形象
- 视频上传
- 复杂共鸣关系
- 自研内容审核系统

这些能力保留架构扩展口，但不进入第一版实现。
