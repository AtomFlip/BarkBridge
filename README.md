# Apple App Store Server Notifications to Bark

这是一个 Cloudflare Worker，旨在接收 Apple App Store Server Notifications (V2) 并将其转发到 Bark 移动推送服务。

## 功能
- 接收 Apple 支付相关的 Webhook。
- 解析 JWT 格式的 `signedPayload`。
- **金额增强显示**：在收钱通知标题中直接显示转换后的花哨字体金额（如 𝟏𝟐.𝟑𝟒 𝐔𝐒𝐃）。
- **强制通知过滤**：仅转发包含“收钱啦”类型的通知，过滤无用的订阅变更、续期失败等干扰。
- **多设备支持**：支持配置多个 BARK_KEY，同时向多台设备推送。

## 部署步骤

### 1. 安装依赖
```bash
cd BarkBridge
npm install
```

### 2. 配置 Bark
在 `wrangler.toml` 中修改 `BARK_SERVER`（如果使用自建服务器）。

设置你的 Bark Key：
```bash
npx wrangler secret put BARK_KEY
```
> [!TIP]
> 如果需要推送到多个 Bark 设备，请在输入时使用英文逗号 `,` 分解多个 Key，例如：`key1,key2,key3`。

### 3. 部署到 Cloudflare
```bash
npm run deploy
```

### 4. 在 App Store Connect 配置
将部署后的 Worker URL 填写到 App Store Connect 的 App 信息 -> Server Notifications 中。

## 开发
本地调试：
```bash
npm run dev
```

## 技术架构
- **Cloudflare Workers**: 无服务器执行环境。
- **TypeScript**: 强类型开发。
- **JWT Parsing**: 手动解析 Apple 的 `signedPayload` 以保持轻量。
- **Mathematical Bold Conversion**: 使用 Unicode 数学字母符号实现花哨字体显示。
