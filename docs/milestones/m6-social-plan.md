# Milestone 6 实现路线：社交流（Feed / 轻互动 / 关注好友 / 通知）

> ✅ **状态：已完成（2026-06-30）**。9 个阶段全部落地，Go `build/vet/test` 与前端 `typecheck/lint/build` 全过。完成总结见文末「实现总结」。

## 背景与现状核实

我已核实代码库真实状态，M1–M5 已落地，M6 的**数据层完全就绪、API 层与前端完全缺失**：

- ✅ 数据库 models 已全部定义并已注册 AutoMigrate：`MedalInteraction`、`FollowRelation`(表名 `follows`)、`FriendRelation`(表名 `friendships`)、`Notification`（`apps/api/internal/database/models.go`）。
- ✅ shared 类型已定义：`InteractionType`、`MedalInteraction`、`FollowRelation`、`FriendRelation`、`FriendshipStatus`、`Notification`、`PaginatedResponse`（`packages/shared/src/types.ts`）。
- ❌ 后端无任何社交/feed/通知的 router、handler、dto。`router.go` 路由到 assets 为止。
- ❌ 前端 `HomePage.tsx` 的 5 个 Tab 是**假 feed**：只读本地 `medalStore` 里当前用户自己的奖章，5 个 Tab 渲染同一份数据，未调用任何后端。
- ❌ `NotificationsPage.tsx`（24 行）是空壳；`features/` 下无 `social`/`feed`/`notifications` 目录。

结论：M6 = 补齐后端 API + 真实 feed 查询 + 通知写入 + 前端对接。范围按确认为**完整 M6 全做**。

## 设计决策

1. **分页统一约定**：feed/通知列表用 `?page=1&page_size=20`，返回 `PaginatedResponse<T>`（`{data,total,page,page_size}`），契合 shared 已有类型。
2. **互动幂等**：`medal_interactions` 对 `(medal_id, user_id, type)` 唯一，重复 applaud 不报错（幂等 upsert）。需补一个唯一索引（当前 model 只有单列 index）。
3. **通知为站内表**：所有社交事件（被关注、奖章被互动、好友申请/通过）写入 `notifications` 表。MVP 不接 push，与 PRD「默认克制，仅站内」一致。通知写入与触发动作放在**同一事务**，失败不阻塞主操作（best-effort，记日志）。
4. **feed 只暴露公开内容**：feed 查询统一 `visibility = 'public'`，权限过滤在 Go API 完成，前端不重复判断（符合技术方案约束）。
5. **好友可见性**：本里程碑实现好友关系 CRUD 与 `friends` feed tab 的查询；字段级 `friends` 可见性过滤复用 M5 已有的 visibility 逻辑。
6. **viewer 上下文**：feed 接口在已登录时附带「我是否已点赞/已关注」状态，复用 `currentViewerID` helper。

## 分阶段实现

### 阶段 M6.1 — 后端：轻互动（interactions）

**新增文件**

- `apps/api/internal/http/dto/social.go`：`InteractionResponse`、`InteractionCountResponse`、`CreateInteractionRequest{ type oneof=applaud relate brave memorable favorite }`。
- `apps/api/internal/http/handlers/social.go`：`SocialHandler` 结构体 + 构造函数（持有 `db`、`logger`）。
  - `POST /medals/:id/interactions`：校验奖章存在且为 public（或本人），幂等创建互动，写「奖章被互动」通知给奖章作者（非自己时），返回该奖章各 type 计数。
  - `DELETE /medals/:id/interactions/:type`：删除当前用户该 type 互动。

**改动**

- `models.go`：`MedalInteraction` 加复合唯一索引 `uniqueIndex:idx_interaction`（`medal_id`+`user_id`+`type`），AutoMigrate 自动应用。
- `router.go`：注册上述 2 路由（authRequired 组）；构造 `socialHandler`。

**验证**：`go build ./... && go vet ./...`。

### 阶段 M6.2 — 后端：关注 / 好友（follows / friendships）

**新增**

- `dto/social.go` 追加：`FollowStatusResponse`、`FriendRequestResponse`、`FriendListItem`。
- `handlers/social.go` 追加：
  - `POST /users/:id/follow` / `DELETE /users/:id/follow`：幂等，禁止自关注；关注成功写通知给被关注者。
  - `POST /friends/:id/request`（创建 pending）/ `POST /friends/:id/accept` / `POST /friends/:id/reject`：状态机校验，accept 时写通知。
  - `GET /me/following`、`GET /me/followers`、`GET /me/friends`：列表查询，join users 取昵称头像。

**改动**：`models.go` 的 `FollowRelation` 唯一索引已具备（`idx_follow`）；`FriendRelation` 同理（`idx_friend`）。`router.go` 注册路由。

