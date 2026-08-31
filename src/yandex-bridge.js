/**
 * yandex-bridge.js
 *
 * Единая точка входа для всего, что связано с Yandex SDK: реклама, сохранения, готовность.
 * На платформе Yandex Игры файл /sdk.js подставляется автоматически хостингом —
 * его не нужно и нельзя скачивать самому, он появляется только когда игра
 * реально открыта на games.yandex.ru.
 *
 * Локально (при тестировании в обычном браузере) /sdk.js не существует,
 * поэтому здесь есть fallback-заглушка с тем же интерфейсом — можно спокойно
 * тестировать геймплей и монетизационные хуки без выкладки на платформу.
 */

window.gameBridge = (function () {
  let ysdk = null;
  let ready = false;
  let readyResolvers = [];
  let isMock = false;

  function whenReady() {
    return new Promise((resolve) => {
      if (ready) resolve();
      else readyResolvers.push(resolve);
    });
  }

  function resolveAllReady() {
    ready = true;
    readyResolvers.forEach((r) => r());
    readyResolvers = [];
  }

  // ---------- Заглушка для локального тестирования ----------
  function createMockSDK() {
    isMock = true;
    console.warn('[yandex-bridge] /sdk.js не найден — используется локальная заглушка для тестов.');
    return {
      features: { LoadingAPI: { ready: () => console.log('[mock] LoadingAPI.ready()') } },
      adv: {
        showFullscreenAdv: ({ callbacks } = {}) => {
          console.log('[mock] показ межстраничной рекламы (пропущено)');
          callbacks && callbacks.onClose && callbacks.onClose(true);
        },
        showRewardedVideo: ({ callbacks } = {}) => {
          console.log('[mock] показ rewarded-видео (сразу засчитано как просмотренное)');
          callbacks && callbacks.onRewarded && callbacks.onRewarded();
          callbacks && callbacks.onClose && callbacks.onClose();
        }
      },
      getStorage: () =>
        Promise.resolve({
          getItem: (k) => localStorage.getItem(k),
          setItem: (k, v) => localStorage.setItem(k, v)
        }),
      environment: { i18n: { lang: 'ru' } }
    };
  }

  function loadSDK() {
    const script = document.createElement('script');
    script.src = '/sdk.js';

    const timeout = setTimeout(() => {
      // /sdk.js не откликнулся (мы не на платформе Yandex) — используем заглушку
      ysdk = createMockSDK();
      resolveAllReady();
    }, 1500);

    script.onload = () => {
      clearTimeout(timeout);
      if (typeof YaGames === 'undefined') {
        ysdk = createMockSDK();
        resolveAllReady();
        return;
      }
      YaGames.init()
        .then((sdk) => {
          ysdk = sdk;
          resolveAllReady();
        })
        .catch(() => {
          ysdk = createMockSDK();
          resolveAllReady();
        });
    };
    script.onerror = () => {
      clearTimeout(timeout);
      ysdk = createMockSDK();
      resolveAllReady();
    };
    document.body.appendChild(script);
  }

  // ---------- Публичное API ----------
  const api = {
    init() {
      loadSDK();
      return whenReady();
    },

    /** Вызывать один раз, когда игра реально показана на экране (первый кадр отрисован). */
    ready() {
      whenReady().then(() => {
        try { ysdk.features.LoadingAPI?.ready(); } catch (e) {}
      });
    },

    /** Межстраничная реклама между забегами. callback вызывается после закрытия рекламы. */
    showInterstitial(callback) {
      whenReady().then(() => {
        try {
          ysdk.adv.showFullscreenAdv({
            callbacks: {
              onClose: () => callback && callback(),
              onError: () => callback && callback()
            }
          });
        } catch (e) {
          callback && callback();
        }
      });
    },

    /**
     * Rewarded-видео. onRewarded вызывается только если ролик досмотрен до конца —
     * именно на этот колбэк вешается сама награда (второй шанс, буст и т.д.).
     * onClose вызывается всегда при закрытии (досмотрел или нет).
     */
    showRewarded(onRewarded, onClose) {
      whenReady().then(() => {
        try {
          ysdk.adv.showRewardedVideo({
            callbacks: {
              onRewarded: () => onRewarded && onRewarded(),
              onClose: () => onClose && onClose()
            }
          });
        } catch (e) {
          onClose && onClose();
        }
      });
    },

    /** Сохранение прогресса. Пытается через игровое хранилище SDK, иначе — localStorage. */
    async saveData(obj) {
      await whenReady();
      try {
        const storage = await ysdk.getStorage();
        storage.setItem('candyTowerMeta', JSON.stringify(obj));
      } catch (e) {
        try { localStorage.setItem('candyTowerMeta', JSON.stringify(obj)); } catch (e2) {}
      }
    },

    async loadData() {
      await whenReady();
      try {
        const storage = await ysdk.getStorage();
        const raw = storage.getItem('candyTowerMeta');
        return raw ? JSON.parse(raw) : { best: 0, candy: 0 };
      } catch (e) {
        try {
          const raw = localStorage.getItem('candyTowerMeta');
          return raw ? JSON.parse(raw) : { best: 0, candy: 0 };
        } catch (e2) {
          return { best: 0, candy: 0 };
        }
      }
    },

    isMock() { return isMock; }
  };

  return api;
})();
