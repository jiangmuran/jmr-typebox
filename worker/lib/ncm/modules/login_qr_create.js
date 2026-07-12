// login_qr_create — build the QR-code URL string. We DON'T render the QR image server-side
// (the upstream module pulls in the `qrcode` npm package for that); the frontend already has
// `qrcode@1.5.4` as a dependency and renders the image locally. This keeps the Worker bundle
// lean and avoids shipping image bytes over the wire.
//
// Returned shape: { qrurl, qrimg: '' } — frontend treats qrimg === '' as "render locally from qrurl".
export default function login_qr_create(query) {
  const platform = query.platform || 'pc'
  let url = `https://music.163.com/login?codekey=${query.key}`
  // The web-variant chainId is derived from cookie state we don't track server-side; skip it.
  // NCM accepts the plain codekey URL just fine for the mobile/desktop scan flow.
  if (platform === 'web') {
    // intentionally no chainId — clients that need it can build it from cookie state locally
  }
  return {
    status: 200,
    body: {
      code: 200,
      data: { qrurl: url, qrimg: '' },
    },
    cookie: [],
  }
}
