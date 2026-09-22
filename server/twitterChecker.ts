import crypto from 'crypto';

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
}

export class CheckTwitter {
  private guestToken: string = '';
  private guestTokenExpiry: number = 0;
  private updateTokenPromise: Promise<string | null> | null = null;

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

  public async getGuestToken(): Promise<string | null> {
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

      const res = await fetch('https://api.twitter.com/1.1/guest/activate.json', {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        console.warn('[CheckTwitter] guest/activate status:', res.status);
        return null;
      }

      const data: any = await res.json();
      const gt = data?.guest_token;
      if (gt) {
        this.guestToken = String(gt);
        this.guestTokenExpiry = Date.now() + 2 * 60 * 60 * 1000;
        return this.guestToken;
      }
      return null;
    } catch (err: any) {
      console.warn('[CheckTwitter] getGuestToken error:', err.message);
      return null;
    }
  }

  public async ensureGuestToken(forceRefresh = false): Promise<string | null> {
    if (!forceRefresh && this.guestToken && Date.now() < this.guestTokenExpiry) {
      return this.guestToken;
    }

    if (this.updateTokenPromise) {
      return this.updateTokenPromise;
    }

    this.updateTokenPromise = (async () => {
      try {
        return await this.getGuestToken();
      } finally {
        this.updateTokenPromise = null;
      }
    })();

    return this.updateTokenPromise;
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

    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const token = await this.ensureGuestToken(attempt > 0);
        if (!token) {
          await new Promise((r) => setTimeout(r, 1000));
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

        const res = await fetch(
          `https://api.x.com/graphql/Yka-W8dz7RaEuQNkroPkYw/UserByScreenName?${params.toString()}`,
          {
            method: 'GET',
            headers: {
              authorization: `Bearer ${this.authorization}`,
              'x-guest-token': token,
              'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
            signal: AbortSignal.timeout(15000),
          }
        );

        const text = await res.text();

        if (text.includes('limit') || res.status === 429) {
          this.guestToken = '';
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        let json: any = {};
        try {
          json = JSON.parse(text);
        } catch {
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
        console.warn(`[CheckTwitter] checkLive attempt ${attempt + 1} warn:`, err.message);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    return {
      isLive: false,
      status: 'DIE',
      rawStatus: 'ERROR',
      reason: 'Lỗi kết nối kiểm tra',
      username: cleanUsername,
    };
  }
}

export const twitterChecker = new CheckTwitter();
