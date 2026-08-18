import { LANE, GAS, DUEL, DUEL_PAIRS, TRIO, TRIO_SETS, SLOW_FACTOR } from './config.js';
import { Race } from './physics.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* สีอ่านจาก CSS แล้วแปลงเป็น rgb ผ่านการระบายจริง
   เพราะค่าที่ประกาศไว้อาจอยู่ในรูปแบบที่ผืนผ้าใบไม่รู้จัก */
const probe = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  return c.getContext('2d', { willReadFrequently: true });
})();
const cache = new Map();
function rgb(value) {
  if (cache.has(value)) return cache.get(value);
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  const out = `rgb(${d[0]},${d[1]},${d[2]})`;
  cache.set(value, out);
  return out;
}
const cssVar = (n) => rgb(getComputedStyle(document.body).getPropertyValue(n).trim());

const COLORS = {};
for (const k of ['blue', 'amber', 'red', 'ink', 'line']) COLORS[k] = cssVar(`--${k}`);

/* ════════════ ลู่แข่งบนจอ ════════════ */

class TrackView {
  constructor(el, color, label) {
    this.canvas = $('canvas', el);
    this.ctx = this.canvas.getContext('2d');
    this.color = color;
    this.label = label;
    this.sprite = null;
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.dpr = dpr;
    this.sprite = null;
  }

  makeSprite() {
    const r = Math.max(1.8, this.canvas.height / 34);
    const size = Math.ceil(r * 2 + 2);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const cx = size / 2;
    const grad = g.createRadialGradient(cx - r * 0.3, cx - r * 0.35, r * 0.1, cx, cx, r);
    grad.addColorStop(0, mix(this.color, '#ffffff', 0.4));
    grad.addColorStop(1, this.color);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cx, r, 0, Math.PI * 2);
    g.fill();
    this.sprite = { canvas: c, half: size / 2 };
  }

  draw(lane) {
    const { ctx, canvas } = this;
    if (!canvas.width) return;
    if (!this.sprite) this.makeSprite();
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const sx = W / LANE.length;
    const sy = H / LANE.height;
    // ป้ายนักวิ่งหยุดที่เส้นชัย ไม่วิ่งเลยออกไปพร้อมกับฝูงที่ผ่านเส้นไปแล้ว
    const front = Math.min(lane.frontier(), LANE.finish);
    const fx = front * sx;

    // แถบจางลากตามหลังกลุ่มก้อน บอกทางที่ผ่านมาแล้ว
    const tail = W * 0.3;
    const grad = ctx.createLinearGradient(Math.max(0, fx - tail), 0, fx, 0);
    grad.addColorStop(0, withAlpha(this.color, 0));
    grad.addColorStop(1, withAlpha(this.color, 0.14));
    ctx.fillStyle = grad;
    ctx.fillRect(Math.max(0, fx - tail), 0, Math.min(fx, tail), H);

    this.drawFinish(W, H, sx);

    /* โมเลกุลที่แหกฝูงนำไปไกลวาดให้จาง เพื่อไม่ให้ตาไปจับผิดตัว
       ว่ามันคือ "ผู้เข้าเส้นชัย" ทั้งที่ตัวที่นับคือกลุ่มก้อน */
    // เข้ม = อยู่ในกลุ่มก้อน · จาง = พวกที่แหกฝูงนำอยู่ระหว่างทาง
    // ตัวที่ผ่านเส้นชัยออกนอกลู่ไปแล้วไม่ต้องวาด ปล่อยให้วิ่งหายไปเลย
    const s = this.sprite;
    ctx.globalAlpha = 1;
    for (let i = 0; i < lane.n; i++) {
      if (lane.x[i] > front || lane.x[i] > LANE.length) continue;
      ctx.drawImage(s.canvas, lane.x[i] * sx - s.half, lane.y[i] * sy - s.half);
    }
    ctx.globalAlpha = 0.3;
    for (let i = 0; i < lane.n; i++) {
      if (lane.x[i] <= front || lane.x[i] > LANE.length) continue;
      ctx.drawImage(s.canvas, lane.x[i] * sx - s.half, lane.y[i] * sy - s.half);
    }
    ctx.globalAlpha = 1;

    this.drawRunner(fx, H);
  }

  /* ธงเส้นชัยวาดลงผืนผ้าใบ ไม่ใช่วาง element ทับ
     เพื่อให้ตำแหน่งอ้างอิง LANE.finish ที่เดียว และให้ป้ายนักวิ่งวาดทับธงได้
     ถ้าใช้ element ทับ ป้ายจะถูกธงบังตอนเข้าเส้นชัยพอดี */
  drawFinish(W, H, sx) {
    const ctx = this.ctx;
    const cell = Math.max(4, H / 7);
    const x = LANE.finish * sx - cell;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, cell * 2, H);
    ctx.clip();
    for (let row = 0; row * cell < H; row++) {
      for (let col = 0; col < 2; col++) {
        ctx.fillStyle = (row + col) % 2 ? '#ffffff' : COLORS.ink;
        ctx.fillRect(x + col * cell, row * cell, cell, cell);
      }
    }
    ctx.restore();
  }

  /* ป้ายนักวิ่ง — ตัวแทนของกลุ่มก้อนแก๊ส และเป็นตัวที่ "ข้ามเส้นชัย" จริง ๆ
     ตำแหน่งของป้ายคือค่าที่ระบบใช้วัดเวลา สิ่งที่ตาเห็นจึงตรงกับสิ่งที่นับ */
  drawRunner(fx, H) {
    const ctx = this.ctx;
    const h = Math.min(H * 0.52, 46 * this.dpr);
    const fontSize = h * 0.56;
    ctx.font = `700 ${fontSize}px Kanit, sans-serif`;
    const w = ctx.measureText(this.label).width + h * 0.9;
    const x = Math.min(Math.max(fx - w / 2, 2), this.canvas.width - w - 2);
    const y = (H - h) / 2;
    const r = h / 2;

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();

    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.lineWidth = this.dpr * 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.label, x + w / 2, y + h / 2 + fontSize * 0.06);
  }
}

