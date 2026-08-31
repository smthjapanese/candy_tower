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

class MainScene extends Phaser.Scene {
  constructor() { super('main'); }

  create() {
    this.bg = this.add.graphics();
    this.drawBackground();
    this.makeParticleTexture();

    this.meta = { best: 0, candy: 0 };
    window.gameBridge.loadData().then((m) => { this.meta = m; });

    this.stack = [];
    this.nextY = BASE_Y - BLOCK_H;
    this.score = 0;
    this.combo = 0;
    this.gameOver = false;
    this.swingSpeed = 0.0046;
    this.dropping = false;
    this.hazard = null;
    this.lean = 0;
    this.displayLean = 0;
    this.leanThreshold = LEAN_COLLAPSE;
    this.deathCount = 0;
    this.usedContinue = false;

    this.stackContainer = this.add.container(PIVOT_X, PIVOT_Y0).setDepth(10);
    this.addBaseBlock();

    this.scoreText = this.add.text(W/2, 58, '0', {
      fontFamily: 'Arial, sans-serif', fontSize: '46px', fontStyle: 'bold', color: PALETTE.textMain
    }).setOrigin(0.5).setDepth(20);

    this.hintText = this.add.text(W/2, 95, 'Тапни, чтобы уронить конфету', {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', color: PALETTE.textDim
    }).setOrigin(0.5).setDepth(20);

    this.comboText = this.add.text(W/2, 122, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '18px', fontStyle: 'bold', color: '#FFD166'
    }).setOrigin(0.5).setDepth(20);

    this.stabLabel = this.add.text(W/2, 12, 'Наклон башни', {
      fontFamily: 'Arial, sans-serif', fontSize: '10px', color: PALETTE.textDim
    }).setOrigin(0.5).setDepth(20).setAlpha(0.8);
    this.stabBarBg = this.add.rectangle(W/2, 24, 200, 6, 0x2A1710, 0.7).setDepth(20);
    this.stabBarFill = this.add.rectangle(W/2, 24, 0, 6, 0x8AE68A).setOrigin(0.5, 0.5).setDepth(21);

    this.spawnMovingBlock();
    this.input.on('pointerdown', () => { this.ensureAudio(); this.handleTap(); });

    this.buildOverlayUI();

    // tell the platform the game is visually ready (first playable frame is up)
    window.gameBridge.ready();
  }

  // ---------- overlay UI: continue offer + final game-over screen ----------
  buildOverlayUI() {
    this.overlay = this.add.rectangle(W/2, H/2, W, H, 0x2B160C, 0.88).setDepth(30).setVisible(false);

    // continue (rewarded) offer
    this.contTitle = this.add.text(W/2, H/2 - 90, 'БАШНЯ ПОШАТНУЛАСЬ', {
      fontFamily: 'Arial, sans-serif', fontSize: '24px', fontStyle: 'bold', color: '#FFD166', align: 'center', wordWrap: {width: 320}
    }).setOrigin(0.5).setDepth(31).setVisible(false);
    this.contSub = this.add.text(W/2, H/2 - 50, 'Посмотри рекламу — и башня устоит', {
      fontFamily: 'Arial, sans-serif', fontSize: '14px', color: PALETTE.textDim, align: 'center'
    }).setOrigin(0.5).setDepth(31).setVisible(false);
    this.contBtn = this.add.rectangle(W/2, H/2 + 10, 260, 56, 0x8AE68A).setDepth(31).setVisible(false).setInteractive({useHandCursor:true});
    this.contBtnText = this.add.text(W/2, H/2 + 10, '▶ СМОТРЕТЬ РЕКЛАМУ', {
      fontFamily: 'Arial, sans-serif', fontSize: '16px', fontStyle: 'bold', color: '#2B160C'
    }).setOrigin(0.5).setDepth(32).setVisible(false);
    this.contSkip = this.add.text(W/2, H/2 + 65, 'Пропустить', {
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

    // final game-over screen
    this.goTitle = this.add.text(W/2, H/2 - 100, 'БАШНЯ РАССЫПАЛАСЬ', {
      fontFamily: 'Arial, sans-serif', fontSize: '27px', fontStyle: 'bold', color: '#FF5C4D', align: 'center', wordWrap: {width: 320}
    }).setOrigin(0.5).setDepth(31).setVisible(false);
    this.goScore = this.add.text(W/2, H/2 - 45, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '20px', color: PALETTE.textMain, align: 'center'
    }).setOrigin(0.5).setDepth(31).setVisible(false);
    this.goMeta = this.add.text(W/2, H/2 + 5, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', color: '#FFD166', align: 'center'
    }).setOrigin(0.5).setDepth(31).setVisible(false);
    this.goBtn = this.add.rectangle(W/2, H/2 + 75, 200, 56, 0xFF8FAB).setDepth(31).setVisible(false).setInteractive({useHandCursor:true});
    this.goBtnText = this.add.text(W/2, H/2 + 75, 'ЕЩЁ РАЗ', {
      fontFamily: 'Arial, sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#2B160C'
    }).setOrigin(0.5).setDepth(32).setVisible(false);
    this.goBtn.on('pointerdown', (p, x, y, e) => { e.stopPropagation(); this.restart(); });
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
    this.time.delayedCall(220, () => this.spawnMovingBlock());
  }

  finishRun() {
    const candyGained = Math.floor(this.score / 10);
    this.meta.candy += candyGained;
    if (this.score > this.meta.best) this.meta.best = this.score;
    window.gameBridge.saveData(this.meta);

    const reveal = () => {
      this.overlay.setVisible(true);
      this.goTitle.setVisible(true);
      this.goScore.setText('Счёт: ' + this.score + '   •   Рекорд: ' + this.meta.best).setVisible(true);
      this.goMeta.setText('+' + candyGained + ' конфет  •  всего: ' + this.meta.candy).setVisible(true);
      this.goBtn.setVisible(true);
      this.goBtnText.setVisible(true);
    };

    if (this.deathCount % INTERSTITIAL_EVERY === 0) {
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
    if (!this.audioCtx) return;
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
    if (!this.audioCtx) return;
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
    const base = tier === -1 ? PALETTE.base : PALETTE.tiers[Math.min(tier, PALETTE.tiers.length-1)];
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
    if (this.gameOver) return;

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
    if (this.gameOver || this.dropping || !this.movingBlock) return;
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
      hazardMsg = 'БОНУС! +50';
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
      this.flashCombo('ТОЧНО! +25  ↔ ШИРЕ');
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
        this.burstAt(keep.x, keep.y - BLOCK_H/2, PALETTE.tiers[Math.min(newTier, PALETTE.tiers.length-1)], 16);

        this.stack.pop();
        this.nextY += BLOCK_H;

        this.combo++;
        const bonus = 20 * this.combo;
        this.score += bonus;
        this.scoreText.setText(String(this.score));
        this.flashCombo('СЛИЯНИЕ x' + this.combo + '  +' + bonus + '  ↔ ШИРЕ');
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
    this.deathCount++;

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

function startGame() {
  const config = {
    type: Phaser.AUTO,
    width: W,
    height: H,
    parent: 'game-root',
    backgroundColor: '#2B160C',
    scene: MainScene,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }
  };
  new Phaser.Game(config);
  const preload = document.getElementById('preload-screen');
  if (preload) preload.remove();
}

window.gameBridge.init().then(startGame);
