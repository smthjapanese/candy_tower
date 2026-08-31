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
      features: {
        LoadingAPI: { ready: () => console.log('[mock] LoadingAPI.ready()') },
        GameplayAPI: {
          start: () => console.log('[mock] GameplayAPI.start()'),
          stop: () => console.log('[mock] GameplayAPI.stop()')
        }
      },
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

    // Settles the mock fallback at most once. /sdk.js либо грузится (onload),
    // либо не существует и браузер сразу бьёт 404 (onerror) — это происходит
    // быстро и надёжно, поэтому таймаут здесь только "аварийный" случай на
    // случай, если запрос вообще завис (ни onload, ни onerror). Раньше таймаут
    // был коротким (1.5с) и участвовал в гонке с реальной загрузкой — на
    // медленной мобильной сети внутри самой платформы Yandex это могло
    // подменить настоящий SDK заглушкой ещё до того, как /sdk.js успевал
    // ответить, и игра навсегда оставалась без рекламы и облачных сохранений.
    let settled = false;
    const fallbackToMock = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ysdk = createMockSDK();
      resolveAllReady();
    };
    const timeout = setTimeout(fallbackToMock, 8000);

    script.onload = () => {
      if (settled) return; // аварийный таймаут уже сработал — не перезаписываем состояние
      clearTimeout(timeout);
      if (typeof YaGames === 'undefined') {
        fallbackToMock();
        return;
      }
      YaGames.init()
        .then((sdk) => {
          if (settled) return;
          settled = true;
          ysdk = sdk;
          resolveAllReady();
        })
        .catch(fallbackToMock);
    };
    script.onerror = fallbackToMock;
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

    /**
     * Сигналы GameplayAPI: сообщают платформе, идёт ли сейчас активный геймплей.
     * Пока start() не "закрыт" через stop(), платформа не должна перекрывать
     * игру интерстишлом — это требование Yandex Games к прохождению модерации.
     * Вызывать start() при начале забега и stop() перед показом любой рекламы
     * или на экране "game over"/предложении продолжить.
     */
    gameplayStart() {
      whenReady().then(() => {
        try { ysdk.features.GameplayAPI?.start(); } catch (e) {}
      });
    },
    gameplayStop() {
      whenReady().then(() => {
        try { ysdk.features.GameplayAPI?.stop(); } catch (e) {}
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