function mix(a, b, t) {
  const A = rgb(a).match(/\d+/g).map(Number);
  const B = rgb(b).match(/\d+/g).map(Number);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}
function withAlpha(c, a) {
  const [r, g, b] = rgb(c).match(/\d+/g);
  return `rgba(${r},${g},${b},${a})`;
}

/* ════════════ ตัวคุมการแข่ง ════════════ */

class RaceScreen {
  // showResult ต้องไม่ตั้งเป็น property ชื่อเดียวกับเมท็อด showResult()
  // ไม่งั้น property จะบังเมท็อดจนเรียกใช้ไม่ได้
  constructor({ root, gases, colors, speed, showResult = true, countdownEl, onFinish, onTick }) {
    this.gases = gases;
    this.speed = speed;
    this.showTimes = showResult;
    this.countdownEl = countdownEl;
    this.onFinish = onFinish;
    this.onTick = onTick;
    this.tracks = $$('.track', root);
    this.views = this.tracks.map((el, i) => new TrackView(el, colors[i], gases[i].formula));
    this.race = new Race(gases);
    this.state = 'idle';
    this.reported = new Set();
    this.slow = false;
    this.runToken = 0;
  }

  setSlow(on) { this.slow = on; }

  /*
   * เปลี่ยนแก๊สกลางคัน — สร้างลู่ใหม่ทั้งหมดและอัปเดตชื่อบนป้ายนักวิ่ง
   * ต้องล้างช่องผลลัพธ์ด้วย ไม่งั้นเวลาของชุดก่อนหน้าจะค้างอยู่ข้างแก๊สชุดใหม่
   * นักเรียนจะจดข้อมูลผิดลงใบงานโดยไม่มีสัญญาณเตือนใด ๆ
   */
  setGases(gases) {
    this.gases = gases;
    this.race = new Race(gases);
    this.views.forEach((v, i) => { v.label = gases[i].formula; });
    this.state = 'idle';
    this.reported.clear();
    this.clearResults();
    this.render();
  }

