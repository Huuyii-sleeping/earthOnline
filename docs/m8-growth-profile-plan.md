# Milestone 8 实现路线：成长画像与推荐增强

> 状态：规划中。M8 是 M1-M7 MVP 闭环后的第一轮增强，不替换现有奖章/阶段总结闭环，而是在其上沉淀长期画像，并用画像改善个人主页和推荐流。

## 背景与目标

M7 已完成周/月阶段总结和 Agent 主动提醒。PRD 中同一条长期路径还剩“个人成长画像更新”，个人主页也预留了“个人成就档案”。社交流的 `similar` / `for-you` 目前仍是 MVP 降级实现，缺少用户画像和内容标签支撑。

M8 的目标是建立一套轻量、可回溯、可增量更新的成长画像能力：

- 从经历、奖章、阶段总结中提取结构化画像信号。
- 在个人主页展示用户自己的长期成长档案。
- 用画像信号增强 `similar` 和 `for-you` feed。
- 保持 Go API 为唯一数据写入入口，Agent 只负责结构化生成。

## 范围

本阶段做：

- 后端新增成长画像与洞察数据模型。
- Agent 新增画像提取 prompt/schema/route。
- Go API 新增画像查询与刷新接口。
- Worker 支持生成奖章/阶段总结后的画像刷新任务。
- 前端个人主页新增“成长档案”展示。
- Feed `similar` / `for-you` 从降级排序升级为基于画像/标签的粗匹配。
- 补充后端测试、Agent 类型校验、前端类型校验和构建校验。

本阶段不做：

- 不引入 pgvector、embedding 或独立推荐服务。
- 不做复杂共鸣关系。
- 不做完整年度报告。
- 不做用户画像公开展示；M8 默认仅本人可见。
- 不做复杂图表库，先用基础卡片和轻量趋势展示。

## 数据设计

### growth_profiles

用户当前聚合画像，一人一行。

建议字段：

- `user_id`：用户 ID，唯一。
- `trait_keywords_json`：人格特质关键词数组。
- `growth_keywords_json`：成长关键词数组。
- `experience_types_json`：经历类型统计，如工作、学习、关系、健康、创作。
- `emotion_trends_json`：情绪轨迹摘要，可先存轻量统计而非完整时间序列。
- `summary_text`：Agent 生成的整体画像总结。
- `source_counts_json`：参与画像的经历/奖章/阶段总结数量。
- `last_refreshed_at`：最近刷新时间。

### growth_insights

画像生成或阶段性刷新时产生的洞察记录，用于回溯和展示近期变化。

建议字段：

- `user_id`：用户 ID。
- `period_type`：`all` / `week` / `month`。
- `period_start`、`period_end`：可空，`all` 时为空。
- `title`：洞察标题。
- `summary_text`：洞察正文。
- `keywords_json`：关键词数组。
- `signals_json`：Agent 结构化证据与来源 ID。
- `generated_by`：`agent`。
- `trigger`：`manual` / `scheduled` / `medal_generated` / `stage_summary_generated`。

## API 设计

- `GET /api/v1/growth-profile`
  返回当前用户成长画像，若不存在则返回空画像结构，不强制生成。

- `POST /api/v1/growth-profile/refresh`
  手动刷新当前用户画像。可选参数：`scope=all|recent`。M8 先支持 `all`。

- `GET /api/v1/growth-insights`
  分页返回当前用户洞察记录。

后续可扩展但 M8 不做：

- `GET /api/v1/users/:id/growth-profile/public`
- 画像公开范围设置。

## Agent 设计

新增 Agent 能力：

- `POST /growth/profile`
  输入用户近期奖章、阶段总结、经历摘要，输出结构化画像。

输出 schema 建议：

- `summary`：整体成长画像总结。
- `traitKeywords`：人格特质关键词，5-10 个。
- `growthKeywords`：成长关键词，5-10 个。
- `experienceTypes`：经历类型及权重。
- `emotionTrends`：情绪趋势摘要。
- `insights`：本次提取的 2-5 条洞察。
- `evidence`：引用的 medal/stage/experience ID 列表。

Prompt 原则：

- 不做心理诊断，不给医疗/人格定型结论。
- 用“从记录中呈现出……”而不是“你就是……”。
- 允许画像为空或低置信，避免根据少量记录过度总结。
- 必须引用已有记录，不编造事件。

## Worker 设计

新增任务类型：

