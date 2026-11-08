-- 木木三工作台 D1 数据库初始化
-- 版本：v1.0.0
-- 日期：2026-11-08

-- 用户认证表
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- sha256('u|' + username)
  salt TEXT NOT NULL,            -- 随机盐（16字节hex）
  hash TEXT NOT NULL,            -- sha256(password + '|' + salt)
  created_at INTEGER NOT NULL,   -- 注册时间（毫秒时间戳）
  changed_at INTEGER            -- 最后改密时间（毫秒时间戳）
);

-- 用户数据表（JSON 存储，一条用户一条记录）
CREATE TABLE user_data (
  user_id TEXT PRIMARY KEY,      -- 关联 users.id
  data TEXT NOT NULL,            -- JSON 字符串
  updated_at INTEGER NOT NULL,   -- 最后更新时间（毫秒时间戳）
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 同步日志（审计和调试）
CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,          -- pull / push / register / chpass
  size INTEGER,                  -- 数据大小（字节）
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 限流表（替代原 KV 方案）
CREATE TABLE rate_limit (
  user_id TEXT PRIMARY KEY,
  n INTEGER DEFAULT 0,        -- 失败次数
  until INTEGER DEFAULT 0,    -- 锁定截止时间
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 索引
CREATE INDEX idx_sync_log_user ON sync_log(user_id, created_at);
CREATE INDEX idx_users_created ON users(created_at);