  clearResults() {
    this.tracks.forEach((t) => {
      const res = $('.result', t);
      if (!res) return;
      res.innerHTML = '';
      res.classList.remove('pop');
    });
  }

  hasResults() {
    return this.tracks.some((t) => {
      const res = $('.result', t);
      return res && res.textContent.trim() !== '';
    });
  }

  resize() { this.views.forEach((v) => v.resize()); }

  reset() {
    this.race.reset();
    this.state = 'idle';
    this.reported.clear();
    this.clearResults();
    this.render();
  }

  /*
   * กดปุ่มเมื่อไรก็เริ่มการแข่งใหม่ทันที รวมถึงระหว่างที่กำลังแข่งหรือกำลังนับถอยหลัง
   * ใช้ runToken กันไม่ให้การนับถอยหลังรอบเก่าที่ยังค้างอยู่ใน await
   * กลับมาสั่ง state ทับรอบใหม่
   */
  async start() {
    const token = ++this.runToken;
    this.reset();
    this.state = 'counting';
    const el = this.countdownEl;
    const span = $('span', el);
    el.hidden = false;
    for (const word of ['3', '2', '1', 'ไป!']) {
      span.textContent = word;
      span.style.animation = 'none';
      void span.offsetWidth;
      span.style.animation = '';
      await wait(reduceMotion ? 180 : 620);
      if (token !== this.runToken) return; // มีการกดปุ่มรอบใหม่แล้ว ทิ้งรอบนี้
    }
    el.hidden = true;
    this.state = 'running';
  }

  frame(dt) {
    if (this.state === 'running') {
      this.race.advance(dt * this.speed * (this.slow ? SLOW_FACTOR : 1));
      this.onTick?.(this.race.time);

      this.race.lanes.forEach((lane, i) => {
        if (lane.done() && !this.reported.has(i)) {
          this.reported.add(i);
          this.showResult(i, lane);
        }
      });

      // จบเมื่อทุกลู่วัดผลได้แล้ว ไม่รอให้โมเลกุลตัวสุดท้ายเข้าเส้นชัย
      // เพราะหางของการแจกแจงมีโมเลกุลที่ช้ามากจนแทบไม่มีวันถึง
      if (this.race.done()) {
        this.state = 'done';
        this.onFinish?.(this.race.lanes.map((l) => l.halfTime));
      }
    }
    this.render();
  }

  showResult(i, lane) {
    if (!this.showTimes) return;
    const el = $('.result', this.tracks[i]);
    if (!el) return;
    el.innerHTML = `<span class="time">${lane.halfTime.toFixed(1)}</span><span class="unit">วินาที</span>`;
    el.classList.add('pop');
  }

  render() { this.views.forEach((v, i) => v.draw(this.race.lanes[i])); }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ════════════ หน้าจอ ════════════ */

let current = 1;
let classGuess = null;

function show(n) {
  current = Math.min(5, Math.max(1, n));
  $$('.screen').forEach((s) => {
    const on = s.id === `screen-${current}`;
    s.hidden = !on;
    s.classList.toggle('is-on', on);
    if (on && !reduceMotion) {
      s.classList.remove('is-entering');
      void s.offsetWidth;
      s.classList.add('is-entering');
    }
  });
  $$('#steps button').forEach((b) => {
    const on = Number(b.dataset.step) === current;
    b.setAttribute('aria-current', on ? 'step' : 'false');
    if (!on) b.removeAttribute('aria-current');
  });
  $('#prev').disabled = current === 1;
  $('#next').disabled = current === 5;
  if (current === 2) duel.resize();
  if (current === 3) trio.resize();
  if (current === 4) revealFormula();
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
}

/* ── หน้า 1: โพล ── */
$('#poll').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  classGuess = b.dataset.guess;
  $$('#poll button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
});

/* ── หน้า 2: ดวล ── */
/*
 * ด่านนี้ไม่มีป้ายชนะบนลู่และไม่มีตัวเลข
 * คำถามอยู่ที่หัวเรื่อง ส่วนคำเฉลยขึ้นเป็นกล่องด้านล่างหลังแข่งจบ
 */
