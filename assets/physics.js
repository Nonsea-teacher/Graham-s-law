/*
 * การแข่งขันของโมเลกุลแก๊ส
 *
 * โมเลกุลถูกปล่อยที่ปลายซ้ายของลู่พร้อมกัน แต่ละตัวได้ความเร็วสุ่มจากการแจกแจง
 * แมกซ์เวลล์–โบลต์ซมันน์ที่อุณหภูมิเดียวกัน  ส่วนเบี่ยงเบนของความเร็วแต่ละแกน
 * คือ sqrt(kB·T/m)  โมเลกุลหนักจึงช้ากว่าโดยอัตโนมัติ ไม่ได้ถูกสั่งให้ช้า
 *
 * เวลาที่ใช้ = เวลาที่โมเลกุล "ครึ่งลู่" ถึงเส้นชัย
 * เลือกวัดแบบนี้เพราะเป็นการวัดจริงเหมือนกัน แต่ความคลาดเคลื่อนต่ำกว่าการจับ
 * เวลาโมเลกุลตัวแรกมาก จึงยังเห็นความสัมพันธ์ ×4 → ×2 ได้ด้วยตาเปล่า
 */

import { LANE } from './config.js';

const KB = 1;

function gaussian(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function makeRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Lane {
  constructor(gas, { seed = null, count = LANE.count } = {}) {
    this.gas = gas;
    this.n = count;
    this.rand = seed === null ? Math.random : makeRandom(seed);
    this.reset();
  }

  reset() {
    const n = this.n;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.arrived = new Uint8Array(n);
    this.time = 0;
    this.finishedCount = 0;
    this.goneCount = 0;
    this.halfTime = null;   // เวลาที่ครึ่งลู่ถึงเส้นชัย = ผลการวัด
    this.firstTime = null;

    const sigma = Math.sqrt((KB * LANE.T) / this.gas.M);
    for (let i = 0; i < n; i++) {
      this.x[i] = LANE.start;
      this.y[i] = LANE.height * (0.15 + 0.7 * this.rand());
      // ปล่อยไปทางขวา: ใช้ขนาดความเร็วตามการแจกแจง แล้วบังคับทิศ x ให้เป็นบวก
      this.vx[i] = Math.abs(gaussian(this.rand)) * sigma;
      this.vy[i] = gaussian(this.rand) * sigma * 0.35;
    }
  }

  /** now = เวลาของสนามแข่ง ถ้าไม่ส่งมาจะนับเวลาของตัวเอง (ใช้ตอนทดสอบลู่เดี่ยว) */
  step(dt, now) {
    this.time = now === undefined ? this.time + dt : now;
    const h = LANE.height;
    for (let i = 0; i < this.n; i++) {
      // ผ่านเส้นชัยแล้ววิ่งออกนอกลู่ไปเลย ไม่ต้องหยุดกองกันอยู่ปลายลู่
      if (this.x[i] > LANE.length) continue;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      if (this.y[i] < 0.6) { this.y[i] = 1.2 - this.y[i]; this.vy[i] = Math.abs(this.vy[i]); }
      else if (this.y[i] > h - 0.6) { this.y[i] = 2 * (h - 0.6) - this.y[i]; this.vy[i] = -Math.abs(this.vy[i]); }

      if (!this.arrived[i] && this.x[i] >= LANE.finish) {
        this.arrived[i] = 1;
        this.finishedCount++;
        if (this.firstTime === null) this.firstTime = this.time;
        if (this.halfTime === null && this.finishedCount >= this.n / 2) this.halfTime = this.time;
      }
      if (this.x[i] > LANE.length) this.goneCount++;
    }
  }

  /** ตำแหน่งของ "แนวหน้า" = โมเลกุลลำดับกลางของลู่ */
  frontier() {
    const sorted = Array.from(this.x).sort((a, b) => b - a);
    return sorted[Math.floor(this.n / 2)];
  }

  progress() {
    return Math.min(1, (this.frontier() - LANE.start) / (LANE.finish - LANE.start));
  }

  done() {
    return this.halfTime !== null;
  }
}

export class Race {
  constructor(gases, opts = {}) {
    this.lanes = gases.map((g, i) => new Lane(g, { ...opts, seed: opts.seed == null ? null : opts.seed + i * 977 }));
    this.time = 0;
    this.carry = 0;
  }

  /*
   * สนามแข่งถือนาฬิกาเรือนเดียว ไม่ใช่ให้แต่ละลู่นับเวลาของตัวเอง
   * เพราะลู่ที่โมเลกุลออกหมดแล้วจะหยุดถูกคำนวณ เวลาของลู่นั้นจึงค้าง
   * ถ้าเอาไปโชว์เป็นนาฬิกากลาง เข็มจะหยุดทั้งที่การแข่งยังไม่จบ
   */
  reset() { this.lanes.forEach((l) => l.reset()); this.carry = 0; this.time = 0; }

  /*
   * เดินเวลาไปข้างหน้าตามจำนวนวินาทีที่ขอ
   * เวลาที่เหลือไม่ครบหนึ่งก้าวต้องเก็บสะสมไว้ ไม่ใช่ปัดทิ้ง
   * ถ้าปัดทิ้ง การแข่งจะช้ากว่าความเร็วที่ตั้งไว้จริงราว 20%
   */
  advance(seconds) {
    this.carry = (this.carry || 0) + seconds;
    const steps = Math.floor(this.carry / LANE.dt);
    this.carry -= steps * LANE.dt;
    if (steps <= 0) return;
    for (let s = 0; s < steps; s++) {
      this.time += LANE.dt;
      for (const lane of this.lanes) {
        if (lane.goneCount < lane.n) lane.step(LANE.dt, this.time);
      }
    }
  }

  done() { return this.lanes.every((l) => l.done()); }
}
