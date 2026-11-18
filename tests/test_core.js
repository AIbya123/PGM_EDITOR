'use strict';
/* 核心算法测试：node tests/test_core.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../src/core.js');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failed++;
    console.error('  FAIL ' + name + '\n       ' + (e && e.message));
  }
}

console.log('MapCore v' + C.VERSION + ' 单元测试');

for (const r of C.selfTest()) {
  if (r.ok) { passed++; console.log('  ok   ' + r.name); }
  else { failed++; console.error('  FAIL ' + r.name + '\n       ' + r.error); }
}

check('P2 ASCII 解析（含注释）', () => {
  const text = 'P2\n# c\n3 2\n15\n0 15 7\n 14 8 1\n';
  const p = C.parsePGM(new TextEncoder().encode(text));
  assert.strictEqual(p.width, 3);
  assert.strictEqual(p.height, 2);
  assert.strictEqual(p.data[1], 255);
  assert.strictEqual(p.data[2], Math.round(7 * 255 / 15));
  assert.strictEqual(p.data[5], Math.round(1 * 255 / 15));
});

check('16 位 PGM 解析', () => {
  const head = new TextEncoder().encode('P5\n2 1\n65535\n');
  const buf = new Uint8Array(head.length + 4);
  buf.set(head, 0);
  buf.set([0xff, 0xff, 0x80, 0x00], head.length);
  const p = C.parsePGM(buf);
  assert.strictEqual(p.data[0], 255);
  assert.strictEqual(p.data[1], 128);
});

check('拒绝非 PGM', () => {
  assert.throws(() => C.parsePGM(new TextEncoder().encode('P6\n1 1\n255\nxxxx')), /PGM/);
});

check('YAML block origin', () => {
  const m = C.parseYAML('resolution: 0.05\norigin:\n  - -3.5\n  - 4.25\n  - 0.0\nmode: trinary\n');
  assert.deepStrictEqual(m.origin, [-3.5, 4.25, 0]);
});

check('buildYAML 可被 parseYAML 读回', () => {
  const meta = { resolution: 0.0500000001, origin: [-17.2477951, -30.0675106, 0], negate: 0, occupied_thresh: 0.65, free_thresh: 0.25, mode: 'trinary' };
  const txt = C.buildYAML(meta, 'x.pgm');
  const back = C.parseYAML(txt);
  assert.ok(Math.abs(back.resolution - meta.resolution) < 1e-9);
  assert.strictEqual(back.free_thresh, 0.25);
  assert.ok(Math.abs(back.origin[0] - meta.origin[0]) < 1e-7);
  assert.strictEqual(back.image, 'x.pgm');
});

check('形态学 close 填补小孔', () => {
  const w = 21, h = 21;
  const d = new Uint8Array(w * h).fill(C.FREE);
  for (let y = 5; y <= 15; y++) {
    for (let x = 5; x <= 15; x++) d[y * w + x] = C.OCCUPIED;
  }
  d[10 * w + 10] = C.FREE; // 单像素孔
  C.morphology(d, w, h, 'close', 2);
  assert.strictEqual(d[10 * w + 10], C.OCCUPIED);
});

check('大图填充性能 (4M px)', () => {
  const w = 2048, h = 2048;
  const d = new Uint8Array(w * h).fill(C.FREE);
  const seen = new Uint8Array(w * h);
  const t0 = Date.now();
  const r = C.bucketFill(d, w, h, 1000 * w + 1000, C.UNKNOWN, 0, seen);
  const ms = Date.now() - t0;
  assert.strictEqual(r.count, w * h);
  console.log('       flood 4.19M px: ' + ms + ' ms');
  assert.ok(ms < 2000, 'too slow: ' + ms);
});

// ---- 使用真实地图（存在则测） ----
const realMaps = [
  '/home/aibya/桌面/map.pgm',
  '/home/aibya/JC05/maps/indoor_f8/2Dmap/map.pgm',
  '/home/aibya/JC05/maps/outdoor/2Dmap/map.pgm'
].filter(p => fs.existsSync(p));

for (const file of realMaps) {
  check('真实地图解析与字节级往返: ' + path.basename(file), () => {
    const buf = fs.readFileSync(file);
    const t0 = Date.now();
    const p = C.parsePGM(buf);
    const parseMs = Date.now() - t0;
    assert.ok(p.width > 10 && p.height > 10);
    const out = Buffer.from(C.encodePGM(p.width, p.height, p.data));
    assert.ok(out.equals(buf), 'encodePGM 输出应与 map_saver 生成的原始文件完全一致');
    console.log('       ' + p.width + '×' + p.height + '，解析 ' + parseMs + ' ms；文件头一致');
  });

  const yamlPath = path.join(path.dirname(file), 'map.yaml');
  if (fs.existsSync(yamlPath)) {
    check('真实 YAML 解析: ' + path.dirname(file), () => {
      const m = C.parseYAML(fs.readFileSync(yamlPath, 'utf8'));
      assert.ok(m.resolution > 0);
      assert.ok(Array.isArray(m.origin));
      assert.strictEqual(m.negate, 0);
    });
  }
}

check('大图形态学性能 (11.8M px)', () => {
  const w = 4880, h = 2410;
  const d = new Uint8Array(w * h).fill(C.FREE);
  for (let i = 0; i < 50000; i++) d[(i * 7919) % d.length] = C.OCCUPIED;
  const t0 = Date.now();
  C.morphology(d, w, h, 'dilate', 3);
  const ms = Date.now() - t0;
  console.log('       dilate 11.8M px: ' + ms + ' ms');
  assert.ok(ms < 5000);
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