- `growth_profile.refresh_user`
  刷新单个用户画像。

触发点：

- 手动刷新接口入队或同步执行。
- 奖章生成成功后入队。
- 阶段总结生成成功后入队。
- 每周低频定时全量刷新活跃用户。

执行策略：

- M8 先做低成本实现：每次刷新读取最近 N 条奖章与阶段总结，生成完整覆盖画像。
- 使用 `Unique` 防止同一用户短时间重复刷新。
- Agent 调用失败时记录任务错误，不影响奖章/阶段总结主流程。

## 前端设计

个人主页新增“成长档案”区域：

- 画像总结卡片。
- 人格特质关键词。
- 成长关键词。
- 经历类型分布。
- 最近洞察列表。
- 手动刷新按钮。

展示原则：

- 默认仅本人可见。
- 信息表达克制，不做“人格标签审判”。
- 画像不足时展示空态：继续记录经历后再生成画像。

Feed 增强：

- `similar`：优先匹配当前用户成长关键词、经历类型、记忆重量相近的公开奖章。
- `for-you`：混合关注、热门、相似，M8 可用简单加权排序。

## 分阶段实现

### M8.1 后端数据模型与 DTO

- 新增 `GrowthProfile`、`GrowthInsight` GORM models。
- 注册 AutoMigrate。
- 新增 DTO 与 response mapper。
- 增加基础单测覆盖 JSON 字段 marshal/unmarshal helper。

验收：

- `go test ./...` 通过。
- 数据表可由 AutoMigrate 创建。

### M8.2 Agent 画像提取能力

- 新增 `growth-profile` prompt。
- 新增 Zod schema。
- 新增 graph/service 组装输入上下文。
- 新增 `/growth/profile` route。

验收：

- Agent `typecheck` / `lint` / `build` 通过。
- malformed JSON 会被 schema 拒绝。

### M8.3 Go API 画像服务

- 新增 domain service：收集用户奖章、阶段总结、经历摘要，调用 Agent，持久化画像和洞察。
- 新增 `GET /growth-profile`、`POST /growth-profile/refresh`、`GET /growth-insights`。
- 手动刷新需要鉴权，只能刷新当前用户。

验收：

- 当前用户只能读写自己的画像。
- Agent 失败时返回明确错误，不写入半成品。
- 空数据用户返回空画像或 422，不崩溃。

### M8.4 Worker 刷新任务

- 新增 `growth_profile.refresh_user`。
- 奖章生成成功、阶段总结生成成功后 best-effort 入队。
- 定时任务每周刷新活跃用户。

验收：

- 同一用户短时间重复触发只入队一次或幂等执行。
- 主流程不因画像刷新失败而失败。

### M8.5 前端成长档案

- 新增 growth API client。
- 个人主页接入成长档案卡片。
- 支持手动刷新与空态。
- 展示最近洞察。

验收：

- Web `typecheck` / `lint` / `build` 通过。
- 无画像、刷新中、刷新失败、刷新成功四种状态都有可见反馈。

### M8.6 Feed 推荐增强

- 后端 `similar` 基于画像关键词/经历类型做粗匹配。
- 后端 `for-you` 混合 latest/popular/following/similar 简单加权。
- 保持公开可见性过滤。

验收：

- 私密奖章不会出现在任何推荐流。
- 无画像用户退化到现有排序。
- 有画像用户的 `similar` 结果优先出现主题相近内容。

### M8.7 全量校验与总结

- Go：`test` / `vet` / `build`。
- Agent：`typecheck` / `lint` / `build`。
- Web：`typecheck` / `lint` / `build`。
- 更新本文档状态、完成摘要、遗留问题。
- 提交代码与文档。

## 风险与取舍

- 画像可能过度解读用户：Prompt 和 UI 必须使用低断言表达，并允许低置信/空画像。
- 推荐质量可能有限：M8 不上 embedding，先做关键词粗匹配，保证可解释和低成本。
- JSON 字段查询能力有限：M8 先以简单 marshal + 应用层过滤为主，必要时增加冗余 normalized keyword 表。
- Agent 成本增加：画像刷新必须异步、限频、可去重。
- 隐私风险：M8 默认画像仅本人可见，不进入社交流公开字段。

## 当前建议

先实现 M8.1-M8.3，打通“手动刷新成长画像”的最小闭环；再做 Worker 触发和前端展示；最后增强 Feed。这样即使推荐增强延期，成长画像本身也能独立交付。
