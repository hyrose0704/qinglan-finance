const { LESSONS, TRACKS, readLearningProgress, searchKnowledge } = require("../../utils/shared.js");
const { readSetting, openLesson } = require("../../utils/platform.js");

Page({
  data: {
    tracks: Object.entries(TRACKS).map(([id, title]) => ({ id, title })),
    track: "basics", query: "", rows: [], results: [], completed: 0, total: LESSONS.length,
  },
  onShow() { this.draw(); },
  draw() {
    const progress = readLearningProgress(readSetting("qinglan-learning-v1", {}));
    const query = this.data.query.trim();
    this.setData({
      rows: LESSONS.filter(item => item.track === this.data.track).map(item => ({
        id: item.id, title: item.title, minutes: item.minutes, done: progress[item.id] === item.answer,
      })),
      searching: query.length >= 2, results: query.length >= 2 ? searchKnowledge(query) : [],
      completed: Object.keys(progress).length,
    });
  },
  search(event) { this.setData({ query: event.detail.value }); this.draw(); },
  setTrack(event) { this.setData({ track: event.currentTarget.dataset.id, query: "" }); this.draw(); },
  openLab() { wx.navigateTo({ url: "/pages/lab/index" }); },
  openLesson,
});