const duel = new RaceScreen({
  root: $('#duel'),
  gases: [DUEL.light, DUEL.heavy],
  colors: [COLORS.blue, COLORS.red],
  speed: DUEL.speed,
  showResult: false,
  countdownEl: $('#count-2'),
  onFinish: () => {
    const el = $('#verdict-2');
    const right = classGuess === 'light';
    /* บอกแค่ว่าใครถึงก่อน ซึ่งเป็นสิ่งที่เพิ่งเห็นกับตา
       ไม่สรุปให้ว่า "หนักกว่าแพร่ช้ากว่า" เพราะการแข่งคู่เดียวยังสรุปแบบนั้นไม่ได้
       และข้อสรุปนั้นเป็นงานของนักเรียนหลังเห็นหลายคู่ในหน้าถัดไป */
    el.innerHTML =
      `<b class="win">${pair.light.formula}</b> ถึงเส้นชัยก่อน ${pair.heavy.formula}` +
      (classGuess
        ? `<span class="reveal-sub">${right ? 'นักเรียนทายถูก' : 'นักเรียนทายผิด ลองดูอีกรอบว่าเพราะอะไร'}</span>`
        : '');
    el.hidden = false;
  },
});

$('#go-2').addEventListener('click', () => {
  $('#verdict-2').hidden = true;
  duel.start();
});

/* ── เลือกคู่แข่ง — เปลี่ยนแล้วอัปเดตทั้งการ์ดหน้าแรกและลู่แข่ง ── */
let pair = DUEL_PAIRS[0];

function renderPair() {
  const { light, heavy } = pair;
  $('#duel-cards').innerHTML = `
    <div class="gcard gcard-blue">
      <span class="gcard-tag">เบา</span>
      <span class="gcard-formula">${light.formula}</span>
      <span class="gcard-name">${light.name}</span>
      <span class="gcard-mass">มวลโมเลกุล = <b>${light.M}</b></span>
    </div>
    <span class="versus">VS</span>
    <div class="gcard gcard-red">
      <span class="gcard-tag">หนัก</span>
      <span class="gcard-formula">${heavy.formula}</span>
      <span class="gcard-name">${heavy.name}</span>
      <span class="gcard-mass">มวลโมเลกุล = <b>${heavy.M}</b></span>
    </div>`;

  [light, heavy].forEach((gas, i) => {
    const plate = $$('#duel .plate')[i];
    $('.plate-formula', plate).textContent = gas.formula;
    $('.plate-mass', plate).textContent = `มวล = ${gas.M}`;
  });

  duel.setGases([light, heavy]);
  $('#verdict-2').hidden = true;
}

DUEL_PAIRS.forEach((p, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(i === 0));
  // ไม่ติดป้ายว่าคู่ไหน "ต่างกันมาก" หรือ "สูสี" เพราะนั่นคือคำตอบ
  // ให้นักเรียนสังเกตเอาเองจากการแข่ง (ชื่อ label ใน config ใช้เฉพาะในสคริปต์ตรวจสอบ)
  b.innerHTML = `${p.light.formula} <span class="vs-mini">vs</span> ${p.heavy.formula}`;
  b.addEventListener('click', () => {
    pair = p;
    $$('#pair-pick button').forEach((o) => o.setAttribute('aria-checked', String(o === b)));
    renderPair();
  });
  $('#pair-pick').appendChild(b);
});
renderPair();

/* ปุ่มสโลว์โมชัน กดได้ทั้งก่อนและระหว่างการแข่ง มีผลทันที */
function bindSlow(btn, screen) {
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'ความเร็วปกติ' : 'สโลว์โมชัน';
    screen.setSlow(on);
  });
}
bindSlow($('#slow-2'), duel);

/* ── หน้า 3: สามลู่ ── */
const trio = new RaceScreen({
  root: $('#trio'),
  gases: TRIO.gases,
  colors: [COLORS.blue, COLORS.amber, COLORS.red],
  speed: TRIO.speed,
  showTime: true,
  countdownEl: $('#count-3'),
  onTick: (t) => { $('#clock-3').textContent = t.toFixed(1); },
});