**验证**：`go build`、`go vet`，并对状态机写一个 `social_test.go`（见 M6.5）。

### 阶段 M6.3 — 后端：Feed 查询

**新增**

- `dto/social.go` 追加 `FeedItemResponse`（奖章外层信息 + 作者 nickname/avatar + 互动计数 + viewer 是否已互动/已关注作者）。
- `handlers/feed.go`：`FeedHandler`，单入口 `GET /feed?tab=&page=&page_size=`，按 tab 分派：
  - `latest`：public 奖章按 `created_at DESC`。
  - `following`：当前用户关注对象的 public 奖章。
  - `popular`：按互动数 + 时间衰减排序（MVP：`COUNT(interactions)` 为主，`created_at` 次序）。
  - `similar`：MVP 先退化为 latest（PRD 允许「先做入口」），预留 TODO。
  - `for-you`：MVP 混合 latest + popular（PRD 允许）。
  - 统一返回 `PaginatedResponse`，附 viewer 互动/关注状态（批量查询避免 N+1）。

**改动**：`router.go` 注册 `/feed`（authRequired）。

**验证**：`go build`、`go vet`。

### 阶段 M6.4 — 后端：通知 API

**新增**

- `dto/social.go` 追加 `NotificationResponse`。
- `handlers/notification.go`：`NotificationHandler`
  - `GET /notifications?page=&page_size=`：当前用户通知倒序，含 `is_read`。
  - `GET /notifications/unread-count`：未读数（给前端红点）。
  - `POST /notifications/:id/read`、`POST /notifications/read-all`。
- `handlers/notify.go`：内部 helper `writeNotification(tx, userID, type, title, body, data)`，供 social/feed handler 复用，统一 best-effort 写入。

**改动**：`router.go` 注册通知路由。

**验证**：`go build`、`go vet`。

### 阶段 M6.5 — 后端测试

**新增 `apps/api/internal/http/handlers/social_test.go`**（项目当前零测试，这里建立 handler 测试基线）：

- 用 SQLite in-memory（`gorm.io/driver/sqlite`）或 dockertest 起 PG。**优先 SQLite**（无需 Docker，CI 友好；注意 UUID default 用 BeforeCreate 已兼容）。
- 覆盖：互动幂等、禁止自关注、好友状态机（pending→accepted）、feed 公开过滤（私密奖章不出现在 latest）、通知写入。
- 若 SQLite 与 `jsonb`/`uuid_generate_v4()` 不兼容，则测试中改用 `gorm` 的 `AutoMigrate` + Go 侧生成 UUID（`Base.BeforeCreate` 已支持），并跳过 jsonb 列断言。

**验证**：`go test ./...`。

### 阶段 M6.6 — 前端：API 客户端层

**新增**

- `apps/web/src/features/social/socialApi.ts`：`createInteraction`、`deleteInteraction`、`followUser`、`unfollowUser`、`requestFriend`、`acceptFriend`、`rejectFriend`、`listFollowing/Followers/Friends`。
- `apps/web/src/features/feed/feedApi.ts`：`getFeed(tab, page, pageSize)`。
- `apps/web/src/features/notifications/notificationApi.ts`：`listNotifications`、`getUnreadCount`、`markRead`、`markAllRead`。
- shared 类型补充：`FeedItem`、`InteractionCount`、`NotificationResponse`（若与现有 `Notification` 不同则新增 response 类型），并在 `types.ts` 导出。

**验证**：`pnpm --filter @earth-online/shared build`、`pnpm typecheck`。

### 阶段 M6.7 — 前端：HomePage 真实 Feed

**改动 `HomePage.tsx`**

- 用 TanStack Query 按 `activeTab` 调 `getFeed`，替换 `useMedalStore` 假数据。
- 5 个 tab 值与后端对齐（`following/latest/popular/similar/for-you`，注意现状是 `hot/recommend`，需统一）。
- feed 卡片新增轻互动按钮（鼓掌/我也经历过/这很勇敢/这值得记住），点击调 `createInteraction`，乐观更新计数。
- 空态、加载态、分页（「加载更多」或滚动）。

**新增**：`apps/web/src/features/feed/FeedCard.tsx`（抽出卡片组件，含互动按钮）。

**验证**：`pnpm --filter @earth-online/web build`。

### 阶段 M6.8 — 前端：通知页 + 关注/好友入口

**改动**

- `NotificationsPage.tsx`：列表 + 已读/全部已读 + 空态，对接 `notificationApi`。
- `AppLayout.tsx`：通知入口加未读红点（轮询 `getUnreadCount` 或进入页面刷新）。
- `ProfilePage.tsx`：他人主页加「关注/取消关注」「加好友」按钮（对接 socialApi），自己主页加「关注数/粉丝数」。

