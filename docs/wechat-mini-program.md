# 青览微信小程序

小程序和网页读取同一套市场数据。打开小程序就能查看北京时间 09:00 计划发布的晨报、上金所 Au99.99、纳斯达克 100 和万家纳指 100 C（019442）。登录已有青览邮箱账号后，晨报会按当前持有克数及基金份额估算变化。资金规划沿用网页的条件测算，课程和计算实验可以直接在微信里使用。

## 在电脑导入

1. 下载并安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)，扫码登录。
2. 解压从 GitHub Actions 下载的 `qinglan-wechat` 项目包。导入含 `project.config.json` 的目录，选择“小程序”，后端服务选择“不使用云服务”。
3. 电脑模拟器可选择“测试号/体验”。安装包自带带日期的公开行情与课程，适合先查看界面和填写演示档案。
4. 若从源码修改，使用 Node.js 24，执行 `npm ci` 和 `npm run build:wechat`，再导入 `dist-wechat`。

## 在手机微信使用

1. 在开发者工具导入时填写你有权限的**小程序 AppID**。如果只想自己扫码试用，可以先申请[微信小程序测试号](https://mp.weixin.qq.com/wxamp/sandbox?doc=1)。
2. 在开发者工具点击“预览”，用对应的微信号扫描生成的二维码。[预览官方说明](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release.html)
3. 测试时如遇到合法域名校验失败，使用微信官方的开发调试功能。真机上在小程序的右上角菜单选“打开调试”。只有开发调试场景适用。[测试号说明](https://developers.weixin.qq.com/miniprogram/dev/devtools/sandbox.html)
4. 进入小程序的“个人中心”，使用网页中同一个邮箱和密码登录。已有档案会从云端读取。未登录时的输入保存在本机，登录后可在云端没有档案时主动复制过去。两边同时修改时，比较版本后再保存。

小程序的 09:00 晨报在应用内更新。DeepSeek 和本机 ChatGPT 助手由网页端提供。

## 体验版与正式发布

微信公众平台要求用有权限的 AppID 上传代码。测试号用于预览。正式 AppID 可先上传开发版本，再设置为体验版，或按平台要求完成小程序备案、隐私保护指引和类目审核后发布。

网络配置在微信公众平台“开发管理 → 开发设置 → 服务器域名”中维护。构建默认请求两个 HTTPS 域名。

| 请求域名 | 用途 |
|---|---|
| `https://hyrose0704.github.io` | 读取 `qinglan-finance/brief.json` 与 `qinglan-finance/market.json` |
| `https://zpnoikeqlvvnrdttkyqg.supabase.co` | 验证已有邮箱账号，读写该账号自己的资产档案 |

登录与档案请求受现有 Supabase 权限控制，随项目打包的只是公开连接配置。平台要求合法请求域名具备 ICP 备案。若当前域名无法添加，可配置你控制的合规 HTTPS 域名后重新构建。让行情地址提供相同的两个 JSON 文件，让数据库域名安全连接现有 Supabase 项目并保留其身份验证及数据权限。只将数据库请求路由到自己控制的服务。[微信网络规则](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)

例如在 PowerShell 为已配置的域名指定构建参数。

```powershell
$env:QINGLAN_WECHAT_MARKET_BASE = 'https://market.example.com/qinglan/'
$env:QINGLAN_WECHAT_CLOUD_ORIGIN = 'https://assets.example.com'
npm.cmd run build:wechat
```

个人资产、登录凭证和上传密钥均不属于项目包。源材料按钮在点击后复制公开链接。答题进度、规划偏好和金额隐私开关保存在使用小程序的设备上。
