# 木木三工作台 · Cloudflare Pages + D1 部署指南

> 版本：v1.0.0  
> 来源：EdgeOne Pages + Blob → Cloudflare Pages + D1  
> 日期：2026-11-08  
> 状态：已完成编码，待部署验证

---

## 一、部署前检查

### 1.1 已完成的工作

- [x] 架构分析报告：`木木三工作台_架构分析.md`
- [x] Cloudflare 边缘函数：`functions/api/sync.js`（D1 版）
- [x] D1 迁移脚本：`migrations/0001_init.sql`
- [x] Wrangler 配置：`wrangler.toml`
- [x] 前端入口：`index.html`（已复制，API 路径不变）
- [x] PWA 资源：`dist/manifest.json`、`dist/icon.png`
- [x] 部署说明：本文档

### 1.2 核心变更

| 项目 | 原方案 | 新方案 |
|------|--------|--------|
| 托管 | EdgeOne Pages | Cloudflare Pages |
| 边缘函数 | EdgeOne Functions | Cloudflare Pages Functions |
| 持久化 | EdgeOne Pages Blob | Cloudflare D1 |
| API 路由 | `/api/sync` | `/api/sync`（不变） |
| 前端改动 | 无 | 无（完全兼容） |

---

## 二、Cloudflare 环境准备

### 2.1 登录 Cloudflare

```bash
wrangler login
```

浏览器会打开 Cloudflare 登录页面，授权后返回。

### 2.2 创建 D1 数据库

```bash
cd C:/Users/陈彬洲/WorkBuddy/2026-11-08-09-07-04/mumusan-workbench

wrangler d1 create mumusan-workbench-db
```

执行后会返回类似：

```
✅ Successfully created DB 'mumusan-workbench-db'
   database_id: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**重要**：复制 `database_id`，更新到 `wrangler.toml`。

### 2.3 更新 wrangler.toml

```bash
# 编辑 wrangler.toml，将 database_id 替换为实际值
# [[d1_databases]]
# binding = "DB"
# database_name = "mumusan-workbench-db"
# database_id = "你的实际数据库ID"
```

---

## 三、数据库初始化

### 3.1 本地测试（可选）

```bash
# 初始化本地 D1
wrangler d1 migrations apply mumusan-workbench-db --local
```

### 3.2 生产环境部署

部署时 Cloudflare Pages 会自动运行迁移。如需手动执行：

```bash
wrangler d1 migrations apply mumusan-workbench-db
```

---

## 四、部署到 Cloudflare Pages

### 方式一：Git 部署（推荐）

1. 将 `mumusan-workbench` 目录推送到 GitHub/GitLab
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
3. 进入 **Pages** → **Create a project**
4. 连接 Git 仓库
5. 构建设置：
   - Build command: `echo "No build needed"`
   - Build output directory: `/`
   - Node version: 18+（可选）
6. 环境变量：
   - 无需额外环境变量
7. 点击 **Save and Deploy**

### 方式二：CLI 直接部署

```bash
# 直接部署当前目录
wrangler pages project create mumusan-workbench
wrangler pages deploy
```

---

## 五、前端适配说明

### 5.1 已完成的适配

- [x] API 路径保持 `/api/sync`（Cloudflare Pages Functions 默认路径）
- [x] 请求/响应格式完全兼容 EdgeOne 版本
- [x] 无需修改前端代码

### 5.2 WorkBuddy 云服务集成

工作台已集成 WorkBuddy 云服务 SDK，配置如下：

```javascript
const publicConfig = {
  resourceId: "wbcs_AGzVEIIGoQ4afNq2YSOEei",
  endpoint: "https://mumusans-workbench.app.workbuddy.host",
  oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
  publishableKey: "wbpk_eEC5gw6z71zUedRN5okliK_QZ32MFw56qlQaFX3u3et9YnQYm50N0e5"
};
```

**WorkBuddy 迭代修改同步机制**：
- WorkBuddy 修改工作台数据时，调用 `Store.set()` / `Store.upsert()` 等 API
- 这些操作会触发 `Store._touch()` → `Sync.schedule()` → `Sync.push()`
- `Sync.push()` 会调用 `/api/sync` 推送数据到 Cloudflare D1
- 手机端和电脑端通过 `Sync.pull()` 拉取最新数据，确保跨设备同步

---

## 六、验证测试

### 6.1 基础功能测试

```bash
# 启动本地开发服务器
wrangler pages dev
```

访问 `http://localhost:8788`，测试：
- [ ] 页面正常加载
- [ ] PWA 安装正常
- [ ] 基础交互无异常

