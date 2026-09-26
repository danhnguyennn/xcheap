import crypto from 'crypto';
import { ProxyAgent } from 'undici';

export type TwitterAccountStatus = 'LIVE' | 'TEMPORARILY' | 'WRONG' | 'SUPPEND' | 'DIE' | 'ERROR';

export interface TwitterCheckResult {
  isLive: boolean;
  status: TwitterAccountStatus;
  rawStatus: 'LIVE' | 'WRONG' | 'SUPPEND' | 'TEMPORARILY' | 'ERROR';
  reason: string;
  following?: number;
  followers?: number;
  post?: number;
  created_at?: string;
  username: string;
  proxyUsed?: string;
}

export interface ProxyTestResult {
  success: boolean;
  ip?: string;
  latencyMs?: number;
  proxy: string;
  error?: string;
}

/**
 * Normalizes different proxy formats into standard URLs:
 * - host:port -> http://host:port
 * - host:port:user:pass -> http://user:pass@host:port
 * - user:pass:host:port -> http://user:pass@host:port
 * - http://user:pass@host:port -> preserved
 * - socks5://user:pass@host:port -> preserved
 */
export function normalizeProxy(rawProxy: string): string | null {
  if (!rawProxy) return null;
  let p = rawProxy.trim();
  if (!p) return null;

  if (/^(http|https|socks4|socks5):\/\//i.test(p)) {
    return p;
  }

  p = p.replace(/\/+$/, '');
  if (p.includes('@')) {
    return `http://${p}`;
  }

  const parts = p.split(':');
  if (parts.length === 2) {
    const [host, port] = parts;
    if (host && port && /^\d+$/.test(port)) {
      return `http://${host}:${port}`;
    }
  }

  // Format: host:port:user:pass OR user:pass:host:port
  if (parts.length === 4) {
    // If parts[1] is numeric port: host:port:user:pass
    if (/^\d+$/.test(parts[1])) {
      const [host, port, user, pass] = parts;
      return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
    }
    // If parts[3] is numeric port: user:pass:host:port
    if (/^\d+$/.test(parts[3])) {
      const [user, pass, host, port] = parts;
      return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
    }
  }
  return `http://${p}`;
}

const proxyAgentCache = new Map<string, ProxyAgent>();

export function getProxyAgent(proxyStr?: string): ProxyAgent | undefined {
  if (!proxyStr) return undefined;
  const normalized = normalizeProxy(proxyStr);
  if (!normalized) return undefined;
  let agent = proxyAgentCache.get(normalized);
  if (!agent) {
    try {
      agent = new ProxyAgent(normalized);
      proxyAgentCache.set(normalized, agent);
    } catch (err: any) {
      console.warn(`[CheckTwitter] Invalid proxy string "${proxyStr}":`, err.message);
      return undefined;
    }
  }
  return agent;
}

export function getDefaultEnvProxy(): string | null {
  const envVal =
    process.env.DEFAULT_PROXY ||
    process.env.TWITTER_PROXY ||
    process.env.X_CHECK_PROXY;
  if (!envVal || typeof envVal !== 'string') return null;
  return normalizeProxy(envVal.trim());
}

export class CheckTwitter {
  private cachedGuestToken: { token: string; expiry: number } | null = null;
  private guestTokenPromise: Promise<string | null> | null = null;
  // If direct server IP is blocked from guest activation (403/429), remember until this timestamp to avoid repeated timeouts
  private directGuestBlockedUntil = 0;

  private readonly authorization =
    'AAAAAAAAAAAAAAAAAAAAAAj4AQAAAAAAPraK64zCZ9CSzdLesbE7LB%2Bw4uE%3DVJQREvQNCZJNiz3rHO7lOXlkVOQkzzdsgu6wWgcazdMUaGoUGm';
  private readonly clientVersion = '9.34.1';

  private generateTraceId(): string {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    let res = '';
    const bytes = crypto.randomBytes(16);
    for (let i = 0; i < 16; i++) {
      res += chars[bytes[i] % chars.length];
    }
    return res;
  }

  private getUserAgent(): string {
    return `Twitter-iPhone/${this.clientVersion} iOS/14.8 (Apple;iPhone13,2;;;;;1;2020)`;
  }

