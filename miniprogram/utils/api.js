// Conversa com o SOT (/api/mp/*). A identidade é só o WeChat: wx.login() →
// code → o SOT troca pelo OpenID e devolve uma sessão assinada (7 dias).
const { API_BASE } = require("../config");

const TOKEN_KEY = "sot_token";

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (r) => (r.code ? resolve(r.code) : reject(new Error("wx.login: no code"))),
      fail: (e) => reject(new Error(e.errMsg || "wx.login failed")),
    });
  });
}

function raw(method, path, data, token) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_BASE + path,
      method,
      data,
      header: Object.assign(
        { "content-type": "application/json" },
        token ? { Authorization: "Bearer " + token } : {}
      ),
      success: (res) => resolve(res),
      fail: (e) => reject(new Error(e.errMsg || "Network error")),
    });
  });
}

function errorOf(res) {
  return (res.data && res.data.error) || "Error " + res.statusCode;
}

/** Login (sempre que abre): devolve { token, contacts }. */
async function login() {
  const code = await wxLogin();
  const res = await raw("POST", "/api/mp/login", { code });
  if (res.statusCode !== 200) throw new Error(errorOf(res));
  wx.setStorageSync(TOKEN_KEY, res.data.token);
  const app = getApp();
  app.globalData.token = res.data.token;
  app.globalData.contacts = res.data.contacts;
  return res.data;
}

/** Chamada autenticada; sessão vencida (401) → refaz o login uma vez. */
async function call(method, path, data) {
  let token = getApp().globalData.token || wx.getStorageSync(TOKEN_KEY);
  if (!token) token = (await login()).token;
  let res = await raw(method, path, data, token);
  if (res.statusCode === 401) {
    token = (await login()).token;
    res = await raw(method, path, data, token);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(errorOf(res));
  return res.data;
}

module.exports = { login, call };
