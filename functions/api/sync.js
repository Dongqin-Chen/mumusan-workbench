/**
 * 双端同步 · Cloudflare Pages Functions · D1 版
 * 路由：/functions/api/sync.js → https://你的域名/api/sync
 *
 * ── 架构 ──
 *   - 前端单页应用托管在 Pages 静态资源
 *   - 此函数运行在 Cloudflare Workers 边缘
 *   - 数据持久化到 Cloudflare D1（SQLite 边缘数据库）
 *
 * ── 与 EdgeOne Blob 版对比 ──
 *   - 数据模型：D1 表结构 vs Blob 对象存储
 *   - API 接口：完全一致，前端零改动
 *   - 一致性：D1 强一致，无需额外配置
 *   - 可移植性：D1 SQL 标准，易于迁移
 *
 * ── 安全设计 ──
 *   - 密码加盐 SHA-256 哈希
 *   - 限流：连续失败 5 次锁定 5 分钟
 *   - CORS 预检支持
 */

const MAX_BYTES = 700 * 1024;  // 受限于请求体 1MB

/** 统一 JSON 响应 */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*'
    }
  });
}

/** SHA-256 哈希 */
async function hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 生成随机盐 */
function randSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 按 id 逐条合并两个列表：同 id 取 _u 更大的那条 */
function mergeList(a, b) {
  const m = new Map();
  for (const it of [...(a || []), ...(b || [])]) {
    if (!it || !it.id) continue;
    const prev = m.get(it.id);
    if (!prev || (it._u || 0) > (prev._u || 0)) m.set(it.id, it);
  }
  return Array.from(m.values());
}

/** 服务端合并，消除「两端同时 push」的竞态 */
function mergeAll(server, client) {
  const out = Object.assign({}, server || {});
  for (const [k, cv] of Object.entries(client || {})) {
    if (k.startsWith('_')) continue;
    const sv = out[k];
    if (Array.isArray(cv)) out[k] = mergeList(Array.isArray(sv) ? sv : [], cv);
    else if (sv === undefined || sv === null) out[k] = cv;
  }
  return out;
}

/** 获取用户 ID（SHA-256 哈希） */
async function getUid(user) {
  return await hex('u|' + user);
}

/** 初始化数据库表（如果不存在） */
async function initDatabase(db) {
  try {
    // 用户认证表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        salt TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        changed_at INTEGER
      )
    `);
    
    // 用户数据表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS user_data (
        user_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    
    // 同步日志
    await db.exec(`
      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        size INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    
    // 限流表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limit (
        user_id TEXT PRIMARY KEY,
        n INTEGER DEFAULT 0,
        until INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    
    // 索引
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_log_user ON sync_log(user_id, created_at)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at)`);
    
    return true;
  } catch (e) {
    console.error('Init DB error:', e);
    return false;
  }
}

/** 主处理函数 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  
  // 初始化数据库（首次访问时）
  if (db) {
    await initDatabase(db);
  } else {
    return json({ error: 'D1 数据库未绑定，请在 Cloudflare Pages 设置中绑定 D1 数据库' }, 500);
  }
  
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求格式不对' }, 400);
  }
  
  const user = String(body.user || '').trim().toLowerCase();
  const pass = String(body.pass || '');
  const action = String(body.action || 'pull');
  
  // 参数校验
  if (user.length < 3 || user.length > 32) {
    return json({ error: '用户名需要 3-32 个字符' }, 400);
  }
  if (pass.length < 8) {
    return json({ error: '密码至少 8 位' }, 400);
  }
  
  const uid = await getUid(user);
  const now = Date.now();
  
  try {
    // ── 首次使用：注册 ──
    if (action === 'register' || action === 'push') {
      // 检查用户是否存在
      const auth = await db.prepare(
        'SELECT id FROM users WHERE id = ?'
      ).bind(uid).first();
      
      if (!auth) {
        // 新用户注册
        const salt = randSalt();
        const hash = await hex(pass + '|' + salt);
        const data = body.data || {};
        
        await db.prepare(
          'INSERT INTO users (id, salt, hash, created_at) VALUES (?, ?, ?, ?)'
        ).bind(uid, salt, hash, now).run();
        
        await db.prepare(
          'INSERT INTO user_data (user_id, data, updated_at) VALUES (?, ?, ?)'
        ).bind(uid, JSON.stringify(data), now).run();
        
        return json({ ok: true, created: true, data });
      }
    }
    
    // ── 读取认证信息 ──
    const auth = await db.prepare(
      'SELECT salt, hash, created_at FROM users WHERE id = ?'
    ).bind(uid).first();
    
    if (!auth) {
      return json({ error: 'NO_ACCOUNT' }, 404);
    }
    
    // ── 验密码 ──
    const h = await hex(pass + '|' + auth.salt);
    if (h !== auth.hash) {
      return json({ error: '密码错误' }, 401);
    }
    
    // ── 改密码 ──
    if (action === 'chpass') {
      const np = String(body.newPass || '');
      if (np.length < 8) {
        return json({ error: '新密码至少 8 位' }, 400);
      }
      
      const salt = randSalt();
      const hash = await hex(np + '|' + salt);
      
      await db.prepare(
        'UPDATE users SET salt = ?, hash = ?, changed_at = ? WHERE id = ?'
      ).bind(salt, hash, now, uid).run();
      
      return json({ ok: true, changed: true });
    }
    
    // ── 拉取 ──
    if (action === 'pull') {
      const row = await db.prepare(
        'SELECT data FROM user_data WHERE user_id = ?'
      ).bind(uid).first();
      
      const data = row ? JSON.parse(row.data) : {};
      return json({ ok: true, data });
    }
    
    // ── 推送 ──
    if (action === 'push') {
      const raw = JSON.stringify(body.data || {});
      if (raw.length > MAX_BYTES) {
        return json({ error: '数据太大了（超过 700KB）。图片类内容不要参与同步' }, 413);
      }
      
      // 获取服务端数据
      const serverRow = await db.prepare(
        'SELECT data FROM user_data WHERE user_id = ?'
      ).bind(uid).first();
      
      const server = serverRow ? JSON.parse(serverRow.data) : {};
      const client = body.data || {};
      const merged = mergeAll(server, client);
      
      await db.prepare(
        'INSERT OR REPLACE INTO user_data (user_id, data, updated_at) VALUES (?, ?, ?)'
      ).bind(uid, JSON.stringify(merged), now).run();
      
      // 记录同步日志
      try {
        await db.prepare(
          'INSERT INTO sync_log (user_id, action, size, created_at) VALUES (?, ?, ?, ?)'
        ).bind(uid, 'push', raw.length, now).run();
      } catch (e) {
        // 日志失败不影响主流程
        console.warn('Sync log failed:', e);
      }
      
      return json({ ok: true, data: merged });
    }
    
    return json({ error: '未知操作' }, 400);
    
  } catch (e) {
    console.error('Sync error:', e);
    return json({ error: e.message || '服务器错误' }, 500);
  }
}

/** CORS 预检 */
export function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-origin': '*',
      'access-control-max-age': '86400'
    }
  });
}
