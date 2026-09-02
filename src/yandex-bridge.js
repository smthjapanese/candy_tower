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
  // Позволяет проверять автоопределение языка локально: ?lang=en в адресной
  // строке подставляет этот код в environment.i18n.lang заглушки, как если
  // бы именно такой язык вернул настоящий Yandex SDK. Без параметра — 'ru',
  // как и должно быть по умолчанию вне платформы.
  function mockLang() {
    try {
      return new URLSearchParams(window.location.search).get('lang') || 'ru';
    } catch (e) {
      return 'ru';
    }
  }

  // A handful of fake competitors so the leaderboard screen has something to
  // show during local testing. The player's own best (mockPlayerScores, keyed
  // by leaderboard name) is merged in and re-ranked on every read.
  const MOCK_LB_BOTS = [
    { name: 'Мила', score: 640 },
    { name: 'Тимур', score: 480 },
    { name: 'Соня', score: 355 },
    { name: 'Егор', score: 210 },
    { name: 'Ксюша', score: 95 }
  ];
  const mockPlayerScores = {};

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
      getLeaderboards: () =>
        Promise.resolve({
          setLeaderboardScore: (name, score) => {
            mockPlayerScores[name] = Math.max(mockPlayerScores[name] || 0, score);
            console.log('[mock] leaderboard "' + name + '" score set: ' + score);
            return Promise.resolve();
          },
          getLeaderboardEntries: (name) => {
            const playerScore = mockPlayerScores[name] || 0;
            const entries = MOCK_LB_BOTS.map((b) => ({
              score: b.score,
              formattedScore: String(b.score),
              player: { publicName: b.name, getAvatarSrc: () => null },
              isPlayer: false
            }));
            entries.push({
              score: playerScore,
              formattedScore: String(playerScore),
              player: { publicName: null, getAvatarSrc: () => null },
              isPlayer: true
            });
            entries.sort((a, b) => b.score - a.score);
            entries.forEach((e, i) => { e.rank = i + 1; });
            const userEntry = entries.find((e) => e.isPlayer);
            return Promise.resolve({ entries, userRank: userEntry ? userEntry.rank : null });
          }
        }),
      environment: { i18n: { lang: mockLang() } }
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
     * Определение языка интерфейса Yandex Games (требование п. 2.14 модерации —
     * никаких хардкодных языков, язык должен приходить из SDK). Дожидается
     * готовности SDK и возвращает код языка платформы; если SDK недоступен или
     * поле не пришло — фолбэк на 'ru'. Что делать с кодом, если игра его не
     * поддерживает — решает вызывающий код (game.js), это не забота моста.
     */
    async getLang() {
      await whenReady();
      try {
        return ysdk.environment.i18n.lang || 'ru';
      } catch (e) {
        return 'ru';
      }
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

    isMock() { return isMock; },

    /**
     * Отправляет результат в таблицу лидеров Yandex Games. Лидерборд с таким
     * техническим именем должен быть заранее создан в консоли разработчика
     * (числовой тип, сортировка по убыванию) — до этого момента вызов просто
     * молча ничего не делает на боевой платформе. Всегда безопасно вызывать:
     * ошибки (нет доступа, лидерборд не настроен, игрок не авторизован)
     * проглатываются, чтобы не мешать основному геймплею.
     */
    async setLeaderboardScore(name, score) {
      await whenReady();
      try {
        const lb = await ysdk.getLeaderboards();
        await lb.setLeaderboardScore(name, score);
      } catch (e) {}
    },

    /**
     * Возвращает { entries, userRank } или null, если лидерборд недоступен
     * (SDK не поддерживает его, лидерборд не создан в консоли, игрок не
     * авторизован и т.п.) — вызывающий код должен уметь показать пустое
     * состояние в этом случае.
     */
    async getLeaderboardEntries(name, options) {
      await whenReady();
      try {
        const lb = await ysdk.getLeaderboards();
        const opts = options || { quantityTop: 10, includeUser: true, quantityAround: 5 };
        return await lb.getLeaderboardEntries(name, opts);
      } catch (e) {
        return null;
      }
    }
  };

  return api;
})();