/*
 * ปุ่มปล่อยตัวของด่าน 3 ต้องกดสองครั้งเมื่อมีเวลาที่วัดได้ค้างอยู่บนจอ
 * เพราะกดพลาดครั้งเดียวตอนนักเรียนกำลังจดลงใบงาน ข้อมูลจะหายและเรียกกลับไม่ได้
 * ถ้ายังไม่มีผลอะไรบนจอ กดครั้งเดียวเริ่มได้เลยตามปกติ
 */
const GO3_LABEL = 'ปล่อยพร้อมกัน';
const GO3_ARMED = 'กดอีกครั้งเพื่อวัดใหม่';
let go3Armed = false;
let go3Timer = null;

function disarmGo3() {
  clearTimeout(go3Timer);
  go3Armed = false;
  $('#go-3').textContent = GO3_LABEL;
  $('#go-3').classList.remove('is-armed');
}

$('#go-3').addEventListener('click', () => {
  if (!go3Armed && trio.hasResults()) {
    go3Armed = true;
    $('#go-3').textContent = GO3_ARMED;
    $('#go-3').classList.add('is-armed');
    clearTimeout(go3Timer);
    go3Timer = setTimeout(disarmGo3, 4000);
    return;
  }
  disarmGo3();
  $('#clock-3').textContent = '0.0';
  trio.start();
});
bindSlow($('#slow-3'), trio);

/* ── เลือกชุดการทดลอง 3 ชุด ชุดละ 3 แก๊ส ──
   ตัวเลขที่ได้ไม่ถูกเก็บไว้บนจอ นักเรียนจดลงใบงานเอง
   หน้าจอมีหน้าที่แสดงผลลัพธ์ให้เห็นชัดเท่านั้น */
let trioSet = TRIO_SETS[0];

function renderSet() {
  trioSet.gases.forEach((gas, i) => {
    const plate = $$('#trio .plate')[i];
    $('.plate-formula', plate).textContent = gas.formula;
    $('.plate-mass', plate).textContent = `มวล = ${gas.M}`;
  });
  trio.setGases(trioSet.gases);
  $('#clock-3').textContent = '0.0';
  disarmGo3();
}

TRIO_SETS.forEach((s, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(i === 0));
  b.textContent = s.label;
  b.addEventListener('click', () => {
    trioSet = s;
    $$('#set-pick button').forEach((o) => o.setAttribute('aria-checked', String(o === b)));
    renderSet();
  });
  $('#set-pick').appendChild(b);
});
renderSet();

/* ── หน้า 4: เผยทีละบรรทัด + เครื่องแทนค่า ── */
let revealed = false;
function revealFormula() {
  if (revealed) return;
  revealed = true;
  const items = $$('[data-i]', $('#screen-4')).sort((a, b) => a.dataset.i - b.dataset.i);
  items.forEach((el, k) => {
    setTimeout(() => el.classList.add('is-revealed'), reduceMotion ? 0 : k * 420);
  });
}

const CALC_GASES = [GAS.H2, GAS.He, GAS.CH4, GAS.O2, GAS.CO2, GAS.SO2];

/* เริ่มที่แก๊สชนิดเดียวกันทั้งสองฝั่ง เครื่องจึงยังไม่แสดงวิธีทำอะไรให้ดู
   นักเรียนต้องเปลี่ยนแก๊สเองถึงจะเห็นการคำนวณ — ไม่ใช่เปิดมาแล้วเจอตัวอย่างสำเร็จรูป */
const picked = { a: GAS.H2, b: GAS.H2 };

for (const side of ['a', 'b']) {
  const group = $(`#pick-${side}`);
  CALC_GASES.forEach((g) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = g.formula;
    b.setAttribute('aria-pressed', String(picked[side].key === g.key));
    b.addEventListener('click', () => {
      picked[side] = g;
      $$('button', group).forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      renderCalc();
    });
    group.appendChild(b);
  });
}

