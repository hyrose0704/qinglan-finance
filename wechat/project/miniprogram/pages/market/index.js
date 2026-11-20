const { morningWindow } = require("../../utils/shared.js");
const { editionView, snapshotCards, beijingTime } = require("../../utils/view.js");
const { copySource, openAccount, openEditor, openLesson } = require("../../utils/platform.js");

Page({
  data: { issue: null, dates: [], dateIndex: 0, loading: false, showQuotes: false, showSources: false, openEvidence: "" },
  selected: "",
  onShow() {
    const app = getApp();
    this.stopMarket = app.market.subscribe(() => this.draw());
    this.stopProfile = app.profiles.subscribe(() => this.draw());
    this.timer = setInterval(() => void app.market.refresh(), 300000);
    void app.market.refresh();
  },
  onHide() {
    this.stopMarket?.();
    this.stopProfile?.();
    clearInterval(this.timer);
  },
  onUnload() { this.onHide(); },
  draw() {
    const app = getApp();
    const info = app.market.snapshot();
    const account = app.profiles.snapshot();
    const editions = info.brief?.editions || [];
    const found = editions.findIndex(edition => edition.date === this.selected);
    const dateIndex = Math.max(0, found);
    if (this.selected && found < 0) this.selected = "";
    const edition = editions[dateIndex];
    const privacy = app.privacy;
    const loadingProfile = account.phase === "starting" || account.busy && !account.hasProfile;
    this.setData({
      issue: edition ? editionView(edition, account.profile, privacy || loadingProfile) : null,
      archiveNote: edition && edition.date < morningWindow(Date.now()).date
        ? (dateIndex > 0 ? "历史晨报 · 按当前持仓回算" : "本期尚未同步，当前显示最近一期") : "",
      dates: editions.map(item => item.date), dateIndex,
      loading: info.loading, warning: info.warning, packed: info.status === "snapshot",
      saved: account.hasProfile, privacy, loadingProfile,
      quotes: snapshotCards(info.market), quoteTime: beijingTime(info.market?.fetchedAt),
    });
  },
  selectIssue(event) {
    this.selected = this.data.dates[Number(event.detail.value)] || "";
    this.setData({ openEvidence: "" });
    this.draw();
  },
  async refresh() { await getApp().market.refresh(true); },
  async onPullDownRefresh() {
    try { await this.refresh(); } finally { wx.stopPullDownRefresh(); }
  },
  toggleQuotes() { this.setData({ showQuotes: !this.data.showQuotes }); },
  toggleSources() { this.setData({ showSources: !this.data.showSources }); },
  toggleEvidence(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ openEvidence: this.data.openEvidence === id ? "" : id });
  },
  copySource, openAccount, openEditor, openLesson,
});