  /**
   * Raw low-level call to Twitter guest activation endpoint
   */
  private async fetchGuestTokenRaw(
    agent?: ProxyAgent,
    sourceLabel = 'direct'
  ): Promise<{ token: string | null; status?: number; error?: string }> {
    try {
      const deviceId = crypto.randomUUID().toUpperCase();
      const uuidX = crypto.randomUUID().toUpperCase();
      const traceId = this.generateTraceId();

      const headers = {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twitter-client-deviceid': deviceId,
        accept: 'application/json',
        'x-twitter-client-version': this.clientVersion,
        authorization: `Bearer ${this.authorization}`,
        'x-client-uuid': uuidX,
        'x-twitter-client-language': 'en',
        'x-b3-traceid': traceId,
        'accept-language': 'en',
        'user-agent': this.getUserAgent(),
        'x-twitter-client-limit-ad-tracking': '0',
        'x-twitter-api-version': '5',
        'x-twitter-client': 'Twitter-iPhone',
      };

      const fetchOpts: any = {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(10000),
      };
      if (agent) {
        fetchOpts.dispatcher = agent;
      }

      const res = await fetch('https://api.twitter.com/1.1/guest/activate.json', fetchOpts);

      if (!res.ok) {
        console.warn(`[CheckTwitter] guest/activate status ${res.status} [${sourceLabel}]`);
        return { token: null, status: res.status };
      }

      const data: any = await res.json();
      const gt = data?.guest_token;
      if (gt) {
        return { token: String(gt), status: res.status };
      }
      return { token: null, status: res.status };
    } catch (err: any) {
      console.warn(`[CheckTwitter] getGuestToken error [${sourceLabel}]:`, err.message);
      return { token: null, error: err.message };
    }
  }

  /**
   * Obtains a guest token:
   * 1. Attempts direct from server IP.
   * 2. If blocked or failed, and DEFAULT_PROXY is defined in env:
   *    Uses DEFAULT_PROXY strictly to acquire the guest ID.
   */
  public async getGuestToken(): Promise<string | null> {
    const defaultEnvProxy = getDefaultEnvProxy();
    let token: string | null = null;

    // Check if direct server IP is currently blocked (e.g. within cooldown after 403/429)
    const directCooldownActive = Date.now() < this.directGuestBlockedUntil;

    if (!directCooldownActive) {
      const res = await this.fetchGuestTokenRaw(undefined, 'direct');
      token = res.token;

      if (!token && (res.status === 403 || res.status === 429)) {
        this.directGuestBlockedUntil = Date.now() + 5 * 60 * 1000;
        console.warn(
          `[CheckTwitter] Server IP bị X chặn kích hoạt guest token (HTTP ${res.status}). Bật cooldown 5 phút để chuyển tiếp sang DEFAULT_PROXY trong ENV.`
        );
      }
    } else {
      console.log(
        `[CheckTwitter] Server IP đang trong cooldown bị chặn guest, ưu tiên dùng DEFAULT_PROXY từ ENV để lấy ID Guest...`
      );
    }

    // Fallback: If blocked or failed to obtain guest token, and DEFAULT_PROXY is available in env:
    // "dùng proxy mặc định trong env, nếu bị chặn lấy guest thì dùng nó, chỉ dùng nó để lấy id guest"
    if (!token && defaultEnvProxy) {
      console.log(
        `[CheckTwitter] Bị chặn hoặc không lấy được guest token trực tiếp. Dùng DEFAULT_PROXY trong env (${defaultEnvProxy}) để lấy ID Guest...`
      );
      const envAgent = getProxyAgent(defaultEnvProxy);
      const envRes = await this.fetchGuestTokenRaw(envAgent, `env_default_proxy: ${defaultEnvProxy}`);
      token = envRes.token;

      if (token) {
        console.log(`[CheckTwitter] Lấy ID Guest thành công qua DEFAULT_PROXY trong ENV!`);
      } else {
        console.warn(`[CheckTwitter] Lấy ID Guest qua DEFAULT_PROXY trong ENV cũng không thành công (status: ${envRes.status || 'unknown'})`);
      }
    }

    if (token) {
      this.cachedGuestToken = {
        token,
        expiry: Date.now() + 2 * 60 * 60 * 1000,
      };
      return token;
    }

    return null;
  }

  public async ensureGuestToken(forceRefresh = false): Promise<string | null> {
    if (!forceRefresh && this.cachedGuestToken && Date.now() < this.cachedGuestToken.expiry) {
      return this.cachedGuestToken.token;
    }

    if (this.guestTokenPromise) {
      return this.guestTokenPromise;
    }

    this.guestTokenPromise = (async () => {
      try {
        return await this.getGuestToken();
      } finally {
        this.guestTokenPromise = null;
      }
    })();

    return this.guestTokenPromise;
  }

  public invalidateGuestToken() {
    this.cachedGuestToken = null;
  }

