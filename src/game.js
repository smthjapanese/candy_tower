// ---------- Design tokens: candy / dessert theme ----------
const PALETTE = {
  bgTop:    0x8C2F63,
  bgBottom: 0x3A1550,
  base:     0x6B4226,
  tiers: [
    0xFF8FAB, 0xFFD166, 0x8AE68A, 0xB39CFF, 0xFF9F5A, 0xFF5C7A
  ],
  danger:   0xFF5C4D,
  bonus:    0xFFD166,
  textMain: '#FFF3E6',
  textDim:  '#D9B79A'
};

const W = 400, H = 700;
const BLOCK_H = 42;
const BLOCK_W = 130;
const MIN_OVERLAP = 16;
const BASE_Y = 600;
const SPAWN_Y = 130;
const SCROLL_THRESHOLD = 220;
const HAZARD_CHANCE = 0.42;
const GROWTH = 20;
const LEAN_COLLAPSE = 65;
const PIVOT_X = W/2;
const PIVOT_Y0 = BASE_Y + BLOCK_H;
const INTERSTITIAL_EVERY = 2; // show an interstitial every Nth death

// Technical name of the Yandex Games leaderboard this game submits to. Must
// be created in the developer console first (numeric type, descending order)
// — see README. Submitting to a leaderboard that doesn't exist yet is a
// harmless no-op (yandex-bridge swallows the error).
const LEADERBOARD_NAME = 'candyTowerHeight';

// Persists across scene.restart() (which re-runs create() on the same scene
// instance) so the "every Nth death" cadence actually accumulates over a
// play session instead of resetting to 0 on every replay.
let sessionDeathCount = 0;

// shade(color, +0.4) lightens toward white, shade(color, -0.4) darkens toward black
function shade(color, percent) {
  const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
  const t = percent < 0 ? 0 : 255;
  const p = Math.abs(percent);
  const nr = Math.round((t - r) * p) + r;
  const ng = Math.round((t - g) * p) + g;
  const nb = Math.round((t - b) * p) + b;
  return (nr << 16) | (ng << 8) | nb;
}

// ---------- persisted player state (shared across scenes) ----------
function normalizeMeta(m) {
  const ownedSkins = Array.isArray(m && m.ownedSkins) && m.ownedSkins.length ? m.ownedSkins.slice() : [0];
  return {
    best: (m && m.best) || 0,
    candy: (m && m.candy) || 0,
    skin: (m && Number.isInteger(m.skin)) ? m.skin : 0,
    ownedSkins,
    soundOn: !(m && m.soundOn === false)
  };
}

// candy flavours sold in the shop — index 0 mirrors PALETTE.tiers[0] and is
// always owned/selected by default; the rest unlock with earned candy. Names
// are looked up from STRINGS[lang].skinNames by index, not stored here — this
// data is purely visual (colours/price), never localized.
const SKIN_DEFS = [
  { top: 0xFFB3C6, bot: 0xFF6F97, dark: 0x7A1F3D, price: 0 },
  { top: 0xFFE29A, bot: 0xF7B93B, dark: 0x8A5A12, price: 100 },
  { top: 0xB8F0B8, bot: 0x5FC95F, dark: 0x2F6B3A, price: 150 },
  { top: 0xC9BBFF, bot: 0x8F72E8, dark: 0x443077, price: 250 },
  { top: 0xFFCB7A, bot: 0xE8843C, dark: 0x7A4A18, price: 200 },
  { top: 0xFF9DAE, bot: 0xE8405F, dark: 0x7A1030, price: 300 }
];

// ---------- localized UI strings ----------
// Only 'ru' exists today (the only language Yandex moderation approved), but
// every UI-facing string routes through here so adding STRINGS.en later is a
// pure data change — no call site needs to change. Values that need runtime
// data (score, combo, etc.) are functions; everything else is a plain string.
const STRINGS = {
  ru: {
    tapHint: 'Тапни, чтобы уронить конфету',
    towerLean: 'Наклон башни',
    continueTitle: 'БАШНЯ ПОШАТНУЛАСЬ',
    continueSub: 'Посмотри рекламу — и башня устоит',
    watchAd: '▶ СМОТРЕТЬ РЕКЛАМУ',
    skip: 'Пропустить',
    gameOverTitle: 'БАШНЯ РУХНУЛА',
    statRecord: 'РЕКОРД',
    statCandy: 'КОНФЕТЫ',
    retry: 'ЕЩЁ РАЗ',
    shareCopied: 'Скопировано!',
    shareText: (score) => `Я построил Сладкую Башню высотой ${score} очков! Сможешь лучше?`,
    pauseTitle: 'ПАУЗА',
    pauseResume: 'ПРОДОЛЖИТЬ',
    pauseRestart: 'ЗАНОВО',
    pauseMenu: 'В МЕНЮ',
    bonusPopup: 'БОНУС! +50',
    precisePopup: 'ТОЧНО! +25  ↔ ШИРЕ',
    mergePopup: (combo, bonus) => 'СЛИЯНИЕ x' + combo + '  +' + bonus + '  ↔ ШИРЕ',
    menuTitleTop: 'СЛАДКАЯ',
    menuTitleBottom: 'БАШНЯ',
    play: 'ИГРАТЬ',
    shop: 'МАГАЗИН',
    settings: 'НАСТРОЙКИ',
    bestScore: (best) => 'РЕКОРД: ' + best,
    back: 'НАЗАД',
    notEnoughCandy: 'Не хватает конфет',
    selectedBadge: 'ВЫБРАНО',
    ownedBadge: 'КУПЛЕНО',
    skinNames: ['Клубничный', 'Лимонный', 'Мятный', 'Виноградный', 'Апельсиновый', 'Вишнёвый'],
    leaderboard: 'РЕЙТИНГ',
    leaderboardLoading: 'Загрузка…',
    leaderboardEmpty: 'Рейтинг пока недоступен',
    you: 'ТЫ'
  }
};

// Languages the UI actually has copy for — extend once STRINGS.en (etc.) exists.
const SUPPORTED_LANGS = ['ru'];
let CURRENT_LANG = 'ru';

// Looks up STRINGS[CURRENT_LANG][key], calling it with args when it's a
// template function; falls back to STRINGS.ru if the current language is
// missing that key (keeps a partially-translated future language safe).
function t(key, ...args) {
  const dict = STRINGS[CURRENT_LANG] || STRINGS.ru;
  const entry = key in dict ? dict[key] : STRINGS.ru[key];
  return typeof entry === 'function' ? entry(...args) : entry;
}

// confetti dots for the main menu backdrop — [x, y, size, color]
const MENU_CONFETTI = [
  [24,60,4,0xFFD166],[340,90,3,0x8AE68A],[70,140,5,0xFF8FAB],[300,180,3,0xB39CFF],
  [40,220,3,0xFF9F5A],[360,250,4,0xFF5C7A],[20,320,3,0xFFD166],[350,340,3,0x8AE68A],
  [80,400,4,0xFF8FAB],[310,420,3,0xB39CFF],[30,470,3,0xFF9F5A],[370,500,4,0xFF5C7A],
  [60,540,3,0xFFD166],[330,570,3,0x8AE68A],[15,600,4,0xFF8FAB],[380,620,3,0xB39CFF],
  [100,90,3,0xFF5C7A],[280,120,4,0xFFD166],[120,470,3,0x8AE68A],[260,540,3,0xFF9F5A],
  [150,40,3,0xB39CFF],[220,600,4,0xFF8FAB],[190,340,3,0xFFD166],[10,180,3,0x8AE68A]
];

// tells the platform once per page load that the game's first real screen is up
let loadingReadySent = false;

// ---------- shared candy-themed drawing helpers (used by every scene) ----------
function fillBgGradient(gfx, w, h) {
  gfx.fillGradientStyle(PALETTE.bgTop, PALETTE.bgTop, PALETTE.bgBottom, PALETTE.bgBottom, 1);
  gfx.fillRect(0, 0, w, h);
}

