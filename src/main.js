/*
MIT License

Copyright (c) 2025 Karate project contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

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
    const smoothStep = (t) => t * t * (3 - 2 * t);

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
      constructor(opts = {}) {
        this.name = opts.name || 'Fighter';
        this.x = opts.x || 100;
        this.y = opts.y || GROUND_Y;
        this.dir = opts.dir || 1; // 1 right, -1 left
        this.enemy = !!opts.enemy;
        this.color = opts.color || '#cde5ff';
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
        // Palette
        this.giColor = opts.giColor || '#f5f9ff';
        this.skinTone = opts.skinTone || (this.enemy ? '#d49c70' : '#f6d2b7');
        this.skinToneShade = opts.skinToneShade || (this.enemy ? '#c98453' : '#eab28c');
        this.hairColor = opts.hairColor || (this.enemy ? '#2f241c' : '#3a2417');
        this.eyeColor = opts.eyeColor || '#1a1a1a';
        this.beltColor = opts.beltColor || (this.enemy ? '#1f3f7a' : '#c41f3e');
        this.accentColor = opts.accentColor || (this.enemy ? '#2856a6' : '#d53f4e');
        this.footWrapColor = opts.footWrapColor || (this.enemy ? '#25344a' : '#27364a');
        this.giShadow = opts.giShadow || (this.enemy ? '#e0e3ef' : '#e5ecf6');
        this.opacity = 1;
        // Animation params
        this.armExtend = 0; // 0..1 (punch blend)
        this.legExtend = 0; // 0..1 (kick blend)
        this.walkCycle = 0; // step cycle
        this.stepPhase = 0; // 0..1 for step-like footwork
        // Debug flags (injected by Game each frame)
        this.debugHyakuretsu = false;
        this.bowState = null;
        this.bowAmount = 0;
        this.hasGreeted = false;
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

      startBow(durations = {}) {
        if (!this.alive || this.bowState) return;
        const defaults = { down: 520, hold: 360, up: 520 };
        const phases = { ...defaults, ...durations };
        this.bowState = { phase: 'down', t: 0, durations: phases };
        this.bowAmount = 0;
        this.attack = null;
        this.intentAttack = null;
        this.hitLag = 0;
        this.moveDir = 0;
        this.state = 'bow';
        this.stateT = 0;
        this.walkCycle = 0;
        this.stepPhase = 0;
        const total = (phases.down || 0) + (phases.hold || 0) + (phases.up || 0);
        this.attackCooldown = Math.max(this.attackCooldown, total + 160);
      }

      isBowAnimating() { return !!this.bowState; }

      hasClearedBowPose() { return !this.bowState && this.bowAmount < 0.05; }

      handleBow(dt) {
        if (this.bowState) {
          const bs = this.bowState;
          const durations = bs.durations;
          bs.t += dt;
          this.moveDir = 0;
          this.state = 'bow';
          this.stateT += dt;
          this.attack = null;
          this.intentAttack = null;
          this.walkCycle = lerp(this.walkCycle, 0, 0.25);
          this.stepPhase = lerp(this.stepPhase, 0, 0.2);
          if (bs.phase === 'down') {
            const downDur = Math.max(1, durations.down || 0);
            const prog = clamp(bs.t / downDur, 0, 1);
            this.bowAmount = lerp(this.bowAmount, prog, 0.35);
            if (bs.t >= downDur) { bs.phase = 'hold'; bs.t = 0; }
          } else if (bs.phase === 'hold') {
            const holdDur = Math.max(1, durations.hold || 0);
            this.bowAmount = lerp(this.bowAmount, 1, 0.22);
            if (bs.t >= holdDur) { bs.phase = 'up'; bs.t = 0; }
          } else if (bs.phase === 'up') {
            const upDur = Math.max(1, durations.up || 0);
            const prog = clamp(bs.t / upDur, 0, 1);
            this.bowAmount = lerp(this.bowAmount, Math.max(0, 1 - prog), 0.28);
            if (bs.t >= upDur) {
              this.bowState = null;
              this.state = 'idle';
              this.stateT = 0;
              this.bowAmount = lerp(this.bowAmount, 0, 0.28);
              this.attackCooldown = Math.max(this.attackCooldown, 240);
              return true;
            }
          }
          return true;
        }
        this.bowAmount = lerp(this.bowAmount, 0, 0.18);
        return false;
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
          this.opacity = Math.max(0.2, this.opacity - dt * 0.001);
          return;
        }

        this.attackCooldown = Math.max(0, this.attackCooldown - dt);
        this.hitLag = Math.max(0, this.hitLag - dt);

        if (this.hitLag > 0) {
          // small freeze
          return;
        }

        if (this.handleBow(dt)) {
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
        const leftLimit = game ? game.getLeftBoundary(this) : 20;
        const rightLimit = game ? game.getRightBoundary(this) : WORLD_W - 20;
        this.x = clamp(this.x, leftLimit, rightLimit);

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
              if (!self.enemy && game.handlePlayerAttackSwing) {
                const hazardHit = game.handlePlayerAttackSwing(hitbox, self, a, opts);
                if (hazardHit) {
                  a.applied = true;
                  return;
                }
              }
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

        if (!game || game.state !== 'falling') {
          this.opacity = lerp(this.opacity, 1, 0.15);
          this.y = lerp(this.y, GROUND_Y, 0.35);
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
        if (keys.has('w')) keys.delete('w');
        if (keys.has('s')) keys.delete('s');

        // Attack inputs: J punch, K kick; aim = stance
        if (keys.has('j')) {
          this.startAttack('punch', this.stance);
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
          const options = ['low','mid','high'];
          let aim = options[Math.floor(Math.random()*3)];
          if (Math.random() < 0.55) {
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

        const bowAmount = this.bowAmount || 0;

        ctx.save();
        ctx.globalAlpha = this.opacity;

        // Shadow fades as fighter falls
        const dropDepth = Math.max(0, this.y - GROUND_Y);
        const shadowAlpha = 0.35 * Math.max(0, 1 - dropDepth / 220);
        const shadowRadius = Math.max(12, Math.max(18, BW*0.7) * Math.max(0.35, 1 - dropDepth / 240));
        const shadowY = this.y + Math.min(50, dropDepth * 0.2) + 4;
        ctx.fillStyle = `rgba(0,0,0,${shadowAlpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(BX + BW/2, shadowY, shadowRadius, Math.max(6, 8 - dropDepth * 0.02), 0, 0, Math.PI * 2);
        ctx.fill();

        const side = this.dir; // 1 facing right, -1 left
        const outline = '#0b0e12';
        const giColor = this.giColor;
        const giShadow = this.giShadow;
        const skinFront = this.skinTone;
        const skinBack = this.skinToneShade;
        const hair = this.hairColor;
        const accent = this.accentColor;
        const beltColor = this.beltColor;
        const wrapColor = this.footWrapColor;

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
        const baseCrouch = stance === 'low' ? 8 : stance === 'mid' ? 4 : 0;
        const bowCrouch = bowAmount * 18;
        const crouch = baseCrouch + bowCrouch;
        const baseLean = stance === 'high' ? 0.02 : stance === 'low' ? 0.10 : 0.06;
        const lean = baseLean + bowAmount * 0.28;
        const beltY = torsoTop + torsoH*0.58 + crouch*0.3;
        const walkSwing = Math.sin(this.walkCycle*2) * 0.25;

        // Torso/gi
        ctx.save();
        ctx.translate(hipX, (torsoTop + torsoBot)/2 + crouch);
        ctx.rotate(lean * side);
        ctx.fillStyle = giColor;
        ctx.strokeStyle = outline;
        ctx.lineWidth = 2;
        ctx.fillRect(-torsoW/2, -torsoH/2, torsoW, torsoH);
        ctx.strokeRect(-torsoW/2, -torsoH/2, torsoW, torsoH);
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(-torsoW/2 + 4, -torsoH/2 + torsoH*0.3, torsoW - 8, torsoH*0.55);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(-torsoW/2 + 3, -torsoH/2 + 3, torsoW*0.32, torsoH*0.28);
        ctx.strokeStyle = outline;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -torsoH/2);
        ctx.lineTo(-side*torsoW*0.25, -torsoH*0.05);
        ctx.lineTo(0, torsoH*0.25);
        ctx.stroke();
        ctx.restore();

        // Head (with hair and facial features)
        const headX = BX + BW/2 + side*8;
        const headY = BY + BH*0.12 + crouch*0.2;
        const headR = BW*0.34;

        ctx.save();
        ctx.beginPath();
        ctx.arc(headX, headY - headR*0.75, headR*1.05, Math.PI, 0);
        ctx.quadraticCurveTo(headX + headR*1.05, headY - headR*0.1, headX + headR*0.8, headY + headR*0.3);
        ctx.lineTo(headX - headR*0.8, headY + headR*0.3);
        ctx.quadraticCurveTo(headX - headR*1.05, headY - headR*0.1, headX - headR*1.05, headY - headR*0.75);
        ctx.closePath();
        ctx.fillStyle = hair;
        ctx.fill();
        ctx.restore();

        ctx.beginPath();
        ctx.arc(headX, headY, headR, 0, Math.PI*2);
        ctx.fillStyle = skinFront;
        ctx.fill();
        ctx.strokeStyle = outline;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = accent;
        ctx.fillRect(headX - headR*0.8, headY - headR*0.32, headR*1.6, headR*0.18);
        ctx.strokeStyle = outline;
        ctx.strokeRect(headX - headR*0.8, headY - headR*0.32, headR*1.6, headR*0.18);

        ctx.beginPath();
        const earX = headX - side * headR * 0.88;
        const earY = headY + headR*0.05;
        ctx.arc(earX, earY, headR*0.3, Math.PI*0.2, Math.PI*1.8);
        ctx.fillStyle = skinFront;
        ctx.fill();
        ctx.strokeStyle = outline;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const eyeOffset = headR*0.4;
        const eyeY = headY - headR*0.1;
        ctx.fillStyle = this.eyeColor;
        ctx.fillRect(headX - eyeOffset - 3, eyeY - 3, 6, 4);
        ctx.fillRect(headX + eyeOffset - 3, eyeY - 3, 6, 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(headX - eyeOffset - 2, eyeY - 2, 2, 2);
        ctx.fillRect(headX + eyeOffset, eyeY - 2, 2, 2);

        ctx.strokeStyle = '#b07457';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(headX - side*headR*0.05, eyeY + 2);
        ctx.lineTo(headX + side*headR*0.12, eyeY + headR*0.25);
        ctx.stroke();

        ctx.strokeStyle = '#b55a58';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(headX, headY + headR*0.35, headR*0.35, 0, Math.PI);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,130,130,0.18)';
        ctx.beginPath();
        ctx.ellipse(headX - eyeOffset, headY + headR*0.15, headR*0.28, headR*0.18, 0, 0, Math.PI*2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(headX + eyeOffset, headY + headR*0.15, headR*0.28, headR*0.18, 0, 0, Math.PI*2);
        ctx.fill();

        const upperArm = BH * 0.22;
        const foreArm  = BH * 0.22;
        const thigh    = BH * 0.26;
        const shin     = BH * 0.26;
        const footL    = BH * 0.16;
        const thicknessArm = 6;
        const thicknessLeg = 7;

        const guardFront = { up: -0.15 + walkSwing*0.3, low: -1.0 };
        const guardBack  = { up: -0.75 - walkSwing*0.2, low: -0.9 };
        const legFrontA  = { thigh: 0.75 + (stance==='low'?0.15:0) + walkSwing*0.2, shin: 0.85 + (stance==='low'?0.15:0) - walkSwing*0.2, foot: 0.15 };
        const legBackA   = { thigh: 0.95 + (stance==='low'?0.15:0) - walkSwing*0.2, shin: 0.95 + (stance==='low'?0.15:0) + walkSwing*0.2, foot: -0.05 };

        if (bowAmount > 0.001) {
          guardFront.up = lerp(guardFront.up, 1.15, bowAmount);
          guardFront.low = lerp(guardFront.low, -1.45, bowAmount);
          guardBack.up = lerp(guardBack.up, 1.28, bowAmount);
          guardBack.low = lerp(guardBack.low, -1.5, bowAmount);
          legFrontA.thigh = lerp(legFrontA.thigh, 0.55, bowAmount * 0.8);
          legBackA.thigh = lerp(legBackA.thigh, 0.8, bowAmount * 0.8);
        }

        if (this.attack) {
          const a = this.attack;
          const total = a.windup + a.active + a.recover;
          const p = clamp(a.t / total, 0, 1);
          if (a.kind === 'punch') {
            const raise = a.height === 'high' ? -0.16 : a.height === 'low' ? 0.12 : 0.0;
            if (p < a.windup/total) {
              guardFront.up += -0.2; guardFront.low += -0.3;
            } else if (p < (a.windup + a.active)/total) {
              const k = (p - a.windup/total) / (a.active/total);
              guardFront.up = lerp(guardFront.up, 0.15 + raise, k);
              guardFront.low = lerp(guardFront.low, -0.1, k);
            } else {
              guardFront.up += -0.1; guardFront.low += -0.2;
            }
          } else if (a.kind === 'kick') {
            const aim = a.height === 'high' ? -0.12 : a.height === 'low' ? 0.18 : 0.06;
            if (p < a.windup/total) {
              legFrontA.thigh = 0.2 + aim;
              legFrontA.shin  = 1.6;
            } else if (p < (a.windup + a.active)/total) {
              const k = (p - a.windup/total) / (a.active/total);
              legFrontA.thigh = lerp(0.25 + aim, 0.05 + aim, k);
              legFrontA.shin  = lerp(1.6, 0.1, k);
            } else {
              legFrontA.thigh = 0.45 + aim*0.5; legFrontA.shin = 1.2;
            }
          }
        }

        const baseShoulderX = shoulderX + side * 2;
        const baseShoulderY = shoulderY + crouch;
        const baseHipX = hipX;
        const baseHipY = hipY + crouch;

        drawLeg(baseHipX - side*8, baseHipY, legBackA.thigh, legBackA.shin, thicknessLeg, giShadow, skinBack, wrapColor, true);
        drawArm(baseShoulderX - side*8, baseShoulderY, guardBack.up, guardBack.low, thicknessArm, giShadow, skinBack, true);

        ctx.fillStyle = '#0b0e12';
        ctx.fillRect(BX + 2, beltY, BW - 4, 4);
        ctx.fillStyle = beltColor;
        ctx.fillRect(BX + BW/2 - 16, beltY - 2, 32, 6);
        ctx.fillStyle = accent;
        ctx.fillRect(BX + BW/2 - 14, beltY, 28, 3);

        drawArm(baseShoulderX, baseShoulderY, guardFront.up, guardFront.low, thicknessArm, giColor, skinFront, false);
        drawLeg(baseHipX, baseHipY, legFrontA.thigh, legFrontA.shin, thicknessLeg, giColor, skinFront, wrapColor, false);

        const ar = this.getAttackRect();
        if (ar) {
          ctx.fillStyle = 'rgba(255, 160, 48, 0.35)';
          ctx.fillRect(Math.round(ar.x - camX), Math.round(ar.y), Math.round(ar.w), Math.round(ar.h));
        }

        ctx.restore();

        function drawArm(sx, sy, aUpper, aLower, th, sleeveColor, skinColor, isBack) {
          const a1 = aUpper * side;
          const a2 = (aUpper + aLower) * side;
          segmentPiece(sx, sy, a1, upperArm, th, sleeveColor, isBack);
          const elbowX = sx + Math.cos(a1) * upperArm;
          const elbowY = sy + Math.sin(a1) * upperArm;
          const clothLen = foreArm * 0.35;
          segmentPiece(elbowX, elbowY, a2, clothLen, th*0.96, sleeveColor, isBack);
          const wristX = elbowX + Math.cos(a2) * clothLen;
          const wristY = elbowY + Math.sin(a2) * clothLen;
          const skinLen = foreArm - clothLen;
          segmentPiece(wristX, wristY, a2, skinLen, th*0.9, skinColor, isBack);
          const handX = wristX + Math.cos(a2) * skinLen;
          const handY = wristY + Math.sin(a2) * skinLen;
          drawHand(handX, handY, a2, th, skinColor, isBack);
        }

        function drawLeg(sx, sy, aThigh, aShin, th, fabricColor, skinColor, wrap, isBack) {
          const a1 = aThigh * side;
          const a2 = (aThigh + aShin) * side;
          segmentPiece(sx, sy, a1, thigh, th, fabricColor, isBack);
          const kx = sx + Math.cos(a1) * thigh;
          const ky = sy + Math.sin(a1) * thigh;
          const clothLen = shin * 0.78;
          segmentPiece(kx, ky, a2, clothLen, th*0.96, fabricColor, isBack);
          const ankleX = kx + Math.cos(a2) * clothLen;
          const ankleY = ky + Math.sin(a2) * clothLen;
          const ankleSkinLen = Math.max(4, shin - clothLen);
          segmentPiece(ankleX, ankleY, a2, ankleSkinLen, th*0.88, skinColor, isBack);
          const footX = ankleX + Math.cos(a2) * ankleSkinLen;
          const footY = ankleY + Math.sin(a2) * ankleSkinLen;
          drawFoot(footX, footY, a2, th, skinColor, wrap, isBack);
        }

        function drawHand(fx, fy, ang, th, color, isBack) {
          ctx.save();
          ctx.translate(fx, fy);
          ctx.rotate(ang);
          const w = th * 1.4;
          const h = th * 0.9;
          ctx.fillStyle = color;
          ctx.strokeStyle = outline;
          ctx.lineWidth = 2;
          ctx.fillRect(-w*0.6, -h/2, w, h);
          ctx.strokeRect(-w*0.6, -h/2, w, h);
          ctx.fillStyle = isBack ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)';
          ctx.fillRect(-w*0.4, -h*0.4, w*0.35, h*0.3);
          ctx.restore();
        }

        function drawFoot(fx, fy, ang, th, skinColor, wrap, isBack) {
          ctx.save();
          ctx.translate(fx, fy);
          ctx.rotate(ang);
          const footLen = footL * 0.95;
          ctx.fillStyle = skinColor;
          ctx.strokeStyle = outline;
          ctx.lineWidth = 2;
          ctx.fillRect(-footLen*0.25, -th*0.45, footLen, th*0.9);
          ctx.strokeRect(-footLen*0.25, -th*0.45, footLen, th*0.9);
          ctx.fillStyle = wrap;
          ctx.fillRect(footLen*0.1, -th*0.45, footLen*0.28, th*0.9);
          ctx.fillStyle = isBack ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)';
          ctx.fillRect(-footLen*0.2, -th*0.35, footLen*0.18, th*0.28);
          ctx.restore();
        }

        function segmentPiece(sx, sy, ang, len, th, fill, isBack) {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(ang);
          ctx.fillStyle = fill;
          ctx.strokeStyle = outline;
          ctx.lineWidth = 2;
          ctx.fillRect(0, -th/2, len, th);
          ctx.strokeRect(0, -th/2, len, th);
          ctx.fillStyle = isBack ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)';
          ctx.fillRect(len*0.05, -th/2 + 1, len*0.2, th-2);
          ctx.restore();
        }
      }
  }

  class Pigeon {
    constructor(game) {
      this.alive = true;
      this.x = game.player ? game.player.x + 320 : 320;
      this.y = GROUND_Y - 220;
      this.state = 'enter';
      this.timer = 0;
      this.opacity = 0;
      this.hitCooldown = 0;
      this.dissolve = false;
    }

    getHitbox() {
      return { x: this.x - 28, y: this.y - 18, w: 56, h: 36 };
    }

    takeHit(game) {
      if (!this.alive || this.dissolve) return;
      this.alive = false;
      this.timer = 0;
      this.dissolve = true;
      this.opacity = 1;
      if (game && game.birdTrap) {
        game.birdTrap.resolved = true;
        game.pushTempMessage('鳩を撃退!', 1400, 0.95);
      }
    }

    update(dt, game) {
      const t = dt / 1000;
      const player = game.player;
      if (!game || game.state !== 'playing' || !player) return;

      this.timer += dt;
      this.hitCooldown = Math.max(0, this.hitCooldown - dt);

      if (this.dissolve) {
        this.opacity = Math.max(0, this.opacity - dt * 0.003);
        this.y += 180 * t;
        this.x += 40 * t;
        if (this.opacity <= 0 || this.y > GROUND_Y + 90) {
          game.birdTrap.bird = null;
        }
        return;
      }

      this.opacity = Math.min(1, this.opacity + dt * 0.0045);

      switch (this.state) {
        case 'enter': {
          this.x -= 140 * t;
          this.y = lerp(this.y, player.y - 140, 0.018 * dt);
          if (this.x <= player.x + 110) {
            this.state = 'hover';
            this.timer = 0;
          }
          break;
        }
        case 'hover': {
          this.x = lerp(this.x, player.x + 80, 0.12 * t);
          this.y = lerp(this.y, player.y - 130, 0.16 * t);
          if (this.timer >= 360) {
            this.state = 'dive';
            this.timer = 0;
          }
          break;
        }
        case 'dive': {
          const targetX = player.x + (player.dir === 1 ? -18 : 18);
          this.x = lerp(this.x, targetX, 0.25);
          this.y += 420 * t;
          if (this.hitCooldown <= 0 && this.y >= player.y - 60) {
            if (player.alive) {
              player.applyHit(8, 34, 'peck', 'high', false);
            }
            this.hitCooldown = 700;
          }
          if (this.y >= player.y + 48) {
            this.state = 'rise';
            this.timer = 0;
          }
          break;
        }
        case 'rise': {
          this.x += 220 * t;
          this.y -= 360 * t;
          if (this.y <= GROUND_Y - 210) {
            this.state = 'hover';
            this.timer = 0;
          }
          break;
        }
      }
    }

    draw(ctx, camX) {
      const alpha = this.opacity;
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      const sx = Math.round(this.x - camX);
      const sy = Math.round(this.y);
      ctx.translate(sx, sy);
      ctx.fillStyle = '#d9dde4';
      ctx.strokeStyle = '#0b0e12';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-26, -6);
      ctx.quadraticCurveTo(0, -22, 26, -6);
      ctx.quadraticCurveTo(4, 2, -26, -6);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 12, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#c2c6cf';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f8a03c';
      ctx.beginPath();
      ctx.moveTo(16, -2);
      ctx.lineTo(26, 0);
      ctx.lineTo(16, 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  class Game {
      constructor() {
        this.player = new Fighter({
          name: 'Player',
          x: 80,
          dir: 1,
          giColor: '#f8f9fd',
          giShadow: '#e7edf6',
          skinTone: '#f3c3a1',
          skinToneShade: '#e0a47b',
          hairColor: '#3d261a',
          beltColor: '#c0263b',
          accentColor: '#d74556',
          footWrapColor: '#2b3a4d'
        });
        this.enemies = [
          new Fighter({
            name: 'Guard A',
            enemy: true,
            x: 520,
            giColor: '#f2f5fb',
            giShadow: '#dde3f4',
            skinTone: '#e4b184',
            skinToneShade: '#d09361',
            hairColor: '#332418',
            beltColor: '#234985',
            accentColor: '#2c7dfd',
            footWrapColor: '#25344a'
          }),
          new Fighter({
            name: 'Guard B',
            enemy: true,
            x: 1120,
            giColor: '#f0f4fb',
            giShadow: '#dce2f1',
            skinTone: '#dca578',
            skinToneShade: '#c48653',
            hairColor: '#2a1f17',
            beltColor: '#274582',
            accentColor: '#336ffc',
            footWrapColor: '#243346'
          }),
          new Fighter({
            name: 'Guard C',
            enemy: true,
            x: 1680,
            giColor: '#f3f6fb',
            giShadow: '#dfe5f3',
            skinTone: '#c9946b',
            skinToneShade: '#b37a4e',
            hairColor: '#1f1410',
            beltColor: '#1f3c77',
            accentColor: '#2b63e6',
            footWrapColor: '#1f2d40'
          }),
          new Fighter({
            name: 'Captain',
            enemy: true,
            x: 2380,
            giColor: '#f7f2f5',
            giShadow: '#e7dbe0',
            skinTone: '#f0c3b5',
            skinToneShade: '#d39a82',
            hairColor: '#271c1a',
            beltColor: '#301f45',
            accentColor: '#ff6b81',
            footWrapColor: '#2d2f44'
          })
        ];
        this.activeEnemy = null;
        this.state = 'playing'; // 'playing' | 'falling' | 'win' | 'lose'
        this.loseReason = null;
        this.cameraX = 0;
        this.time = 0;
        this.engageRadius = 360; // spawn/engage enemy when within this range
        this.debugHyakuretsu = false;
        this.seaEdgeX = 42;
        this.seaWidth = 340;
        this.seaSurfaceY = GROUND_Y + 96;
        this.seaBottomY = GROUND_Y + 220;
        this.fallAnim = null;
        this.splashTimer = 0;
        this.engagement = { state: 'idle', enemy: null, timer: 0 };
        this.birdTrap = { triggered: false, bird: null, resolved: false };
        this.tempMessage = null;
      }

      reset() {
        Object.assign(this, new Game());
      }

      getLeftBoundary(fighter) {
        if (this.state === 'falling' && fighter === this.player) {
          return this.seaEdgeX - this.seaWidth - 120;
        }
        return 20;
      }

      getRightBoundary() {
        return WORLD_W - 20;
      }

      beginGreeting(enemy) {
        if (!enemy || enemy.hasGreeted) return;
        this.engagement = { state: 'bowing', enemy, timer: 0 };
        this.player.faceToward(enemy.x);
        enemy.faceToward(this.player.x);
        this.player.startBow();
        enemy.startBow();
        enemy.hasGreeted = true;
      }

      pushTempMessage(text, duration = 1000, opacity = 0.85) {
        this.tempMessage = { text, timer: duration, opacity };
      }

      triggerBirdTrap() {
        if (this.birdTrap.triggered) return;
        this.birdTrap.triggered = true;
        this.birdTrap.resolved = false;
        this.birdTrap.bird = new Pigeon(this);
        this.pushTempMessage('鳩が襲来!', 1600, 0.9);
      }

      handlePlayerAttackSwing(hitbox) {
        let hit = false;
        const bird = this.birdTrap.bird;
        if (bird && !bird.dissolve) {
          if (rectsOverlap(hitbox, bird.getHitbox())) {
            bird.takeHit(this);
            hit = true;
          }
        }
        return hit;
      }

      beginSeaFall() {
        this.state = 'falling';
        this.loseReason = 'fall';
        this.fallAnim = {
          t: 0,
          duration: 2600,
          startX: this.player.x,
          startY: this.player.y,
          endX: this.seaEdgeX - this.seaWidth * 0.6,
          pauseSpan: 0.4,
          splashShown: false
        };
        this.player.state = 'fall';
        this.player.moveDir = 0;
        this.player.attack = null;
        this.player.hitLag = 0;
        this.player.armExtend = 0.25;
        this.player.legExtend = 0.15;
        this.player.dir = -1;
        centerMsg.textContent = '足元が崩れた…';
        centerMsg.style.opacity = 0.9;
      }

      updateFall(dt) {
        if (keys.has('r')) { this.reset(); keys.delete('r'); return; }
        if (!this.fallAnim) return;
        const f = this.fallAnim;
        f.t += dt;
        const t = clamp(f.t / f.duration, 0, 1);
        const driftEase = smoothStep(Math.min(1, t / 0.65));
        const sinkEase = t < 0.65 ? smoothStep(t / 0.65) : 1 - Math.pow(1 - (t - 0.65) / 0.35, 2);

        this.player.x = lerp(f.startX, f.endX, driftEase);
        const surfaceTarget = this.seaSurfaceY - 28;
        const sinkTarget = this.seaBottomY;
        const midY = lerp(f.startY, surfaceTarget, Math.min(1, sinkEase));
        const deepEase = t < 0.72 ? 0 : smoothStep((t - 0.72) / 0.28);
        this.player.y = lerp(midY, sinkTarget, deepEase);
        this.player.opacity = Math.max(0, 1 - Math.pow(Math.max(0, t - 0.75) / 0.25, 1.6));
        this.player.hp = clamp(this.player.hp - (100 * dt / f.duration), 0, this.player.maxHp);
        pbar.style.width = `${Math.round((this.player.hp / this.player.maxHp) * 100)}%`;
        ebar.style.width = '0%';
        this.cameraX = lerp(this.cameraX, 0, 0.08);

        if (!f.splashShown && t > 0.68) {
          f.splashShown = true;
          this.splashTimer = 420;
        }

        centerMsg.textContent = '海へ落下中…';
        centerMsg.style.opacity = 0.85 - 0.45 * t;

        if (t >= 1) {
          this.player.hp = 0;
          this.player.alive = false;
          this.state = 'lose';
          centerMsg.textContent = '落水… Rで再挑戦';
          centerMsg.style.opacity = 1;
        }
      }

      update(dt) {
        if (this.state === 'falling') {
          this.updateFall(dt);
          return;
        }

        if (this.state !== 'playing') {
          if (keys.has('r')) { this.reset(); keys.delete('r'); }
          return;
        }

        this.time += dt;

        if (keys.has('h')) { this.debugHyakuretsu = !this.debugHyakuretsu; keys.delete('h'); }

        const activeAlive = this.activeEnemy && this.activeEnemy.alive ? this.activeEnemy : null;
        if (!activeAlive) {
          const candidate = this.enemies.find(e => e.alive && Math.abs(e.x - this.player.x) < this.engageRadius && e.x >= this.player.x);
          if (candidate) {
            this.activeEnemy = candidate;
            if (!candidate.hasGreeted) this.beginGreeting(candidate);
            else if (this.engagement.state === 'idle') this.engagement = { state: 'fight', enemy: candidate, timer: 0 };
          } else {
            this.activeEnemy = null;
            if (this.engagement.state !== 'idle') this.engagement = { state: 'idle', enemy: null, timer: 0 };
          }
        } else {
          this.activeEnemy = activeAlive;
          if (!activeAlive.hasGreeted && this.engagement.state === 'idle') this.beginGreeting(activeAlive);
          else if (this.engagement.enemy !== activeAlive) this.engagement.enemy = activeAlive;
        }

        this.player.debugHyakuretsu = this.debugHyakuretsu;
        this.player.update(dt, this, keys);
        if (this.activeEnemy) this.activeEnemy.update(dt, this, null);

        if (!this.birdTrap.triggered) {
          const firstEnemy = this.enemies[0];
          if (firstEnemy && !firstEnemy.alive) {
            this.triggerBirdTrap();
          }
        }
        if (this.birdTrap.bird) this.birdTrap.bird.update(dt, this);

        if (this.engagement.state === 'bowing') {
          const foe = this.engagement.enemy && this.engagement.enemy.alive ? this.engagement.enemy : null;
          if (!foe) {
            this.engagement = { state: 'idle', enemy: null, timer: 0 };
          } else if (!this.player.isBowAnimating() && this.player.hasClearedBowPose() && !foe.isBowAnimating() && foe.hasClearedBowPose()) {
            this.engagement = { state: 'postBow', enemy: foe, timer: 480 };
          }
        } else if (this.engagement.state === 'postBow') {
          const foe = this.engagement.enemy && this.engagement.enemy.alive ? this.engagement.enemy : null;
          if (!foe) {
            this.engagement = { state: 'idle', enemy: null, timer: 0 };
          } else {
            this.engagement.timer = Math.max(0, this.engagement.timer - dt);
            if (this.engagement.timer <= 0) {
              this.engagement = { state: 'fight', enemy: foe, timer: 0 };
            }
          }
        } else if (this.engagement.state === 'fight') {
          if (!this.engagement.enemy || !this.engagement.enemy.alive) {
            this.engagement = { state: 'idle', enemy: null, timer: 0 };
          }
        }

        const marginLeft = 300;
        const targetCam = clamp(this.player.x - marginLeft, 0, Math.max(0, WORLD_W - VIEW_W));
        this.cameraX = lerp(this.cameraX, targetCam, 0.08);

        if (!this.player.alive) {
          this.state = 'lose';
          if (!this.loseReason) this.loseReason = 'combat';
        }
        const allDown = this.enemies.every(e => !e.alive);
        if (allDown && this.player.x > WORLD_W - 200) this.state = 'win';

        pbar.style.width = `${Math.round((this.player.hp / this.player.maxHp) * 100)}%`;
        const foe = this.activeEnemy && this.activeEnemy.alive ? this.activeEnemy : this.enemies.find(e => e.alive) || null;
        ebar.style.width = foe ? `${Math.round((foe.hp / foe.maxHp) * 100)}%` : '0%';

        if (this.tempMessage) {
          this.tempMessage.timer = Math.max(0, this.tempMessage.timer - dt);
          if (this.tempMessage.timer <= 0) this.tempMessage = null;
        }

        if (this.state === 'playing') {
          let msg = '';
          let opacity = 0;
          const birdActive = this.birdTrap.bird && !this.birdTrap.bird.dissolve;
          if (this.tempMessage) {
            msg = this.tempMessage.text;
            opacity = this.tempMessage.opacity;
          } else if (birdActive) {
            msg = '鳩を攻撃!';
            opacity = 0.9;
          } else if (this.engagement.state === 'bowing') {
            msg = '礼';
            opacity = 0.85;
          } else if (this.engagement.state === 'postBow') {
            msg = '構え!';
            opacity = 0.8;
          } else if (!this.activeEnemy || !this.activeEnemy.alive) {
            msg = '進め →';
            opacity = 0.5;
          }

          if (this.debugHyakuretsu) {
            msg = msg ? `${msg}  [DEBUG: 百裂拳]` : '[DEBUG: 百裂拳]';
            opacity = Math.max(opacity, 0.7);
          }

          centerMsg.textContent = msg;
          centerMsg.style.opacity = opacity;
        }

        if (!this.activeEnemy && this.player.x <= this.seaEdgeX + 4 && this.player.moveDir < 0 && this.cameraX < 10) {
          this.beginSeaFall();
        }
      }

      draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const skyGrad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
        skyGrad.addColorStop(0, '#0f1620');
        skyGrad.addColorStop(1, '#0b0e12');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);

        const cam = this.cameraX;
        drawHills(cam * 0.25, 0.15, '#142131');
        drawHills(cam * 0.5,  0.25, '#121b28');

        ctx.fillStyle = '#141a22';
        ctx.fillRect(0, GROUND_Y + 8, VIEW_W, VIEW_H - (GROUND_Y + 8));
        ctx.fillStyle = '#1a2533';
        ctx.fillRect(0, GROUND_Y, VIEW_W, 10);
        ctx.fillStyle = '#223044';
        for (let i = -100; i < VIEW_W + 100; i += 24) {
          const ix = ((i + (-(cam % 24))) | 0);
          ctx.fillRect(ix, GROUND_Y + 10, 18, 2);
        }

        this.drawSea(cam);

        if (this.activeEnemy) this.activeEnemy.draw(ctx, cam);
        if (this.birdTrap.bird) this.birdTrap.bird.draw(ctx, cam);
        this.player.draw(ctx, cam);

        if (this.splashTimer > 0) {
          this.drawSplash(cam);
          this.splashTimer -= 16;
        }

        if (this.state === 'lose' && this.loseReason === 'fall') {
          centerMsg.textContent = '落水… Rで再挑戦';
          centerMsg.style.opacity = 1;
        } else if (this.state === 'win') {
          centerMsg.textContent = '勝利!  Rで再開';
          centerMsg.style.opacity = 1;
        } else if (this.state === 'lose' && this.loseReason !== 'fall') {
          centerMsg.textContent = '敗北…  Rで再挑戦';
          centerMsg.style.opacity = 1;
        }

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

      drawSea(cam) {
        const shoreX = this.seaEdgeX - cam;
        const seaStart = shoreX - this.seaWidth;
        if (shoreX > VIEW_W) return;

        const surface = this.seaSurfaceY;
        const seaGrad = ctx.createLinearGradient(0, surface, 0, VIEW_H);
        seaGrad.addColorStop(0, '#0c1f32');
        seaGrad.addColorStop(0.4, '#0a1a29');
        seaGrad.addColorStop(1, '#050b12');

        ctx.fillStyle = seaGrad;
        ctx.fillRect(seaStart - 40, surface, this.seaWidth + 80, VIEW_H - surface);

        ctx.fillStyle = '#193f5c';
        ctx.fillRect(seaStart - 40, surface - 6, this.seaWidth + 80, 6);

        ctx.fillStyle = '#213448';
        ctx.fillRect(shoreX - 8, GROUND_Y - 60, 12, 70);
        ctx.fillStyle = '#141d28';
        ctx.fillRect(shoreX - 20, GROUND_Y - 12, 28, 12);

        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const waveY = surface + 18 + i * 24;
          ctx.beginPath();
          for (let x = seaStart - 40; x <= seaStart + this.seaWidth + 30; x += 24) {
            const phase = ((this.time || 0) * 0.002 + i * 0.8);
            const offset = Math.sin((x + phase * 60) * 0.03) * 6;
            ctx.lineTo(x, waveY + offset);
          }
          ctx.stroke();
        }
      }

      drawSplash(cam) {
        const shoreX = this.seaEdgeX - cam - this.seaWidth * 0.5;
        const splashBaseX = shoreX + this.seaWidth * 0.5;
        const splashY = this.seaSurfaceY + 8;
        const life = clamp(this.splashTimer / 420, 0, 1);
        const height = 22 * life;
        const spread = 90 * (1 - Math.pow(1 - life, 2));

        ctx.strokeStyle = `rgba(255,255,255,${0.45 * life})`;
        ctx.lineWidth = 3 * life;
        ctx.beginPath();
        ctx.moveTo(splashBaseX - spread * 0.5, splashY);
        ctx.quadraticCurveTo(splashBaseX, splashY - height, splashBaseX + spread * 0.5, splashY);
        ctx.stroke();

        ctx.fillStyle = `rgba(255,255,255,${0.22 * life})`;
        ctx.beginPath();
        ctx.ellipse(splashBaseX, splashY + 10, 26 + spread * 0.15, 6 + life * 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const game = new Game();

    // Main loop
    let last = performance.now();
    function loop(now) {
      const dt = Math.min(32, now - last);
      last = now;
      game.time += dt;
      game.update(dt);
      game.draw();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  })();
