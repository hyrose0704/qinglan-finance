const storage = {
  getItem(key) {
    const value = wx.getStorageSync(key);
    return typeof value === "string" && value ? value : null;
  },
  setItem(key, value) {
    wx.setStorageSync(key, value);
  },
};

function readSetting(key, fallback) {
  try {
    const value = storage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeSetting(key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function request(url, { method = "GET", data, headers } = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      header: { Accept: "application/json", ...headers },
      timeout: 12000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        const error = new Error("服务器请求未成功。");
        error.status = response.statusCode;
        error.code = response.data?.code || response.data?.error_code;
        reject(error);
      },
      fail(error) {
        const hint = /url not in domain list|合法域名/i.test(error?.errMsg || "")
          ? "此小程序 AppID 尚未配置请求域名。" : "网络连接暂不可用。";
        reject(new Error(hint));
      },
    });
  });
}

function copySource(event) {
  const { url } = event.currentTarget.dataset;
  if (typeof url !== "string" || !/^https:\/\/[^\s\\]+$/.test(url)) return;
  wx.setClipboardData({
    data: url,
    fail: () => wx.showModal({ title: "原文地址", content: url, showCancel: false }),
  });
}

function openEditor() { wx.navigateTo({ url: "/pages/editor/index" }); }
function openAccount() { wx.navigateTo({ url: "/pages/account/index" }); }
function openLesson(event) {
  wx.navigateTo({ url: "/pages/lesson/index?id=" + encodeURIComponent(event.currentTarget.dataset.id) });
}

module.exports = { storage, readSetting, writeSetting, request, copySource, openEditor, openAccount, openLesson };
