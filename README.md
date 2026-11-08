# 木木三工作台 · Cloudflare Pages + D1 部署指南

> 版本：v1.0.0  
> 迁移自：EdgeOne Pages + Blob  
> 日期：2026-11-08

---

## 快速开始

### 1. 环境准备

```bash
# 安装 Wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login
```

### 2. 初始化 D1 数据库

```bash
# 创建 D1 数据库（仅首次）
wrangler d1 create mumusan-workbench-db

# 复制返回的 database_id，更新 wrangler.toml
```

### 3. 运行数据库迁移

```bash
# 本地测试迁移
wrangler d1 migrations apply mumusan-workbench-db --local

# 生产环境迁移（部署前执行）
wrangler d1 migrations apply mumusan-workbench-db
```

### 4. 本地开发

```bash
cd mumusan-workbench
npm install
wrangler pages dev
```

### 5. 部署到 Cloudflare Pages

```bash
# 方式一：通过 Git 部署（推荐）
# 将项目推送到 GitHub/GitLab，在 Cloudflare Pages 控制台连接仓库

# 方式二：通过 CLI 部署
wrangler pages project create mumusan-workbench
wrangler pages deploy
```

---

## 项目结构

```
mumusan-workbench/
├── index.html              # 前端单页应用
├── package.json            # 项目配置
├── wrangler.toml           # Cloudflare 配置
├── functions/
│   └── api/
│       └── sync.js         # /api/sync 边缘函数
├── migrations/
│   └── 0001_init.sql       # D1 数据库初始化
└── README.md
```

---

## API 接口

### POST /api/sync

**请求体：**
```json
{
  "action": "register|pull|push|chpass",
  "user": "用户名",
  "pass": "密码",
  "newPass": "新密码（chpass 时使用）",
  "data": {}  // push 时使用，用户完整数据
}
```

**响应：**
```json
{
  "ok": true,
  "data": {}  // pull/push 时返回合并后的数据
}
```

---

## 数据模型

### D1 表结构

| 表 | 说明 |
|----|------|
| users | 用户认证（id, salt, hash, created_at, changed_at） |
| user_data | 用户数据（JSON 存储，一条用户一条记录） |
| sync_log | 同步日志（审计用） |
| rate_limit | 限流（失败次数和锁定时间） |

---

## 与 EdgeOne 版本的兼容性

### 已兼容
- ✅ 请求/响应格式完全一致
- ✅ 密码哈希算法一致（SHA-256）
- ✅ 合并策略一致（按 _u 时间戳合并）
- ✅ 限流逻辑一致（5 次失败锁定 5 分钟）

### 需注意
- ⚠️ D1 版在限流上使用内存方案，生产环境建议接入 KV
- ⚠️ 最大数据量仍限制在 700KB
- ⚠️ 用户名哈希存储方式保持一致

---

## 部署检查清单

- [ ] Wrangler CLI 已安装并登录
- [ ] D1 数据库已创建
- [ ] wrangler.toml 中的 database_id 已更新
- [ ] 数据库迁移已运行
- [ ] index.html 已复制到项目目录
- [ ] 测试本地开发环境：`wrangler pages dev`
- [ ] 部署到 Cloudflare Pages
- [ ] 手机端和电脑端同步测试
- [ ] 离线功能验证
- [ ] 数据一致性验证

---

## 后续优化

- [ ] 接入 Cloudflare KV 实现分布式限流
- [ ] 接入 Cloudflare R2 实现图片同步
- [ ] 添加数据压缩（gzip/brotli）
- [ ] 添加操作审计日志导出
- [ ] 实现增量同步（仅传输变更部分）

---

## 技术支持

- Cloudflare Pages 文档：https://developers.cloudflare.com/pages/
- Cloudflare D1 文档：https://developers.cloudflare.com/d1/
