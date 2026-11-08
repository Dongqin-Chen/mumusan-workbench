/**
 * 双端同步 · Cloudflare Pages Functions · GitHub 版
 * 路由：/functions/api/sync.js → https://你的域名/api/sync
 *
 * ── 架构 ──
 *   - 前端单页应用托管在 Pages 静态资源
 *   - 此函数运行在 Cloudflare Workers 边缘
 *   - 数据持久化到 GitHub 仓库文件（sync-data/<uid>.json）
 *
 * ── 与 D1 版对比 ──
 *   - 存储：GitHub 文件 vs D1 数据库
 *   - API：完全一致，前端零改动
 *   - 一致性：GitHub 强一致
 *   - 优点：免费、自带版本历史、无需数据库配置
 *
 * ── 安全设计 ──
 *   - 密码加盐 SHA-256 哈希
 *   - 敏感数据（盐、哈希）与用户数据分开存储
 *   - CORS 预检支持
 */

const MAX_BYTES = 700 * 1024;  // 受限于请求体 1MB

// GitHub 配置（通过环境变量注入）
const GITHUB_TOKEN = env => env.GITHUB_TOKEN;
const GITHUB_REPO = env => env.GITHUB_REPO || 'Dongqin-Chen/mumusan-workbench';
const GITHUB_BRANCH = env => env.GITHUB_BRANCH || 'main';

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

/** 从 GitHub 读取文件内容 */
async function githubReadFile(env, path) {
  const token = GITHUB_TOKEN(env);
  if (!token) throw new Error('GITHUB_TOKEN 未配置');
  
  const url = `https://api.github.com/repos/${GITHUB_REPO(env)}/contents/${encodeURIComponent(path)}?ref=${GITHUB_BRANCH(env)}`;
  const resp = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'mumusan-workbench'
    }
  });
  
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub 读取失败: ${resp.status} ${text}`);
  }
  
  const data = await resp.json();
  if (!data.content) return null;
  
  // GitHub API 返回 base64 编码的内容
  const content = atob(data.content.replace(/\n/g, ''));
  return JSON.parse(content);
}

/** 写入文件到 GitHub */
async function githubWriteFile(env, path, content, message, sha) {
  const token = GITHUB_TOKEN(env);
  if (!token) throw new Error('GITHUB_TOKEN 未配置');
  
  const body = {
    message,
    content: btoa(JSON.stringify(content, null, 2)),
    branch: GITHUB_BRANCH(env)
  };
  
  if (sha) body.sha = sha;
  
  const url = `https://api.github.com/repos/${GITHUB_REPO(env)}/contents/${encodeURIComponent(path)}`;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'mumusan-workbench'
    },
    body: JSON.stringify(body)
  });
  
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub 写入失败: ${resp.status} ${text}`);
  }
  
  return await resp.json();
}

/** 主处理函数 */
export async function onRequestPost(context) {
  const { request, env } = context;
  
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
  const authPath = `sync-data/auth/${uid}.json`;
  const dataPath = `sync-data/data/${uid}.json`;
  
  try {
    // ── 首次使用：注册 ──
    if (action === 'register' || action === 'push') {
      const existingAuth = await githubReadFile(env, authPath);
      
      if (!existingAuth) {
        // 新用户注册
        const salt = randSalt();
        const hash = await hex(pass + '|' + salt);
        const data = body.data || {};
        
        const authResult = await githubWriteFile(env, authPath, {
          salt,
          hash,
          created_at: now,
          changed_at: null
        }, `Register user ${user}`);
        
        await githubWriteFile(env, dataPath, data, `Init data for ${user}`);
        
        return json({ ok: true, created: true, data });
      }
    }
    
    // ── 读取认证信息 ──
    const auth = await githubReadFile(env, authPath);
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
      
      // 读取现有文件 SHA（GitHub API 返回的 sha 字段）
      const existingAuth = await githubReadFile(env, authPath);
      const authSha = existingAuth ? await githubReadFile(env, authPath).then(f => f && f.sha) : undefined;
      
      await githubWriteFile(env, authPath, {
        salt,
        hash,
        created_at: auth.created_at,
        changed_at: now
      }, `Change password for ${user}`, authSha);
      
      return json({ ok: true, changed: true });
    }
    
    // ── 拉取 ──
    if (action === 'pull') {
      const data = await githubReadFile(env, dataPath) || {};
      return json({ ok: true, data });
    }
    
    // ── 推送 ──
    if (action === 'push') {
      const raw = JSON.stringify(body.data || {});
      if (raw.length > MAX_BYTES) {
        return json({ error: '数据太大了（超过 700KB）。图片类内容不要参与同步' }, 413);
      }
      
      // 获取服务端数据
      const server = await githubReadFile(env, dataPath) || {};
      const client = body.data || {};
      const merged = mergeAll(server, client);
      
      // 读取现有文件 SHA
      const existingData = await githubReadFile(env, dataPath);
      const dataSha = existingData ? existingData.sha : undefined;
      
      await githubWriteFile(env, dataPath, merged, `Sync data for ${user}`, dataSha);
      
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
