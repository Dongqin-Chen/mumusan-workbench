# 木木三工作台 · Cloudflare 部署操作手册

> 适用场景：当前终端缺少 Node.js/npm，改走 Cloudflare 网页端 + 最小本地命令完成部署

---

## 第一步：获取 API Token（网页端）

1. 打开 https://dash.cloudflare.com/profile/api-tokens
2. 点击 **Create Token**
3. 选择 **Edit Cloudflare Workers** 模板（或自定义，给 Cloudflare Pages 和 D1 的编辑权限）
4. 创建后复制 Token（只会显示一次）

把 Token 发给我，我继续后续步骤。

---

## 第二步：创建 D1 数据库（网页端或CLI）

如果你已经拿到 Token，在终端执行：

```bash
set CLOUDFLARE_API_TOKEN=你的Token
npx wrangler d1 create mumusan-workbench-db
```

如果终端还是不行，也可以在网页端：
1. 打开 https://dash.cloudflare.com/d1
2. 点击 **Create database**
3. 名称填 `mumusan-workbench-db`
4. 创建后复制 `database_id`

---

## 第三步：创建 Cloudflare Pages 项目（网页端）

1. 打开 https://dash.cloudflare.com/pages
2. 点击 **Create a project** → **Direct Upload**
3. 项目名填 `mumusan-workbench`
4. 上传时选择整个 `mumusan-workbench` 文件夹
5. 构建命令留空，输出目录填 `/`

---

## 第四步：绑定 D1 到 Pages

1. Pages 项目创建后，进入 **Settings** → **Functions**
2. 找到 **D1** 部分，点击 **Add binding**
3. Binding name 填 `DB`
4. 选择刚创建的 `mumusan-workbench-db`

---

## 第五步：配置 Functions

在 Pages 项目根目录创建 `functions` 文件夹结构，上传以下文件：

```
functions/
└── api/
    └── sync.js
```

---

## 第六步：验证部署

访问 `https://mumusan-workbench.pages.dev/api/sync`，应返回 JSON。

---

## 备选方案：使用 Git 部署

如果你有 GitHub 账号：

1. 将 `mumusan-workbench` 文件夹推送到 GitHub
2. 在 Cloudflare Pages 选择 **Connect to Git**
3. 自动部署，无需手动上传

---

## 需要我帮你什么

- [ ] 生成 API Token 后告诉我，我帮你创建 D1
- [ ] 或者你把 `database_id` 告诉我，我更新配置
- [ ] 或者你上传 GitHub，我指导 Cloudflare 连接