function drawGlowCircle(gfx, cx, cy, r, alpha = 0.05) {
  gfx.fillStyle(0xffffff, alpha);
  gfx.fillCircle(cx, cy, r);
}

function drawPanel(gfx, cx, cy, w, h, radius, borderAlpha = 0.2) {
  gfx.fillStyle(0x000000, 0.25);
  gfx.fillRoundedRect(cx - w/2, cy - h/2, w, h, radius);
  gfx.lineStyle(3, 0xFFF3E6, borderAlpha);
  gfx.strokeRoundedRect(cx - w/2, cy - h/2, w, h, radius);
}

function drawStatCard(gfx, cx, cy, w, h, radius) {
  drawPanel(gfx, cx, cy, w, h, radius, 0.2);
}

function drawCandyIcon(gfx, cx, cy, r) {
  gfx.fillGradientStyle(0xFFE9A8, 0xFFE9A8, 0xE8A93A, 0xE8A93A, 1);
  gfx.fillCircle(cx, cy, r);
  gfx.lineStyle(2, 0x8A5A12, 1);
  gfx.strokeCircle(cx, cy, r);
  gfx.fillStyle(0xffffff, 0.55);
  gfx.fillEllipse(cx - r*0.3, cy - r*0.35, r*0.6, r*0.35);
}

// candy-wrapper pill button: triangular twist caps + glossy rounded body, echoes drawTwist()/drawBlock()
function drawCandyPillButton(gfx, cx, cy, w, h, topColor, botColor, borderColor) {
  const capLen = Math.min(18, h * 0.42);
  const radius = h / 2;
  gfx.fillStyle(borderColor, 1);
  gfx.beginPath();
  gfx.moveTo(cx - w/2, cy - h/2 + h*0.08);
  gfx.lineTo(cx - w/2 - capLen, cy);
  gfx.lineTo(cx - w/2, cy + h/2 - h*0.08);
  gfx.closePath();
  gfx.fillPath();
  gfx.beginPath();
  gfx.moveTo(cx + w/2, cy - h/2 + h*0.08);
  gfx.lineTo(cx + w/2 + capLen, cy);
  gfx.lineTo(cx + w/2, cy + h/2 - h*0.08);
  gfx.closePath();
  gfx.fillPath();

  gfx.fillGradientStyle(topColor, topColor, botColor, botColor, 1);
  gfx.fillRoundedRect(cx - w/2, cy - h/2, w, h, radius);
  gfx.lineStyle(5, borderColor, 1);
  gfx.strokeRoundedRect(cx - w/2, cy - h/2, w, h, radius);

  gfx.fillStyle(0xffffff, 0.45);
  gfx.fillRoundedRect(cx - w/2 + w*0.11, cy - h/2 + h*0.16, w*0.32, h*0.16, 6);
  gfx.fillStyle(0xffffff, 0.55);
  gfx.fillCircle(cx + w/2 - w*0.14, cy - h/2 + h*0.28, Math.max(3, h*0.08));
}

function drawShareButton(gfx, cx, cy, r) {
  gfx.fillStyle(0x000000, 0.28);
  gfx.fillCircle(cx, cy, r);
  gfx.lineStyle(3, 0xFFF3E6, 0.5);
  gfx.strokeCircle(cx, cy, r);

  const s = r * 0.42;
  const p1 = { x: cx - s, y: cy + s*0.5 };
  const p2 = { x: cx + s, y: cy - s };
  const p3 = { x: cx + s, y: cy + s };
  gfx.lineStyle(2, 0xFFF3E6, 0.9);
  gfx.lineBetween(p1.x, p1.y, p2.x, p2.y);
  gfx.lineBetween(p1.x, p1.y, p3.x, p3.y);
  const dotR = Math.max(3, r * 0.15);
  gfx.fillStyle(0xFFF3E6, 1);
  gfx.fillCircle(p1.x, p1.y, dotR);
  gfx.fillCircle(p2.x, p2.y, dotR);
  gfx.fillCircle(p3.x, p3.y, dotR);
}

// round icon-button shell (sound toggle, pause button, and similar circular actions)
function drawIconButton(gfx, cx, cy, r) {
  gfx.fillStyle(0x000000, 0.28);
  gfx.fillCircle(cx, cy, r);
  gfx.lineStyle(3, 0xFFF3E6, 0.5);
  gfx.strokeCircle(cx, cy, r);
}

// trophy icon inside the shared round icon-button shell — opens the leaderboard
function drawTrophyIcon(gfx, cx, cy, r) {
  drawIconButton(gfx, cx, cy, r);
  const cupW = r * 0.85, cupH = r * 0.62, cupTopY = cy - r * 0.5;
  gfx.lineStyle(2.5, 0xFFF3E6, 0.95);
  gfx.beginPath();
  gfx.arc(cx - cupW/2, cupTopY + cupH * 0.32, r * 0.24, Phaser.Math.DegToRad(80), Phaser.Math.DegToRad(280), true);
  gfx.strokePath();
  gfx.beginPath();
  gfx.arc(cx + cupW/2, cupTopY + cupH * 0.32, r * 0.24, Phaser.Math.DegToRad(-80), Phaser.Math.DegToRad(100), true);
  gfx.strokePath();
  gfx.fillStyle(0xFFF3E6, 1);
  gfx.fillRoundedRect(cx - cupW/2, cupTopY, cupW, cupH, 4);
  gfx.fillRect(cx - 2, cupTopY + cupH, 4, r * 0.28);
  gfx.fillRoundedRect(cx - r * 0.38, cupTopY + cupH + r * 0.28, r * 0.76, 4, 2);
}

class MainScene extends Phaser.Scene {
  constructor() { super('main'); }

