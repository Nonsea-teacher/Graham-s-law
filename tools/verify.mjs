/*
 * ตรวจสอบว่าตัวเลขที่นักเรียนจะเห็นบนจอเชื่อถือได้
 *   node tools/verify.mjs
 */
import { Lane } from '../assets/physics.js';
import { LANE, GAS, TRIO, TRIO_SETS, DUEL, DUEL_PAIRS } from '../assets/config.js';

let failures = 0;
const report = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`[${ok ? 'ผ่าน' : 'ไม่ผ่าน'}] ${name}\n        ${detail}`);
};
const pct = (a, b) => (Math.abs(a - b) / Math.abs(b)) * 100;

function runOnce(gas, seed) {
  const lane = new Lane(gas, { seed });
  let guard = 0;
  while (!lane.done() && guard++ < 200000) lane.step(LANE.dt);
  return lane.halfTime;
}

function stats(gas, trials) {
  const t = [];
  for (let i = 0; i < trials; i++) t.push(runOnce(gas, 10000 + i * 13 + gas.M));
  const mean = t.reduce((s, v) => s + v, 0) / t.length;
  const sd = Math.sqrt(t.reduce((s, v) => s + (v - mean) ** 2, 0) / (t.length - 1));
  return { mean, sd, cv: (sd / mean) * 100, min: Math.min(...t), max: Math.max(...t) };
}

const trials = Number(process.env.TRIALS || 40);

/* ---------- 1. ความแกว่งของการวัดต้องต่ำพอให้เห็นว่า "คูณสอง" ---------- */
console.log('\n  แก๊ส    มวล   เวลาเฉลี่ย   ความแกว่ง   ช่วงที่เจอจริง');
const rows = [];
for (const gas of TRIO.gases) {
  const s = stats(gas, trials);
  rows.push({ gas, ...s });
  console.log(
    `  ${gas.formula.padEnd(5)}  ${String(gas.M).padStart(3)}   ${s.mean.toFixed(1).padStart(7)} วิ` +
      `     ±${s.cv.toFixed(1)}%       ${s.min.toFixed(1)}–${s.max.toFixed(1)}`
  );
}
console.log('');

report(
  `ความแกว่งของเวลาที่วัดได้ต่ำกว่า 6% (${trials} รอบต่อแก๊ส)`,
  rows.every((r) => r.cv < 6),
  `สูงสุด ${Math.max(...rows.map((r) => r.cv)).toFixed(1)}%`
);

/* ---------- 2. คู่สำคัญของแต่ละชุดต้องให้อัตราส่วนเวลาเป็นเลขจำนวนเต็มอ่านง่าย ---------- */
{
  const cache = new Map();
  const meanOf = (gas) => {
    if (!cache.has(gas.key)) cache.set(gas.key, stats(gas, Math.min(trials, 10)).mean);
    return cache.get(gas.key);
  };
  const checks = [
    ['ชุด 1', TRIO_SETS[0].gases[0], TRIO_SETS[0].gases[1], 2],   // มวล ×4  → เวลา ×2
    ['ชุด 1', TRIO_SETS[0].gases[1], TRIO_SETS[0].gases[2], 2],   // มวล ×4  → เวลา ×2
    ['ชุด 2', TRIO_SETS[1].gases[0], TRIO_SETS[1].gases[1], 4],   // มวล ×16 → เวลา ×4
    ['ชุด 3', TRIO_SETS[2].gases[0], TRIO_SETS[2].gases[2], 3],   // มวล ×9  → เวลา ×3
  ];
  let worst = 0;
  const lines = checks.map(([label, a, b, want]) => {
    const got = meanOf(b) / meanOf(a);
    worst = Math.max(worst, pct(got, want));
    return `  ${label} ${a.formula} → ${b.formula} : มวล ×${(b.M / a.M).toFixed(1)} · เวลา ×${got.toFixed(2)} (ควรได้ ×${want})`;
  });
  report('อัตราส่วนเวลาของแต่ละชุดออกมาเป็น ×2 ×3 ×4 ตามที่ออกแบบไว้', worst < 6, `คลาดเคลื่อนสูงสุด ${worst.toFixed(1)}%\n` + lines.join('\n'));
}

/* ---------- 3. เวลาแปรผันตรงกับ √M ---------- */
let sxy = 0, sxx = 0, sy = 0;
for (const r of rows) { const x = Math.sqrt(r.gas.M); sxy += x * r.mean; sxx += x * x; sy += r.mean; }
const k = sxy / sxx;
const meanY = sy / rows.length;
let ssr = 0, sst = 0;
for (const r of rows) {
  ssr += (r.mean - k * Math.sqrt(r.gas.M)) ** 2;
  sst += (r.mean - meanY) ** 2;
}
report('เวลาแปรผันตรงกับ √M (เส้นตรงผ่านจุดกำเนิด)', 1 - ssr / sst > 0.999, `R² = ${(1 - ssr / sst).toFixed(5)}`);

/* ---------- 4. ทุกคู่แข่งของด่าน 2 ต้องให้ผลตรงทฤษฎี และแยกออกด้วยตาเปล่า ---------- */
{
  let worst = 0, tightest = Infinity;
  const lines = [];
  for (const p of DUEL_PAIRS) {
    const light = stats(p.light, 8);
    const heavy = stats(p.heavy, 8);
    const gap = heavy.mean / light.mean;
    const theory = Math.sqrt(p.heavy.M / p.light.M);
    worst = Math.max(worst, pct(gap, theory));
    tightest = Math.min(tightest, gap);
    lines.push(
      `  ${p.label.padEnd(10)} ${p.light.formula} vs ${p.heavy.formula} : ช้ากว่า ${gap.toFixed(2)} เท่า` +
        ` (ทฤษฎี ${theory.toFixed(2)}) · ${(light.mean / DUEL.speed).toFixed(1)} vs ${(heavy.mean / DUEL.speed).toFixed(1)} วินาทีจริง`
    );
  }
  report(
    'ทุกคู่แข่งให้อัตราส่วนตรงทฤษฎี และคู่ที่สูสีที่สุดยังห่างพอให้เห็น',
    worst < 8 && tightest > 1.25,
    `คลาดเคลื่อนสูงสุด ${worst.toFixed(1)}% · คู่สูสีที่สุดห่าง ${tightest.toFixed(2)} เท่า\n` + lines.join('\n')
  );
}

/* ---------- 5. เวลาที่ครูต้องรอหน้าห้องต้องไม่นานเกินไป ---------- */
{
  // เร็วเกินไปนักเรียนดูไม่ทัน ช้าเกินไปครูยืนรอเก้อ ช่วงที่ใช้ได้คือราว 8–25 วินาที
  const slowest = rows[rows.length - 1].mean / TRIO.speed;
  report(
    'เวลารอจริงหน้าห้องอยู่ในช่วง 8–25 วินาที',
    slowest >= 8 && slowest <= 25,
    `ลู่ที่ช้าที่สุดใช้เวลาจริง ${slowest.toFixed(1)} วินาที (เร่ง ${TRIO.speed} เท่า)`
  );
}

console.log(failures === 0 ? '\nทุกข้อผ่าน\n' : `\nไม่ผ่าน ${failures} ข้อ\n`);
process.exit(failures ? 1 : 0);