  public async checkLive(username: string): Promise<TwitterCheckResult> {
    const cleanUsername = username.replace(/^@/, '').trim();
    if (!cleanUsername) {
      return {
        isLive: false,
        status: 'WRONG',
        rawStatus: 'WRONG',
        reason: 'Tên người dùng trống',
        username: cleanUsername,
      };
    }

    const maxAttempts = 2;
    let lastError = '';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const token = await this.ensureGuestToken(attempt > 0);
        if (!token) {
          lastError = 'Không thể lấy guest token từ X';
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }

        const params = new URLSearchParams({
          variables: JSON.stringify({
            screen_name: cleanUsername,
            withSafetyModeUserFields: true,
          }),
          features: JSON.stringify({
            hidden_profile_subscriptions_enabled: true,
            rweb_tipjar_consumption_enabled: true,
            responsive_web_graphql_exclude_directive_enabled: true,
            verified_phone_label_enabled: false,
            subscriptions_verification_info_is_identity_verified_enabled: true,
            subscriptions_verification_info_verified_since_enabled: true,
            highlights_tweets_tab_ui_enabled: true,
            responsive_web_twitter_article_notes_tab_enabled: true,
            subscriptions_feature_can_gift_premium: true,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            responsive_web_graphql_timeline_navigation_enabled: true,
          }),
          fieldToggles: JSON.stringify({ withAuxiliaryUserLabels: false }),
        });

        // UserByScreenName luôn được gọi TRỰC TIẾP từ server, hoàn toàn KHÔNG dùng proxy
        const res = await fetch(
          `https://api.x.com/graphql/Yka-W8dz7RaEuQNkroPkYw/UserByScreenName?${params.toString()}`,
          {
            method: 'GET',
            headers: {
              authorization: `Bearer ${this.authorization}`,
              'x-guest-token': token,
              'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
            signal: AbortSignal.timeout(12000),
          }
        );

        const text = await res.text();

        if (text.includes('limit') || res.status === 429) {
          this.invalidateGuestToken();
          lastError = 'Rate limited (429) từ X';
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        let json: any = {};
        try {
          json = JSON.parse(text);
        } catch {
          lastError = 'Phản hồi không hợp lệ từ máy chủ X';
          continue;
        }

        // 1. Wrong username / Not found
        if (!json.data || Object.keys(json.data).length === 0 || !json.data.user) {
          return {
            isLive: false,
            status: 'WRONG',
            rawStatus: 'WRONG',
            reason: 'Tài khoản không tồn tại (Wrong Username)',
            username: cleanUsername,
          };
        }

        const result = json.data?.user?.result;
        if (!result) {
          return {
            isLive: false,
            status: 'WRONG',
            rawStatus: 'WRONG',
            reason: 'Tài khoản không tồn tại (Wrong Username)',
            username: cleanUsername,
          };
        }

        // 2. Suspended / Unavailable
        const typename = result.__typename;
        if (typename === 'UserUnavailable') {
          return {
            isLive: false,
            status: 'SUPPEND',
            rawStatus: 'SUPPEND',
            reason: 'Tài khoản bị đình chỉ (Suspended)',
            username: cleanUsername,
          };
        }

        const legacy = result.legacy;
        if (!legacy) {
          if (typename === 'User') {
            return {
              isLive: true,
              status: 'LIVE',
              rawStatus: 'LIVE',
              reason: 'Tài khoản hoạt động (LIVE)',
              username: cleanUsername,
            };
          }
          return {
            isLive: false,
            status: 'SUPPEND',
            rawStatus: 'SUPPEND',
            reason: 'Tài khoản không khả dụng (Suspended)',
            username: cleanUsername,
          };
        }

        const profileInterstitialType = legacy.profile_interstitial_type || '';
        const following = legacy.friends_count ?? 0;
        const followers = legacy.followers_count ?? 0;
        const createdAt = legacy.created_at || '';
        const statusesCount = legacy.statuses_count ?? 0;

        // 3. Normal Live User
        if (typename === 'User' && profileInterstitialType === '') {
          return {
            isLive: true,
            status: 'LIVE',
            rawStatus: 'LIVE',
            following,
            followers,
            post: statusesCount,
            created_at: createdAt,
            reason: `LIVE | Followers: ${followers.toLocaleString()} | Following: ${following.toLocaleString()} | Posts: ${statusesCount.toLocaleString()}`,
            username: legacy.screen_name || cleanUsername,
          };
        } else if (typename === 'User' && profileInterstitialType === 'fake_account') {
          // 4. Temporarily restricted / warning
          return {
            isLive: false,
            status: 'TEMPORARILY',
            rawStatus: 'TEMPORARILY',
            following,
            followers,
            post: statusesCount,
            created_at: createdAt,
            reason: 'Tài khoản bị hạn chế tạm thời (TEMPORARILY)',
            username: legacy.screen_name || cleanUsername,
          };
        } else if (typename === 'User') {
          return {
            isLive: true,
            status: 'LIVE',
            rawStatus: 'LIVE',
            following,
            followers,
            post: statusesCount,
            created_at: createdAt,
            reason: `LIVE (${profileInterstitialType})`,
            username: legacy.screen_name || cleanUsername,
          };
        } else {
          return {
            isLive: false,
            status: 'SUPPEND',
            rawStatus: 'SUPPEND',
            reason: 'Tài khoản không khả dụng (Suspended)',
            username: cleanUsername,
          };
        }
      } catch (err: any) {
        lastError = err.message || 'Lỗi mạng';
        console.warn(`[CheckTwitter] checkLive attempt ${attempt + 1} warn:`, err.message);
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    return {
      isLive: false,
      status: 'DIE',
      rawStatus: 'ERROR',
      reason: `Lỗi kết nối kiểm tra (${lastError || 'Không xác định'})`,
      username: cleanUsername,
    };
  }
}

export const twitterChecker = new CheckTwitter();
