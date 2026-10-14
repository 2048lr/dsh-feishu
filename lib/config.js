/**
 * dsh-feishu configuration: normalization, defaults, and brand endpoints.
 *
 * The plugin deliberately exports no Cordis `Config` schema: a Cordis runtime
 * without a schema skips validation and hands the raw patch configuration to
 * `apply`, which lets this package stay free of `@deepseek-ai/*` imports and
 * therefore load from a junction, a copied profile install, or any host layout.
 * Every field is validated and defaulted here instead.
 *
 * @module dsh-feishu/config
 */

/** Endpoint families for the two Feishu brands. */
export const BRANDS = {
  feishu: {
    label: 'Feishu (飞书, China)',
    api: 'https://open.feishu.cn/open-apis',
    accounts: 'https://accounts.feishu.cn/open-apis',
  },
  lark: {
    label: 'Lark (international)',
    api: 'https://open.larksuite.com/open-apis',
    accounts: 'https://accounts.larksuite.com/open-apis',
  },
};

/** Environment variable fallbacks consulted when configuration omits a value. */
export const ENV = {
  appId: 'FEISHU_APP_ID',
  appSecret: 'FEISHU_APP_SECRET',
  brand: 'FEISHU_BRAND',
  userAccessToken: 'FEISHU_USER_ACCESS_TOKEN',
  defaultFolderToken: 'FEISHU_FOLDER_TOKEN',
};

/** Field defaults applied before validation. */
export const DEFAULTS = {
  appId: '',
  appSecret: '',
  appSecretRef: 'FEISHU_APP_SECRET',
  brand: 'feishu',
  apiBaseUrl: '',
  accountsBaseUrl: '',
  defaultFolderToken: '',
  defaultIdentity: 'auto',
  toolPrefix: 'feishu_',
  requestTimeoutMs: 30000,
  maxRetries: 2,
  requestTimeoutHardCapMs: 120000,
  enableTools: true,
  enableOAuth: true,
  enableUi: true,
  oauthRedirectUri: '',
  oauthScopes: [],
  registerSystemPrompt: true,
  userAccessToken: '',
  maxRecordsPerPage: 500,
  activityLogSize: 50,
  patchFilePath: '',
};

/** The literal values accepted by the identity selector. */
export const IDENTITIES = ['auto', 'user', 'app'];

/**
 * Coerce one configuration value to a trimmed string.
 * @param value - raw value from the patch file or environment.
 * @param fallback - value returned when the input is absent or empty.
 * @returns the trimmed string.
 */
function str(value, fallback) {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

/**
 * Coerce one configuration value to a positive finite number.
 * @param value - raw value.
 * @param fallback - value returned when the input is absent or unusable.
 * @param max - optional inclusive upper bound.
 * @returns the usable number.
 */
function num(value, fallback, max) {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) return fallback;
  return max !== undefined && parsed > max ? max : parsed;
}

/**
 * Coerce one configuration value to a boolean, accepting the usual YAML spellings.
 * @param value - raw value.
 * @param fallback - value returned when the input is absent or unrecognized.
 * @returns the boolean.
 */
function bool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (['true', 'yes', 'on', '1'].includes(lowered)) return true;
    if (['false', 'no', 'off', '0'].includes(lowered)) return false;
  }
  return fallback;
}

/**
 * Coerce one configuration value to an array of non-empty trimmed strings.
 * @param value - raw value, or a single string.
 * @returns the string array, possibly empty.
 */
function strList(value) {
  if (typeof value === 'string') {
    return value.split(/[,\s]+/u).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim().length > 0) out.push(entry.trim());
  }
  return out;
}

/** Strip trailing slashes so endpoint concatenation is predictable. */
function trimBase(url) {
  return url.replace(/\/+$/u, '');
}

/**
 * Normalize the raw patch configuration into the runtime shape, applying
 * environment fallbacks and the brand endpoint table.
 * @param raw - the object handed to `apply` by the Cordis loader, or undefined.
 * @param env - environment lookup, defaulting to the process environment.
 * @returns the frozen normalized configuration.
 */
export function normalizeConfig(raw, env = (typeof process !== 'undefined' ? process.env : {})) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const brand = str(source.brand, str(env[ENV.brand], DEFAULTS.brand)).toLowerCase();
  const endpoints = BRANDS[brand] === undefined ? BRANDS[DEFAULTS.brand] : BRANDS[brand];
  const resolvedBrand = BRANDS[brand] === undefined ? DEFAULTS.brand : brand;
  const defaultIdentity = str(source.defaultIdentity, DEFAULTS.defaultIdentity).toLowerCase();
  const prefix = str(source.toolPrefix, DEFAULTS.toolPrefix);

  const config = {
    brand: resolvedBrand,
    brandLabel: endpoints.label,
    appId: str(source.appId, str(env[ENV.appId], DEFAULTS.appId)),
    appSecret: str(source.appSecret, DEFAULTS.appSecret),
    appSecretRef: str(source.appSecretRef, DEFAULTS.appSecretRef),
    apiBaseUrl: trimBase(str(source.apiBaseUrl, endpoints.api)),
    accountsBaseUrl: trimBase(str(source.accountsBaseUrl, endpoints.accounts)),
    defaultFolderToken: str(source.defaultFolderToken, str(env[ENV.defaultFolderToken], DEFAULTS.defaultFolderToken)),
    userAccessToken: str(source.userAccessToken, str(env[ENV.userAccessToken], DEFAULTS.userAccessToken)),
    defaultIdentity: IDENTITIES.includes(defaultIdentity) ? defaultIdentity : DEFAULTS.defaultIdentity,
    toolPrefix: prefix.endsWith('_') ? prefix : prefix + '_',
    requestTimeoutMs: num(source.requestTimeoutMs, DEFAULTS.requestTimeoutMs, DEFAULTS.requestTimeoutHardCapMs),
    maxRetries: Math.min(5, Math.max(0, Math.trunc(num(source.maxRetries, DEFAULTS.maxRetries)) - 1)),
    enableTools: bool(source.enableTools, DEFAULTS.enableTools),
    enableOAuth: bool(source.enableOAuth, DEFAULTS.enableOAuth),
    enableUi: bool(source.enableUi, DEFAULTS.enableUi),
    oauthRedirectUri: str(source.oauthRedirectUri, DEFAULTS.oauthRedirectUri),
    oauthScopes: strList(source.oauthScopes),
    registerSystemPrompt: bool(source.registerSystemPrompt, DEFAULTS.registerSystemPrompt),
    maxRecordsPerPage: Math.min(1000, Math.max(1, Math.trunc(num(source.maxRecordsPerPage, DEFAULTS.maxRecordsPerPage)))),
    activityLogSize: Math.max(1, Math.trunc(num(source.activityLogSize, DEFAULTS.activityLogSize))),
    patchFilePath: str(source.patchFilePath, DEFAULTS.patchFilePath),
  };

  return Object.freeze(config);
}

/**
 * Report whether the app-level credentials needed for tenant tokens are present.
 * @param config - normalized configuration.
 * @returns whether an app id and a secret source both exist.
 */
export function hasAppCredentials(config) {
  return config.appId.length > 0 && config.appSecret.length > 0;
}
