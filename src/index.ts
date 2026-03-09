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
      console.log("Received payload:", JSON.stringify(payload));

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
      if (data.signedRenewalInfo) {
        data.renewalInfo = decodeJwt(data.signedRenewalInfo);
      }

      const tx = data.transactionInfo || {};

      // 2. 获取中文化映射和分类
      const info = getNotificationInfo(notificationType, subtype);

      // 3. 构造消息
      let priceStr = "";
      if (tx.price && tx.currency) {
        priceStr = `${(tx.price / 1000).toFixed(2)} ${tx.currency}`;
      }

      let title = `${info.icon} ${info.title}`;
      // 如果是收钱通知，在标题增加花哨字体的金额
      if (info.icon.includes("收钱啦") && priceStr) {
        title += ` ${toFancyFont(priceStr)}`;
      }

      let message = `${title}\n`;
      message += `------------------\n`;
      message += `📦 产品: ${getProductInfo(tx.productId || "未知")}\n`;

      if (priceStr) {
        message += `💰 金额: ${priceStr}\n`;
      }

      if (tx.storefront) {
        message += `🌍 地区: ${getStorefrontInfo(tx.storefront)}\n`;
      }

      const envMap: Record<string, string> = { 'Sandbox': '沙盒测试', 'Production': '正式环境' };
      const envStr = decodedPayload.environment || tx.environment || "未知";
      message += `🌐 环境: ${envMap[envStr] || envStr}\n`;

      if (tx.originalTransactionId) {
        message += `🔑 原始ID: ${tx.originalTransactionId}\n`;
      }

      if (tx.webOrderLineItemId) {
        message += `📄 WebID: ${tx.webOrderLineItemId}\n`;
      }

      const time = tx.purchaseDate ? new Date(tx.purchaseDate).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : "未知";
      message += `⏰ 时间: ${time}\n`;

      if (data.bundleId) {
        message += `🆔 App: ${data.bundleId}\n`;
      }

      // 4. 过滤逻辑：只有“收钱啦”才发送通知
      if (!info.icon.includes("收钱啦")) {
        console.log(`Skipping notification for type: ${notificationType}, subtype: ${subtype}`);
        return new Response("OK: Skipped non-revenue notification", { status: 200 });
      }

      // 5. 支持多个 BARK_KEY (以逗号分隔)
      const barkKeys = env.BARK_KEY.split(',').map(key => key.trim()).filter(key => key.length > 0);

      const sendPromises = barkKeys.map(async (key) => {
        const barkUrl = `${env.BARK_SERVER}/${key}/${encodeURIComponent(env.DEFAULT_TITLE)}/${encodeURIComponent(message)}?group=AppStore&icon=https://raw.githubusercontent.com/AtomFlip/CashcodeResource/main/icon.png`;
        const response = await fetch(barkUrl);
        return response.text();
      });

      const results = await Promise.allSettled(sendPromises);
      const resultSummary = results.map((r, i) => `${barkKeys[i]}: ${r.status === 'fulfilled' ? 'Success' : 'Failed'}`).join(', ');

      return new Response(`OK: ${resultSummary}`, { status: 200 });
    } catch (error: any) {
      console.error("Error:", error.message, error.stack);
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  },
};

// --- 辅助逻辑 ---

function decodeJwt(jwt: string): any {
  const parts = jwt.split('.');
  if (parts.length !== 3) return {};
  let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return JSON.parse(atob(base64));
}

/**
 * 将英文字母和数字转换为花哨的粗体字体 (Mathematical Bold Unicode)
 */
function toFancyFont(text: string): string {
  return Array.from(text).map(char => {
    const code = char.charCodeAt(0);
    // 数字 0-9: \u{1D7CE} - \u{1D7D7}
    if (code >= 48 && code <= 57) {
      return String.fromCodePoint(0x1D7CE + (code - 48));
    }
    // 大写 A-Z: \u{1D400} - \u{1D419}
    if (code >= 65 && code <= 90) {
      return String.fromCodePoint(0x1D400 + (code - 65));
    }
    // 小写 a-z: \u{1D41A} - \u{1D433}
    if (code >= 97 && code <= 122) {
      return String.fromCodePoint(0x1D41A + (code - 97));
    }
    return char;
  }).join('');
}

/**
 * 获取通知类型的中文化描述和图标
 */
