/**
 * Steam 直连规则注入（默认开启，帝宸 2026-11-06 拍板）。
 *
 * Steam 客户端与下载 CDN 的流量巨大（单个游戏几十 GB），走代理节点会
 * 白白烧掉节点流量；这些域名在国内有本地 CDN，直连速度不吃亏。
 * 所以生成 Clash / Sing-box 配置时，把下面这组域名后缀的 DIRECT 规则
 * 固定写在规则最前面，不提供开关——这是他明确要的“生成时默认带上”。
 * V2Ray Base64 / Plain 是纯节点列表，没有规则概念，不受影响。
 */

/** Steam 相关域名后缀：商店、社区、下载 CDN、静态资源、服务器与聊天。 */
export const STEAM_DOMAIN_SUFFIXES = [
  'steampowered.com',
  'steamcommunity.com',
  'steamcontent.com',
  'steamstatic.com',
  'steamcdn-a.akamaihd.net',
  'steamserver.net',
  'steam-chat.com',
];

/**
 * 给 Clash/Mihomo 配置对象注入 Steam 直连规则（原地改传入的 config 并返回它）。
 * 规则放在最前面：下载流量第一时间被判直连，不会先撞上后面的分流规则。
 * 已存在的同名规则先剔除再统一前置，重复生成不会越堆越多。
 * @param {object} config - genClash 拼好的完整配置对象（含 rules）
 */
export function applyClashSteamDirect(config) {
  const steamRules = STEAM_DOMAIN_SUFFIXES.map(d => `DOMAIN-SUFFIX,${d},DIRECT`);
  const rules = Array.isArray(config.rules) ? config.rules : [];
  config.rules = [...steamRules, ...rules.filter(r => !steamRules.includes(r))];
  return config;
}

/**
 * 给 Sing-box 配置对象注入 Steam 直连规则（原地改传入的 config 并返回它）。
 * 依赖配置里已有的 direct 出站（genSingbox 会保证它存在）。
 * 判定“已注入”看规则里是否已有包含 steampowered.com 的 domain_suffix
 * 直连规则，避免重复生成时叠加。
 * @param {object} config - genSingbox 拼好的完整配置对象（含 route）
 */
export function applySingboxSteamDirect(config) {
  if (!config.route) return config;

  const route = config.route;
  const rules = Array.isArray(route.rules) ? route.rules : [];
  const already = rules.some(r =>
    r && r.outbound === 'direct' && Array.isArray(r.domain_suffix) &&
    r.domain_suffix.includes('steampowered.com'));
  if (!already) {
    route.rules = [
      { domain_suffix: [...STEAM_DOMAIN_SUFFIXES], outbound: 'direct' },
      ...rules,
    ];
  }
  return config;
}
