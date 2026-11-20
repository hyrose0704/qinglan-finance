const { LESSONS, TRACKS, readLearningProgress } = require("../../utils/shared.js");
const { readSetting, writeSetting, copySource } = require("../../utils/platform.js");

const progressKey = "qinglan-learning-v1";

Page({
  data: { lesson: null, selected: -1, feedback: "" },
  onLoad(options) {
    const index = LESSONS.findIndex(item => item.id === options.id);
    const lesson = LESSONS[index];
    if (!lesson) return;
    const progress = readLearningProgress(readSetting(progressKey, {}));
    this.lesson = lesson;
    this.setData({
      lesson, next: LESSONS[index + 1]?.id || "", track: TRACKS[lesson.track],
      sources: [lesson.source, ...(lesson.furtherReading || [])], passed: progress[lesson.id] === lesson.answer,
    });
  },
  answer(event) {
    const { lesson } = this;
    const selected = Number(event.currentTarget.dataset.answer);
    if (!lesson || !Number.isInteger(selected) || selected < 0 || selected >= lesson.options.length) return;
    if (selected !== lesson.answer) {
      this.setData({ selected, feedback: "再试一次。可以回到上方核对计算依据。" });
      return;
    }
    const saved = writeSetting(progressKey, { ...readLearningProgress(readSetting(progressKey, {})), [lesson.id]: selected });
    this.setData({ selected, passed: saved || this.data.passed,
      feedback: "答对了。" + lesson.explanation + (saved ? "" : " 当前设备未能保存答题进度。") });
  },
  next() { wx.redirectTo({ url: "/pages/lesson/index?id=" + encodeURIComponent(this.data.next) }); },
  openLab() {
    const mode = this.lesson?.id === "qdii" ? "currency" : this.lesson?.track === "basics" ? "compound" : "valuation";
    wx.navigateTo({ url: "/pages/lab/index?mode=" + mode });
  },
  goPlan() { wx.switchTab({ url: "/pages/plan/index" }); },
  copySource,
});