function getNotificationInfo(type: string, subtype: string): { title: string; icon: string } {
  const mappings: Record<string, string> = {
    'SUBSCRIBED': '新订阅',
    'DID_RENEW': '订阅续期成功',
    'REFUND': '已退款',
    'REFUND_DECLINED': '拒绝退款',
    'DID_FAIL_TO_RENEW': '续期失败',
    'GRACE_PERIOD_EXPIRED': '宽限期已过',
    'OFFER_REDEEMED': '优惠码兑换',
    'PRICE_INCREASE': '价格上涨确认',
    'REVOCATION': '权利撤销(退款)',
    'EXPIRED': '订阅已过期',
    'CONSUMPTION_REQUEST': '消耗确认请求',
    'DID_CHANGE_RENEWAL_PREF': '订阅方案变更',
    'RENEWAL_EXTENDED': '订阅期已延长',
    'DID_CHANGE_RENEWAL_STATUS': '续期状态变更',
  };

  const subtypeMappings: Record<string, string> = {
    'INITIAL_BUY': '首购',
    'RESUBSCRIBE': '重订',
    'AUTO_RENEWABLE': '自动续期弹窗',
    'BILLING_RECOVERY': '账单恢复',
    'VOLUNTARY': '用户主动',
    'BILLING_RETRY': '账单重试',
    'PENDING': '等待确认',
    'ACCEPTED': '已接受',
    'ONE_TIME_CHARGE': '一次性购买',
    'DOWNGRADE': '降级',
    'UPGRADE': '升级',
    'AUTO_RENEW_ENABLED': '开启自动续期',
    'AUTO_RENEW_DISABLED': '关闭自动续期',
    'ACCOUNT_HOLD': '账号冻结/保留',
    'GRACE_PERIOD': '宽限期内',
  };

  let title = mappings[type] || type;
  if (subtype && subtypeMappings[subtype]) {
    title += ` (${subtypeMappings[subtype]})`;
  } else if (subtype) {
    title += ` (${subtype})`;
  }

  // 分类图标
  let icon = '🔔';
  if (['SUBSCRIBED', 'DID_RENEW'].includes(type) || subtype === 'ONE_TIME_CHARGE') {
    icon = '💰 收钱啦';
  } else if (['REFUND', 'REVOCATION'].includes(type)) {
    icon = '💸 退钱了';
  } else if (['DID_FAIL_TO_RENEW', 'EXPIRED'].includes(type) || subtype === 'AUTO_RENEW_DISABLED') {
    icon = '📉 订阅流失/关闭';
  } else if (type === 'DID_CHANGE_RENEWAL_PREF' || type === 'DID_CHANGE_RENEWAL_STATUS') {
    icon = '🔄 方案/状态变更';
  } else if (type === 'RENEWAL_EXTENDED') {
    icon = '🎁 订阅延长';
  }

  return { title, icon };
}

/**
 * 获取商品 ID 的映射名称
 */
function getProductInfo(productId: string): string {
  const products: Record<string, string> = {
    "com.atomflip.cashcode.premium.permanent": "永久会员",
    "com.atomflip.cashcode.gift": "邀请有礼1",
    "com.atomflip.cashcode.gift10": "邀请有礼1",
    "com.atomflip.cashcode.gift30": "邀请有礼2",
    "com.atomflip.cashcode.gift60": "邀请有礼3",
    "com.atomflip.cashcode.gift100": "邀请有礼4",
    "com.atomflip.cashcode.premium.yearly": "年度会员",
    "com.atomflip.cashcode.premium.quarterly": "季度会员",
    "com.atomflip.cashcode.premium.monthly": "月度会员"
  };
  return products[productId] ? `${products[productId]} (${productId})` : productId;
}

/**
 * 获取地区的映射名称 (常用地区)
 */
function getStorefrontInfo(storefront: string): string {
  const stores: Record<string, string> = {
    "CHN": "中国",
    "USA": "美国",
    "HKG": "香港",
    "TWN": "台湾",
    "JPN": "日本",
    "KOR": "韩国",
    "GBR": "英国",
    "DEU": "德国",
    "FRA": "法国",
  };
  // storefront 通常是 3 位地区码 + 后面的一串数字，这里简单做前缀匹配
  const code = storefront.substring(0, 3);
  return stores[code] ? `${stores[code]} (${storefront})` : storefront;
}
