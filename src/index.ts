/**
 * Apple App Store Server Notifications V2 转发至 Bark 的 Cloudflare Worker
 */

export interface Env {
  BARK_KEY: string;
  BARK_SERVER: string;
  DEFAULT_TITLE: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Only POST requests are accepted", { status: 405 });
    }

    try {
      const payload = await request.json() as any;
      
      if (!payload.signedPayload) {
        return new Response("Invalid payload", { status: 400 });
      }

      // 1. 解码核心数据
      const decodedPayload = decodeJwt(payload.signedPayload);
      const notificationType = decodedPayload.notificationType;
      const subtype = decodedPayload.subtype || "";
      const data = decodedPayload.data || {};

      if (data.signedTransactionInfo) {
        data.transactionInfo = decodeJwt(data.signedTransactionInfo);
      }

      const tx = data.transactionInfo || {};

      // 2. 获取中文化映射和分类
      const info = getNotificationInfo(notificationType, subtype);

      // 3. 构造金额字符串
      let priceStr = "";
      if (tx.price !== undefined && tx.currency) {
        priceStr = `${(tx.price / 1000).toFixed(2)} ${tx.currency}`;
      }

      // 4. 过滤逻辑：只有“收钱啦”才发送通知
      if (!info.icon.includes("收钱啦")) {
        return new Response("OK: Skipped non-revenue notification", { status: 200 });
      }

      // 5. 构造通知标题
      let displayTitle = `${info.icon} ${info.title}`;
      if (priceStr) {
        displayTitle += ` ${toFancyFont(priceStr)}`;
      }

      // 6. 构造通知正文 (使用数组 join 提高可读性)
      const messageLines = [
        `📦 产品: ${getProductInfo(tx.productId || "未知")}`,
        priceStr ? `💰 金额: ${priceStr}` : null,
        tx.storefront ? `🌍 地区: ${getStorefrontInfo(tx.storefront)}` : null,
        `🌐 环境: ${decodedPayload.environment === 'Sandbox' ? '沙盒测试' : '正式环境'}`,
        `⏰ 时间: ${tx.purchaseDate ? new Date(tx.purchaseDate).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : "未知"}`,
        data.bundleId ? `🆔 App: ${data.bundleId}` : null,
        tx.originalTransactionId ? `🔑 原始ID: ${tx.originalTransactionId}` : null
      ].filter(Boolean);

      const fullMessage = messageLines.join('\n');

      // 7. 发送 Bark 通知
      const barkKeys = env.BARK_KEY.split(',').map(k => k.trim()).filter(Boolean);
      const barkServer = env.BARK_SERVER.replace(/\/$/, ""); 

      const promises = barkKeys.map(async (key) => {
        // 使用 URLSearchParams 自动处理 URL 编码，避免特殊字符导致发送失败
        const params = new URLSearchParams({
          title: env.DEFAULT_TITLE || "App Store 通知",
          body: `${displayTitle}\n------------------\n${fullMessage}`,
          group: "AppStore",
          icon: "https://raw.githubusercontent.com/AtomFlip/CashcodeResource/main/icon.png",
          level: "active" 
        });

        return fetch(`${barkServer}/${key}/?${params.toString()}`);
      });

      // 使用 waitUntil 确保在返回响应后，发送请求的异步任务仍能完成
      ctx.waitUntil(Promise.allSettled(promises));

      return new Response("Accepted", { status: 202 });
      
    } catch (error: any) {
      console.error("Error:", error.message);
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  },
};

// --- 辅助逻辑 ---

function decodeJwt(jwt: string): any {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return {};
    // 将 URL 安全的 Base64 转换为标准 Base64
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    return JSON.parse(atob(base64));
  } catch (e) {
    return {};
  }
}

function toFancyFont(text: string): string {
  return Array.from(text).map(char => {
    const code = char.charCodeAt(0);
    if (code >= 48 && code <= 57) return String.fromCodePoint(0x1D7CE + (code - 48));
    if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D400 + (code - 65));
    if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D41A + (code - 97));
    return char;
  }).join('');
}

function getNotificationInfo(type: string, subtype: string): { title: string; icon: string } {
  const mappings: Record<string, string> = {
    'SUBSCRIBED': '新订阅', 'DID_RENEW': '订阅续期成功', 'REFUND': '已退款',
    'REFUND_DECLINED': '拒绝退款', 'DID_FAIL_TO_RENEW': '续期失败',
    'EXPIRED': '订阅已过期', 'REVOCATION': '权利撤销'
  };

  const subtypeMappings: Record<string, string> = {
    'INITIAL_BUY': '首购', 'RESUBSCRIBE': '重订', 'ONE_TIME_CHARGE': '一次性购买'
  };

  let title = mappings[type] || type;
  if (subtype && subtypeMappings[subtype]) title += ` (${subtypeMappings[subtype]})`;

  let icon = '🔔';
  if (['SUBSCRIBED', 'DID_RENEW'].includes(type) || subtype === 'ONE_TIME_CHARGE') {
    icon = '💰 收钱啦';
  } else if (['REFUND', 'REVOCATION'].includes(type)) {
    icon = '💸 退钱了';
  }

  return { title, icon };
}

function getProductInfo(productId: string): string {
  const products: Record<string, string> = {
    "com.atomflip.cashcode.premium.yearly": "年度会员",
    "com.atomflip.cashcode.premium.permanent": "永久会员"
  };
  return products[productId] ? `${products[productId]} (${productId})` : productId;
}

function getStorefrontInfo(storefront: string): string {
  const stores: Record<string, string> = { "CHN": "中国", "USA": "美国", "HKG": "香港" };
  const code = storefront.substring(0, 3);
  return stores[code] ? `${stores[code]} (${storefront})` : storefront;
}
