const published = require("./data/published.js");
const { storage, readSetting, writeSetting, request } = require("./utils/platform.js");
const { createProfileStore } = require("./utils/profile-store.js");
const { createMarketStore } = require("./utils/market-store.js");

App({
  onLaunch() {
    this.privacy = readSetting("qinglan-privacy-v1", false) === true;
    this.market = createMarketStore(published, request, readSetting, writeSetting);
    this.profiles = createProfileStore(published.cloud, storage, request);
    void this.profiles.restore();
  },
  onShow() {
    void this.profiles.refreshIfStale();
  },
  setPrivacy(hidden) {
    this.privacy = hidden === true;
    writeSetting("qinglan-privacy-v1", this.privacy);
  },
});
