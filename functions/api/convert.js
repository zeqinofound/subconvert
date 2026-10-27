/**
 * POST /api/convert - Create a new conversion link
 *
 * Request body:
 *   {
 *     "sourceUrl": "https://example.com/sub",      // required；可填多个源，用 | 或换行分隔，输出时合并为一份订阅
 *     "targetFormat": "clash",                       // required: clash | singbox | base64 | plain
 *     "customPath": "my-sub",                        // optional, auto-generated if omitted
 *     "name": "My Subscription"                      // optional display name
 *   }
 *
 * Response:
 *   {
 *     "id": "my-sub",
 *     "sourceUrl": "...",
 *     "targetFormat": "clash",
 *     "customPath": "my-sub",
 *     "subscriptionUrl": "/sub/my-sub",
 *     "name": "My Subscription",
 *     "createdAt": 1234567890
 *   }
 */

import { createLink, pathExists } from '../_lib/store.js';
import { sanitizePath, generateId, validatePublicUrl, splitSourceUrls, isProxyUri } from '../_lib/utils.js';
import { parseSubscription } from '../_lib/sub-parse.js';
import { json, error, handleCORS } from '../_lib/response.js';
import { authenticate } from '../_lib/auth.js';

const VALID_FORMATS = ['clash', 'singbox', 'base64', 'plain'];

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await authenticate(request, env);
  if (!auth.ok) {
    if (auth.reason === 'locked') {
      return error(
        `密码错误次数过多，请 ${Math.ceil(auth.retryAfter / 60)} 分钟后再试`,
        429,
        { 'Retry-After': String(auth.retryAfter) }
      );
    }
    return error('Unauthorized: 访问密码错误或缺失', 401);
  }

  if (!env.SUBCONVERT_KV) {
    return error('KV namespace not configured. Set up SUBCONVERT_KV binding in wrangler.toml.', 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body');
  }

  const { sourceUrl, targetFormat, customPath, name, userAgent } = body;

  // Validate required fields
  if (!sourceUrl || typeof sourceUrl !== 'string') {
    return error('sourceUrl is required');
  }

  // 长度上限：所有链接都存在单个 KV value 里，超限会撑爆 25MB 上限、
  // 让全部链接一起失效。
  if (sourceUrl.length > 4096) {
    return error('sourceUrl 过长（上限 4096 字符）', 400);
  }
  if (typeof name === 'string' && name.length > 200) {
    return error('name 过长（上限 200 字符）', 400);
  }
  if (typeof userAgent === 'string' && userAgent.length > 512) {
    return error('userAgent 过长（上限 512 字符）', 400);
  }

  // Validate URL format — 支持多源合并：sourceUrl 里可以用 | 或换行
  // 分隔多个源订阅，逐个校验。抓取时（fetchSubscription）还会对每个源
  // 的重定向每一跳再校验一次。
  const sourceUrls = splitSourceUrls(sourceUrl);
  if (sourceUrls.length === 0) {
    return error('sourceUrl is required');
  }
  if (sourceUrls.length > 10) {
    return error(`源订阅最多支持 10 个（当前填了 ${sourceUrls.length} 个）`, 400);
  }
  for (let i = 0; i < sourceUrls.length; i++) {
    // 直接粘贴的节点链接（vless:// 等）：不发起抓取，没有 SSRF 风险；
    // 但要在创建时就验证它确实能解析出节点，避免存下永远报错的链接。
    if (isProxyUri(sourceUrls[i])) {
      if (parseSubscription(sourceUrls[i]).nodes.length === 0) {
        return error(`sourceUrl 中第 ${i + 1} 个节点链接无法解析，请检查是否完整`, 400);
      }
      continue;
    }

    try {
      new URL(sourceUrls[i]);
    } catch {
      return error(`sourceUrl 中第 ${i + 1} 个地址不是合法 URL`);
    }

    // SSRF 防护：服务端会去抓这些地址，必须限制为公网 http(s)。
    const guard = validatePublicUrl(sourceUrls[i]);
    if (!guard.ok) {
      return error(`sourceUrl 中第 ${i + 1} 个地址不允许：${guard.reason}`, 400);
    }
  }

  // Validate target format
  if (!targetFormat || !VALID_FORMATS.includes(targetFormat)) {
    return error(`targetFormat must be one of: ${VALID_FORMATS.join(', ')}`);
  }

  // Sanitize and validate custom path
  const rawPath = customPath ? String(customPath).trim() : '';
  let path = rawPath ? sanitizePath(rawPath) : generateId(20);

  // Reject unsupported characters explicitly instead of silently
  // generating a random path. Spaces are allowed (auto → hyphen).
  // 不允许 "/"（路由只有单段，含斜杠的链接必然 404）和 "."（会产生
  // "." / ".." 这类畸形路径，浏览器还会对 URL 做规范化，导致链接对不上）。
  if (rawPath && !/^[a-zA-Z0-9\-_ ]+$/.test(rawPath)) {
    return error(
      '自定义路径仅支持英文、数字、连字符、下划线（空格会自动转为连字符）；不支持斜杠和点，请修改或留空由系统自动生成',
      400
    );
  }

  if (!path) {
    path = generateId(20);
  }

  // Check if path already exists
  if (await pathExists(env.SUBCONVERT_KV, path)) {
    return error(`Path "${path}" already exists. Choose a different one.`, 409);
  }

  // Create the link
  let link;
  try {
    link = await createLink(env.SUBCONVERT_KV, {
      sourceUrl,
      targetFormat,
      customPath: path,
      name: name || '',
      userAgent: userAgent || '',
    });
  } catch (e) {
    return error(e.message || 'Failed to create link', 400);
  }

  // Build the subscription URL
  const url = new URL(request.url);
  const subscriptionUrl = `${url.origin}/sub/${path}`;

  return json({
    ...link,
    subscriptionUrl,
  });
}

export async function onRequestOptions() {
  return handleCORS();
}
