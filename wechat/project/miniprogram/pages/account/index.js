const { beijingTime, quantity, cny } = require("../../utils/view.js");
const { copySource, openEditor } = require("../../utils/platform.js");

const phaseText = {
  starting: "正在恢复登录", "signed-out": "当前使用本机档案", ready: "已连接云端",
  pending: "等待同步", conflict: "有版本差异", offline: "云端暂不可用", expired: "登录已过期",
};

Page({
  data: { login: false, busy: true },
  onShow() {
    this.stopProfile = getApp().profiles.subscribe(state => {
      const privacy = getApp().privacy;
      const comparison = state.phase === "conflict" && state.remote
        ? [
          { field: "cash", title: "现金", format: value => cny(value, false) },
          { field: "goldGrams", title: "黄金", format: value => quantity(value) + " 克" },
          { field: "fundUnits", title: "基金", format: value => quantity(value) + " 份" },
        ].map(({ field, title, format }) => ({
          title, local: privacy ? "••••" : format(state.profile[field]),
          cloud: privacy ? "••••" : format(state.remote.profile[field]),
        })) : [];
      this.setData({
        email: state.email, signedIn: state.signedIn, login: state.phase !== "starting" && (!state.signedIn || state.phase === "expired"),
        busy: state.busy || state.phase === "starting", notice: state.notice, summary: phaseText[state.phase],
        privacy, revision: state.revision, canImport: state.canImport, pending: state.hasPending,
        conflict: state.phase === "conflict", remoteVersion: state.remoteRevision,
        canUseCloud: !!state.remote, remoteTime: beijingTime(state.remote?.updatedAt), comparison,
      });
    });
  },
  onHide() { this.stopProfile?.(); },
  onUnload() { this.onHide(); },
  async submit(event) {
    const fields = event.detail.value;
    await getApp().profiles.signIn(String(fields.email || ""), String(fields.password || ""));
  },
  refresh() { void getApp().profiles.refresh(); },
  logout() { void getApp().profiles.signOut(); },
  togglePrivacy(event) {
    getApp().setPrivacy(event.detail.value);
    // Rebuild the comparison without putting unmasked holdings into the template.
    this.onHide();
    this.onShow();
  },
  keepLocal() {
    const store = getApp().profiles;
    if (!this.data.conflict) { void store.keepLocal(); return; }
    const reviewedRevision = this.data.remoteVersion;
    wx.showModal({
      title: "用本机档案更新云端",
      content: "将另存一个云端版本。其他设备刷新后会读取这个版本。",
      success: res => { if (res.confirm) void store.keepLocal(reviewedRevision); },
    });
  },
  useCloud() {
    const reviewedRevision = this.data.remoteVersion;
    wx.showModal({
      title: "采用云端档案",
      content: "当前小程序会切换到云端版本。本机历史副本会保留。",
      success: res => { if (res.confirm) getApp().profiles.useCloud(reviewedRevision); },
    });
  },
  importLocal() {
    wx.showModal({
      title: "同步本机档案",
      content: "把未登录时在这台设备录入的档案上传至当前青览账号。",
      success: res => { if (res.confirm) void getApp().profiles.importLocal(); },
    });
  },
  copySource, openEditor,
});
