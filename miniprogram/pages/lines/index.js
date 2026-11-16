const { login, call } = require("../../utils/api");
const dates = require("../../utils/dates");

const TITLES = {
  delay: "延期 · Report a delay",
  ready: "已备好 · Parts ready",
  undo: "撤销已备好 · Undo parts ready",
};

function decorate(line) {
  return Object.assign({}, line, {
    shipLabel: dates.show(line.ship_requirement),
    initialLabel: dates.show(line.initial_date),
    currentLabel: dates.show(line.current_date),
    readyLabel: line.ready_parts ? dates.show(line.ready_date) : "—",
  });
}

Page({
  data: {
    loading: true,
    error: "",
    lines: [],
    factories: "",
    pendingCount: 0,
    today: dates.today(),
    form: null,
    busy: false,
  },

  async onLoad() {
    try {
      const res = await login();
      if (!res.contacts.length) {
        wx.reLaunch({ url: "/pages/bind/index" });
        return;
      }
    } catch (e) {
      this.setData({ loading: false, error: e.message });
      return;
    }
    this.load();
  },

  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },

  async load() {
    this.setData({ loading: true, error: "", today: dates.today() });
    try {
      const res = await call("GET", "/api/mp/lines");
      if (!res.contacts.length) {
        wx.reLaunch({ url: "/pages/bind/index" });
        return;
      }
      const lines = res.data.map(decorate);
      this.setData({
        loading: false,
        lines,
        factories: res.contacts.map((c) => c.factory_name).join(", "),
        pendingCount: lines.filter((l) => !l.initial_date).length,
      });
    } catch (e) {
      this.setData({ loading: false, error: e.message });
    }
  },

  find(id) {
    return this.data.lines.find((l) => l.id === id);
  },

  replace(updated) {
    const lines = this.data.lines.map((l) => (l.id === updated.id ? decorate(updated) : l));
    this.setData({ lines, pendingCount: lines.filter((l) => !l.initial_date).length });
  },

  async patch(id, body) {
    const res = await call("PATCH", "/api/mp/lines/" + id, body);
    this.replace(res.data);
  },

  /** Initial Date: confirma antes — depois de gravada, só muda como atraso. */
  onInitial(e) {
    const id = e.currentTarget.dataset.id;
    const day = e.detail.value;
    const line = this.find(id);
    wx.showModal({
      title: "确认交货期 · Confirm ETD",
      content:
        "PO " + line.po_number + " · " + line.category + "\n" + dates.show(day) +
        "\n\n确认后不可修改，如有变化请使用「延期」。Once confirmed, changes go through Delay.",
      confirmText: "确认",
      cancelText: "取消",
      success: async (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: "…" });
        try {
          await this.patch(id, { initial_date: day });
          wx.hideLoading();
          wx.showToast({ title: "已保存 Saved", icon: "success" });
        } catch (err) {
          wx.hideLoading();
          wx.showModal({ title: "Error", content: err.message, showCancel: false });
        }
      },
    });
  },

  openForm(e) {
    const { id, kind } = e.currentTarget.dataset;
    const line = this.find(id);
    const today = dates.today();
    this.setData({
      form: {
        id,
        kind,
        title: TITLES[kind],
        po: line.po_number,
        category: line.category,
        date: kind === "ready" ? today : "",
        dateLabel: kind === "ready" ? dates.show(today) : "",
        // Atraso: a partir de hoje. Ready: a data real, nunca futura.
        start: kind === "delay" ? today : "2000-01-01",
        end: kind === "ready" ? today : "2100-12-31",
        // O SOT exige motivo para atraso e para desfazer o Ready parts.
        needsReason: kind !== "ready",
        remarks: "",
        error: "",
      },
    });
  },

  closeForm() {
    if (!this.data.busy) this.setData({ form: null });
  },
  noop() {},

  onFormDate(e) {
    this.setData({ "form.date": e.detail.value, "form.dateLabel": dates.show(e.detail.value) });
  },
  onFormRemarks(e) {
    this.setData({ "form.remarks": e.detail.value });
  },

  async submitForm() {
    const f = this.data.form;
    const remarks = f.remarks.trim();
    if (f.kind !== "undo" && !f.date) {
      this.setData({ "form.error": "请选择日期 · Pick a date." });
      return;
    }
    if (f.needsReason && !remarks) {
      this.setData({ "form.error": "请填写原因 · Write the reason." });
      return;
    }

    let body;
    if (f.kind === "delay") body = { current_date: f.date, remarks };
    else if (f.kind === "ready") body = { ready_date: f.date };
    else body = { ready_date: null, remarks };

    this.setData({ busy: true, "form.error": "" });
    try {
      await this.patch(f.id, body);
      this.setData({ busy: false, form: null });
      wx.showToast({ title: "已保存 Saved", icon: "success" });
    } catch (err) {
      this.setData({ busy: false, "form.error": err.message });
    }
  },
});
