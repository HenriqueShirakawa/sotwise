const { login, call } = require("../../utils/api");

/** Convite que veio no QR: scene = "i=<código>" (codificado na URL). */
function inviteFromScene(options) {
  const scene = options && options.scene ? decodeURIComponent(options.scene) : "";
  const match = /(?:^|&)i=([A-Za-z0-9]+)/.exec(scene);
  return match ? match[1] : "";
}

Page({
  data: { invite: "", name: "", busy: false, error: "", contacts: [] },

  async onLoad(options) {
    this.setData({ invite: inviteFromScene(options) });
    try {
      const res = await login();
      const known = res.contacts.length ? res.contacts[0].name : "";
      this.setData({ contacts: res.contacts, name: this.data.name || known });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },

  onInvite(e) {
    this.setData({ invite: e.detail.value });
  },
  onName(e) {
    this.setData({ name: e.detail.value });
  },

  async submit() {
    const invite = this.data.invite.trim();
    const name = this.data.name.trim();
    if (!invite || !name) {
      this.setData({ error: "请填写邀请码和姓名 · Fill in the code and your name." });
      return;
    }
    this.setData({ busy: true, error: "" });
    try {
      const res = await call("POST", "/api/mp/bind", { invite, name });
      getApp().globalData.contacts = res.contacts;
      wx.showToast({ title: "已绑定 Linked", icon: "success" });
      wx.reLaunch({ url: "/pages/lines/index" });
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ busy: false });
    }
  },

  goLines() {
    wx.reLaunch({ url: "/pages/lines/index" });
  },
});