  create() {
    this.bg = this.add.graphics();
    this.drawBackground();
    this.makeParticleTexture();

    this.meta = normalizeMeta(null);
    this.skinTiers = this.buildSkinTiers(this.meta.skin);
    this.soundOn = this.meta.soundOn;
    // loadData() is async and can resolve after a run already finished (e.g. slow
    // storage on first load + a very fast death) — metaDirty guards against a late
    // resolution stomping progress that finishRun() already wrote into this.meta.
    this.metaDirty = false;
    window.gameBridge.loadData().then((m) => {
      if (this.metaDirty) return;
      this.meta = normalizeMeta(m);
      this.skinTiers = this.buildSkinTiers(this.meta.skin);
      this.soundOn = this.meta.soundOn;
    });

    this.stack = [];
    this.nextY = BASE_Y - BLOCK_H;
    this.score = 0;
    this.combo = 0;
    this.gameOver = false;
    this.paused = false;
    this.swingSpeed = 0.0046;
    this.dropping = false;
    this.hazard = null;
    this.lean = 0;
    this.displayLean = 0;
    this.leanThreshold = LEAN_COLLAPSE;
    this.usedContinue = false;

    this.stackContainer = this.add.container(PIVOT_X, PIVOT_Y0).setDepth(10);
    this.addBaseBlock();

    this.scoreText = this.add.text(W/2, 58, '0', {
      fontFamily: 'Arial, sans-serif', fontSize: '46px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0.5).setDepth(20);

    this.hintText = this.add.text(W/2, 95, t('tapHint'), {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', color: PALETTE.textDim
    }).setOrigin(0.5).setDepth(20);

    this.comboText = this.add.text(W/2, 122, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '18px', fontStyle: 'bold', color: '#FFD166'
    }).setOrigin(0.5).setDepth(20);

    this.stabLabel = this.add.text(W/2, 12, t('towerLean'), {
      fontFamily: 'Arial, sans-serif', fontSize: '10px', color: PALETTE.textDim
    }).setOrigin(0.5).setDepth(20).setAlpha(0.8);
    this.stabBarBg = this.add.rectangle(W/2, 24, 200, 6, 0x2A1710, 0.7).setDepth(20);
    this.stabBarFill = this.add.rectangle(W/2, 24, 0, 6, 0x8AE68A).setOrigin(0.5, 0.5).setDepth(21);

    this.pauseBtnGfx = this.add.graphics().setDepth(22);
    drawIconButton(this.pauseBtnGfx, W - 34, 34, 20);
    this.pauseBtnGfx.lineStyle(4, 0xFFF3E6, 0.9);
    this.pauseBtnGfx.lineBetween(W - 34 - 6, 34 - 9, W - 34 - 6, 34 + 9);
    this.pauseBtnGfx.lineBetween(W - 34 + 6, 34 - 9, W - 34 + 6, 34 + 9);
    this.pauseBtnGfx.setInteractive({
      hitArea: new Phaser.Geom.Circle(W - 34, 34, 20),
      hitAreaCallback: Phaser.Geom.Circle.Contains,
      useHandCursor: true
    });
    this.pauseBtnGfx.on('pointerdown', (p, x, y, e) => { e.stopPropagation(); this.openPause(); });

    this.spawnMovingBlock();
    this.input.on('pointerdown', () => { this.ensureAudio(); this.handleTap(); });

    this.buildOverlayUI();
    this.buildPauseUI();

    // and that active gameplay has begun, so the platform holds off on interstitials
    window.gameBridge.gameplayStart();
  }

  buildSkinTiers(skinIndex) {
    const n = PALETTE.tiers.length;
    const start = ((skinIndex % n) + n) % n;
    return PALETTE.tiers.map((_, i) => PALETTE.tiers[(start + i) % n]);
  }

  // ---------- overlay UI: continue offer + final game-over screen ----------
  buildOverlayUI() {
    this.overlay = this.add.rectangle(W/2, H/2, W, H, 0x2B160C, 0.88).setDepth(30).setVisible(false);

    // continue (rewarded) offer
    this.contTitle = this.add.text(W/2, H/2 - 90, t('continueTitle'), {
      fontFamily: 'Arial, sans-serif', fontSize: '24px', fontStyle: 'bold', color: '#FFD166', align: 'center', wordWrap: {width: 320}
    }).setOrigin(0.5).setDepth(31).setVisible(false);
    this.contSub = this.add.text(W/2, H/2 - 50, t('continueSub'), {
      fontFamily: 'Arial, sans-serif', fontSize: '14px', color: PALETTE.textDim, align: 'center'
    }).setOrigin(0.5).setDepth(31).setVisible(false);
    this.contBtn = this.add.rectangle(W/2, H/2 + 10, 260, 56, 0x8AE68A).setDepth(31).setVisible(false).setInteractive({useHandCursor:true});
    this.contBtnText = this.add.text(W/2, H/2 + 10, t('watchAd'), {
      fontFamily: 'Arial, sans-serif', fontSize: '16px', fontStyle: 'bold', color: '#2B160C'
    }).setOrigin(0.5).setDepth(32).setVisible(false);
    this.contSkip = this.add.text(W/2, H/2 + 65, t('skip'), {
      fontFamily: 'Arial, sans-serif', fontSize: '14px', color: PALETTE.textDim
    }).setOrigin(0.5).setDepth(31).setVisible(false).setInteractive({useHandCursor:true});

    this.contBtn.on('pointerdown', (p, x, y, e) => {
      e.stopPropagation();
      window.gameBridge.showRewarded(
        () => { this.reviveTower(); },       // onRewarded — досмотрел до конца
        () => {}                              // onClose — просто закрыли плеер
      );
    });
    this.contSkip.on('pointerdown', (p, x, y, e) => {
      e.stopPropagation();
      this.hideContinueOffer();
      this.finishRun();
    });

    // final game-over screen (ported from the "Game Over Screen" design)
    this.goTitle = this.add.text(W/2, 84, t('gameOverTitle'), {
      fontFamily: 'Arial, sans-serif', fontSize: '26px', fontStyle: 'bold', color: '#FF5C7A', align: 'center', wordWrap: {width: 340}
    }).setOrigin(0.5).setDepth(31).setVisible(false);

    this.goScoreText = this.add.text(W/2, 154, '0', {
      fontFamily: 'Arial, sans-serif', fontSize: '64px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0.5).setDepth(31).setVisible(false);

    // stat cards: "РЕКОРД" and "КОНФЕТЫ"
    const statY = 262, cardW = 150, cardH = 76, cardGap = 14;
    const recordCX = W/2 - (cardW + cardGap) / 2;
    const candyCX = W/2 + (cardW + cardGap) / 2;
    this.goStatGfx = this.add.graphics().setDepth(31).setVisible(false);
    drawStatCard(this.goStatGfx, recordCX, statY, cardW, cardH, 18);
    drawStatCard(this.goStatGfx, candyCX, statY, cardW, cardH, 18);

    this.goRecordLabel = this.add.text(recordCX, statY - 20, t('statRecord'), {
      fontFamily: 'Arial, sans-serif', fontSize: '13px', fontStyle: 'bold', color: PALETTE.textDim
    }).setOrigin(0.5).setDepth(32).setVisible(false);
    this.goRecordValue = this.add.text(recordCX, statY + 12, '0', {
      fontFamily: 'Arial, sans-serif', fontSize: '22px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0.5).setDepth(32).setVisible(false);

    this.goCandyIconGfx = this.add.graphics().setDepth(32).setVisible(false);
    drawCandyIcon(this.goCandyIconGfx, candyCX - 24, statY + 12, 10);
    this.goCandyLabel = this.add.text(candyCX, statY - 20, t('statCandy'), {
      fontFamily: 'Arial, sans-serif', fontSize: '13px', fontStyle: 'bold', color: PALETTE.textDim
    }).setOrigin(0.5).setDepth(32).setVisible(false);
    this.goCandyValue = this.add.text(candyCX + 4, statY + 12, '+0', {
      fontFamily: 'Arial, sans-serif', fontSize: '22px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0, 0.5).setDepth(32).setVisible(false);

    // buttons row: candy-piped "ЕЩЁ РАЗ" retry pill + round share button
    const btnY = 600, retryCX = 164, retryW = 210, retryH = 76, shareCX = 341, shareR = 28;
    this.goRetryGfx = this.add.graphics().setDepth(31).setVisible(false);
    drawCandyPillButton(this.goRetryGfx, retryCX, btnY, retryW, retryH, 0xFFB3C6, 0xFF6F97, 0x7A1F3D);
    this.goRetryGfx.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(retryCX - retryW/2 - 18, btnY - retryH/2, retryW + 36, retryH),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true
    });
    this.goRetryText = this.add.text(retryCX, btnY, t('retry'), {
      fontFamily: 'Arial, sans-serif', fontSize: '24px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0.5).setDepth(32).setVisible(false);

    this.goShareGfx = this.add.graphics().setDepth(31).setVisible(false);
    drawShareButton(this.goShareGfx, shareCX, btnY, shareR);
    this.goShareGfx.setInteractive({
      hitArea: new Phaser.Geom.Circle(shareCX, btnY, shareR),
      hitAreaCallback: Phaser.Geom.Circle.Contains,
      useHandCursor: true
    });

    this.goShareToast = this.add.text(shareCX, btnY - shareR - 18, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '13px', fontStyle: 'bold', color: PALETTE.textMain, align: 'center'
    }).setOrigin(0.5).setDepth(33).setAlpha(0);

    this.goElements = [
      this.goTitle, this.goScoreText, this.goStatGfx,
      this.goRecordLabel, this.goRecordValue, this.goCandyIconGfx, this.goCandyLabel, this.goCandyValue,
      this.goRetryGfx, this.goRetryText, this.goShareGfx
    ];

    this.goRetryGfx.on('pointerdown', (p, x, y, e) => {
      e.stopPropagation();
      this.tweens.add({ targets: [this.goRetryGfx, this.goRetryText], scale: 0.95, duration: 70, yoyo: true, onComplete: () => this.restart() });
    });
    this.goShareGfx.on('pointerdown', (p, x, y, e) => {
      e.stopPropagation();
      this.tweens.add({ targets: this.goShareGfx, scale: 0.92, duration: 70, yoyo: true });
      this.shareResult();
    });
  }

  // ---------- pause overlay (reuses the shared dark backdrop) ----------
  buildPauseUI() {
    const px = W/2;
    this.pauseTitle = this.add.text(px, H/2 - 190, t('pauseTitle'), {
      fontFamily: 'Arial, sans-serif', fontSize: '40px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0.5).setDepth(31).setVisible(false);

    const resumeY = H/2 - 60, resumeW = 230, resumeH = 76;
    this.pauseResumeGfx = this.add.graphics().setDepth(31).setVisible(false);
    drawCandyPillButton(this.pauseResumeGfx, px, resumeY, resumeW, resumeH, 0xFFB3C6, 0xFF6F97, 0x7A1F3D);
    this.pauseResumeGfx.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(px - resumeW/2 - 18, resumeY - resumeH/2, resumeW + 36, resumeH),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true
    });
    this.pauseResumeText = this.add.text(px, resumeY, t('pauseResume'), {
      fontFamily: 'Arial, sans-serif', fontSize: '22px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0.5).setDepth(32).setVisible(false);

    const restartY = resumeY + 92, restartW = 230, restartH = 60;
    this.pauseRestartGfx = this.add.graphics().setDepth(31).setVisible(false);
    drawCandyPillButton(this.pauseRestartGfx, px, restartY, restartW, restartH, 0xFFE29A, 0xF7B93B, 0x8A5A12);
    this.pauseRestartGfx.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(px - restartW/2 - 16, restartY - restartH/2, restartW + 32, restartH),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true
    });
    this.pauseRestartText = this.add.text(px, restartY, t('pauseRestart'), {
      fontFamily: 'Arial, sans-serif', fontSize: '19px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0.5).setDepth(32).setVisible(false);

    const menuY = restartY + 76, menuW = 230, menuH = 60;
    this.pauseMenuGfx = this.add.graphics().setDepth(31).setVisible(false);
    drawCandyPillButton(this.pauseMenuGfx, px, menuY, menuW, menuH, 0xC9BBFF, 0x8F72E8, 0x443077);
    this.pauseMenuGfx.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(px - menuW/2 - 16, menuY - menuH/2, menuW + 32, menuH),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true
    });
    this.pauseMenuText = this.add.text(px, menuY, t('pauseMenu'), {
      fontFamily: 'Arial, sans-serif', fontSize: '19px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0.5).setDepth(32).setVisible(false);

    this.pauseElements = [
      this.pauseTitle, this.pauseResumeGfx, this.pauseResumeText,
      this.pauseRestartGfx, this.pauseRestartText, this.pauseMenuGfx, this.pauseMenuText
    ];

    this.pauseResumeGfx.on('pointerdown', (p, x, y, e) => { e.stopPropagation(); this.closePause(); });
    this.pauseRestartGfx.on('pointerdown', (p, x, y, e) => { e.stopPropagation(); this.restart(); });
    this.pauseMenuGfx.on('pointerdown', (p, x, y, e) => { e.stopPropagation(); this.scene.start('menu'); });
  }

  openPause() {
    if (this.gameOver || this.paused) return;
    this.paused = true;
    this.tweens.pauseAll(); // freezes any in-flight drop/merge/collapse tween until resumed
    window.gameBridge.gameplayStop();
    this.overlay.setVisible(true);
    this.pauseElements.forEach((el) => el.setVisible(true));
  }

  closePause() {
    this.paused = false;
    this.tweens.resumeAll();
    this.overlay.setVisible(false);
    this.pauseElements.forEach((el) => el.setVisible(false));
    window.gameBridge.gameplayStart();
  }

  // ---------- share ----------
  shareResult() {
    const text = t('shareText', this.score);
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => this.flashShareToast(t('shareCopied'))).catch(() => {});
    }
  }

  flashShareToast(msg) {
    this.goShareToast.setText(msg).setAlpha(1);
    this.tweens.add({ targets: this.goShareToast, alpha: 0, delay: 700, duration: 350 });
  }

  showContinueOffer() {
    this.usedContinue = true; // only offered once per run, regardless of outcome
    this.overlay.setVisible(true);
    this.contTitle.setVisible(true);
    this.contSub.setVisible(true);
    this.contBtn.setVisible(true);
    this.contBtnText.setVisible(true);
    this.contSkip.setVisible(true);
  }
  hideContinueOffer() {
    this.overlay.setVisible(false);
    this.contTitle.setVisible(false);
    this.contSub.setVisible(false);
    this.contBtn.setVisible(false);
    this.contBtnText.setVisible(false);
    this.contSkip.setVisible(false);
  }

  reviveTower() {
    this.hideContinueOffer();
    this.tweens.killTweensOf(this.stackContainer);
    this.tweens.add({
      targets: this.stackContainer,
      rotation: 0, x: PIVOT_X, alpha: 1,
      duration: 320, ease: 'Cubic.easeOut'
    });
    this.lean = 0;
    this.displayLean = 0;
    this.gameOver = false;
    this.hintText.setVisible(false);
    this.movingBlock = null;
    window.gameBridge.gameplayStart();
    this.time.delayedCall(220, () => this.spawnMovingBlock());
  }

  finishRun() {
    this.metaDirty = true;
    const candyGained = Math.floor(this.score / 10);
    this.meta.candy += candyGained;
    const isNewBest = this.score > this.meta.best;
    if (isNewBest) this.meta.best = this.score;
    window.gameBridge.saveData(this.meta);
    // Only push to the leaderboard on an actual improvement — setLeaderboardScore
    // overwrites the previous entry unconditionally, so submitting every run
    // (including worse ones) would let a bad run erase a good one.
    if (isNewBest) window.gameBridge.setLeaderboardScore(LEADERBOARD_NAME, this.score);

    const reveal = () => {
      this.overlay.setVisible(true);
      this.goScoreText.setText(String(this.score));
      this.goRecordValue.setText(String(this.meta.best));
      this.goCandyValue.setText('+' + candyGained);
      this.goElements.forEach((el) => el.setVisible(true));
    };

    if (sessionDeathCount % INTERSTITIAL_EVERY === 0) {
      window.gameBridge.showInterstitial(reveal);
    } else {
      reveal();
    }
  }

  // ---------- audio ----------
  ensureAudio() {
    if (!this.audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.audioCtx = new Ctx();
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume();
  }
  tone(freq, duration, type, gain) {
    if (!this.soundOn || !this.audioCtx) return;
    try {
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      g.gain.value = gain || 0.16;
      osc.connect(g); g.connect(ctx.destination);
      osc.start();
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  }
  sndLand()    { this.tone(180, 0.09, 'sine', 0.18); }
  sndPrecise() { this.tone(180, 0.09, 'sine', 0.18); this.tone(720, 0.12, 'triangle', 0.1); }
  sndMerge(tier) { this.tone(480 + tier * 90, 0.18, 'triangle', 0.16); }
  sndBonus()   { this.tone(700, 0.08, 'square', 0.1); this.tone(950, 0.12, 'square', 0.1); }
  sndCollapse() {
    if (!this.soundOn || !this.audioCtx) return;
    try {
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.6);
      g.gain.value = 0.14;
      osc.connect(g); g.connect(ctx.destination);
      osc.start();
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.stop(ctx.currentTime + 0.6);
    } catch (e) {}
  }

  makeParticleTexture() {
    const pg = this.make.graphics({ x: 0, y: 0, add: false });
    pg.fillStyle(0xffffff, 1);
    pg.fillCircle(4, 4, 4);
    pg.generateTexture('sparkle', 8, 8);
    pg.destroy();
  }

  burstAt(x, y, color, count = 12) {
    const emitter = this.add.particles(x, y, 'sparkle', {
      speed: { min: 60, max: 200 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.4, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 420,
      tint: color,
      quantity: count,
      emitting: false
    }).setDepth(25);
    emitter.explode(count);
    this.time.delayedCall(480, () => emitter.destroy());
  }

  drawBackground() {
    this.bg.fillGradientStyle(PALETTE.bgTop, PALETTE.bgTop, PALETTE.bgBottom, PALETTE.bgBottom, 1);
    this.bg.fillRect(0, 0, W, H);

    // soft bokeh glows for depth
    const glowColors = [0xFF8FAB, 0xFFD166, 0xB39CFF];
    for (let i = 0; i < 7; i++) {
      const c = Phaser.Utils.Array.GetRandom(glowColors);
      this.bg.fillStyle(c, 0.05);
      this.bg.fillCircle(Phaser.Math.Between(0, W), Phaser.Math.Between(0, H), Phaser.Math.Between(40, 90));
    }

    // sprinkles: mix of tiny capsules and dots
    const sprinkleColors = [0xFF8FAB, 0xFFD166, 0x8AE68A, 0xB39CFF, 0xFFFFFF, 0xFF9F5A];
    for (let i = 0; i < 42; i++) {
      const x = Phaser.Math.Between(0, W);
      const y = Phaser.Math.Between(0, H);
      const c = Phaser.Utils.Array.GetRandom(sprinkleColors);
      const a = Phaser.Math.FloatBetween(0.10, 0.32);
      this.bg.fillStyle(c, a);
      if (Math.random() < 0.5) {
        this.bg.fillCircle(x, y, Phaser.Math.FloatBetween(1, 2.4));
      } else {
        this.bg.fillRoundedRect(x, y, Phaser.Math.FloatBetween(5, 9), 2, 1);
      }
    }
  }

  addBaseBlock() {
    const gfx = this.add.graphics();
    this.stackContainer.add(gfx);
    const localX = W/2 - PIVOT_X - BLOCK_W/2;
    const localY = this.nextY + BLOCK_H - PIVOT_Y0;
    this.drawBlock(gfx, localX, localY, BLOCK_W, -1);
    this.stack.push({ x: W/2, y: this.nextY + BLOCK_H, w: BLOCK_W, tier: -1, gfx });
  }

  drawBlock(gfx, x, y, w, tier, h = BLOCK_H) {
    gfx.clear();
    const base = tier === -1 ? PALETTE.base : this.skinTiers[Math.min(tier, this.skinTiers.length-1)];
    const light = shade(base, tier === -1 ? 0.18 : 0.30);
    const dark = shade(base, tier === -1 ? -0.20 : -0.20);
    const outline = tier === -1 ? shade(base, -0.5) : shade(base, -0.45);
    const radius = Math.min(14, h/2);

    // wrapped-candy twist ends (skip for the tray, and for very thin trimmed pieces)
    if (tier !== -1 && w > 34 && h > 14) {
      this.drawTwist(gfx, x, y, h, dark, outline, true);
      this.drawTwist(gfx, x + w, y, h, dark, outline, false);
    }

    // glossy gradient body — light at top, deeper at bottom
    gfx.fillGradientStyle(light, light, dark, dark, 1);
    gfx.fillRoundedRect(x, y, w, h, radius);
    gfx.lineStyle(Math.max(2, h * 0.08), outline, 0.9);
    gfx.strokeRoundedRect(x, y, w, h, radius);

    if (h > 14 && w > 26) {
      // single bold cartoon gloss streak
      gfx.fillStyle(0xffffff, 0.4);
      gfx.fillRoundedRect(x + w*0.10, y + h*0.14, w*0.30, Math.max(4, h*0.22), 6);
      // small round shine dot for extra cartoon pop
      gfx.fillStyle(0xffffff, 0.55);
      gfx.fillCircle(x + w*0.78, y + h*0.30, Math.max(2, h*0.09));
    }
  }

  drawTwist(gfx, edgeX, y, h, fillColor, outlineColor, isLeft) {
    const len = Math.min(10, h * 0.28);
    const dir = isLeft ? -1 : 1;
    const tipX = edgeX + dir * len;
    const topY = y + h * 0.08;
    const botY = y + h * 0.92;
    const midY = y + h / 2;
    gfx.fillStyle(fillColor, 1);
    gfx.beginPath();
    gfx.moveTo(edgeX, topY);
    gfx.lineTo(tipX, midY);
    gfx.lineTo(edgeX, botY);
    gfx.closePath();
    gfx.fillPath();
    gfx.lineStyle(Math.max(1.5, h * 0.06), outlineColor, 0.9);
    gfx.strokePath();
  }

  spawnMovingBlock() {
    if (this.gameOver) return;
    const gfx = this.add.graphics().setDepth(15);
    this.movingTier = 0;
    const top = this.stack[this.stack.length - 1];
    this.movingBlock = { x: W/2, y: SPAWN_Y, w: top.w, gfx, t: 0 };
    this.dropping = false;
    this.maybeSpawnHazard();
  }

  maybeSpawnHazard() {
    if (this.hazard) { this.hazard.gfx.destroy(); this.hazard = null; }
    const top = this.stack[this.stack.length - 1];
    const margin = 12;
    const usable = top.w - margin * 2;
    if (Math.random() > HAZARD_CHANCE || usable < 14) return;
    const baseX = top.x + Phaser.Math.FloatBetween(-usable/2, usable/2);
    const gfx = this.add.graphics().setDepth(16);
    this.hazard = { baseX, x: baseX, gfx, t: 0, block: top };
  }

  drawHazard() {
    const hz = this.hazard;
    if (!hz) return;
    const y = hz.block.y - 12;
    hz.gfx.clear();
    const pulse = 7 + Math.sin(hz.t * 0.012) * 2;
    hz.gfx.fillStyle(PALETTE.bonus, 0.95);
    hz.gfx.fillCircle(hz.x, y, pulse);
    hz.gfx.lineStyle(2, 0xffffff, 0.6);
    hz.gfx.strokeCircle(hz.x, y, pulse + 2);
  }

  update(time, delta) {
    if (this.gameOver || this.paused) return;

    this.displayLean = Phaser.Math.Linear(this.displayLean, this.lean, 0.07);
    this.stackContainer.rotation = Phaser.Math.Clamp(this.displayLean / 140, -0.5, 0.5);
    this.stackContainer.x = PIVOT_X + this.displayLean * 0.12;

    const frac = Phaser.Math.Clamp(Math.abs(this.displayLean) / this.leanThreshold, 0, 1);
    const barColor = frac < 0.5 ? 0x8AE68A : (frac < 0.8 ? 0xFFD166 : 0xFF5C4D);
    this.stabBarFill.setOrigin(this.displayLean >= 0 ? 0 : 1, 0.5);
    this.stabBarFill.width = 100 * frac;
    this.stabBarFill.fillColor = barColor;

    if (this.hazard) {
      this.hazard.t += delta;
      const osc = Math.sin(this.hazard.t * 0.0035) * 16;
      this.hazard.x = this.hazard.baseX + osc;
      this.drawHazard();
    }
    if (!this.movingBlock || this.dropping) return;
    this.movingBlock.t += delta;
    const amp = W/2 - this.movingBlock.w/2 - 10;
    this.movingBlock.x = W/2 + Math.sin(this.movingBlock.t * this.swingSpeed) * amp;
    this.drawBlock(this.movingBlock.gfx, this.movingBlock.x - this.movingBlock.w/2, this.movingBlock.y, this.movingBlock.w, this.movingTier);
  }

  handleTap() {
    if (this.gameOver || this.paused || this.dropping || !this.movingBlock) return;
    this.dropping = true;

    const top = this.stack[this.stack.length - 1];
    const targetY = this.nextY;
    const distance = Math.abs(targetY - this.movingBlock.y);
    const fallDuration = Phaser.Math.Clamp(distance * 1.1, 160, 420);

    this.tweens.add({
      targets: this.movingBlock,
      y: targetY,
      duration: fallDuration,
      ease: 'Quad.easeIn',
      onUpdate: () => {
        this.drawBlock(this.movingBlock.gfx, this.movingBlock.x - this.movingBlock.w/2, this.movingBlock.y, this.movingBlock.w, this.movingTier);
      },
      onComplete: () => this.resolveDrop(top, targetY)
    });
  }

  resolveDrop(top, targetY) {
    const dropX = this.movingBlock.x;
    const movW = this.movingBlock.w;
    const movingLeft = dropX - movW/2;
    const movingRight = dropX + movW/2;
    const topLeft = top.x - top.w/2;
    const topRight = top.x + top.w/2;

    let overlapLeft = Math.max(movingLeft, topLeft);
    let overlapRight = Math.min(movingRight, topRight);
    let overlapWidth = overlapRight - overlapLeft;
    const fullOverlap = overlapWidth >= Math.min(top.w, movW) * 0.94;

    let hazardMsg = null;
    let hazardBonus = 0;
    if (this.hazard && overlapWidth > 0 && this.hazard.x >= overlapLeft && this.hazard.x <= overlapRight) {
      hazardBonus = 50;
      hazardMsg = t('bonusPopup');
      this.burstAt(this.hazard.x, this.hazard.block.y - 12, PALETTE.bonus, 14);
    }
    if (this.hazard) { this.hazard.gfx.destroy(); this.hazard = null; }

    if (overlapWidth < MIN_OVERLAP) {
      this.tumbleAndEnd(dropX - top.x);
      return;
    }

    let finalW, finalX;
    if (fullOverlap) {
      finalW = Math.min(BLOCK_W, movW + GROWTH);
      finalX = dropX;
    } else {
      finalW = Phaser.Math.Clamp(overlapWidth, MIN_OVERLAP, BLOCK_W);
      finalX = (overlapLeft + overlapRight) / 2;
    }

    const gfx = this.movingBlock.gfx;
    this.stackContainer.add(gfx);
    this.drawBlock(gfx, finalX - PIVOT_X - finalW/2, targetY - PIVOT_Y0, finalW, this.movingTier);

    const newBlock = { x: finalX, y: targetY, w: finalW, tier: this.movingTier, gfx };
    this.stack.push(newBlock);
    this.nextY -= BLOCK_H;
    this.squashLand(newBlock);

    if (fullOverlap) { this.sndPrecise(); } else { this.sndLand(); }

    let gained = 10 + hazardBonus;
    if (hazardMsg) {
      this.flashCombo(hazardMsg);
      this.sndBonus();
    } else if (fullOverlap) {
      gained += 15;
      this.flashCombo(t('precisePopup'));
    } else {
      this.comboText.setText('');
    }
    this.score += gained;
    this.scoreText.setText(String(this.score));
    this.hintText.setVisible(false);

    this.checkMerge();

    const top2 = this.stack[this.stack.length - 1];
    this.lean = top2.x - PIVOT_X;
    const heightFactor = Math.max(0.5, 1 - this.stack.length * 0.015);
    this.leanThreshold = LEAN_COLLAPSE * heightFactor;

    if (Math.abs(this.lean) > this.leanThreshold) {
      this.collapseTower(this.lean > 0 ? 1 : -1);
      return;
    }

    this.checkScroll();
    this.movingBlock = null;
    this.time.delayedCall(120, () => this.spawnMovingBlock());
  }

  squashLand(block) {
    this.cameras.main.shake(60, 0.002);
    block.landTween = this.tweens.addCounter({
      from: 0, to: 1, duration: 170, ease: 'Quad.easeOut',
      onUpdate: (tw) => {
        const v = tw.getValue();
        const amt = Math.sin(v * Math.PI);
        const w = block.w * (1 + 0.16 * amt);
        const h = BLOCK_H * (1 - 0.28 * amt);
        const x = (block.x - PIVOT_X) - w / 2;
        const y = (block.y - PIVOT_Y0) + (BLOCK_H - h);
        this.drawBlock(block.gfx, x, y, w, block.tier, h);
      },
      onComplete: () => {
        this.drawBlock(block.gfx, block.x - PIVOT_X - block.w/2, block.y - PIVOT_Y0, block.w, block.tier);
      }
    });
  }

  checkMerge() {
    let merged = true;
    while (merged && this.stack.length >= 2) {
      merged = false;
      const a = this.stack[this.stack.length - 1];
      const b = this.stack[this.stack.length - 2];
      if (a.tier === b.tier && a.tier >= 0) {
        const newTier = Math.min(a.tier + 1, PALETTE.tiers.length - 1);
        const keep = b;
        const discard = a;
        if (a.landTween) a.landTween.stop();
        if (b.landTween) b.landTween.stop();
        discard.gfx.destroy();

        keep.x = Phaser.Math.Linear(a.x, PIVOT_X, 0.07);
        const widen = 22 + newTier * 6;
        keep.w = Math.min(BLOCK_W, Math.max(a.w, b.w) + widen);

        this.tweens.add({
          targets: keep.gfx,
          scaleX: 1.15, scaleY: 1.3,
          duration: 90, yoyo: true,
          onComplete: () => { keep.gfx.setScale(1); }
        });

        keep.tier = newTier;
        this.drawBlock(keep.gfx, keep.x - PIVOT_X - keep.w/2, keep.y - PIVOT_Y0, keep.w, newTier);
        this.burstAt(keep.x, keep.y - BLOCK_H/2, this.skinTiers[Math.min(newTier, this.skinTiers.length-1)], 16);

        this.stack.pop();
        this.nextY += BLOCK_H;

        this.combo++;
        const bonus = 20 * this.combo;
        this.score += bonus;
        this.scoreText.setText(String(this.score));
        this.flashCombo(t('mergePopup', this.combo, bonus));
        this.sndMerge(newTier);
        merged = true;
      }
    }
    if (!merged) this.combo = 0;
  }

  flashCombo(msg) {
    this.comboText.setText(msg);
    this.comboText.setAlpha(1);
    this.tweens.add({ targets: this.comboText, alpha: 0, delay: 500, duration: 400 });
  }

  checkScroll() {
    if (this.nextY < SCROLL_THRESHOLD) {
      const shift = SCROLL_THRESHOLD - this.nextY;
      this.nextY = SCROLL_THRESHOLD;
      this.tweens.add({
        targets: this.stackContainer,
        y: this.stackContainer.y + shift,
        duration: 180, ease: 'Cubic.easeOut'
      });
    }
  }

  tumbleAndEnd(offset) {
    const dir = offset > 0 ? 1 : -1;
    this.tweens.add({
      targets: this.movingBlock.gfx,
      x: this.movingBlock.gfx.x + dir * 120,
      angle: dir * 80,
      alpha: 0,
      y: this.movingBlock.y + 200,
      duration: 500, ease: 'Cubic.easeIn'
    });
    this.endGame();
  }

  collapseTower(dir) {
    this.cameras.main.shake(300, 0.01);
    this.sndCollapse();
    this.tweens.add({
      targets: this.stackContainer,
      rotation: dir * 0.8,
      x: PIVOT_X + dir * 60,
      alpha: 0.25,
      duration: 550, ease: 'Cubic.easeIn'
    });
    this.endGame();
  }

  endGame() {
    this.gameOver = true;
    this.hintText.setVisible(false);
    window.gameBridge.gameplayStop();
    sessionDeathCount++;

    this.time.delayedCall(450, () => {
      if (!this.usedContinue) {
        this.showContinueOffer();
      } else {
        this.finishRun();
      }
    });
  }

  restart() {
    this.scene.restart();
  }
}

// ---------- main menu (ported from the "Main Menu" design) ----------
class MenuScene extends Phaser.Scene {
  constructor() { super('menu'); }

  create() {
    this.meta = normalizeMeta(null);

    const bg = this.add.graphics();
    fillBgGradient(bg, W, H);
    drawGlowCircle(bg, 20, 20, 110, 0.05);
    drawGlowCircle(bg, W + 30, 200, 90, 0.04);
    drawGlowCircle(bg, -10, 560, 100, 0.05);
    drawGlowCircle(bg, W + 10, 640, 85, 0.04);

    const confettiGfx = this.add.graphics();
    MENU_CONFETTI.forEach(([x, y, s, c]) => {
      confettiGfx.fillStyle(c, 0.55);
      if (s > 3) confettiGfx.fillRoundedRect(x, y, s, s, 2);
      else confettiGfx.fillCircle(x, y, s);
    });

    this.add.text(W/2, 80, t('menuTitleTop'), {
      fontFamily: 'Arial, sans-serif', fontSize: '44px', fontStyle: 'bold', color: PALETTE.textMain, align: 'center'
    }).setOrigin(0.5).setDepth(10);
    this.add.text(W/2, 126, t('menuTitleBottom'), {
      fontFamily: 'Arial, sans-serif', fontSize: '44px', fontStyle: 'bold', color: '#FF8FAB', align: 'center'
    }).setOrigin(0.5).setDepth(10);

    // leaderboard button (mirrors the sound toggle, top-left corner)
    const lbCX = 46, lbCY = 46, lbR = 24;
    const lbGfx = this.add.graphics().setDepth(11);
    drawTrophyIcon(lbGfx, lbCX, lbCY, lbR);
    lbGfx.setInteractive({
      hitArea: new Phaser.Geom.Circle(lbCX, lbCY, lbR),
      hitAreaCallback: Phaser.Geom.Circle.Contains, useHandCursor: true
    });
    lbGfx.on('pointerdown', (p, x, y, e) => { e.stopPropagation(); this.scene.start('leaderboard'); });

    // sound toggle
    const soundCX = W - 46, soundCY = 46, soundR = 24;
    this.soundGfx = this.add.graphics().setDepth(11);
    this.soundGfx.setInteractive({
      hitArea: new Phaser.Geom.Circle(soundCX, soundCY, soundR),
      hitAreaCallback: Phaser.Geom.Circle.Contains, useHandCursor: true
    });
    this.soundGfx.on('pointerdown', (p, x, y, e) => { e.stopPropagation(); this.toggleSound(); });
    this.drawSoundIcon(soundCX, soundCY, soundR);

    // play button
    const playY = 240, playW = 220, playH = 84;
    const playGfx = this.add.graphics().setDepth(10);
    drawCandyPillButton(playGfx, W/2, playY, playW, playH, 0xFFB3C6, 0xFF6F97, 0x7A1F3D);
    playGfx.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(W/2 - playW/2 - 18, playY - playH/2, playW + 36, playH),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true
    });
    const playText = this.add.text(W/2, playY, t('play'), {
      fontFamily: 'Arial, sans-serif', fontSize: '30px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0.5).setDepth(11);
    playGfx.on('pointerdown', (p, x, y, e) => {
      e.stopPropagation();
      this.tweens.add({ targets: [playGfx, playText], scale: 0.95, duration: 70, yoyo: true, onComplete: () => this.scene.start('main') });
    });

    // shop + settings row
    const rowY = playY + 96, btnW = 130, btnH = 56, gap = 44;
    const shopCX = W/2 - (btnW + gap)/2, setCX = W/2 + (btnW + gap)/2;

    const shopGfx = this.add.graphics().setDepth(10);
    drawCandyPillButton(shopGfx, shopCX, rowY, btnW, btnH, 0xFFE29A, 0xF7B93B, 0x8A5A12);
    shopGfx.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(shopCX - btnW/2 - 14, rowY - btnH/2, btnW + 28, btnH),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true
    });
    this.add.text(shopCX, rowY, t('shop'), {
      fontFamily: 'Arial, sans-serif', fontSize: '16px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0.5).setDepth(11);
    shopGfx.on('pointerdown', (p, x, y, e) => { e.stopPropagation(); this.scene.start('shop'); });

    const setGfx = this.add.graphics().setDepth(10);
    drawCandyPillButton(setGfx, setCX, rowY, btnW, btnH, 0xB8F0B8, 0x5FC95F, 0x2F6B3A);
    setGfx.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(setCX - btnW/2 - 14, rowY - btnH/2, btnW + 28, btnH),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true
    });
    this.add.text(setCX, rowY, t('settings'), {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0.5).setDepth(11);
    // no dedicated settings screen exists yet — audio is the only real setting,
    // so this button routes to the same toggle as the icon above
    setGfx.on('pointerdown', (p, x, y, e) => { e.stopPropagation(); this.toggleSound(); });

    this.bestText = this.add.text(W/2, H - 26, t('bestScore', 0), {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', fontStyle: 'bold', color: PALETTE.textDim
    }).setOrigin(0.5).setDepth(10);

    window.gameBridge.loadData().then((m) => {
      this.meta = normalizeMeta(m);
      this.bestText.setText(t('bestScore', this.meta.best));
      this.drawSoundIcon(soundCX, soundCY, soundR);
    });

    // first true "playable" paint of the game — tell the platform loading is done
    if (!loadingReadySent) {
      loadingReadySent = true;
      window.gameBridge.ready();
    }
  }

  drawSoundIcon(cx, cy, r) {
    this.soundGfx.clear();
    drawIconButton(this.soundGfx, cx, cy, r);
    this.soundGfx.fillStyle(0xFFF3E6, 1);
    this.soundGfx.fillRect(cx - 9, cy - 4, 6, 8);
    this.soundGfx.beginPath();
    this.soundGfx.moveTo(cx - 3, cy - 4);
    this.soundGfx.lineTo(cx + 5, cy - 9);
    this.soundGfx.lineTo(cx + 5, cy + 9);
    this.soundGfx.lineTo(cx - 3, cy + 4);
    this.soundGfx.closePath();
    this.soundGfx.fillPath();
    if (!this.meta.soundOn) {
      this.soundGfx.lineStyle(2, 0xFFF3E6, 0.95);
      this.soundGfx.lineBetween(cx + 2, cy - 8, cx + 12, cy + 8);
      this.soundGfx.lineBetween(cx + 12, cy - 8, cx + 2, cy + 8);
    }
  }

  toggleSound() {
    this.meta.soundOn = !this.meta.soundOn;
    window.gameBridge.saveData(this.meta);
    this.drawSoundIcon(W - 46, 46, 24);
  }
}

// ---------- shop (ported from the "Shop Screen" design) ----------
class ShopScene extends Phaser.Scene {
  constructor() { super('shop'); }

  create() {
    this.meta = normalizeMeta(null);
    this.cardObjects = [];

    const bg = this.add.graphics();
    fillBgGradient(bg, W, H);
    drawGlowCircle(bg, W + 40, 20, 100, 0.05);
    drawGlowCircle(bg, -30, 470, 100, 0.04);

    this.add.text(24, 40, t('shop'), {
      fontFamily: 'Arial, sans-serif', fontSize: '26px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0, 0.5).setDepth(10);

    this.currencyGfx = this.add.graphics().setDepth(10);
    this.currencyText = this.add.text(0, 40, '0', {
      fontFamily: 'Arial, sans-serif', fontSize: '18px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0, 0.5).setDepth(11);

    this.toast = this.add.text(W/2, 490, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '14px', fontStyle: 'bold', color: '#FF5C7A', align: 'center'
    }).setOrigin(0.5).setDepth(12).setAlpha(0);

    const backY = 640, backW = 170, backH = 58;
    const backGfx = this.add.graphics().setDepth(10);
    drawCandyPillButton(backGfx, W/2, backY, backW, backH, 0xC9BBFF, 0x8F72E8, 0x443077);
    backGfx.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(W/2 - backW/2 - 14, backY - backH/2, backW + 28, backH),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true
    });
    this.add.text(W/2, backY, t('back'), {
      fontFamily: 'Arial, sans-serif', fontSize: '19px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0.5).setDepth(11);
    backGfx.on('pointerdown', (p, x, y, e) => { e.stopPropagation(); this.scene.start('menu'); });

    this.renderGrid();
    window.gameBridge.loadData().then((m) => {
      this.meta = normalizeMeta(m);
      this.renderGrid();
    });
  }

  renderCurrency() {
    this.currencyGfx.clear();
    const cx = W - 90, cy = 40;
    drawPanel(this.currencyGfx, cx + 34, cy, 96, 34, 17, 0.35);
    drawCandyIcon(this.currencyGfx, cx, cy, 13);
    this.currencyText.setText(String(this.meta.candy)).setPosition(cx + 20, cy);
  }

  renderGrid() {
    this.renderCurrency();
    this.cardObjects.forEach((o) => o.destroy());
    this.cardObjects = [];

    const cardW = 164, cardH = 150, gap = 14;
    const col = [W/2 - (cardW + gap)/2, W/2 + (cardW + gap)/2];
    const rowTop = 110;
    const row = [rowTop + cardH/2, rowTop + cardH/2 + (cardH + gap), rowTop + cardH/2 + 2*(cardH + gap)];

    SKIN_DEFS.forEach((def, i) => {
      const cx = col[i % 2];
      const cy = row[Math.floor(i / 2)];
      const owned = this.meta.ownedSkins.includes(i);
      const selected = this.meta.skin === i;

      const gfx = this.add.graphics().setDepth(10);
      drawPanel(gfx, cx, cy, cardW, cardH, 18, selected ? 0.9 : 0.18);
      drawCandyPillButton(gfx, cx, cy - 30, 104, 42, def.top, def.bot, def.dark);
      gfx.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(cx - cardW/2, cy - cardH/2, cardW, cardH),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true
      });
      gfx.on('pointerdown', (p, x, y, e) => { e.stopPropagation(); this.onCardTap(i); });
      this.cardObjects.push(gfx);

      const nameText = this.add.text(cx, cy + 16, t('skinNames')[i], {
        fontFamily: 'Arial, sans-serif', fontSize: '15px', fontStyle: 'bold', color: PALETTE.textMain
      }).setOrigin(0.5).setDepth(11);
      this.cardObjects.push(nameText);

      const badgeColor = selected ? '#FFD166' : owned ? PALETTE.textDim : PALETTE.textMain;
      const badgeStr = selected ? t('selectedBadge') : owned ? t('ownedBadge') : String(def.price);
      const badgeText = this.add.text(cx, cy + 44, badgeStr, {
        fontFamily: 'Arial, sans-serif', fontSize: '13px', fontStyle: 'bold', color: badgeColor
      }).setOrigin(0.5).setDepth(11);
      this.cardObjects.push(badgeText);
    });
  }

  onCardTap(index) {
    const def = SKIN_DEFS[index];
    const owned = this.meta.ownedSkins.includes(index);
    if (owned) {
      if (this.meta.skin !== index) {
        this.meta.skin = index;
        window.gameBridge.saveData(this.meta);
        this.renderGrid();
      }
      return;
    }
    if (this.meta.candy < def.price) {
      this.flashToast(t('notEnoughCandy'));
      return;
    }
    this.meta.candy -= def.price;
    this.meta.ownedSkins.push(index);
    this.meta.skin = index;
    window.gameBridge.saveData(this.meta);
    this.renderGrid();
  }

  flashToast(msg) {
    this.toast.setText(msg).setAlpha(1);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 700, duration: 350 });
  }
}

// ---------- leaderboard (Yandex SDK ysdk.getLeaderboards(), see yandex-bridge.js) ----------
class LeaderboardScene extends Phaser.Scene {
  constructor() { super('leaderboard'); }

  create() {
    this.rowObjects = [];

    const bg = this.add.graphics();
    fillBgGradient(bg, W, H);
    drawGlowCircle(bg, W + 40, 20, 100, 0.05);
    drawGlowCircle(bg, -30, 470, 100, 0.04);

    this.add.text(W/2, 46, t('leaderboard'), {
      fontFamily: 'Arial, sans-serif', fontSize: '26px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0.5).setDepth(10);

    this.statusText = this.add.text(W/2, H/2 - 20, t('leaderboardLoading'), {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', color: PALETTE.textDim
    }).setOrigin(0.5).setDepth(10);

    const backY = 640, backW = 170, backH = 58;
    const backGfx = this.add.graphics().setDepth(10);
    drawCandyPillButton(backGfx, W/2, backY, backW, backH, 0xC9BBFF, 0x8F72E8, 0x443077);
    backGfx.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(W/2 - backW/2 - 14, backY - backH/2, backW + 28, backH),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true
    });
    this.add.text(W/2, backY, t('back'), {
      fontFamily: 'Arial, sans-serif', fontSize: '19px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0.5).setDepth(11);
    backGfx.on('pointerdown', (p, x, y, e) => { e.stopPropagation(); this.scene.start('menu'); });

    window.gameBridge
      .getLeaderboardEntries(LEADERBOARD_NAME, { quantityTop: 8, includeUser: true, quantityAround: 2 })
      .then((result) => this.renderEntries(result));
  }

  renderEntries(result) {
    const entries = result && Array.isArray(result.entries) ? result.entries : [];
    if (!entries.length) {
      this.statusText.setText(t('leaderboardEmpty')).setVisible(true);
      return;
    }
    this.statusText.setVisible(false);

    const rowH = 52, startY = 92, maxRows = 10;
    entries.slice(0, maxRows).forEach((entry, i) => {
      const cy = startY + rowH / 2 + i * rowH;
      const isPlayer = result.userRank != null && entry.rank === result.userRank;

      const rowGfx = this.add.graphics().setDepth(10);
      drawPanel(rowGfx, W/2, cy, W - 32, rowH - 10, 14, isPlayer ? 0.9 : 0.16);
      this.rowObjects.push(rowGfx);

      const rankText = this.add.text(36, cy, String(entry.rank), {
        fontFamily: 'Arial, sans-serif', fontSize: '16px', fontStyle: 'bold',
        color: isPlayer ? '#FFD166' : PALETTE.textDim
      }).setOrigin(0.5).setDepth(11);
      this.rowObjects.push(rankText);

      const name = (entry.player && entry.player.publicName) || t('you');
      const nameText = this.add.text(62, cy, name, {
        fontFamily: 'Arial, sans-serif', fontSize: '15px', fontStyle: 'bold', color: PALETTE.textMain
      }).setOrigin(0, 0.5).setDepth(11);
      this.rowObjects.push(nameText);

      const scoreStr = entry.formattedScore != null ? entry.formattedScore : String(entry.score);
      const scoreText = this.add.text(W - 32, cy, scoreStr, {
        fontFamily: 'Arial, sans-serif', fontSize: '16px', fontStyle: 'bold', color: PALETTE.textMain
      }).setOrigin(1, 0.5).setDepth(11);
      this.rowObjects.push(scoreText);
    });
  }
}

function startGame() {
  const config = {
    type: Phaser.AUTO,
    width: W,
    height: H,
    parent: 'game-root',
    backgroundColor: '#2B160C',
    scene: [MenuScene, MainScene, ShopScene, LeaderboardScene],
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }
  };
  new Phaser.Game(config);
  const preload = document.getElementById('preload-screen');
  if (preload) preload.remove();
}

// Определяем язык интерфейса через SDK (п. 2.14 модерации Yandex Games —
// язык не должен быть зашит намертво). Резолвим его один раз, до первого
// scene.create(), чтобы все сцены строили UI сразу на правильном языке —
// без "мигания" текста и без гонки между несколькими сценами, каждая из
// которых независимо спрашивала бы SDK. Единственный сейчас поддерживаемый
// язык — 'ru'; если платформа вернёт что-то другое, используем 'ru' как
// дефолт, пока не появится соответствующий STRINGS.<lang>.
window.gameBridge.init()
  .then(() => window.gameBridge.getLang())
  .then((lang) => { CURRENT_LANG = SUPPORTED_LANGS.includes(lang) ? lang : 'ru'; })
  .catch(() => { CURRENT_LANG = 'ru'; })
  .then(startGame);
