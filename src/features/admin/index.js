// Admin feature — a drop-in module that ONLY contributes i18n strings for /admin. It does NOT
// register a component (the /admin route is wired in src/router/routes.js → AdminPage.vue
// directly, since admin is a top-level page, not a tool-suite), does NOT add ⌘K commands
// (the route is excluded from the palette via ROUTE_META.inCommandPalette = false), and does
// NOT register any converters.
//
// Keeping this as a feature module (rather than dumping strings into the core useI18n dict)
// preserves the project's drop-in convention: every named surface owns its own strings.

export default {
  components: {},
  i18n: {
    en: {
      'admin.title': 'Admin',
      'admin.loading': 'Loading…',
      'admin.logout': 'Log out',
      'admin.working': 'Working…',
      'admin.failed': 'Action failed',
      'admin.unknownState': 'Unknown auth state',

      // no-setup
      'admin.noSetupTitle': 'Bootstrap token not set',
      'admin.noSetupBody': 'Set the BOOTSTRAP_TOKEN worker secret, then refresh this page. It’s a one-time token used to bind the first passkey.',
      'admin.noSetupNote': 'After binding your first device, the token is consumed and can never be reused.',

      // bind
      'admin.bindTitle': 'Bind a passkey',
      'admin.bindSub': 'This is the first time anyone is opening /admin. Bind a biometric credential (Face ID, Touch ID, or a security key); afterwards you’ll only need biometrics to log in.',
      'admin.bootstrapToken': 'Bootstrap token',
      'admin.tokenPlaceholder': 'Paste the token from `wrangler secret put BOOTSTRAP_TOKEN`',
      'admin.deviceName': 'Device name (optional)',
      'admin.deviceNamePlaceholder': 'MacBook, iPhone, etc.',
      'admin.bindAction': 'Bind passkey',
      'admin.bindFailed': 'Could not bind passkey',

      // login
      'admin.loginTitle': 'Biometric login',
      'admin.loginSub': 'Use a registered passkey to open the admin dashboard.',
      'admin.loginAction': 'Log in with passkey',
      'admin.loginNoPasskey': 'No passkey on this device? Ask an already-logged-in device to generate a one-time link.',

      // dashboard tabs
      'admin.tabStatus': 'Status',
      'admin.tabNcm': 'NetEase account',
      'admin.tabSecurity': 'Security',

      // status
      'admin.statBootstrap': 'Bootstrap',
      'admin.statBound': 'Bound',
      'admin.statUnbound': 'Unbound',
      'admin.statPasskeys': 'Passkeys',
      'admin.statNcmCookie': 'NCM cookie',
      'admin.statCookieActive': 'Active',
      'admin.statCookieMissing': 'Missing',
      'admin.cookieFromQr': 'via QR login',
      'admin.cookieFromEnv': 'via deploy secret',

      // NCM account tab
      'admin.qrLoginTitle': 'Scan to log in',
      'admin.qrLoginHint': 'Scan with the NetEase Cloud Music app to bind your account.',
      'admin.qrStart': 'Show QR code',
      'admin.qrStarting': 'Starting…',
      'admin.qrCancel': 'Cancel',
      'admin.qrStartFailed': 'Could not start QR login',
      'admin.qrLoggedIn': 'NetEase account connected',
      'admin.qrStatus_idle': '',
      'admin.qrStatus_waiting': 'Waiting for scan…',
      'admin.qrStatus_scanned': 'Scanned — confirm in the app',
      'admin.qrStatus_confirming': 'Confirming…',
      'admin.qrStatus_done': 'Logged in',
      'admin.qrStatus_expired': 'QR expired — click to retry',
      'admin.pasteCookieTitle': 'Paste cookie manually',
      'admin.pasteCookieHint': 'Fallback: copy the cookie string from a logged-in browser’s devtools and paste it here.',
      'admin.cookiePlaceholder': 'MUSIC_U=...; os=pc; ...',
      'admin.cookieSave': 'Save cookie',
      'admin.cookieSaved': 'Cookie saved',
      'admin.cookieSaveFailed': 'Could not save cookie',
      'admin.cookieClear': 'Log out of NetEase',
      'admin.cookieCleared': 'Cookie cleared',
      'admin.cookieClearConfirm': 'Remove the stored NetEase cookie? You can re-scan to log back in.',

      // security tab
      'admin.ipAllowlistTitle': 'IP allowlist',
      'admin.ipAllowlistHint': 'One IP per line (or comma-separated). Empty = the env ALLOWED_IPS secret is used as-is.',
      'admin.ipPlaceholder': '1.2.3.4\n5.6.7.8',
      'admin.ipSave': 'Save allowlist',
      'admin.ipSaved': 'Allowlist updated',
      'admin.ipSaveFailed': 'Could not update allowlist',
      'admin.passkeysTitle': 'Devices',
      'admin.removePasskey': 'Remove',
      'admin.removePasskeyConfirm': 'Remove this passkey? You won’t be able to log in from that device afterwards.',
      'admin.addPasskey': 'Add a device',
      'admin.passkeyAdded': 'Device added',

      // one-time link
      'admin.oneTimeLinkTitle': 'One-time login link',
      'admin.oneTimeLinkHint': 'Generate a single-use link valid for 10 minutes. Open it on the new device to add its passkey.',
      'admin.oneTimeLinkGenerate': 'Generate link',
      'admin.oneTimeLinkExpires': 'Expires in',
      'admin.copyLink': 'Copy',
      'admin.expired': 'expired',

      // otp auto-redeem (when the page is opened with ?otp=xxx)
      'admin.otpRedeemed': 'Device authorized — add your passkey now',
      'admin.otpInvalid': 'Invalid or expired one-time link',

      // bound toast
      'admin.bound': 'Passkey bound — welcome',

      // Phase 4: statistics + logs tabs
      'admin.tabStats': 'Statistics',
      'admin.tabLogs': 'Logs',
      'admin.statsOverview': 'Overview (all time, this isolate)',
      'admin.statsOk': 'OK',
      'admin.statsBlockedIp': 'IP-blocked',
      'admin.statsBlockedRate': 'Rate-limited',
      'admin.statsBlockedAuth': 'Auth-blocked',
      'admin.statsErrors': 'Errors',
      'admin.statsRefresh': 'Refresh',
      'admin.statsByPath': 'Requests by path',
      'admin.statsNoData': 'No requests recorded yet.',
      'admin.logsTitle': 'Real-time activity',
      'admin.logsLive': '● Live',
      'admin.logsOff': '○ Disconnected',
      'admin.logsEmpty': 'Waiting for events…',
    },
    zh: {
      'admin.title': '后台',
      'admin.loading': '加载中…',
      'admin.logout': '退出登录',
      'admin.working': '处理中…',
      'admin.failed': '操作失败',
      'admin.unknownState': '未知认证状态',

      'admin.noSetupTitle': '尚未设置初始化 token',
      'admin.noSetupBody': '请先用 wrangler secret put BOOTSTRAP_TOKEN 设置一个一次性 token,然后刷新本页。它只在绑定首个 passkey 时使用一次。',
      'admin.noSetupNote': '绑定首个设备后,token 立即作废,永远无法再次使用。',

      'admin.bindTitle': '绑定生物识别',
      'admin.bindSub': '这是首次有人打开 /admin。请绑定一个生物识别凭据(Face ID / 指纹 / 安全密钥);之后只需生物识别即可登录。',
      'admin.bootstrapToken': '初始化 token',
      'admin.tokenPlaceholder': '粘贴 wrangler secret put BOOTSTRAP_TOKEN 设的 token',
      'admin.deviceName': '设备名(可选)',
      'admin.deviceNamePlaceholder': 'MacBook、iPhone 等',
      'admin.bindAction': '绑定 passkey',
      'admin.bindFailed': '绑定失败',

      'admin.loginTitle': '生物识别登录',
      'admin.loginSub': '使用已注册的 passkey 打开后台。',
      'admin.loginAction': '用 passkey 登录',
      'admin.loginNoPasskey': '本设备没有 passkey?让一个已登录的设备生成一次性链接。',

      'admin.tabStatus': '状态',
      'admin.tabNcm': '网易云账号',
      'admin.tabSecurity': '安全',

      'admin.statBootstrap': '初始化',
      'admin.statBound': '已绑定',
      'admin.statUnbound': '未绑定',
      'admin.statPasskeys': '已绑定设备',
      'admin.statNcmCookie': '网易云 cookie',
      'admin.statCookieActive': '有效',
      'admin.statCookieMissing': '缺失',
      'admin.cookieFromQr': '扫码登录',
      'admin.cookieFromEnv': '部署密钥',

      'admin.qrLoginTitle': '扫码登录',
      'admin.qrLoginHint': '用网易云音乐 APP 扫码绑定你的账号。',
      'admin.qrStart': '显示二维码',
      'admin.qrStarting': '生成中…',
      'admin.qrCancel': '取消',
      'admin.qrStartFailed': '无法启动扫码登录',
      'admin.qrLoggedIn': '网易云账号已连接',
      'admin.qrStatus_idle': '',
      'admin.qrStatus_waiting': '等待扫描…',
      'admin.qrStatus_scanned': '已扫描,请在 APP 确认',
      'admin.qrStatus_confirming': '确认中…',
      'admin.qrStatus_done': '登录成功',
      'admin.qrStatus_expired': '二维码已过期,点击重试',
      'admin.pasteCookieTitle': '手动粘贴 cookie',
      'admin.pasteCookieHint': '备用方案:从已登录的浏览器 devtools 复制 cookie 字符串粘贴到这里。',
      'admin.cookiePlaceholder': 'MUSIC_U=...; os=pc; ...',
      'admin.cookieSave': '保存 cookie',
      'admin.cookieSaved': 'cookie 已保存',
      'admin.cookieSaveFailed': '保存 cookie 失败',
      'admin.cookieClear': '退出网易云登录',
      'admin.cookieCleared': 'cookie 已清除',
      'admin.cookieClearConfirm': '删除已存储的网易云 cookie?可以重新扫码登录。',

      'admin.ipAllowlistTitle': 'IP 白名单',
      'admin.ipAllowlistHint': '每行一个 IP(或逗号分隔)。留空 = 沿用 ALLOWED_IPS 部署密钥。',
      'admin.ipPlaceholder': '1.2.3.4\n5.6.7.8',
      'admin.ipSave': '保存白名单',
      'admin.ipSaved': '白名单已更新',
      'admin.ipSaveFailed': '更新白名单失败',
      'admin.passkeysTitle': '设备',
      'admin.removePasskey': '删除',
      'admin.removePasskeyConfirm': '删除此 passkey?之后将无法从该设备登录。',
      'admin.addPasskey': '添加设备',
      'admin.passkeyAdded': '设备已添加',

      'admin.oneTimeLinkTitle': '一次性登录链接',
      'admin.oneTimeLinkHint': '生成一个 10 分钟内有效、仅可使用一次的链接。在新设备上打开即可添加它的 passkey。',
      'admin.oneTimeLinkGenerate': '生成链接',
      'admin.oneTimeLinkExpires': '剩余',
      'admin.copyLink': '复制',
      'admin.expired': '已过期',

      'admin.otpRedeemed': '设备已授权 — 现在可以添加你的 passkey',
      'admin.otpInvalid': '无效或已过期的一次性链接',

      'admin.bound': 'passkey 已绑定 — 欢迎使用',

      // Phase 4:统计 + 日志 tab
      'admin.tabStats': '统计',
      'admin.tabLogs': '日志',
      'admin.statsOverview': '拦截概览(本 isolate)',
      'admin.statsOk': '成功',
      'admin.statsBlockedIp': 'IP 拦截',
      'admin.statsBlockedRate': '限流',
      'admin.statsBlockedAuth': '认证拦截',
      'admin.statsErrors': '错误',
      'admin.statsRefresh': '刷新',
      'admin.statsByPath': '按路径的请求次数',
      'admin.statsNoData': '暂无请求记录。',
      'admin.logsTitle': '实时活动',
      'admin.logsLive': '● 实时',
      'admin.logsOff': '○ 未连接',
      'admin.logsEmpty': '等待事件…',
    },
  },
  register() {
    // No commands to register — the /admin route is excluded from the ⌘K palette by
    // ROUTE_META.inCommandPalette = false. Reach it by direct URL only.
  },
}
