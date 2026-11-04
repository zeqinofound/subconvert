/**
 * 去广告规则注入（217heidai/adblockfilters 合并规则，每 8 小时更新一次）。
 *
 * 名单托管在 GitHub Releases（仓库 2026-10-29 起把规则文件移出代码仓库，
 * raw.githubusercontent 上的旧地址已失效，必须用下面这组 releases 地址）。
 * 这里只把名单的远程地址写进生成的配置，客户端自己按间隔拉取更新，
 * 转换器不下载、不内嵌名单内容：
 *   - Clash/Mihomo：rule-providers（behavior: domain）+ 首行 RULE-SET 规则
 *   - Sing-box：route.rule_set 远程规则集（binary / srs）+ 首行拦截规则
 * V2Ray Base64 / Plain 是纯节点列表，没有规则概念，选了也不生效。
 */

export const ADBLOCK_MODES = ['none', 'lite', 'full'];

const RELEASE_BASE =
  'https://github.com/217heidai/adblockfilters/releases/download/rule';

const CLASH_URL = {
  lite: `${RELEASE_BASE}/adblockmihomolite.yaml`,
  full: `${RELEASE_BASE}/adblockmihomo.yaml`,
};

const SINGBOX_URL = {
  lite: `${RELEASE_BASE}/adblocksingboxlite.srs`,
  full: `${RELEASE_BASE}/adblocksingbox.srs`,
};

/** 归一化用户输入：只接受 none / lite / full，其余（含未传）一律按 none。 */
export function normalizeAdblock(value) {
  return ADBLOCK_MODES.includes(value) ? value : 'none';
}

/**
 * 给 Clash/Mihomo 配置对象注入去广告规则（原地改传入的 config 并返回它）。
 * 名单放在规则最前面：广告域名先被拦下，不会被后面的分流规则抢先匹配走代理。
 * @param {object} config - genClash 拼好的完整配置对象（含 rules）
 * @param {string} mode - 'lite' | 'full'（'none' 时调用方不应调到这里）
 */
export function applyClashAdblock(config, mode) {
  const url = CLASH_URL[mode];
  if (!url) return config;

  config['rule-providers'] = {
    ...(config['rule-providers'] || {}),
    adblock: {
      type: 'http',
      behavior: 'domain',
      url,
      interval: 86400,
      path: './ruleset/adblock.yaml',
    },
  };

  const rule = 'RULE-SET,adblock,REJECT';
  const rules = Array.isArray(config.rules) ? config.rules : [];
  config.rules = [rule, ...rules.filter(r => r !== rule)];
  return config;
}

/**
 * 给 Sing-box 配置对象注入去广告规则（原地改传入的 config 并返回它）。
 * 依赖配置里已有的 block 出站（genSingbox 会保证它存在）。
 * @param {object} config - genSingbox 拼好的完整配置对象（含 route）
 * @param {string} mode - 'lite' | 'full'
 */
export function applySingboxAdblock(config, mode) {
  const url = SINGBOX_URL[mode];
  if (!url || !config.route) return config;

  const route = config.route;
  const sets = Array.isArray(route.rule_set) ? route.rule_set : [];
  if (!sets.some(s => s && s.tag === 'adblock')) {
    sets.push({
      type: 'remote',
      tag: 'adblock',
      format: 'binary',
      url,
      download_detour: 'direct',
    });
  }
  route.rule_set = sets;

  const rules = Array.isArray(route.rules) ? route.rules : [];
  route.rules = [
    { rule_set: 'adblock', outbound: 'block' },
    ...rules.filter(r => !(r && r.rule_set === 'adblock')),
  ];
  return config;
}
