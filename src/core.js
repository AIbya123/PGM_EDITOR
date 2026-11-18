/*!
 * Nav2 地图精修工具 — 核心算法层
 * 不依赖 DOM，可在浏览器和 Node 中运行。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MapCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var OCCUPIED = 0;
  var UNKNOWN = 205;
  var FREE = 254;
  var VERSION = '1.0.0';
  var MAX_DIM = 20000;
  var MAX_PIXELS = 120000000;

  /* ---------------------------------------------------------------- 工具 */

  function toU8(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    throw new Error('无法识别的二进制数据');
  }

  function isWS(c) {
    return c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12;
  }

  function latin1(u8, start, end) {
    var s = '';
    for (var i = start; i < end; i++) s += String.fromCharCode(u8[i]);
    return s;
  }

  function num(v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  function fmtNum(v) {
    if (!isFinite(v)) v = 0;
    var s = Number(v.toFixed(9)).toString();
    return s === '-0' ? '0' : s;
  }

  function bandOf(v) {
    // 编辑器内部使用的像素分档：0 障碍 / 1 空闲 / 2 未知
    if (v < 128) return 0;
    if (v > 230) return 1;
    return 2;
  }

  /* ----------------------------------------------------------------- PGM */

  function parsePGM(input) {
    var u8 = toU8(input);
    var len = u8.length;
    var pos = 0;

    function skip() {
      while (pos < len) {
        var c = u8[pos];
        if (c === 35) { // '#'
          while (pos < len && u8[pos] !== 10 && u8[pos] !== 13) pos++;
        } else if (isWS(c)) {
          pos++;
        } else {
          break;
        }
      }
    }

    function token() {
      skip();
      var start = pos;
      while (pos < len) {
        var c = u8[pos];
        if (isWS(c) || c === 35) break;
        pos++;
      }
      return latin1(u8, start, pos);
    }

    var magic = token();
    if (magic !== 'P5' && magic !== 'P2') {
      throw new Error('不是有效的 PGM 文件（文件头为 "' + (magic || '空') + '"）');
    }

    var width = parseInt(token(), 10);
    var height = parseInt(token(), 10);
    var maxval = parseInt(token(), 10);

    if (!isFinite(width) || !isFinite(height) || !isFinite(maxval)) {
      throw new Error('PGM 文件头缺少宽、高或灰度上限');
    }
    if (width <= 0 || height <= 0) throw new Error('PGM 尺寸无效：' + width + ' × ' + height);
    if (width > MAX_DIM || height > MAX_DIM || width * height > MAX_PIXELS) {
      throw new Error('地图尺寸过大（' + width + ' × ' + height + '），超出编辑器处理能力');
    }
    if (maxval <= 0 || maxval > 65535) throw new Error('PGM 灰度上限无效：' + maxval);

    var count = width * height;
    var data;

    if (magic === 'P5') {
      // 文件头之后恰好一个空白字符；兼容 CRLF
      if (pos < len && isWS(u8[pos])) {
        if (u8[pos] === 13 && pos + 1 < len && u8[pos + 1] === 10) pos += 2;
        else pos += 1;
      }
      var bpp = maxval > 255 ? 2 : 1;
      var need = count * bpp;
      if (len - pos < need) {
        throw new Error('PGM 数据不完整：需要 ' + need + ' 字节，实际只有 ' + (len - pos) + ' 字节');
      }
      if (bpp === 1) {
        data = u8.slice(pos, pos + count);
        if (maxval !== 255) {
          for (var i = 0; i < count; i++) {
            data[i] = Math.max(0, Math.min(255, Math.round(data[i] * 255 / maxval)));
          }
        }
      } else {
        data = new Uint8Array(count);
        for (var j = 0; j < count; j++) {
          var v = (u8[pos + j * 2] << 8) | u8[pos + j * 2 + 1];
          data[j] = Math.max(0, Math.min(255, Math.round(v * 255 / maxval)));
        }
      }
    } else {
      // P2（ASCII）
      data = new Uint8Array(count);
      for (var k = 0; k < count; k++) {
        var t = token();
        if (t === '') throw new Error('PGM 数据不完整：只读到 ' + k + ' 个像素，需要 ' + count + ' 个');
        var pv = parseInt(t, 10);
        if (!isFinite(pv)) throw new Error('PGM 数据中存在非数字像素值：' + t);
        data[k] = maxval === 255 ? pv : Math.max(0, Math.min(255, Math.round(pv * 255 / maxval)));
      }
    }

    return { width: width, height: height, maxval: maxval, format: magic, data: data };
  }

  function encodePGM(width, height, data) {
    var header = new TextEncoder().encode('P5\n' + width + ' ' + height + '\n255\n');
    var out = new Uint8Array(header.length + width * height);
    out.set(header, 0);
    out.set(data.subarray(0, width * height), header.length);
    return out;
  }

  /* ---------------------------------------------------------------- YAML */

  function stripComment(line) {
    var inS = false, inD = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === "'" && !inD) inS = !inS;
      else if (c === '"' && !inS) inD = !inD;
      else if (c === '#' && !inS && !inD) return line.slice(0, i);
    }
    return line;
  }

  function parseScalar(raw) {
    var s = String(raw).trim();
    if (!s) return '';
    if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) {
      return s.slice(1, -1);
    }
    return s;
  }

  function parseList(raw) {
    var s = String(raw).trim();
    var a = s.indexOf('['), b = s.lastIndexOf(']');
    if (a >= 0 && b > a) s = s.slice(a + 1, b);
    return s.split(',').map(function (x) { return parseScalar(x); }).filter(function (x) { return x !== ''; });
  }

  function parseYAML(text) {
    var meta = {
      image: null,
      mode: 'trinary',
      resolution: 0.05,
      origin: [0, 0, 0],
      negate: 0,
      occupied_thresh: 0.65,
      free_thresh: 0.196
    };
    if (!text || typeof text !== 'string') return meta;

    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var raw = stripComment(lines[i]);
      if (!raw.trim()) continue;
      var m = raw.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      var key = m[1];
      var val = m[2].trim();

      if (key === 'origin') {
        if (val === '') {
          var arr = [];
          var j = i + 1;
          while (j < lines.length) {
            var t = stripComment(lines[j]).trim();
            if (!t) { j++; continue; }
            var mm = t.match(/^-\s*(.+)$/);
            if (!mm) break;
            arr.push(parseScalar(mm[1]));
            j++;
          }
          if (arr.length >= 3) {
            meta.origin = [num(arr[0], 0), num(arr[1], 0), num(arr[2], 0)];
          }
          i = j - 1;
        } else {
          var list = parseList(val);
          if (list.length >= 3) {
            meta.origin = [num(list[0], 0), num(list[1], 0), num(list[2], 0)];
          }
        }
      } else if (key === 'resolution') {
        var res = num(parseScalar(val), NaN);
        if (res > 0) meta.resolution = res;
      } else if (key === 'negate') {
        meta.negate = num(parseScalar(val), 0) ? 1 : 0;
      } else if (key === 'occupied_thresh') {
        var ot = num(parseScalar(val), NaN);
        if (ot > 0 && ot < 1) meta.occupied_thresh = ot;
      } else if (key === 'free_thresh') {
        var ft = num(parseScalar(val), NaN);
        if (ft >= 0 && ft < 1) meta.free_thresh = ft;
      } else if (key === 'mode') {
        meta.mode = parseScalar(val) || 'trinary';
      } else if (key === 'image') {
        meta.image = parseScalar(val);
      }
    }
    return meta;
  }

  function buildYAML(meta, imageName) {
    var o = (meta && meta.origin) || [0, 0, 0];
    return [
      'image: ' + (imageName || 'map.pgm'),
      'mode: ' + (meta.mode || 'trinary'),
      'resolution: ' + fmtNum(num(meta.resolution, 0.05)),
      'origin: [' + fmtNum(num(o[0], 0)) + ', ' + fmtNum(num(o[1], 0)) + ', ' + fmtNum(num(o[2], 0)) + ']',
      'negate: ' + (meta.negate ? 1 : 0),
      'occupied_thresh: ' + fmtNum(num(meta.occupied_thresh, 0.65)),
      'free_thresh: ' + fmtNum(num(meta.free_thresh, 0.196)),
      ''
    ].join('\n');
  }

  /* ------------------------------------------------------------ 泛洪填充 */

  /**
   * 扫描线泛洪。match(idx) 判断是否属于目标区域；visit(idx) 在处理每个像素时调用。
   * seen 必须是 length >= width*height 的 Uint8Array，由调用方复用/清零。
   */
  function floodFill(data, width, height, start, match, visit, seen) {
    if (!seen) seen = new Uint8Array(width * height);
    var stack = [start];
    var count = 0;
    var w = width, h = height;

    while (stack.length) {
      var idx = stack.pop();
      if (seen[idx] || !match(idx)) continue;

      var y = (idx / w) | 0;
      var x = idx - y * w;
      var left = x;
      var right = x;

      while (left > 0) {
        var jl = y * w + left - 1;
        if (seen[jl] || !match(jl)) break;
        left--;
      }
      while (right < w - 1) {
        var jr = y * w + right + 1;
        if (seen[jr] || !match(jr)) break;
        right++;
      }

      for (var xx = left; xx <= right; xx++) {
        var j = y * w + xx;
        if (seen[j]) continue;
        seen[j] = 1;
        visit(j);
        count++;
      }

      for (var dy = -1; dy <= 1; dy += 2) {
        var ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        var run = false;
        for (var nx = left; nx <= right; nx++) {
          var nj = ny * w + nx;
          if (!seen[nj] && match(nj)) {
            if (!run) { stack.push(nj); run = true; }
          } else {
            run = false;
          }
        }
      }
    }
    return count;
  }

  function bucketFill(data, width, height, start, newValue, tolerance, seen) {
    var target = data[start];
    var tol = Math.max(0, tolerance | 0);
    var match = tol === 0
      ? function (i) { return data[i] === target; }
      : function (i) { return Math.abs(data[i] - target) <= tol; };

    var x0 = width, y0 = height, x1 = -1, y1 = -1;
    var count = floodFill(data, width, height, start, match, function (i) {
      data[i] = newValue;
      var y = (i / width) | 0;
      var x = i - y * width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }, seen);

    return {
      count: count,
      bbox: count ? [x0, y0, x1, y1] : null
    };
  }

  /**
   * 删除面积小于 minSize 的障碍连通块。
   * occupied: 判定为障碍的像素值上限（默认 < 128）。
   */
  function removeSmallObstacles(data, width, height, minSize, fillValue, seen) {
    if (!seen) seen = new Uint8Array(width * height);
    var limit = Math.min(200000, Math.max(2, minSize | 0));
    var match = function (i) { return data[i] < 128; };
    var components = 0;
    var changed = 0;

    for (var i = 0; i < data.length; i++) {
      if (seen[i] || !match(i)) continue;
      var count = 0;
      var collect = [];
      var local = i;
      floodFill(data, width, height, local, match, function (j) {
        count++;
        if (count <= limit) collect.push(j);
      }, seen);

      if (count > 0 && count < limit) {
        for (var k = 0; k < collect.length; k++) {
          if (data[collect[k]] !== fillValue) {
            data[collect[k]] = fillValue;
            changed++;
          }
        }
        components++;
      }
    }
    return { components: components, changed: changed };
  }

  /* -------------------------------------------------------------- 形态学 */

  function binaryFromData(data) {
    var b = new Uint8Array(data.length);
    for (var i = 0; i < data.length; i++) b[i] = data[i] < 128 ? 1 : 0;
    return b;
  }

  function slidingPass(src, w, h, r, dilate) {
    var n = w * h;
    var tmp = new Uint8Array(n);
    var out = new Uint8Array(n);
    var pref = new Int32Array(Math.max(w, h) + 1);
    var x, y, a, b, cnt, win;

    for (y = 0; y < h; y++) {
      var row = y * w;
      pref[0] = 0;
      for (x = 0; x < w; x++) pref[x + 1] = pref[x] + src[row + x];
      for (x = 0; x < w; x++) {
        a = x - r > 0 ? x - r : 0;
        b = x + r < w - 1 ? x + r : w - 1;
        cnt = pref[b + 1] - pref[a];
        win = b - a + 1;
        tmp[row + x] = dilate ? (cnt > 0 ? 1 : 0) : (cnt === win ? 1 : 0);
      }
    }

    for (x = 0; x < w; x++) {
      pref[0] = 0;
      for (y = 0; y < h; y++) pref[y + 1] = pref[y] + tmp[y * w + x];
      for (y = 0; y < h; y++) {
        a = y - r > 0 ? y - r : 0;
        b = y + r < h - 1 ? y + r : h - 1;
        cnt = pref[b + 1] - pref[a];
        win = b - a + 1;
        out[y * w + x] = dilate ? (cnt > 0 ? 1 : 0) : (cnt === win ? 1 : 0);
      }
    }
    return out;
  }

  /**
   * 对障碍层做形态学处理。op: 'dilate' | 'erode' | 'close'
   * 结构元为 (2r+1) 方形窗口（可分离实现，速度与半径无关）。
   */
  function morphology(data, w, h, op, radius) {
    var r = Math.max(1, Math.min(40, radius | 0));
    var src = binaryFromData(data);
    var res;
    if (op === 'dilate') res = slidingPass(src, w, h, r, true);
    else if (op === 'erode') res = slidingPass(src, w, h, r, false);
    else if (op === 'close') res = slidingPass(slidingPass(src, w, h, r, true), w, h, r, false);
    else throw new Error('未知的形态学操作：' + op);

    var changed = 0;
    for (var i = 0; i < data.length; i++) {
      if (src[i] !== res[i]) {
        data[i] = res[i] ? OCCUPIED : FREE;
        changed++;
      }
    }
    return { changed: changed };
  }

  /* ------------------------------------------------------------ 自检用例 */

  function selfTest() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: String((e && e.message) || e) }); }
    }
    function eq(a, b) {
      if (a !== b) throw new Error('期望 ' + b + '，实际 ' + a);
    }
    function ok(v, msg) { if (!v) throw new Error(msg || '断言失败'); }

    t('PGM 编码/解析往返', function () {
      var w = 5, h = 3;
      var d = new Uint8Array(w * h);
      for (var i = 0; i < d.length; i++) d[i] = (i * 17) & 255;
      var parsed = parsePGM(encodePGM(w, h, d));
      eq(parsed.width, w); eq(parsed.height, h); eq(parsed.maxval, 255);
      for (var k = 0; k < d.length; k++) eq(parsed.data[k], d[k]);
    });

    t('PGM 注释与 CRLF', function () {
      var txt = 'P5\r\n# hello\r\n2 2\r\n255\r\n';
      var head = new TextEncoder().encode(txt);
      var out = new Uint8Array(head.length + 4);
      out.set(head, 0); out.set([0, 205, 254, 33], head.length);
      var p = parsePGM(out);
      eq(p.data[0], 0); eq(p.data[1], 205); eq(p.data[2], 254); eq(p.data[3], 33);
    });

    t('YAML 解析与生成', function () {
      var m = parseYAML('image: a.pgm\nresolution: 0.1\norigin: [-1.5, 2, 0]\nfree_thresh: 0.25\nnegate: 0\n');
      eq(m.resolution, 0.1); eq(m.origin[0], -1.5); eq(m.free_thresh, 0.25);
      var txt = buildYAML(m, 'a.pgm');
      ok(txt.indexOf('image: a.pgm') === 0, 'yaml image 字段');
    });

    t('油漆桶填充封闭区域', function () {
      var w = 5, h = 5;
      var d = new Uint8Array(w * h).fill(FREE);
      for (var i = 0; i < w; i++) { d[i] = OCCUPIED; d[(h - 1) * w + i] = OCCUPIED; }
      for (var j = 0; j < h; j++) { d[j * w] = OCCUPIED; d[j * w + w - 1] = OCCUPIED; }
      var seen = new Uint8Array(w * h);
      var r = bucketFill(d, w, h, 2 * w + 2, UNKNOWN, 0, seen);
      eq(r.count, 9);
      eq(d[2 * w + 2], UNKNOWN);
    });

    t('移除小障碍', function () {
      var w = 20, h = 10;
      var d = new Uint8Array(w * h).fill(FREE);
      d[1 * w + 1] = OCCUPIED; d[1 * w + 2] = OCCUPIED; // 2 px
      for (var i = 5; i < 12; i++) d[5 * w + i] = OCCUPIED; // 7 px
      var r = removeSmallObstacles(d, w, h, 5, FREE, new Uint8Array(w * h));
      eq(r.components, 1); eq(d[1 * w + 1], FREE); eq(d[5 * w + 7], OCCUPIED);
    });

    t('膨胀/腐蚀', function () {
      var w = 7, h = 7;
      var d = new Uint8Array(w * h).fill(FREE);
      d[3 * w + 3] = OCCUPIED;
      morphology(d, w, h, 'dilate', 1);
      eq(d[3 * w + 3], OCCUPIED); eq(d[2 * w + 2], OCCUPIED); eq(d[2 * w + 1], FREE);
      morphology(d, w, h, 'erode', 1);
      eq(d[3 * w + 3], OCCUPIED); eq(d[2 * w + 2], FREE);
    });

    return results;
  }

  return {
    VERSION: VERSION,
    OCCUPIED: OCCUPIED,
    UNKNOWN: UNKNOWN,
    FREE: FREE,
    parsePGM: parsePGM,
    encodePGM: encodePGM,
    parseYAML: parseYAML,
    buildYAML: buildYAML,
    bandOf: bandOf,
    floodFill: floodFill,
    bucketFill: bucketFill,
    removeSmallObstacles: removeSmallObstacles,
    morphology: morphology,
    selfTest: selfTest
  };
});
