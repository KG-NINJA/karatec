// Karateka-like minimalist in pure Canvas 2D
// No external deps. Open index.html to play.

(() => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const pbar = document.getElementById('pbar').querySelector('.fill');
  const ebar = document.getElementById('ebar').querySelector('.fill');
  const centerMsg = document.getElementById('centerMsg');

  // Resize for crisp rendering
  function fitCanvas() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  // Utilities
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);

  // Color helpers for palette variations
  const toRgb = (hex) => {
    if (!hex) return { r: 255, g: 255, b: 255 };
    let str = hex.toString().replace('#', '');
    if (str.length === 3) str = str.split('').map((c) => c + c).join('');
    if (str.length !== 6) return { r: 255, g: 255, b: 255 };
    const int = parseInt(str, 16);
    if (Number.isNaN(int)) return { r: 255, g: 255, b: 255 };
    return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
  };
  const fromRgb = (r, g, b) => {
    const toHex = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };
  const mixColor = (base, target, t) => {
    const c1 = toRgb(base);
    const c2 = toRgb(target);
    const k = clamp(t, 0, 1);
    return fromRgb(
      c1.r + (c2.r - c1.r) * k,
      c1.g + (c2.g - c1.g) * k,
      c1.b + (c2.b - c1.b) * k
    );
  };
  const lighten = (hex, t) => mixColor(hex, '#ffffff', t);
  const darken = (hex, t) => mixColor(hex, '#000000', t);

  // Input
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    keys.add(e.key.toLowerCase());
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "] .includes(e.key)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.key.toLowerCase());
  });

  // World setup
  const VIEW_W = 1280; // design reference, viewport logical width
  const VIEW_H = 720;
  const GROUND_Y = 600;
  const WORLD_W = 3200;

  // Collision Rect helpers
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // Attack timelines
  const ATTACKS = {
    punch: { windup: 110, active: 90, recover: 210, dmg: 10, reach: 56 },
    kick:  { windup: 160, active: 110, recover: 300, dmg: 16, reach: 72 }
  };

  const HEIGHTS = ['low', 'mid', 'high'];

  class Fighter {
    constructor(opts) {
      this.name = opts.name || 'Fighter';
      this.x = opts.x || 100;
      this.y = GROUND_Y;
      this.dir = opts.dir || 1; // 1 right, -1 left
      this.enemy = !!opts.enemy;
      this.color = opts.color || (this.enemy ? '#ffb3bd' : '#cfefff');
      this.maxHp = 100;
      this.hp = this.maxHp;
      this.width = 36;
      this.height = 120;
      this.speed = 180; // px/s
      this.stanceIndex = 1; // 0 low, 1 mid, 2 high
      this.state = 'idle';
      this.stateT = 0;
      this.alive = true;
      this.moveDir = 0; // -1 left, 1 right
      this.intentAttack = null;
      this.attack = null; // {kind,height,t,windup,active,recover,applied}
      this.hitLag = 0;
      this.attackCooldown = 0;
      // Animation params
      this.armExtend = 0; // 0..1 (punch blend)
      this.legExtend = 0; // 0..1 (kick blend)
      this.walkCycle = 0; // step cycle
      this.stepPhase = 0; // 0..1 for step-like footwork
      // Debug flags (injected by Game each frame)
      this.debugHyakuretsu = false;
    }

    get stance() { return HEIGHTS[this.stanceIndex]; }

    faceToward(x) { this.dir = x >= this.x ? 1 : -1; }

    canAct() { return this.alive && !this.attack && this.hitLag <= 0; }

    startAttack(kind, height) {
      if (!this.canAct() || this.attackCooldown > 0) return false;
      const spec = ATTACKS[kind];
      if (!spec) return false;
      this.attack = { kind, height, t: 0, windup: spec.windup, active: spec.active, recover: spec.recover, applied: false };
      this.state = 'attack';
      this.stateT = 0;
      return true;
    }

    isBlockingAgainst(height) {
      // Simple rule: if not attacking and stance matches, it's a block
      return this.attack == null && this.stance === height;
    }

    getBodyRect() {
      const w = this.width;
      const h = this.height;
      return { x: this.x - w/2, y: this.y - h, w, h };
    }

    getHurtRects() {
      // Split body into three regions for high/mid/low
      const b = this.getBodyRect();
      const seg = b.h / 3;
      return {
        low:  { x: b.x, y: b.y + seg*2, w: b.w, h: seg },
        mid:  { x: b.x, y: b.y + seg*1, w: b.w, h: seg },
        high: { x: b.x, y: b.y + seg*0, w: b.w, h: seg }
      };
    }

    getAttackRect() {
      if (!this.attack) return null;
      const spec = ATTACKS[this.attack.kind];
      let active = false;
      const t = this.attack.t;
      if (t >= this.attack.windup && t < this.attack.windup + this.attack.active) active = true;
      if (!active) return null;
      const reach = spec.reach * (this.attack.kind === 'punch' ? (0.85 + 0.35 * this.armExtend) : (0.65 + 0.7 * this.legExtend));
      const b = this.getBodyRect();
      // Tighter hitboxes near fist/instep
      const w = this.attack.kind === 'punch' ? 18 : 22;
      const h = this.attack.kind === 'punch' ? 22 : Math.max(20, b.h/3*0.6);
      let yOffset = 0;
      if (this.attack.height === 'mid') yOffset = b.h/3;
      else if (this.attack.height === 'low') yOffset = b.h/3*2 + (this.attack.kind === 'punch' ? -6 : 0);
      const x = this.dir === 1 ? (b.x + b.w + reach - w/2) : (b.x - reach - w/2);
      const y = b.y + yOffset + (b.h/3 - h)/2;
      return { x, y, w, h };
    }

    applyHit(dmg, knock, kind, height, blocked) {
      if (!this.alive) return;
      if (blocked) {
        // Chip damage
        this.hp = Math.max(0, this.hp - Math.max(1, Math.round(dmg * 0.2)));
        this.hitLag = 80;
      } else {
        this.hp = Math.max(0, this.hp - dmg);
        this.hitLag = 160;
        // Simple knockback
        this.x += -this.dir * knock;
      }
      if (this.hp <= 0) {
        this.alive = false;
        this.attack = null;
        this.state = 'dead';
      } else {
        this.state = blocked ? 'block' : 'hit';
        this.stateT = 0;
      }
    }

    update(dt, game, input) {
      // dt in ms
      if (!this.alive) {
        this.armExtend = Math.max(0, this.armExtend - dt * 0.004);
        this.legExtend = Math.max(0, this.legExtend - dt * 0.004);
        return;
      }

      this.attackCooldown = Math.max(0, this.attackCooldown - dt);
      this.hitLag = Math.max(0, this.hitLag - dt);

      if (this.hitLag > 0) {
        // small freeze
        return;
      }

      // Decide movement for player or enemy
      if (!this.enemy) this.handlePlayerInput(dt, input, game);
      else this.handleAI(dt, game);

      // Integrate movement
      let vx = 0;
      if (this.state !== 'attack' && this.state !== 'hit' && this.state !== 'block') {
        if (this.moveDir !== 0) {
          vx = this.moveDir * this.speed * (HEIGHTS[this.stanceIndex] === 'low' ? 0.9 : HEIGHTS[this.stanceIndex] === 'high' ? 1.05 : 1);
          if (this.enemy) vx *= 0.85; // slower enemies
          this.state = 'walk';
          // step-like progression: accelerate phase when moving
          this.walkCycle += dt * 0.012;
          this.stepPhase = (this.stepPhase + dt * 0.0025) % 1; // slower foot exchange
        } else if (!this.attack) {
          this.state = 'idle';
        }
      }
      this.x += vx * dt / 1000;
      this.x = clamp(this.x, 20, WORLD_W - 20);

      // Attack timeline
      if (this.attack) {
        const a = this.attack;
        a.t += dt;
        const spec = ATTACKS[a.kind];
        // Animate extend
        if (a.t < a.windup) {
          if (a.kind === 'punch') this.armExtend = lerp(this.armExtend, 1.0, 0.2);
          else this.legExtend = lerp(this.legExtend, 1.0, 0.2);
        } else if (a.t < a.windup + a.active) {
          if (a.kind === 'punch') this.armExtend = lerp(this.armExtend, 1.0, 0.35);
          else this.legExtend = lerp(this.legExtend, 1.0, 0.35);
          // Active window: check hit once
          const self = this;
          const tryHit = (opts) => {
            const hitbox = self.getAttackRect();
            if (!hitbox || !game) return;
            const foe = self.enemy ? game.player : game.activeEnemy;
            if (!foe) return;
            const foeHurt = foe.getHurtRects()[a.height];
            const contact = rectsOverlap(hitbox, foeHurt);
            if (!contact) return;
            const blocked = foe.isBlockingAgainst(a.height);
            const dmg = opts?.dmg ?? spec.dmg;
            const knock = opts?.knock ?? (spec.reach * 0.6);
            foe.applyHit(dmg, knock, a.kind, a.height, blocked);
          };

          // Debug: Hyakuretsu multi-hit during punch active window
          if (this.debugHyakuretsu && !this.enemy && a.kind === 'punch') {
            a._multiAcc = (a._multiAcc || 0) + dt;
            const period = 45; // ms per hit
            while (a._multiAcc >= period) {
              a._multiAcc -= period;
              tryHit({ dmg: 8, knock: 3 });
            }
          } else {
            if (!a.applied) { tryHit(); a.applied = true; }
          }
        } else if (a.t < a.windup + a.active + a.recover) {
          if (a.kind === 'punch') this.armExtend = lerp(this.armExtend, 0.0, 0.18);
          else this.legExtend = lerp(this.legExtend, 0.0, 0.18);
        } else {
          // End attack
          this.attack = null;
          this.attackCooldown = 120; // brief delay
          this.state = 'idle';
        }
      } else {
        // relax limbs
        this.armExtend = lerp(this.armExtend, 0.0, 0.25);
        this.legExtend = lerp(this.legExtend, 0.0, 0.25);
      }
    }

    handlePlayerInput(dt, input, game) {
      this.moveDir = 0;
      if (keys.has('arrowleft')) this.moveDir -= 1;
      if (keys.has('arrowright')) this.moveDir += 1;

      // Constrain progress to near enemy if engaged (prevent running through)
      const foe = game.activeEnemy;
      if (foe && foe.alive) {
        // Maintain minimal spacing
        const spacing = 32;
        if (this.dir === 1 && this.x + this.width/2 + spacing > foe.x - foe.width/2) this.moveDir = Math.min(0, this.moveDir);
        if (this.dir === -1 && this.x - this.width/2 - spacing < foe.x + foe.width/2) this.moveDir = Math.max(0, this.moveDir);
      }

      // Stance changes: W up, S down
      if (keys.has('w')) this.stanceIndex = clamp(this.stanceIndex + 1, 0, 2);
      if (keys.has('s')) this.stanceIndex = clamp(this.stanceIndex - 1, 0, 2);

      // Debounce stance change speed slightly by consuming once per press
      // Simple approach: remove key after applying; player can hold to step slowly due to key repeat
      if (keys.has('w')) keys.delete('w');
      if (keys.has('s')) keys.delete('s');

      // Attack inputs: J punch, K kick; aim = stance
      if (keys.has('j')) {
        // Start normal punch; Hyakuretsu mode will multi-hit during active
        this.startAttack('punch', this.stance);
        // Extend active for flurry so many hits can occur from one input
        if (this.debugHyakuretsu && this.attack && this.attack.kind === 'punch') {
          this.attack.active = Math.max(this.attack.active, 800);
          this.attack.recover = Math.min(this.attack.recover, 120);
        }
        keys.delete('j');
      }
      if (keys.has('k')) { this.startAttack('kick',  this.stance); keys.delete('k'); }

      // Face opponent if exists else face right (progression)
      if (foe && foe.alive) this.faceToward(foe.x);
      else this.dir = 1;
    }

    handleAI(dt, game) {
      const player = game.player;
      if (!player) return;
      this.faceToward(player.x);
      const dist = Math.abs(this.x - player.x);
      const desired = 64; // engage distance
      const margin = 10;

      if (!this.attack) {
        if (dist > desired + margin) this.moveDir = this.x < player.x ? 1 : -1;
        else if (dist < desired - margin) this.moveDir = this.x < player.x ? -1 : 1;
        else this.moveDir = 0;
      } else {
        this.moveDir = 0;
      }

      // Defend: align stance to player's current attack if close
      if (player.attack && dist < 90) {
        this.stanceIndex = HEIGHTS.indexOf(player.attack.height);
      } else {
        // Otherwise, change stance occasionally toward random or to counter player's stance
        if (Math.random() < 0.01) {
          if (Math.random() < 0.6) this.stanceIndex = HEIGHTS.indexOf(player.stance);
          else this.stanceIndex = Math.floor(Math.random() * 3);
        }
      }

      // Offense: try to attack periodically when in range
      this._aiAtkTimer = (this._aiAtkTimer || rand(400, 900)) - dt;
      if (this._aiAtkTimer <= 0 && !this.attack && this.attackCooldown <= 0 && dist < 86) {
        const preferKick = Math.random() < 0.45;
        const kind = preferKick ? 'kick' : 'punch';
        // Aim sometimes away from player's stance to slip through
        const options = ['low','mid','high'];
        let aim = options[Math.floor(Math.random()*3)];
        if (Math.random() < 0.55) {
          // pick a height not equal to player's stance
          const others = options.filter(h => h !== player.stance);
          aim = others[Math.floor(Math.random()*others.length)];
        }
        this.startAttack(kind, aim);
        this._aiAtkTimer = rand(700, 1400);
      }
    }

    draw(ctx, camX) {
      const b = this.getBodyRect();
      const BX = Math.round(b.x - camX);
      const BY = Math.round(b.y);
      const BW = Math.round(b.w);
      const BH = Math.round(b.h);

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(BX + BW/2, this.y + 4, Math.max(18, BW*0.7), 8, 0, 0, Math.PI * 2);
      ctx.fill();

      const side = this.dir; // 1 facing right, -1 left
      const outline = '#0b0e12';
      const baseColor = this.color;
      const accentColor = this.enemy ? '#2c7dfd' : '#ff3b4d';
      const backArmColor = lighten(baseColor, 0.18);
      const backLegColor = lighten(baseColor, 0.1);
      const frontArmColor = baseColor;
      const frontLegColor = lighten(baseColor, 0.03);
      const handAccent = lighten(baseColor, 0.28);
      const backHandAccent = lighten(baseColor, 0.32);
      const skinTone = this.enemy ? '#f1c6a8' : '#f7d8bd';
      const skinShade = darken(skinTone, 0.18);
      const skinHighlight = lighten(skinTone, 0.15);
      const hairColor = this.enemy ? '#1f2d4a' : '#3a231b';
      const hairHighlight = lighten(hairColor, 0.2);
      const giBase = '#f5f9ff';
      const giShadow = darken(giBase, 0.18);
      const giHighlight = lighten(giBase, 0.1);

      // Derived anchor points
      const torsoTop = BY + BH * 0.18;
      const torsoBot = BY + BH * 0.7;
      const torsoH = torsoBot - torsoTop;
      const torsoW = BW * 0.9;
      const torsoX = BX + BW*0.05;
      const shoulderY = torsoTop + torsoH * 0.28;
      const hipY = torsoBot - 2;
      const shoulderX = BX + (side === 1 ? BW*0.74 : BW*0.26);
      const hipX = BX + (side === 1 ? BW*0.66 : BW*0.34);

      // Stance and walk shaping
      const stance = this.stance; // 'low' | 'mid' | 'high'
      const crouch = stance === 'low' ? 8 : stance === 'mid' ? 4 : 0;
      const lean = stance === 'high' ? 0.02 : stance === 'low' ? 0.10 : 0.06;
      const beltY = torsoTop + torsoH*0.58 + crouch*0.3;
      const walkSwing = Math.sin(this.walkCycle*2) * 0.25;

      // Torso/gi
      ctx.save();
      ctx.translate(hipX, (torsoTop + torsoBot)/2 + crouch);
      ctx.rotate(lean * side);
      const giGrad = ctx.createLinearGradient(0, -torsoH/2, 0, torsoH/2);
      giGrad.addColorStop(0, giHighlight);
      giGrad.addColorStop(0.52, giBase);
      giGrad.addColorStop(1, giShadow);
      ctx.fillStyle = giGrad;
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-torsoW * 0.55, -torsoH / 2);
      ctx.quadraticCurveTo(-torsoW * 0.78, -torsoH * 0.05, -torsoW * 0.38, torsoH / 2);
      ctx.lineTo(torsoW * 0.42, torsoH / 2);
      ctx.quadraticCurveTo(torsoW * 0.78, -torsoH * 0.05, torsoW * 0.5, -torsoH / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Lapel and gi folds
      ctx.strokeStyle = darken(giBase, 0.3);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-torsoW * 0.02, -torsoH / 2);
      ctx.lineTo(-side * torsoW * 0.32, -torsoH * 0.08);
      ctx.lineTo(side * torsoW * 0.08, torsoH * 0.38);
      ctx.stroke();

      ctx.strokeStyle = darken(giBase, 0.25);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(side * torsoW * 0.18, -torsoH * 0.04);
      ctx.quadraticCurveTo(side * torsoW * 0.32, torsoH * 0.26, side * torsoW * 0.1, torsoH * 0.48);
      ctx.stroke();

      // Belt
      const beltWidth = torsoW * 0.92;
      const beltHeight = torsoH * 0.18;
      const beltLocalY = beltY - ((torsoTop + torsoBot) / 2 + crouch);
      const beltTop = beltLocalY - beltHeight / 2;
      const beltGrad = ctx.createLinearGradient(-beltWidth / 2, beltLocalY, beltWidth / 2, beltLocalY);
      beltGrad.addColorStop(0, darken(baseColor, 0.45));
      beltGrad.addColorStop(0.52, darken(baseColor, 0.2));
      beltGrad.addColorStop(1, lighten(baseColor, 0.1));
      ctx.fillStyle = beltGrad;
      roundedRectPath(-beltWidth / 2, beltTop, beltWidth, beltHeight, beltHeight * 0.45);
      ctx.fill();
      ctx.strokeStyle = darken(baseColor, 0.5);
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.strokeStyle = lighten(baseColor, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-beltWidth * 0.36, beltTop + beltHeight * 0.25);
      ctx.lineTo(-beltWidth * 0.08, beltTop + beltHeight * 0.18);
      ctx.moveTo(beltWidth * 0.05, beltTop + beltHeight * 0.22);
      ctx.lineTo(beltWidth * 0.35, beltTop + beltHeight * 0.34);
      ctx.stroke();
      ctx.restore();

      // Head & portrait details
      const headX = BX + BW/2 + side * 8;
      const headY = BY + BH * 0.12 + crouch * 0.2;
      const headR = BW * 0.34;
      const faceTilt = -side * 0.05 + this.armExtend * 0.02 * side;

      // Neck
      const neckBottom = torsoTop + crouch * 0.6;
      const neckTop = headY + headR * 0.52;
      const neckHeight = Math.max(6, neckBottom - neckTop);
      const neckCenterY = neckTop + neckHeight / 2;
      const neckWidth = headR * 0.62;
      const neckCenterX = headX - side * headR * 0.04;
      const neckGrad = ctx.createLinearGradient(neckCenterX, neckCenterY - neckHeight / 2, neckCenterX, neckCenterY + neckHeight / 2);
      neckGrad.addColorStop(0, skinHighlight);
      neckGrad.addColorStop(0.6, skinTone);
      neckGrad.addColorStop(1, skinShade);
      ctx.fillStyle = neckGrad;
      ctx.strokeStyle = skinShade;
      ctx.lineWidth = 1.6;
      roundedRectPath(neckCenterX - neckWidth / 2, neckCenterY - neckHeight / 2, neckWidth, neckHeight, neckWidth * 0.45);
      ctx.fill();
      ctx.stroke();

      // Hair volume (back)
      ctx.save();
      ctx.translate(headX, headY);
      ctx.rotate(faceTilt * 0.3);
      ctx.beginPath();
      ctx.moveTo(-side * headR * 0.95, -headR * 0.6);
      ctx.quadraticCurveTo(-side * headR * 0.45, -headR * 1.18, side * headR * 0.3, -headR * 1.05);
      ctx.quadraticCurveTo(side * headR * 1.05, -headR * 0.12, side * headR * 0.9, headR * 0.64);
      ctx.quadraticCurveTo(side * headR * 0.1, headR * 1.02, -side * headR * 0.82, headR * 0.88);
      ctx.closePath();
      const hairGrad = ctx.createLinearGradient(-side * headR, -headR, side * headR, headR);
      hairGrad.addColorStop(0, hairHighlight);
      hairGrad.addColorStop(1, hairColor);
      ctx.fillStyle = hairGrad;
      ctx.fill();
      ctx.strokeStyle = darken(hairColor, 0.25);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Ear
      ctx.save();
      ctx.translate(headX - side * headR * 0.72, headY + headR * 0.05);
      ctx.rotate(faceTilt * 0.3);
      const earGrad = ctx.createLinearGradient(-headR * 0.2, -headR * 0.3, headR * 0.2, headR * 0.3);
      earGrad.addColorStop(0, skinHighlight);
      earGrad.addColorStop(1, skinTone);
      ctx.fillStyle = earGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, headR * 0.24, headR * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = skinShade;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.restore();

      // Headband ties
      ctx.save();
      ctx.translate(headX + side * headR * 1.02, headY - headR * 0.42);
      ctx.rotate(faceTilt * 0.4 + side * 0.12);
      ctx.fillStyle = darken(accentColor, 0.15);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(side * headR * 0.38, headR * 0.1, side * headR * 0.36, headR * 0.48);
      ctx.quadraticCurveTo(side * headR * 0.16, headR * 0.62, 0, headR * 0.68);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = darken(accentColor, 0.35);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();

      // Face & features
      ctx.save();
      ctx.translate(headX, headY);
      ctx.rotate(faceTilt);
      const faceGrad = ctx.createRadialGradient(-side * headR * 0.18, -headR * 0.45, headR * 0.12, 0, 0, headR);
      faceGrad.addColorStop(0, skinHighlight);
      faceGrad.addColorStop(0.7, skinTone);
      faceGrad.addColorStop(1, skinShade);
      ctx.fillStyle = faceGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, headR * 0.8, headR * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2;
      ctx.stroke();

      const bandTop = -headR * 0.58;
      const bandBottom = -headR * 0.32;
      ctx.beginPath();
      ctx.moveTo(-headR * 0.88, bandTop);
      ctx.quadraticCurveTo(0, bandTop - headR * 0.12, headR * 0.94, bandTop);
      ctx.lineTo(headR * 1.02, bandBottom);
      ctx.quadraticCurveTo(0, bandBottom - headR * 0.05, -headR * 0.98, bandBottom);
      ctx.closePath();
      const bandGrad = ctx.createLinearGradient(-headR, 0, headR, 0);
      bandGrad.addColorStop(0, darken(accentColor, 0.2));
      bandGrad.addColorStop(0.5, accentColor);
      bandGrad.addColorStop(1, lighten(accentColor, 0.2));
      ctx.fillStyle = bandGrad;
      ctx.fill();
      ctx.strokeStyle = darken(accentColor, 0.35);
      ctx.lineWidth = 1.4;
      ctx.stroke();

      const intense = this.state === 'attack' || this.state === 'block' || this.state === 'hit';
      const eyeSquint = intense ? headR * 0.04 : 0;
      const browDrop = intense ? headR * 0.06 : 0;

      const eyeX = side * headR * 0.22;
      const eyeY = -headR * 0.08 + eyeSquint * 0.4;
      const eyeH = Math.max(headR * 0.12, headR * 0.18 - eyeSquint);
      ctx.beginPath();
      ctx.ellipse(eyeX, eyeY, headR * 0.24, eyeH, -side * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = '#fdfdff';
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(eyeX + side * headR * 0.06, eyeY, headR * 0.09, headR * 0.09, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1b1e';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(eyeX + side * headR * 0.08, eyeY - headR * 0.03, headR * 0.03, headR * 0.03, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      const farEyeX = -side * headR * 0.06;
      const farEyeY = eyeY + headR * 0.02;
      const farEyeH = Math.max(headR * 0.1, eyeH * 0.7);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(farEyeX, farEyeY, headR * 0.18, farEyeH, -side * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = '#f7f8fb';
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(farEyeX, farEyeY, headR * 0.18, farEyeH, -side * 0.12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(farEyeX + side * headR * 0.04, farEyeY, headR * 0.055, headR * 0.055, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#1f242a';
      ctx.fill();

      ctx.strokeStyle = darken(hairColor, 0.1);
      ctx.lineWidth = headR * 0.16;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(eyeX - side * headR * 0.24, eyeY - headR * 0.28 - browDrop);
      ctx.lineTo(eyeX + side * headR * 0.18, eyeY - headR * 0.22 - browDrop);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(farEyeX - side * headR * 0.16, farEyeY - headR * 0.28 - browDrop * 0.5);
      ctx.lineTo(farEyeX + side * headR * 0.14, farEyeY - headR * 0.24 - browDrop * 0.5);
      ctx.stroke();

      ctx.strokeStyle = skinShade;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(side * headR * 0.04, -headR * 0.02);
      ctx.quadraticCurveTo(side * headR * 0.22, headR * 0.1, side * headR * 0.04, headR * 0.18);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(side * headR * 0.02, headR * 0.18);
      ctx.quadraticCurveTo(side * headR * 0.18, headR * 0.21, side * headR * 0.14, headR * 0.24);
      ctx.stroke();

      const mouthY = headR * 0.38;
      ctx.strokeStyle = mixColor(skinTone, '#b55c52', 0.5);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-side * headR * 0.08, mouthY);
      ctx.quadraticCurveTo(side * headR * 0.02, mouthY + headR * 0.07, side * headR * 0.28, mouthY - headR * 0.02);
      ctx.stroke();
      ctx.strokeStyle = skinHighlight;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-side * headR * 0.05, mouthY - headR * 0.02);
      ctx.quadraticCurveTo(side * headR * 0.04, mouthY + headR * 0.03, side * headR * 0.22, mouthY - headR * 0.04);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 146, 146, 0.18)';
      ctx.beginPath();
      ctx.ellipse(side * headR * 0.04, headR * 0.26, headR * 0.24, headR * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // Fringe highlight
      ctx.save();
      ctx.translate(headX, headY);
      ctx.rotate(faceTilt * 0.2);
      ctx.strokeStyle = hairHighlight;
      ctx.lineWidth = headR * 0.12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-side * headR * 0.28, -headR * 0.55);
      ctx.lineTo(-side * headR * 0.08, -headR * 0.32);
      ctx.stroke();
      ctx.restore();

      // Limb dimensions
      const upperArm = BH * 0.22;
      const foreArm  = BH * 0.22;
      const thigh    = BH * 0.26;
      const shin     = BH * 0.26;
      const footL    = BH * 0.16;
      const thicknessArm = 7;
      const thicknessLeg = 8;

      // Base guard angles (front/back)
      const guardFront = { up: -0.15 + walkSwing*0.3, low: -1.0 };
      const guardBack  = { up: -0.75 - walkSwing*0.2, low: -0.9 };
      const legFrontA  = { thigh: 0.75 + (stance==='low'?0.15:0) + walkSwing*0.2, shin: 0.85 + (stance==='low'?0.15:0) - walkSwing*0.2, foot: 0.15 };
      const legBackA   = { thigh: 0.95 + (stance==='low'?0.15:0) - walkSwing*0.2, shin: 0.95 + (stance==='low'?0.15:0) + walkSwing*0.2, foot: -0.05 };

      // Attack posing adjustments
      if (this.attack) {
        const a = this.attack;
        const total = a.windup + a.active + a.recover;
        const p = clamp(a.t / total, 0, 1);
        if (a.kind === 'punch') {
          // Front arm jab/oi-zuki
          const raise = a.height === 'high' ? -0.16 : a.height === 'low' ? 0.12 : 0.0;
          if (p < a.windup/total) {
            guardFront.up += -0.2; guardFront.low += -0.3;
          } else if (p < (a.windup + a.active)/total) {
            const k = (p - a.windup/total) / (a.active/total);
            guardFront.up = lerp(guardFront.up, 0.15 + raise, k);
            guardFront.low = lerp(guardFront.low, -0.1, k);
            // slight lunge by torso lean
            const l = lerp(lean, lean + 0.06, k);
            // override lean visually by translating torso anchor slightly forward
          } else {
            // recovery: bring back
            guardFront.up += -0.1; guardFront.low += -0.2;
          }
        } else if (a.kind === 'kick') {
          // Front-leg front kick
          const aim = a.height === 'high' ? -0.12 : a.height === 'low' ? 0.18 : 0.06;
          if (p < a.windup/total) {
            // chamber knee
            legFrontA.thigh = 0.2 + aim;
            legFrontA.shin  = 1.6;
          } else if (p < (a.windup + a.active)/total) {
            // extend
            const k = (p - a.windup/total) / (a.active/total);
            legFrontA.thigh = lerp(0.25 + aim, 0.05 + aim, k);
            legFrontA.shin  = lerp(1.6, 0.1, k);
          } else {
            // retract
            legFrontA.thigh = 0.45 + aim*0.5; legFrontA.shin = 1.2;
          }
        }
      }

      // Compute limb anchors after torso lean and crouch
      const baseShoulderX = shoulderX + side * 2;
      const baseShoulderY = shoulderY + crouch;
      const baseHipX = hipX;
      const baseHipY = hipY + crouch;

      // Back limbs first (depth)
      drawLeg(baseHipX - side*8, baseHipY, legBackA.thigh, legBackA.shin, thicknessLeg, backLegColor, lighten(backLegColor, 0.15));
      drawArm(baseShoulderX - side*8, baseShoulderY, guardBack.up, guardBack.low, thicknessArm, backArmColor, backHandAccent);

      // Torso belt knot overlay (keeps belt visible over limbs)
      const knotWidth = BW * 0.32;
      const knotHeight = BW * 0.18;
      const knotX = BX + BW / 2 - knotWidth / 2;
      const knotY = beltY - knotHeight * 0.5;
      const knotGrad = ctx.createLinearGradient(knotX, knotY, knotX + knotWidth, knotY);
      knotGrad.addColorStop(0, darken(baseColor, 0.45));
      knotGrad.addColorStop(0.5, darken(baseColor, 0.18));
      knotGrad.addColorStop(1, lighten(baseColor, 0.1));
      ctx.fillStyle = knotGrad;
      roundedRectPath(knotX, knotY, knotWidth, knotHeight, knotHeight * 0.45);
      ctx.fill();
      ctx.strokeStyle = darken(baseColor, 0.55);
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.fillStyle = darken(baseColor, 0.4);
      ctx.beginPath();
      ctx.moveTo(knotX + knotWidth * 0.18, knotY + knotHeight);
      ctx.quadraticCurveTo(knotX + knotWidth * 0.08, knotY + knotHeight * 1.6, knotX + knotWidth * 0.28, knotY + knotHeight * 2.25);
      ctx.quadraticCurveTo(knotX + knotWidth * 0.38, knotY + knotHeight * 2.0, knotX + knotWidth * 0.32, knotY + knotHeight * 1.2);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(knotX + knotWidth * 0.76, knotY + knotHeight);
      ctx.quadraticCurveTo(knotX + knotWidth * 0.92, knotY + knotHeight * 1.55, knotX + knotWidth * 0.7, knotY + knotHeight * 2.35);
      ctx.quadraticCurveTo(knotX + knotWidth * 0.56, knotY + knotHeight * 2.05, knotX + knotWidth * 0.6, knotY + knotHeight * 1.18);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = lighten(baseColor, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(knotX + knotWidth * 0.2, knotY + knotHeight * 0.35);
      ctx.lineTo(knotX + knotWidth * 0.8, knotY + knotHeight * 0.35);
      ctx.stroke();

      // Front limbs
      drawArm(baseShoulderX, baseShoulderY, guardFront.up, guardFront.low, thicknessArm, frontArmColor, handAccent);
      drawLeg(baseHipX, baseHipY, legFrontA.thigh, legFrontA.shin, thicknessLeg, frontLegColor, darken(frontLegColor, 0.2));

      // Debug attack rect
      const ar = this.getAttackRect();
      if (ar) {
        ctx.fillStyle = 'rgba(255, 160, 48, 0.35)';
        ctx.fillRect(Math.round(ar.x - camX), Math.round(ar.y), Math.round(ar.w), Math.round(ar.h));
      }

      function drawArm(sx, sy, aUpper, aLower, th, color, handColor = color) {
        const a1 = aUpper * side;
        const a2 = (aUpper + aLower) * side;
        const segmentHighlight = lighten(color, 0.35);
        const jointShade = darken(color, 0.12);

        // Shoulder cap
        ctx.save();
        ctx.translate(sx, sy);
        const shoulderGrad = ctx.createRadialGradient(-side * th * 0.2, -th * 0.6, th * 0.4, 0, 0, th * 0.9);
        shoulderGrad.addColorStop(0, segmentHighlight);
        shoulderGrad.addColorStop(1, color);
        ctx.fillStyle = shoulderGrad;
        ctx.strokeStyle = outline;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, th * 0.85, th * 1.05, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        segment(sx, sy, a1, upperArm, th, color, segmentHighlight);

        const ex = sx + Math.cos(a1) * upperArm;
        const ey = sy + Math.sin(a1) * upperArm;

        // Elbow joint
        ctx.save();
        ctx.translate(ex, ey);
        const elbowGrad = ctx.createRadialGradient(-side * th * 0.15, -th * 0.3, th * 0.2, 0, 0, th * 0.7);
        elbowGrad.addColorStop(0, segmentHighlight);
        elbowGrad.addColorStop(1, jointShade);
        ctx.fillStyle = elbowGrad;
        ctx.strokeStyle = outline;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(0, 0, th * 0.68, th * 0.54, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        segment(ex, ey, a2, foreArm, th * 0.94, color, segmentHighlight);

        const fx = ex + Math.cos(a2) * foreArm;
        const fy = ey + Math.sin(a2) * foreArm;

        // Hand/fist
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(a2);
        const fistW = th * 0.85;
        const fistH = th * 0.7;
        const handGrad = ctx.createLinearGradient(-fistW / 2, 0, fistW / 2, 0);
        handGrad.addColorStop(0, lighten(handColor, 0.25));
        handGrad.addColorStop(0.5, handColor);
        handGrad.addColorStop(1, darken(handColor, 0.2));
        ctx.fillStyle = handGrad;
        ctx.strokeStyle = outline;
        ctx.lineWidth = 1.6;
        roundedRectPath(-fistW / 2, -fistH / 2, fistW, fistH, fistH * 0.45);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = lighten(handColor, 0.35);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-fistW * 0.3, -fistH * 0.05);
        ctx.lineTo(fistW * 0.42, -fistH * 0.08);
        ctx.stroke();
        ctx.restore();
      }

      function drawLeg(sx, sy, aThigh, aShin, th, color, footColor = color) {
        const a1 = aThigh * side;
        const a2 = (aThigh + aShin) * side;
        const segmentHighlight = lighten(color, 0.28);
        const jointShade = darken(color, 0.2);

        segment(sx, sy, a1, thigh, th, color, segmentHighlight);
        const kx = sx + Math.cos(a1) * thigh;
        const ky = sy + Math.sin(a1) * thigh;

        ctx.save();
        ctx.translate(kx, ky);
        const kneeGrad = ctx.createRadialGradient(-side * th * 0.18, -th * 0.35, th * 0.2, 0, 0, th * 0.75);
        kneeGrad.addColorStop(0, segmentHighlight);
        kneeGrad.addColorStop(1, jointShade);
        ctx.fillStyle = kneeGrad;
        ctx.strokeStyle = outline;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(0, 0, th * 0.72, th * 0.56, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        segment(kx, ky, a2, shin, th * 0.96, color, segmentHighlight);

        const fx = kx + Math.cos(a2) * shin;
        const fy = ky + Math.sin(a2) * shin;

        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(a2);
        const footH = th * 0.85;
        const footGrad = ctx.createLinearGradient(0, -footH / 2, 0, footH / 2);
        footGrad.addColorStop(0, lighten(footColor, 0.25));
        footGrad.addColorStop(0.55, footColor);
        footGrad.addColorStop(1, darken(footColor, 0.2));
        ctx.fillStyle = footGrad;
        ctx.strokeStyle = outline;
        ctx.lineWidth = 2;
        roundedRectPath(0, -footH / 2, footL, footH, footH * 0.45);
        ctx.fill();
        ctx.stroke();

        const soleY = -footH / 2 + footH * 0.75;
        ctx.strokeStyle = darken(footColor, 0.3);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(footL * 0.1, soleY);
        ctx.lineTo(footL * 0.85, soleY - footH * 0.05);
        ctx.stroke();

        ctx.strokeStyle = lighten(footColor, 0.35);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(footL * 0.1, -footH * 0.15);
        ctx.lineTo(footL * 0.75, -footH * 0.22);
        ctx.stroke();

        ctx.restore();
      }

      function segment(sx, sy, ang, len, th, color, highlight) {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(ang);
        const grad = ctx.createLinearGradient(0, -th / 2, 0, th / 2);
        grad.addColorStop(0, lighten(color, 0.2));
        grad.addColorStop(0.5, color);
        grad.addColorStop(1, darken(color, 0.2));
        ctx.fillStyle = grad;
        ctx.strokeStyle = outline;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -th / 2);
        ctx.lineTo(len, -th / 2);
        ctx.quadraticCurveTo(len + th * 0.3, 0, len, th / 2);
        ctx.lineTo(0, th / 2);
        ctx.quadraticCurveTo(-th * 0.3, 0, 0, -th / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const hl = highlight || lighten(color, 0.35);
        ctx.strokeStyle = hl;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(len * 0.15, -th * 0.22);
        ctx.lineTo(len * 0.82, -th * 0.1);
        ctx.stroke();

        ctx.restore();
      }

      function roundedRectPath(x, y, w, h, r) {
        const radius = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        ctx.lineTo(x + radius, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
      }
    }
  }

  class Game {
    constructor() {
      this.player = new Fighter({ name: 'Player', x: 80, dir: 1, color: '#b7ebff' });
      this.enemies = [
        new Fighter({ name: 'Guard A', enemy: true, x: 520 }),
        new Fighter({ name: 'Guard B', enemy: true, x: 1120 }),
        new Fighter({ name: 'Guard C', enemy: true, x: 1680 }),
        new Fighter({ name: 'Captain', enemy: true, x: 2380, color: '#ffc7d1' })
      ];
      this.activeEnemy = null;
      this.state = 'playing'; // 'playing' | 'win' | 'lose'
      this.cameraX = 0;
      this.time = 0;
      this.engageRadius = 360; // spawn/engage enemy when within this range
      this.debugHyakuretsu = false;
    }

    reset() {
      Object.assign(this, new Game());
    }

    update(dt) {
      if (this.state !== 'playing') {
        if (keys.has('r')) { this.reset(); keys.delete('r'); }
        return;
      }

      this.time += dt;

      // Toggle debug Hyakuretsu with H
      if (keys.has('h')) { this.debugHyakuretsu = !this.debugHyakuretsu; keys.delete('h'); }

      // Engage nearest future enemy
      if (!this.activeEnemy || !this.activeEnemy.alive) {
        this.activeEnemy = this.enemies.find(e => e.alive && Math.abs(e.x - this.player.x) < this.engageRadius && e.x >= this.player.x);
      }

      // Update player and enemy
      // Inject debug flag into player each frame
      this.player.debugHyakuretsu = this.debugHyakuretsu;
      this.player.update(dt, this, keys);
      if (this.activeEnemy) this.activeEnemy.update(dt, this, null);

      // Camera follows player, limited by world
      const marginLeft = 300; // keep player slightly left of center
      const targetCam = clamp(this.player.x - marginLeft, 0, Math.max(0, WORLD_W - VIEW_W));
      this.cameraX = lerp(this.cameraX, targetCam, 0.08);

      // Check win/lose
      if (!this.player.alive) this.state = 'lose';
      const allDown = this.enemies.every(e => !e.alive);
      if (allDown && this.player.x > WORLD_W - 200) this.state = 'win';

      // UI bars
      pbar.style.width = `${Math.round((this.player.hp / this.player.maxHp) * 100)}%`;
      const foe = this.activeEnemy && this.activeEnemy.alive ? this.activeEnemy : this.enemies.find(e => e.alive) || null;
      ebar.style.width = foe ? `${Math.round((foe.hp / foe.maxHp) * 100)}%` : '0%';

      // Center message
      if (this.state === 'playing') {
        if (!this.activeEnemy || !this.activeEnemy.alive) {
          centerMsg.textContent = this.debugHyakuretsu ? '進め →  [DEBUG: 百裂拳]' : '進め →';
          centerMsg.style.opacity = 0.5;
        } else {
          centerMsg.textContent = this.debugHyakuretsu ? '[DEBUG: 百裂拳]' : '';
        }
      } else if (this.state === 'win') {
        centerMsg.textContent = '勝利!  Rで再開';
        centerMsg.style.opacity = 1;
      } else if (this.state === 'lose') {
        centerMsg.textContent = '敗北…  Rで再挑戦';
        centerMsg.style.opacity = 1;
      }
    }

    draw() {
      // Clear
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Background parallax
      const skyGrad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
      skyGrad.addColorStop(0, '#0f1620');
      skyGrad.addColorStop(1, '#0b0e12');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);

      // Mountains (parallax)
      const cam = this.cameraX;
      drawHills(cam * 0.25, 0.15, '#142131');
      drawHills(cam * 0.5,  0.25, '#121b28');

      // Ground
      ctx.fillStyle = '#141a22';
      ctx.fillRect(0, GROUND_Y + 8, VIEW_W, VIEW_H - (GROUND_Y + 8));
      ctx.fillStyle = '#1a2533';
      ctx.fillRect(0, GROUND_Y, VIEW_W, 10);
      ctx.fillStyle = '#223044';
      for (let i = -100; i < VIEW_W + 100; i += 24) {
        const ix = ((i + (-(cam % 24))) | 0);
        ctx.fillRect(ix, GROUND_Y + 10, 18, 2);
      }

      // Fighters
      if (this.activeEnemy) this.activeEnemy.draw(ctx, cam);
      this.player.draw(ctx, cam);

      function drawHills(cx, scale, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        const baseY = GROUND_Y - 160*scale;
        ctx.moveTo(-1000, VIEW_H);
        for (let i = -1; i <= 8; i++) {
          const peakX = i * 420 - (cx % 420);
          const peakY = baseY - 60 * (0.5 + Math.sin(i*1.7)*0.5) * scale;
          ctx.quadraticCurveTo(peakX - 140, baseY + 30*scale, peakX, peakY);
          ctx.quadraticCurveTo(peakX + 140, baseY + 30*scale, peakX + 280, baseY);
        }
        ctx.lineTo(VIEW_W + 1000, VIEW_H);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  const game = new Game();

  // Main loop
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(32, now - last);
    last = now;
    game.update(dt);
    game.draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