**验证**：`pnpm typecheck`、`pnpm --filter @earth-online/web build`、`pnpm lint`。

### 阶段 M6.9 — 全量校验与收尾

- `go build ./... && go vet ./... && go test ./...`
- `pnpm -r typecheck && pnpm -r lint && pnpm -r build`
- 更新 `docs/technical-plan.md` 里程碑勾选（可选）。
- 不提交、不 push，等你 review。

## 不在本次范围（按 PRD 后续迭代）

- 推荐算法升级（pgvector、用户画像）——similar/for-you 先用降级实现。
- push 通知 / 站外提醒。
- 评论系统（PRD 列为长期，MVP 只做轻互动）。
- 共鸣关系。

## 风险与权衡

- **测试基建**：项目当前零测试。M6.5 引入 SQLite 内存测试是最低成本方案；若 GORM model 的 PG 专属类型（jsonb/uuid default）在 SQLite 下迁移失败，回退为「仅对纯业务逻辑函数做单测 + 手动验证查询」，不强行硬凑。这一步若受阻不会阻塞其余阶段。
- **feed 排序性能**：MVP 用 SQL `COUNT` + 排序即可，数据量小。预留索引（interactions 的 medal_id、follows 的 follower_id 已有 index）。
- **tab 命名变更**：HomePage 现有 `hot/recommend` 改为 `popular/for-you`，属前端内部改动，无外部依赖。

## 实现总结

### 后端（apps/api）

- **models.go**：`MedalInteraction` 加复合唯一索引 `idx_interaction`（medal_id+user_id+type）保证幂等；`Base.ID` 默认值改为 `default:(uuid_generate_v4())`（加括号），Postgres 语义不变，同时兼容 SQLite 测试迁移。
- **dto/social.go**：新增互动、关注/好友、Feed、通知全部响应/请求结构。
- **handlers/social.go**：轻互动 `POST/DELETE /medals/:id/interactions`，幂等 + 公开校验 + 通知作者。
- **handlers/follow.go**：关注/取关、好友申请/接受/拒绝（状态机校验，仅 addressee 可处理）、关注/粉丝/好友列表。
- **handlers/feed.go**：`GET /feed?tab=&page=&page_size=`，latest/following/popular 真实查询，similar→latest、for-you→popular 降级；批量查询消除 N+1，附 viewer 互动/关注状态。
- **handlers/notification.go**：通知分页列表、未读数、单条/全部已读；`data` 字段以 `json.RawMessage` 透出为对象。
- **handlers/notify.go**：`writeNotification` best-effort helper，失败只记日志不阻塞主流程。
- **router.go**：注册以上全部路由。

### 测试（apps/api）— 项目首个测试基线

- **handlers/social_test.go**：基于 `github.com/glebarez/sqlite`（纯 Go，无 cgo）内存库，8 个用例覆盖：互动幂等、私密奖章拒绝、禁止自关注、关注幂等+通知、好友状态机（pending→accepted、非 addressee 403、重复 accept 409）、Feed 排除私密、关注流空态、通知投递+未读数。全部通过。

### 前端（apps/web + packages/shared）

- **shared/types.ts**：新增 `InteractionCountResponse`、`UserSummary`、`FollowStatusResponse`、`FriendRequestResponse`、`FriendListItem`、`FeedItem`、`FeedTab`、`NotificationResponse`。
- **features/feed/feedApi.ts、social/socialApi.ts、notifications/notificationApi.ts**：完整 API 客户端层。
- **features/feed/FeedCard.tsx**：奖章卡片 + 4 种轻互动按钮（鼓掌/我也经历过/这很勇敢/这值得记住），乐观更新 + 服务端计数纠正。
- **pages/HomePage.tsx**：替换假数据为真实 Feed，tab 对齐后端（latest/following/popular/similar/for-you），加载/错误/空态。
- **pages/NotificationsPage.tsx**：真实通知列表 + 单条/全部已读。
- **pages/UserProfilePage.tsx**（新增）+ `/users/:id` 路由：他人主页，关注/取关 + 加好友 + 公开奖章墙。
- **components/layout/AppLayout.tsx**：通知入口未读红点（60s 轮询）。
- **pages/ProfilePage.tsx**：自己主页加关注数/粉丝数。

### 验证

- Go：`go build ./...`、`go vet ./...`、`go test ./...` 全过（8 测试用例）。
- 前端：`pnpm -r typecheck`、`pnpm -r lint`、`pnpm -r build` 全过。

### 与原计划的偏差

- 计划未明确「查看他人主页」入口；实现时补了 `UserProfilePage` + `/users/:id` 路由，否则关注/加好友按钮无处安放。这是为闭环可用做的必要补充。