/*
 * แสดงการคำนวณโดยให้แก๊สที่เบากว่าเป็นตัวตั้งเสมอ
 * ถ้าปล่อยตามลำดับที่ผู้ใช้กด ผลอาจออกมาเป็น 0.71 ซึ่งนักเรียนที่พื้นฐานไม่แข็ง
 * จะงงว่าทำไม "อัตราส่วน" ถึงน้อยกว่า 1 การจัดให้ตัวเบาอยู่บนเสมอทำให้คำตอบ
 * มากกว่า 1 ทุกครั้ง และอ่านได้ตรง ๆ ว่า "เบาเร็วกว่าหนักกี่เท่า"
 */
/* วาดขั้นตอนการคำนวณด้วยโครงเดียวกับสมการในกล่องดำ (เศษส่วนซ้อนกันและรากที่มีขีดบน)
   ไม่ใช่เขียนเป็นบรรทัดเดียวแบบ r(H₂) / r(SO₂) = √( M(SO₂) / M(H₂) ) ซึ่งอ่านยาก
   และไม่เหมือนสมการที่นักเรียนเพิ่งดูไป */
const RSVG = `<svg class="rsign" viewBox="0 0 26 100" preserveAspectRatio="none" aria-hidden="true"><path d="M1 58 L8 58 L14 95 L25 3" vector-effect="non-scaling-stroke"/></svg>`;
const frac = (top, bottom) => `<span class="frac"><i>${top}</i><i>${bottom}</i></span>`;
const root = (inner) => `<span class="root">${RSVG}${inner}</span>`;
const rootOf = (value) => `<span class="sqrt-inline">${RSVG}<span>${value}</span></span>`;

function renderCalc() {
  const steps = $('#calc-steps');
  if (picked.a.M === picked.b.M) {
    steps.innerHTML = `<li class="calc-note">มวลเท่ากัน จึงแพร่เร็วเท่ากัน — ลองเปลี่ยนแก๊สฝั่งหนึ่งดู</li>`;
    return;
  }
  const light = picked.a.M < picked.b.M ? picked.a : picked.b;
  const heavy = picked.a.M < picked.b.M ? picked.b : picked.a;
  const div = heavy.M / light.M;
  const ratio = Math.sqrt(div);

  /* ไม่ใส่ป้ายกำกับว่าขั้นนี้คือ "แทนค่า" หรือ "ถอดราก"
     บรรทัดที่ขึ้นต้นด้วยเครื่องหมายเท่ากับบอกตัวเองอยู่แล้วว่ากำลังทำอะไร
     จัดเป็นตารางสามคอลัมน์เพื่อให้เครื่องหมายเท่ากับทุกบรรทัดตรงกันพอดี */
  const row = (lhs, rhs) => `<li><span class="lhs">${lhs}</span><span class="eq">=</span><span class="rhs">${rhs}</span></li>`;

  steps.innerHTML =
    row(
      frac(`r(${light.formula})`, `r(${heavy.formula})`),
      root(frac(`M(${heavy.formula})`, `M(${light.formula})`))
    ) +
    row('', root(frac(heavy.M, light.M))) +
    row('', rootOf(round2(div))) +
    row('', round2(ratio)) +
    `<li class="calc-answer">${light.formula} แพร่เร็วกว่า ${heavy.formula} <b>${round2(ratio)} เท่า</b></li>`;
}

const round2 = (n) => Number(n.toFixed(2)).toString();
renderCalc();

/* ── หน้า 5: แบบฝึกหัด ── */
/* ด่านนี้มีแต่โจทย์ ไม่มีปุ่มดูวิธีทำและไม่มีเฉลยบนจอ
   นักเรียนทำลงกระดาษ ครูเป็นคนเฉลย — เฉลยฉบับครูอยู่ใน README.md */