### 6.2 同步功能测试

1. **手机端 + 电脑端同步**
   - 手机端：开启同步 → 添加今日事项
   - 电脑端：刷新页面 → 验证数据已同步

2. **离线可用性**
   - 关闭网络 → 继续添加事项
   - 开启网络 → 验证自动同步

3. **数据一致性**
   - 两端同时修改 → 验证按 _u 时间戳合并

### 6.3 API 测试

```bash
# 测试注册
curl -X POST https://你的域名/api/sync \
  -H "content-type: application/json" \
  -d '{"action":"register","user":"test","pass":"test1234","data":{}}'

# 测试拉取
curl -X POST https://你的域名/api/sync \
  -H "content-type: application/json" \
  -d '{"action":"pull","user":"test","pass":"test1234"}'

# 测试推送
curl -X POST https://你的域名/api/sync \
  -H "content-type: application/json" \
  -d '{"action":"push","user":"test","pass":"test1234","data":{"todos":[]}}'
```

---

## 七、数据迁移

### 7.1 存量数据迁移

当前 EdgeOne Blob 中的数据：

```javascript
// 在浏览器控制台执行，导出 EdgeOne 数据
const blobData = await fetch('/api/sync', {
  method: 'POST',
  headers: {'content-type': 'application/json'},
  body: JSON.stringify({
    action: 'pull',
    user: '你的用户名',
    pass: '你的密码'
  })
}).then(r => r.json());

console.log('EdgeOne 数据：', blobData);
```

### 7.2 导入 Cloudflare D1

迁移脚本将自动处理：
- 用户认证数据迁移
- 工作台数据合并
- 软删除墓碑保留

**注意**：用户无需手动迁移，首次在新平台 push 时自动合并。

---

## 八、监控与维护

### 8.1 查看同步日志

```bash
# 查询特定用户的同步记录
wrangler d1 execute mumusan-workbench-db \
  --command "SELECT * FROM sync_log WHERE user_id = '你的用户ID' ORDER BY created_at DESC LIMIT 10"
```

### 8.2 性能监控

- Cloudflare Dashboard → Pages → Analytics
- 关注：请求量、错误率、边缘函数执行时间

### 8.3 备份策略

- **自动备份**：Cloudflare D1 自动多副本
- **手动备份**：定期导出 JSON 备份（工作台设置页）
- **跨平台备份**：保留 EdgeOne 版本作为灾备

---

## 九、常见问题

### Q1: 部署后 404？

检查 `wrangler.toml` 中的 `pages_build_output_dir` 是否正确。

### Q2: D1 绑定失败？

确认 `database_id` 正确，且数据库在同一个 Cloudflare 账户下。

### Q3: 数据同步慢？

D1 是边缘数据库，全球访问延迟通常 < 50ms。如果慢，检查：
- 数据量是否超过 700KB
- 网络是否正常
- Cloudflare Dashboard 是否有服务中断

### Q4: 如何回滚？

- Cloudflare Pages 支持版本回滚
- 保留 EdgeOne 版本作为快速回滚方案

---

## 十、下一步

1. **用户确认部署方案**
2. **创建 Cloudflare 账户并登录**（如尚未注册）
3. **执行 D1 数据库创建**
4. **部署到 Cloudflare Pages**
5. **端到端测试验证**
6. **切换 DNS（如需要）**

---

## 附录：文件清单

```
mumusan-workbench/
├── index.html              # 前端单页应用
├── package.json            # 项目配置
├── wrangler.toml           # Cloudflare 配置
├── functions/
│   └── api/
│       └── sync.js         # D1 版同步 API
├── migrations/
│   └── 0001_init.sql       # D1 数据库初始化脚本
├── dist/
│   ├── manifest.json       # PWA 清单
│   └── icon.png            # PWA 图标
└── README.md               # 部署指南
```