const QUIZ = [
  {
    q: 'He (มวล 4) กับ CH₄ (มวล 16) แก๊สไหนแพร่เร็วกว่า และเร็วกว่ากี่เท่า',
  },
  {
    q: 'แก๊ส X แพร่ช้ากว่า He (มวล 4) อยู่ 3 เท่า แก๊ส X มีมวลโมเลกุลเท่าไร',
  },
  {
    // ขึ้นบรรทัดใหม่ก่อน "และเพราะเหตุใด" ไม่งั้นวรรคนี้จะถูกตัดคำกลางประโยค
    q: 'ปล่อย NH₃ (มวล 17) และ HCl (มวล 36.5) จากปลายท่อคนละด้านพร้อมกัน ควันสีขาวจะเกิดใกล้ปลายด้านไหน<br>และเพราะเหตุใด',
    sub: 'ข้อนี้คือการทดลองจริงในห้องแล็บ · ตอบให้ครบทั้งตำแหน่งและเหตุผล',
    /* ภาพท่อแก้วให้ดู เพื่อไม่ให้นักเรียนต้องสร้างภาพในหัวเองก่อนจะเริ่มคิดเรื่องอัตราส่วน
       จงใจไม่วาดวงแหวนควันไว้ที่ไหนเลย และลูกศรสองข้างยาวเท่ากันเป๊ะ ไม่ใบ้คำตอบ
       เส้นประกึ่งกลางใส่ไว้เป็นหลักให้เทียบว่าจุดที่เจอกันเยื้องไปทางไหน */
    svg: `
      <svg viewBox="0 0 440 128" role="img" aria-label="ท่อแก้วแนวนอน ปลายซ้ายมีสำลีชุบแอมโมเนีย ปลายขวามีสำลีชุบไฮโดรเจนคลอไรด์ แก๊สทั้งสองแพร่เข้าหากัน มีเส้นประแสดงจุดกึ่งกลางท่อ">
        <rect x="42" y="40" width="356" height="46" rx="9" fill="#fff" stroke="var(--ink)" stroke-width="2.5"/>
        <rect x="42" y="40" width="28" height="46" rx="9" fill="var(--blue)"/>
        <rect x="370" y="40" width="28" height="46" rx="9" fill="var(--red)"/>
        <line x1="220" y1="31" x2="220" y2="95" stroke="var(--ink-2)" stroke-width="2" stroke-dasharray="5 5"/>
        <text x="220" y="114" text-anchor="middle" font-size="15" fill="var(--ink-2)">กึ่งกลางท่อ</text>
        <g stroke="var(--blue)" stroke-width="2.5" fill="none">
          <line x1="82" y1="63" x2="150" y2="63"/>
          <polyline points="143,57 150,63 143,69"/>
        </g>
        <g stroke="var(--red)" stroke-width="2.5" fill="none">
          <line x1="358" y1="63" x2="290" y2="63"/>
          <polyline points="297,57 290,63 297,69"/>
        </g>
        <text x="42" y="26" font-size="19" font-weight="700" fill="var(--blue)">NH₃</text>
        <text x="42" y="114" font-size="15" fill="var(--ink-2)">มวล 17</text>
        <text x="398" y="26" font-size="19" font-weight="700" fill="var(--red)" text-anchor="end">HCl</text>
        <text x="398" y="114" font-size="15" fill="var(--ink-2)" text-anchor="end">มวล 36.5</text>
      </svg>`,
  },
];

$('#quiz').innerHTML = QUIZ.map((item, i) => `
  <article class="q">
    <div class="q-head">
      <span class="q-num">${i + 1}</span>
      <p class="q-text">${item.q}</p>
    </div>
    ${item.sub ? `<p class="q-sub">${item.sub}</p>` : ''}
    ${item.svg ? `<div class="q-figure">${item.svg}</div>` : ''}
  </article>`).join('');

/* ── การเดินหน้า ── */
$('#next').addEventListener('click', () => show(current + 1));
$('#prev').addEventListener('click', () => show(current - 1));
$('#steps').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) show(Number(b.dataset.step));
});

let last = performance.now();
function loop(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;
  if (!document.hidden) {
    if (current === 2) duel.frame(dt);
    else if (current === 3) trio.frame(dt);
  }
  requestAnimationFrame(loop);
}
document.addEventListener('visibilitychange', () => { last = performance.now(); });

show(1);
requestAnimationFrame(loop);

window.__app = { show, duel, trio, get step() { return current; } };
