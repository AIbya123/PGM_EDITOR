/* Nav2 地图精修工具 — 应用层 */
(function () {
  'use strict';

  var C = window.MapCore;
  var OCC = C.OCCUPIED;
  var FREE = C.FREE;
  var UNK = C.UNKNOWN;

  /* ------------------------------------------------------------ DOM 引用 */

  var IDS = [
    'view', 'stage', 'emptyState', 'emptyOpen', 'emptyDemo', 'toolHint', 'zoomLabel',
    'zoomIn', 'zoomOut', 'zoomFit', 'miniWrap', 'miniCanvas', 'dropVeil', 'busy', 'busyText',
    'fileTitle', 'btnOpen', 'btnSave', 'btnSaveAs', 'btnUndo', 'btnRedo', 'btnFit',
    'btnHelp', 'btnTheme', 'toolBar', 'metaFile', 'metaSize', 'metaFormat',
    'inResolution', 'inOriginX', 'inOriginY', 'inOriginYaw', 'metaWarn', 'metaWarnText', 'metaTags',
    'displaySeg', 'chkDiff', 'chkMask', 'layerSeg', 'valueLabel', 'valueSeg', 'keepoutHint',
    'brushSize', 'brushSizeOut', 'shapeSeg', 'lineWidth', 'lineWidthOut', 'chkRectFill',
    'tolerance', 'toleranceOut', 'minBlob', 'btnRemoveSmall', 'morphRadius',
    'btnDilate', 'btnErode', 'btnClose', 'maskCount', 'btnMaskToOcc', 'btnMaskToUnk',
    'btnMaskExport', 'btnMaskClear', 'barOcc', 'barFree', 'barUnk', 'barKeep', 'statOcc',
    'statOccP', 'statFree', 'statFreeP', 'statUnk', 'statUnkP', 'statKeep', 'statKeepP',
    'statChanged', 'stFile', 'stDirty', 'stPos', 'stWorld', 'stZoom', 'stSize', 'stRes',
    'fileInput', 'openDlg', 'openTabs', 'tabServer', 'openLocalPane', 'openServerPane',
    'btnPickLocal', 'serverDir', 'serverFileList', 'btnServerRefresh', 'saveDlg',
    'chkSaveMask', 'saveTargetRow', 'saveTargetServer', 'saveServerDirHint',
    'saveNote', 'btnSaveConfirm', 'helpDlg', 'toasts', 'pairDlg', 'pairFileName',
    'pairContinue', 'pairRetry', 'valueRow'
  ];
  var D = {};
  for (var di = 0; di < IDS.length; di++) D[IDS[di]] = document.getElementById(IDS[di]);

  /* ------------------------------------------------------------ 常量 / 状态 */

  var MIN_SCALE = 0.01;
  var MAX_SCALE = 80;
  var MAP_FILE = 'map.pgm';
  var MAP_YAML = 'map.yaml';
  var MASK_FILE = 'map_keepout.pgm';
  var MASK_YAML = 'map_keepout.yaml';
  var THEMES = {
    dark: {
      stage: '#0b0d12',
      border: 'rgba(255,255,255,.16)',
      grid: 'rgba(150,162,184,.26)',
      gridMajor: 'rgba(150,162,184,.46)',
      cursor: '#ffffff',
      halo: 'rgba(0,0,0,.62)',
      label: 'rgba(255,255,255,.55)',
      accent: '#2dd4bf'
    },
    light: {
      stage: '#dfe4ec',
      border: 'rgba(15,23,42,.22)',
      grid: 'rgba(40,55,80,.16)',
      gridMajor: 'rgba(40,55,80,.30)',
      cursor: '#0f172a',
      halo: 'rgba(255,255,255,.85)',
      label: 'rgba(15,23,42,.55)',
      accent: '#0d9488'
    }
  };

  var S = {
    loaded: false,
    w: 0, h: 0,
    data: null,
    original: null,
    mask: null,
    fileName: null,
    baseName: null,
    meta: null,
    yamlLoaded: false,
    yamlDirty: false,
    negateConverted: false,
    sourceFormat: 'P5',
    sourceMaxval: 255,
    view: { scale: 1, ox: 0, oy: 0 },
    tool: 'brush',
    layer: 'map',
    paint: OCC,
    brushSize: 12,
    brushShape: 'round',
    lineWidth: 3,
    rectFill: true,
    tolerance: 0,
    display: 'trinary',
    showDiff: false,
    showMask: true,
    dirty: false,
    source: null,
    handle: null,
    server: null,
    undo: [],
    redo: []
  };

  var P = {
    sx: 0, sy: 0, down: false, button: -1, inside: false,
    panning: false, lastSx: 0, lastSy: 0, pointerId: null, space: false
  };

  var viewCanvas = D.view;
  var ctx = viewCanvas.getContext('2d', { alpha: false });
  var baseCanvas = document.createElement('canvas');
  var maskCanvas = document.createElement('canvas');
  var baseCtx = baseCanvas.getContext('2d');
  var maskCtx = maskCanvas.getContext('2d');

  var viewW = 1, viewH = 1, dpr = 1;
  var theme = 'dark';
  var rafId = 0;
  var fullBase = true, fullMask = true;
  var dirtyBase = null, dirtyMask = null;
  var curStroke = null;
  var lastPaint = null;
  var dragPreview = null;
  var dragActive = false;
  var polyPoints = [];
  var polyCursor = null;
  var scratchSeen = null;
  var statsTimer = 0;
  var miniLast = 0;
  var miniDrag = false;
  var pairResolver = null;

  /* ---------------------------------------------------------------- 启动 */

  init();

  function init() {
    bindEvents();
    var saved = 'dark';
    try { saved = localStorage.getItem('nme-theme') || 'dark'; } catch (e) { /* ignore */ }
    applyTheme(saved === 'light' ? 'light' : 'dark', true);
    resizeView();
    if (window.ResizeObserver) new ResizeObserver(resizeView).observe(D.stage);
    syncInitialUI();
    syncToolUI();
    syncLayerUI();
    syncDisplayUI();
    updateUndoButtons();
    clearStatsUI();
    refreshChrome();
    probeServer();
    requestRender();
    handleInitialHash();
  }

  function handleInitialHash() {
    var params = new URLSearchParams(location.search);
    if (location.hash === '#demo' || params.get('demo') === '1') {
      loadDemo(true);
    }
  }

  /* ---------------------------------------------------------------- 主题 */

  function applyTheme(name, silent) {
    theme = name;
    document.documentElement.dataset.theme = name;
    var use = D.btnTheme.querySelector('use');
    if (use) use.setAttribute('href', name === 'dark' ? '#i-sun' : '#i-moon');
    try { localStorage.setItem('nme-theme', name); } catch (e) { /* ignore */ }
    if (!silent) requestRender();
  }

  /* ------------------------------------------------------------ 画布尺寸 */

  function resizeView() {
    var rect = D.stage.getBoundingClientRect();
    var oldW = viewW, oldH = viewH;
    viewW = Math.max(1, Math.round(rect.width));
    viewH = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = Math.round(viewW * dpr);
    var ch = Math.round(viewH * dpr);
    if (viewCanvas.width !== cw || viewCanvas.height !== ch) {
      viewCanvas.width = cw;
      viewCanvas.height = ch;
      viewCanvas.style.width = viewW + 'px';
      viewCanvas.style.height = viewH + 'px';
    }
    if (S.loaded && oldW > 1 && oldH > 1) {
      var cx = (oldW / 2 - S.view.ox) / S.view.scale;
      var cy = (oldH / 2 - S.view.oy) / S.view.scale;
      S.view.ox = viewW / 2 - cx * S.view.scale;
      S.view.oy = viewH / 2 - cy * S.view.scale;
    }
    requestRender();
  }

  /* ---------------------------------------------------------- 渲染调度 */

  function requestRender() {
    if (!rafId) rafId = requestAnimationFrame(function () { rafId = 0; render(); });
  }

  function render() {
    flushDirty();
    drawView();
    drawMinimapThrottled();
  }

  function flushDirty() {
    if (!S.loaded) return;
    if (fullBase) {
      rebuildBase();
    } else if (dirtyBase) {
      paintBaseRect(dirtyBase.x0, dirtyBase.y0, dirtyBase.x1, dirtyBase.y1);
      dirtyBase = null;
    }
    if (fullMask) {
      rebuildMask();
    } else if (dirtyMask) {
      paintMaskRect(dirtyMask.x0, dirtyMask.y0, dirtyMask.x1, dirtyMask.y1);
      dirtyMask = null;
    }
  }

  function rebuildBase() {
    baseCtx = baseCanvas.getContext('2d');
    var tile = 512;
    for (var y = 0; y < S.h; y += tile) {
      paintBaseRect(0, y, S.w - 1, Math.min(S.h - 1, y + tile - 1));
    }
    fullBase = false;
    dirtyBase = null;
  }

  function rebuildMask() {
    maskCtx = maskCanvas.getContext('2d');
    var tile = 512;
    for (var y = 0; y < S.h; y += tile) {
      paintMaskRect(0, y, S.w - 1, Math.min(S.h - 1, y + tile - 1));
    }
    fullMask = false;
    dirtyMask = null;
  }

  function paintBaseRect(x0, y0, x1, y1) {
    x0 = Math.max(0, x0 | 0);
    y0 = Math.max(0, y0 | 0);
    x1 = Math.min(S.w - 1, x1 | 0);
    y1 = Math.min(S.h - 1, y1 | 0);
    if (x1 < x0 || y1 < y0) return;
    var ww = x1 - x0 + 1;
    var hh = y1 - y0 + 1;
    var img = new ImageData(ww, hh);
    var buf = new Uint32Array(img.data.buffer);
    var data = S.data;
    var orig = S.original;
    var useDiff = S.showDiff && !!orig;
    var trinary = S.display === 'trinary';
    var stride = S.w;

    for (var y = 0; y < hh; y++) {
      var src = (y0 + y) * stride + x0;
      var dst = y * ww;
      for (var x = 0; x < ww; x++, src++, dst++) {
        var v = data[src];
        var r, g, b;
        if (trinary) {
          if (v < 128) { r = 9; g = 10; b = 14; }
          else if (v > 230) { r = 244; g = 244; b = 241; }
          else { r = 195; g = 198; b = 205; }
        } else {
          r = g = b = v;
        }
        if (useDiff) {
          var o = orig[src];
          if (o !== v) {
            if (o < 128 && v >= 128) {
              r = (r * 0.5 + 239 * 0.5) | 0; g = (g * 0.5 + 68 * 0.5) | 0; b = (b * 0.5 + 68 * 0.5) | 0;
            } else if (o >= 128 && v < 128) {
              r = (r * 0.5 + 34 * 0.5) | 0; g = (g * 0.5 + 197 * 0.5) | 0; b = (b * 0.5 + 94 * 0.5) | 0;
            } else {
              r = (r * 0.55 + 245 * 0.45) | 0; g = (g * 0.55 + 158 * 0.45) | 0; b = (b * 0.55 + 11 * 0.45) | 0;
            }
          }
        }
        buf[dst] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
      }
    }
    baseCtx.putImageData(img, x0, y0);
  }

  function paintMaskRect(x0, y0, x1, y1) {
    x0 = Math.max(0, x0 | 0);
    y0 = Math.max(0, y0 | 0);
    x1 = Math.min(S.w - 1, x1 | 0);
    y1 = Math.min(S.h - 1, y1 | 0);
    if (x1 < x0 || y1 < y0) return;
    var ww = x1 - x0 + 1;
    var hh = y1 - y0 + 1;
    var img = new ImageData(ww, hh);
    var buf = new Uint32Array(img.data.buffer);
    var mask = S.mask;
    var stride = S.w;

    for (var y = 0; y < hh; y++) {
      var src = (y0 + y) * stride + x0;
      var dst = y * ww;
      for (var x = 0; x < ww; x++, src++, dst++) {
        buf[dst] = mask[src]
          ? ((140 << 24) | (68 << 16) | (68 << 8) | 242) >>> 0
          : 0;
      }
    }
    maskCtx.putImageData(img, x0, y0);
  }

  function markDirty(layer, x0, y0, x1, y1) {
    if (!S.loaded) return;
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(S.w - 1, Math.ceil(x1));
    y1 = Math.min(S.h - 1, Math.ceil(y1));
    if (x1 < x0 || y1 < y0) return;
    var d;
    if (layer === 'keepout') {
      d = dirtyMask;
      if (!d) dirtyMask = { x0: x0, y0: y0, x1: x1, y1: y1 };
      else {
        if (x0 < d.x0) d.x0 = x0;
        if (y0 < d.y0) d.y0 = y0;
        if (x1 > d.x1) d.x1 = x1;
        if (y1 > d.y1) d.y1 = y1;
      }
    } else {
      d = dirtyBase;
      if (!d) dirtyBase = { x0: x0, y0: y0, x1: x1, y1: y1 };
      else {
        if (x0 < d.x0) d.x0 = x0;
        if (y0 < d.y0) d.y0 = y0;
        if (x1 > d.x1) d.x1 = x1;
        if (y1 > d.y1) d.y1 = y1;
      }
    }
  }

  /* ------------------------------------------------------------- 视图绘制 */

  function drawView() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var T = THEMES[theme];
    ctx.fillStyle = T.stage;
    ctx.fillRect(0, 0, viewW, viewH);

    if (!S.loaded) return;

    var scale = S.view.scale;
    var ox = S.view.ox;
    var oy = S.view.oy;
    var mw = S.w * scale;
    var mh = S.h * scale;

    // 地图背后的阴影 / 底色
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.42)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#000';
    ctx.fillRect(ox, oy, mw, mh);
    ctx.restore();

    var sx0 = Math.max(0, Math.floor(-ox / scale));
    var sy0 = Math.max(0, Math.floor(-oy / scale));
    var sx1 = Math.min(S.w, Math.ceil((viewW - ox) / scale));
    var sy1 = Math.min(S.h, Math.ceil((viewH - oy) / scale));

    if (sx1 > sx0 && sy1 > sy0) {
      var sw = sx1 - sx0;
      var sh = sy1 - sy0;
      var dx = ox + sx0 * scale;
      var dy = oy + sy0 * scale;
      ctx.imageSmoothingEnabled = scale < 1;
      ctx.drawImage(baseCanvas, sx0, sy0, sw, sh, dx, dy, sw * scale, sh * scale);
      if (S.showMask) {
        ctx.drawImage(maskCanvas, sx0, sy0, sw, sh, dx, dy, sw * scale, sh * scale);
      }
      ctx.imageSmoothingEnabled = true;
    }

    ctx.strokeStyle = T.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, Math.max(0, mw - 1), Math.max(0, mh - 1));

    drawGrid(T);
    drawScaleBar(T);
    drawBrushCursor(T);
    drawPolyPreview(T);
    drawShapePreview(T);
  }

  function niceStep(v) {
    if (!(v > 0)) return 1;
    var e = Math.pow(10, Math.floor(Math.log10(v)));
    var f = v / e;
    var m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return m * e;
  }

  function drawGrid(T) {
    var res = S.meta.resolution;
    if (!(res > 0)) return;
    var scale = S.view.scale;
    var pxPerM = scale / res;
    if (pxPerM < 6) return;
    var step = niceStep(64 / pxPerM);
    var ox = S.view.ox, oy = S.view.oy;
    var originX = S.meta.origin[0];
    var originY = S.meta.origin[1];

    var wx0 = originX - (ox / scale) * res;
    var wx1 = originX + ((viewW - ox) / scale) * res;
    var wyTop = originY + res * (S.h + oy / scale);
    var wyBot = originY + res * (S.h - (viewH - oy) / scale);

    var kx0 = Math.ceil(wx0 / step), kx1 = Math.floor(wx1 / step);
    var ky0 = Math.ceil(wyBot / step), ky1 = Math.floor(wyTop / step);
    if (kx1 - kx0 > 600 || ky1 - ky0 > 600) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, S.w * scale, S.h * scale);
    ctx.clip();
    ctx.lineWidth = 1;

    for (var k = kx0; k <= kx1; k++) {
      var sx = Math.round(ox + ((k * step - originX) / res) * scale) + 0.5;
      if (sx < 0 || sx > viewW) continue;
      ctx.strokeStyle = (k % 5 === 0) ? T.gridMajor : T.grid;
      ctx.beginPath();
      ctx.moveTo(sx, Math.max(0, oy));
      ctx.lineTo(sx, Math.min(viewH, oy + S.h * scale));
      ctx.stroke();
    }
    for (var j = ky0; j <= ky1; j++) {
      var sy = Math.round(oy + (S.h - (j * step - originY) / res) * scale) + 0.5;
      if (sy < 0 || sy > viewH) continue;
      ctx.strokeStyle = (j % 5 === 0) ? T.gridMajor : T.grid;
      ctx.beginPath();
      ctx.moveTo(Math.max(0, ox), sy);
      ctx.lineTo(Math.min(viewW, ox + S.w * scale), sy);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawScaleBar(T) {
    var res = S.meta.resolution;
    var scale = S.view.scale;
    var pxPerM = scale / res;
    if (!(pxPerM > 0)) return;
    var candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    var meters = candidates[0];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] * pxPerM <= 190) meters = candidates[i];
    }
    var len = meters * pxPerM;
    var x = 16;
    var y = 22;
    ctx.save();
    ctx.strokeStyle = T.label;
    ctx.fillStyle = T.label;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.moveTo(x + len, y - 4);
    ctx.lineTo(x + len, y + 4);
    ctx.stroke();
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(meters >= 1 ? (meters + ' m') : (Math.round(meters * 100) + ' cm'), x, y - 9);
    ctx.restore();
  }

  function drawBrushCursor(T) {
    if (!P.inside || P.panning || !S.loaded) return;
    if (S.tool !== 'brush' && S.tool !== 'eraser') return;
    var scale = S.view.scale;
    var r = Math.max(2, (S.brushSize / 2) * scale);
    ctx.save();
    ctx.strokeStyle = T.halo;
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (S.brushShape === 'square') ctx.rect(P.sx - r, P.sy - r, r * 2, r * 2);
    else ctx.arc(P.sx, P.sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = T.cursor;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    if (S.brushShape === 'square') ctx.rect(P.sx - r, P.sy - r, r * 2, r * 2);
    else ctx.arc(P.sx, P.sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawShapePreview(T) {
    if (!dragPreview) return;
    var a = toScreen(dragPreview.a.x, dragPreview.a.y);
    var b = toScreen(dragPreview.b.x, dragPreview.b.y);
    ctx.save();
    ctx.strokeStyle = T.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    if (dragPreview.kind === 'line') {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else {
      var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      var w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      if (S.rectFill) {
        ctx.fillStyle = 'rgba(45,212,191,.12)';
        ctx.fillRect(x, y, w, h);
      }
      ctx.strokeRect(x, y, w, h);
    }
    ctx.restore();
  }

  function drawPolyPreview(T) {
    if (!polyPoints.length) return;
    ctx.save();
    ctx.strokeStyle = T.accent;
    ctx.fillStyle = T.accent;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    var p0 = toScreen(polyPoints[0].x, polyPoints[0].y);
    ctx.moveTo(p0.x, p0.y);
    for (var i = 1; i < polyPoints.length; i++) {
      var p = toScreen(polyPoints[i].x, polyPoints[i].y);
      ctx.lineTo(p.x, p.y);
    }
    if (polyCursor) {
      var pc = toScreen(polyCursor.x, polyCursor.y);
      ctx.lineTo(pc.x, pc.y);
    }
    ctx.stroke();

    if (polyCursor && polyPoints.length >= 2) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(45,212,191,.55)';
      ctx.beginPath();
      var last = toScreen(polyPoints[polyPoints.length - 1].x, polyPoints[polyPoints.length - 1].y);
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(pc.x, pc.y);
      ctx.lineTo(p0.x, p0.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (var k = 0; k < polyPoints.length; k++) {
      var q = toScreen(polyPoints[k].x, polyPoints[k].y);
      ctx.beginPath();
      ctx.arc(q.x, q.y, k === 0 ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = T.accent;
      ctx.lineWidth = 1.6;
    }
    ctx.restore();
  }

  /* -------------------------------------------------------------- 小地图 */

  function updateMinimapSize() {
    if (!S.loaded) { D.miniWrap.classList.add('hidden'); return; }
    var maxW = 200, maxH = 130;
    var s = Math.min(maxW / S.w, maxH / S.h);
    var cw = Math.max(36, Math.round(S.w * s));
    var ch = Math.max(24, Math.round(S.h * s));
    D.miniCanvas.width = cw;
    D.miniCanvas.height = ch;
    D.miniCanvas.style.width = cw + 'px';
    D.miniCanvas.style.height = ch + 'px';
    miniLast = 0;
  }

  function drawMinimapThrottled() {
    if (!S.loaded) return;
    var fits = S.w * S.view.scale <= viewW * 0.98 && S.h * S.view.scale <= viewH * 0.98;
    if (fits) { D.miniWrap.classList.add('hidden'); return; }
    var now = performance.now();
    if (now - miniLast < 110) return;
    miniLast = now;
    D.miniWrap.classList.remove('hidden');
    drawMinimap();
  }

  function drawMinimap() {
    if (!S.loaded) return;
    var c = D.miniCanvas;
    var g = c.getContext('2d');
    var cw = c.width, ch = c.height;
    g.fillStyle = '#0b0d12';
    g.fillRect(0, 0, cw, ch);
    g.imageSmoothingEnabled = true;
    g.drawImage(baseCanvas, 0, 0, cw, ch);
    if (S.showMask) g.drawImage(maskCanvas, 0, 0, cw, ch);

    var scale = S.view.scale;
    var vx = (-S.view.ox / scale) / S.w * cw;
    var vy = (-S.view.oy / scale) / S.h * ch;
    var vw = (viewW / scale) / S.w * cw;
    var vh = (viewH / scale) / S.h * ch;
    vx = Math.max(0, vx); vy = Math.max(0, vy);
    vw = Math.min(cw - vx, vw); vh = Math.min(ch - vy, vh);
    g.fillStyle = 'rgba(45,212,191,.10)';
    g.fillRect(vx, vy, vw, vh);
    g.strokeStyle = 'rgba(45,212,191,.95)';
    g.lineWidth = 1.5;
    g.strokeRect(vx + 0.75, vy + 0.75, Math.max(0, vw - 1.5), Math.max(0, vh - 1.5));
  }

  function minimapCenter(e) {
    var r = D.miniCanvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var mx = ((e.clientX - r.left) / r.width) * S.w;
    var my = ((e.clientY - r.top) / r.height) * S.h;
    centerAt(mx, my);
  }

  function centerAt(mx, my) {
    S.view.ox = viewW / 2 - mx * S.view.scale;
    S.view.oy = viewH / 2 - my * S.view.scale;
    requestRender();
  }

  /* ------------------------------------------------------------ 坐标换算 */

  function toMap(sx, sy) {
    return { x: (sx - S.view.ox) / S.view.scale, y: (sy - S.view.oy) / S.view.scale };
  }

  function toScreen(mx, my) {
    return { x: S.view.ox + mx * S.view.scale, y: S.view.oy + my * S.view.scale };
  }

  function fitView() {
    if (!S.loaded) return;
    var pad = 44;
    var s = Math.min((viewW - pad * 2) / S.w, (viewH - pad * 2) / S.h);
    s = Math.max(MIN_SCALE, Math.min(32, s));
    S.view.scale = s;
    S.view.ox = (viewW - S.w * s) / 2;
    S.view.oy = (viewH - S.h * s) / 2;
    updateZoomLabel();
    requestRender();
  }

  function zoomAt(sx, sy, factor) {
    if (!S.loaded) return;
    var old = S.view.scale;
    var ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, old * factor));
    if (Math.abs(ns - old) < 1e-9) return;
    S.view.ox = sx - (sx - S.view.ox) * (ns / old);
    S.view.oy = sy - (sy - S.view.oy) * (ns / old);
    S.view.scale = ns;
    updateZoomLabel();
    requestRender();
  }

  function updateZoomLabel() {
    var z = S.loaded ? Math.round(S.view.scale * 100) : 0;
    D.zoomLabel.textContent = S.loaded ? z + '%' : '—';
    D.stZoom.textContent = S.loaded ? z + '%' : '—';
  }

  /* ------------------------------------------------------------ 像素写入 */

  function layerArr(layer) { return layer === 'keepout' ? S.mask : S.data; }

  function setPx(layer, idx, v) {
    var arr = layerArr(layer);
    var old = arr[idx];
    if (old === v) return;
    if (curStroke && curStroke.layer === layer) {
      if (!curStroke.map.has(idx)) curStroke.map.set(idx, old);
    }
    arr[idx] = v;
  }

  function paintValueFor(erase) {
    if (S.layer === 'keepout') return erase ? 0 : 1;
    return erase ? FREE : S.paint;
  }

  function stamp(layer, mx, my, radius, shape, value) {
    if (!S.loaded) return;
    var r = Math.max(0.5, radius);
    if (mx < -r - 2 || my < -r - 2 || mx > S.w + r + 2 || my > S.h + r + 2) return;
    if (r < 1.05) {
      var px = Math.floor(mx), py = Math.floor(my);
      if (px < 0 || py < 0 || px >= S.w || py >= S.h) return;
      setPx(layer, py * S.w + px, value);
      markDirty(layer, px, py, px, py);
      return;
    }
    var x0 = Math.max(0, Math.floor(mx - r - 0.5));
    var x1 = Math.min(S.w - 1, Math.ceil(mx + r + 0.5));
    var y0 = Math.max(0, Math.floor(my - r - 0.5));
    var y1 = Math.min(S.h - 1, Math.ceil(my + r + 0.5));
    if (x1 < x0 || y1 < y0) return;

    var r2 = r * r;
    for (var y = y0; y <= y1; y++) {
      var dy = y + 0.5 - my;
      var row = y * S.w;
      if (shape === 'square') {
        if (Math.abs(dy) > r) continue;
        for (var x = x0; x <= x1; x++) {
          if (Math.abs(x + 0.5 - mx) <= r) setPx(layer, row + x, value);
        }
      } else {
        var dy2 = dy * dy;
        for (var x2 = x0; x2 <= x1; x2++) {
          var dx = x2 + 0.5 - mx;
          if (dx * dx + dy2 <= r2) setPx(layer, row + x2, value);
        }
      }
    }
    markDirty(layer, x0, y0, x1, y1);
  }

  function stampLine(layer, a, b, radius, value) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.01) { stamp(layer, a.x, a.y, radius, 'round', value); return; }
    var step = Math.max(0.7, Math.min(3, radius * 0.35));
    var n = Math.min(9000, Math.max(1, Math.ceil(dist / step)));
    for (var i = 0; i <= n; i++) {
      stamp(layer, a.x + dx * i / n, a.y + dy * i / n, radius, 'round', value);
    }
  }

  function fillRectPixels(layer, x0, y0, x1, y1, value) {
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(S.w - 1, Math.floor(x1));
    y1 = Math.min(S.h - 1, Math.floor(y1));
    if (x1 < x0 || y1 < y0) return;
    for (var y = y0; y <= y1; y++) {
      var row = y * S.w;
      for (var x = x0; x <= x1; x++) setPx(layer, row + x, value);
    }
    markDirty(layer, x0, y0, x1, y1);
  }

  function fillPolygon(layer, pts, value) {
    if (pts.length < 3) return;
    var minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].y < minY) minY = pts[i].y;
      if (pts[i].y > maxY) maxY = pts[i].y;
    }
    var y0 = Math.max(0, Math.floor(minY));
    var y1 = Math.min(S.h - 1, Math.ceil(maxY));
    var minX = S.w, maxX = -1;

    for (var y = y0; y <= y1; y++) {
      var yc = y + 0.5;
      var xs = [];
      for (var a = 0, b = pts.length - 1; a < pts.length; b = a++) {
        var p1 = pts[b], p2 = pts[a];
        if ((p1.y <= yc && p2.y > yc) || (p2.y <= yc && p1.y > yc)) {
          var t = (yc - p1.y) / (p2.y - p1.y);
          xs.push(p1.x + t * (p2.x - p1.x));
        }
      }
      if (xs.length < 2) continue;
      xs.sort(function (m, n) { return m - n; });
      for (var k = 0; k + 1 < xs.length; k += 2) {
        var xa = Math.max(0, Math.ceil(xs[k] - 0.5));
        var xb = Math.min(S.w - 1, Math.floor(xs[k + 1] - 0.5));
        if (xb < xa) continue;
        var row = y * S.w;
        for (var x = xa; x <= xb; x++) setPx(layer, row + x, value);
        if (xa < minX) minX = xa;
        if (xb > maxX) maxX = xb;
      }
    }
    if (maxX >= minX) markDirty(layer, minX, y0, maxX, y1);
  }

  /* ------------------------------------------------------------ 撤销重做 */

  function beginStroke(label) {
    if (curStroke) endStroke();
    curStroke = { layer: S.layer, label: label, map: new Map() };
  }

  function endStroke() {
    if (!curStroke) return;
    var cs = curStroke;
    curStroke = null;
    if (!cs.map.size) { updateUndoButtons(); return; }

    var n = cs.map.size;
    var idx = new Int32Array(n);
    var ov = new Uint8Array(n);
    var nv = new Uint8Array(n);
    var arr = layerArr(cs.layer);
    var k = 0;
    cs.map.forEach(function (old, i) {
      idx[k] = i;
      ov[k] = old;
      nv[k] = arr[i];
      k++;
    });
    pushUndo({ layer: cs.layer, label: cs.label, idx: idx, old: ov, new: nv });
    S.dirty = true;
    refreshChrome();
    scheduleStats();
    updateUndoButtons();
    requestRender();
  }

  function cancelStroke() {
    if (!curStroke) return;
    var cs = curStroke;
    var arr = layerArr(cs.layer);
    cs.map.forEach(function (old, i) { arr[i] = old; });
    curStroke = null;
    if (cs.layer === 'keepout') fullMask = true; else fullBase = true;
    requestRender();
  }

  function historyPixels() {
    var n = 0;
    for (var i = 0; i < S.undo.length; i++) n += S.undo[i].idx.length;
    return n;
  }

  function pushUndo(entry) {
    S.undo.push(entry);
    // 同时限制步数与历史内存（约 800 万像素）：
    while (S.undo.length > 80 || (S.undo.length > 1 && historyPixels() > 8000000)) {
      S.undo.shift();
    }
    S.redo.length = 0;
    updateUndoButtons();
  }

  function applyEntry(e, useOld) {
    var arr = layerArr(e.layer);
    var x0 = S.w, y0 = S.h, x1 = 0, y1 = 0;
    for (var k = 0; k < e.idx.length; k++) {
      var i = e.idx[k];
      arr[i] = useOld ? e.old[k] : e.new[k];
      var y = (i / S.w) | 0;
      var x = i - y * S.w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (e.idx.length) markDirty(e.layer, x0, y0, x1, y1);
    S.dirty = true;
    refreshChrome();
    scheduleStats();
    updateUndoButtons();
    requestRender();
  }

  function undo() {
    endStroke();
    var e = S.undo.pop();
    if (!e) return;
    applyEntry(e, true);
    S.redo.push(e);
    updateUndoButtons();
  }

  function redo() {
    endStroke();
    var e = S.redo.pop();
    if (!e) return;
    applyEntry(e, false);
    S.undo.push(e);
    updateUndoButtons();
  }

  function updateUndoButtons() {
    D.btnUndo.disabled = !S.undo.length;
    D.btnRedo.disabled = !S.redo.length;
  }

  /* ------------------------------------------------------------ 批量编辑 */

  function bulkEdit(layer, label, fn) {
    if (!S.loaded) return null;
    endStroke();
    var arr = layerArr(layer);
    var before = arr.slice();
    var result;
    try {
      result = fn() || {};
    } catch (err) {
      toastError('操作失败：' + (err && err.message ? err.message : err));
      return null;
    }

    var count = 0;
    var x0 = S.w, y0 = S.h, x1 = -1, y1 = -1;
    var n = arr.length;
    for (var i = 0; i < n; i++) {
      if (arr[i] !== before[i]) {
        count++;
        var y = (i / S.w) | 0;
        var x = i - y * S.w;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (!count) {
      toast('没有像素需要修改');
      return result;
    }

    var idx = new Int32Array(count);
    var ov = new Uint8Array(count);
    var nv = new Uint8Array(count);
    var k = 0;
    for (var j = 0; j < n; j++) {
      if (arr[j] !== before[j]) {
        idx[k] = j;
        ov[k] = before[j];
        nv[k] = arr[j];
        k++;
      }
    }

    pushUndo({ layer: layer, label: label, idx: idx, old: ov, new: nv });
    if (result.bbox) markDirty(layer, result.bbox[0], result.bbox[1], result.bbox[2], result.bbox[3]);
    else markDirty(layer, x0, y0, x1, y1);

    S.dirty = true;
    refreshChrome();
    scheduleStats();
    updateUndoButtons();
    requestRender();
    return result;
  }

  function getScratch() {
    var n = S.w * S.h;
    if (!scratchSeen || scratchSeen.length !== n) scratchSeen = new Uint8Array(n);
    else scratchSeen.fill(0);
    return scratchSeen;
  }

  /* ------------------------------------------------------------ 指针事件 */

  function getPos(e) {
    var r = viewCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e) {
    if (!S.loaded) return;
    var pos = getPos(e);
    P.sx = pos.x; P.sy = pos.y;
    P.pointerId = e.pointerId;
    P.inside = true;
    updateStatusCoords();

    if (e.button === 1 || (e.button === 0 && (P.space || S.tool === 'pan' || e.altKey))) {
      e.preventDefault();
      P.panning = true;
      P.lastSx = pos.x;
      P.lastSy = pos.y;
      try { viewCanvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      updateCursorClass();
      return;
    }

    if (e.button === 2) {
      e.preventDefault();
      if (S.tool === 'brush' || S.tool === 'eraser') {
        startPaint(true, pos);
      } else if (S.tool === 'fill') {
        doFillAt(pos, true);
      } else if (S.tool === 'polygon') {
        if (polyPoints.length) { polyPoints.pop(); requestRender(); }
      } else if (S.tool === 'line' || S.tool === 'rect') {
        dragPreview = null;
        dragActive = false;
        requestRender();
      }
      return;
    }

    if (e.button !== 0) return;
    try { viewCanvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    P.down = true;
    P.button = 0;

    switch (S.tool) {
      case 'brush': startPaint(false, pos); break;
      case 'eraser': startPaint(true, pos); break;
      case 'line':
      case 'rect':
        var mp = toMap(pos.x, pos.y);
        dragPreview = { kind: S.tool, a: mp, b: mp };
        dragActive = true;
        requestRender();
        break;
      case 'polygon':
        addPolyPoint(pos);
        break;
      case 'fill':
        doFillAt(pos, false);
        break;
      default:
        break;
    }
  }

  function onPointerMove(e) {
    var pos = getPos(e);
    P.sx = pos.x;
    P.sy = pos.y;
    P.inside = pos.x >= 0 && pos.y >= 0 && pos.x <= viewW && pos.y <= viewH;
    updateStatusCoords();

    if (P.panning) {
      S.view.ox += pos.x - P.lastSx;
      S.view.oy += pos.y - P.lastSy;
      P.lastSx = pos.x;
      P.lastSy = pos.y;
      requestRender();
      return;
    }

    if (curStroke && P.down) {
      paintMove(pos);
      return;
    }
    if (dragPreview && dragActive) {
      dragPreview.b = toMap(pos.x, pos.y);
      requestRender();
      return;
    }
    if (S.tool === 'polygon' && polyPoints.length) {
      polyCursor = toMap(pos.x, pos.y);
      requestRender();
      return;
    }
    requestRender();
  }

  function onPointerUp(e) {
    if (P.panning) {
      P.panning = false;
      updateCursorClass();
    } else if (curStroke && P.down) {
      endStroke();
      lastPaint = null;
    } else if (dragPreview && dragActive) {
      applyShape();
    }
    if (P.pointerId !== null) {
      try { viewCanvas.releasePointerCapture(P.pointerId); } catch (err) { /* ignore */ }
    }
    P.down = false;
    P.button = -1;
    P.pointerId = null;
    requestRender();
  }

  function onPointerLeave() {
    if (!P.down) {
      P.inside = false;
      requestRender();
    }
  }

  function startPaint(erase, pos) {
    if (!S.loaded) return;
    if (curStroke) endStroke();
    beginStroke(erase ? '擦除' : '绘制');
    curStroke.value = paintValueFor(erase);
    curStroke.radius = S.brushSize / 2;
    curStroke.shape = S.brushShape;
    lastPaint = toMap(pos.x, pos.y);
    stamp(S.layer, lastPaint.x, lastPaint.y, curStroke.radius, curStroke.shape, curStroke.value);
    P.down = true;
    requestRender();
  }

  function paintMove(pos) {
    if (!curStroke || !lastPaint) return;
    var cur = toMap(pos.x, pos.y);
    var dx = cur.x - lastPaint.x;
    var dy = cur.y - lastPaint.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var r = curStroke.radius;
    var step = Math.max(0.6, Math.min(4, r * 0.35));
    var n = Math.min(8000, Math.max(1, Math.ceil(dist / step)));
    for (var i = 1; i <= n; i++) {
      stamp(curStroke.layer, lastPaint.x + dx * i / n, lastPaint.y + dy * i / n,
        r, curStroke.shape, curStroke.value);
    }
    lastPaint = cur;
    requestRender();
  }

  function applyShape() {
    var pv = dragPreview;
    dragPreview = null;
    dragActive = false;
    if (!pv) return;
    var a = pv.a, b = pv.b;
    if (pv.kind === 'line') {
      beginStroke('直线');
      stampLine(curStroke.layer, a, b, Math.max(0.5, S.lineWidth / 2), paintValueFor(false));
      endStroke();
    } else if (pv.kind === 'rect') {
      beginStroke('矩形');
      var layer = curStroke.layer;
      var value = paintValueFor(false);
      var x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
      var y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      if (S.rectFill) {
        fillRectPixels(layer, x0, y0, x1, y1, value);
      } else {
        var r = Math.max(0.5, S.lineWidth / 2);
        stampLine(layer, { x: x0, y: y0 }, { x: x1, y: y0 }, r, value);
        stampLine(layer, { x: x1, y: y0 }, { x: x1, y: y1 }, r, value);
        stampLine(layer, { x: x1, y: y1 }, { x: x0, y: y1 }, r, value);
        stampLine(layer, { x: x0, y: y1 }, { x: x0, y: y0 }, r, value);
      }
      endStroke();
    }
    requestRender();
  }

  function addPolyPoint(pos) {
    var mp = toMap(pos.x, pos.y);
    if (polyPoints.length >= 3) {
      var first = toScreen(polyPoints[0].x, polyPoints[0].y);
      if (Math.hypot(first.x - pos.x, first.y - pos.y) < 11) {
        finishPolygon();
        return;
      }
    }
    polyPoints.push(mp);
    polyCursor = mp;
    requestRender();
  }

  function finishPolygon() {
    if (polyPoints.length < 3) { polyPoints = []; polyCursor = null; requestRender(); return; }
    beginStroke('多边形');
    fillPolygon(curStroke.layer, polyPoints, paintValueFor(false));
    endStroke();
    polyPoints = [];
    polyCursor = null;
    requestRender();
  }

  function cancelInteractions() {
    if (curStroke) cancelStroke();
    if (dragPreview) { dragPreview = null; dragActive = false; }
    if (polyPoints.length) { polyPoints = []; polyCursor = null; }
    if (P.panning) { P.panning = false; updateCursorClass(); }
    requestRender();
  }

  function doFillAt(pos, erase) {
    var mp = toMap(pos.x, pos.y);
    var x = Math.floor(mp.x), y = Math.floor(mp.y);
    if (x < 0 || y < 0 || x >= S.w || y >= S.h) return;
    var layer = S.layer;
    var value = paintValueFor(erase);
    var tol = layer === 'keepout' ? 0 : S.tolerance;
    var idx = y * S.w + x;
    var res = bulkEdit(layer, erase ? '填充空闲' : '油漆桶', function () {
      return C.bucketFill(layerArr(layer), S.w, S.h, idx, value, tol, getScratch());
    });
    if (res && res.count) toast('已填充 ' + fmtCount(res.count) + ' 个像素');
  }

  /* ------------------------------------------------------------ 状态显示 */

  function updateStatusCoords() {
    if (!S.loaded) {
      D.stPos.textContent = '像素 —';
      D.stWorld.textContent = '世界 —';
      return;
    }
    var mp = toMap(P.sx, P.sy);
    var x = Math.floor(mp.x), y = Math.floor(mp.y);
    if (x >= 0 && y >= 0 && x < S.w && y < S.h) {
      var v = S.data[y * S.w + x];
      D.stPos.textContent = '像素 ' + x + ', ' + y + ' · 值 ' + v;
      var res = S.meta.resolution;
      var wx = S.meta.origin[0] + (x + 0.5) * res;
      var wy = S.meta.origin[1] + (S.h - y - 0.5) * res;
      D.stWorld.textContent = '世界 ' + wx.toFixed(2) + ', ' + wy.toFixed(2) + ' m';
    } else {
      D.stPos.textContent = '像素 —';
      D.stWorld.textContent = '世界 —';
    }
  }

  function updateCursorClass() {
    viewCanvas.classList.remove('cursor-pan', 'cursor-grabbing', 'cursor-cross', 'cursor-paint');
    if (!S.loaded) return;
    if (P.panning) viewCanvas.classList.add('cursor-grabbing');
    else if (S.tool === 'pan' || P.space) viewCanvas.classList.add('cursor-pan');
    else if (S.tool === 'brush' || S.tool === 'eraser') viewCanvas.classList.add('cursor-paint');
    else viewCanvas.classList.add('cursor-cross');
  }

  /* ---------------------------------------------------------------- 统计 */

  function scheduleStats() {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(updateStats, 220);
  }

  function fmtCount(v) {
    if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
    if (v >= 10000) return (v / 1000).toFixed(1) + 'k';
    return String(v);
  }

  function pct(v, total) {
    if (!total) return '—';
    if (!v) return '0%';
    return (v / total * 100).toFixed(v / total < 0.0001 ? 4 : 2) + '%';
  }

  function updateStats() {
    if (!S.loaded) { clearStatsUI(); return; }
    var n = S.w * S.h;
    var d = S.data;
    var o = S.original;
    var occ = 0, free = 0, unk = 0, changed = 0, keep = 0;
    for (var i = 0; i < n; i++) {
      var v = d[i];
      if (v < 128) occ++;
      else if (v > 230) free++;
      else unk++;
      if (o && o[i] !== v) changed++;
    }
    if (S.mask) {
      for (var j = 0; j < n; j++) if (S.mask[j]) keep++;
    }

    D.statOcc.textContent = fmtCount(occ);
    D.statOccP.textContent = pct(occ, n);
    D.statFree.textContent = fmtCount(free);
    D.statFreeP.textContent = pct(free, n);
    D.statUnk.textContent = fmtCount(unk);
    D.statUnkP.textContent = pct(unk, n);
    D.statKeep.textContent = fmtCount(keep);
    D.statKeepP.textContent = pct(keep, n);
    D.statChanged.textContent = changed ? (fmtCount(changed) + ' px · ' + pct(changed, n)) : '0 px';
    D.maskCount.textContent = fmtCount(keep) + ' px';

    D.barOcc.style.width = (occ / n * 100) + '%';
    D.barFree.style.width = (free / n * 100) + '%';
    D.barUnk.style.width = (unk / n * 100) + '%';
    D.barKeep.style.width = '0%';

    var hasMask = keep > 0;
    D.btnMaskToOcc.disabled = !hasMask;
    D.btnMaskToUnk.disabled = !hasMask;
    D.btnMaskExport.disabled = !hasMask;
    D.btnMaskClear.disabled = !hasMask;
  }

  function clearStatsUI() {
    ['statOcc', 'statFree', 'statUnk', 'statKeep', 'statChanged', 'maskCount'].forEach(function (id) {
      if (D[id]) D[id].textContent = '—';
    });
    ['statOccP', 'statFreeP', 'statUnkP', 'statKeepP'].forEach(function (id) {
      if (D[id]) D[id].textContent = '—';
    });
    D.barOcc.style.width = '0';
    D.barFree.style.width = '0';
    D.barUnk.style.width = '0';
    D.barKeep.style.width = '0';
    D.maskCount.textContent = '0';
    D.btnMaskToOcc.disabled = true;
    D.btnMaskToUnk.disabled = true;
    D.btnMaskExport.disabled = true;
    D.btnMaskClear.disabled = true;
  }

  function maskHasPixels() {
    if (!S.mask) return false;
    for (var i = 0; i < S.mask.length; i++) if (S.mask[i]) return true;
    return false;
  }

  /* ------------------------------------------------------------ 界面同步 */

  function syncInitialUI() {
    D.btnSave.disabled = true;
    D.btnSaveAs.disabled = true;
    D.btnUndo.disabled = true;
    D.btnRedo.disabled = true;
    D.btnMaskToOcc.disabled = true;
    D.btnMaskToUnk.disabled = true;
    D.btnMaskExport.disabled = true;
    D.btnMaskClear.disabled = true;
    D.emptyState.classList.remove('hidden');
    D.miniWrap.classList.add('hidden');
    D.toolHint.textContent = '打开地图后即可编辑';
  }

  function syncToolUI() {
    D.toolBar.querySelectorAll('[data-tool]').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tool === S.tool);
    });
    var groups = document.querySelectorAll('[data-tools]');
    for (var i = 0; i < groups.length; i++) {
      var list = groups[i].dataset.tools.split(/\s+/);
      groups[i].classList.toggle('hidden', list.indexOf(S.tool) === -1);
    }
    updateToolHint();
    updateCursorClass();
  }

  function syncLayerUI() {
    D.layerSeg.querySelectorAll('button').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.layer === S.layer);
    });
    var keep = S.layer === 'keepout';
    D.keepoutHint.classList.toggle('hidden', !keep);
    if (D.valueRow) D.valueRow.classList.toggle('hidden', keep);
    D.valueLabel.textContent = '内容';
    D.valueSeg.querySelectorAll('button').forEach(function (b) { b.disabled = keep; });
    updateToolHint();
  }

  function syncDisplayUI() {
    D.displaySeg.querySelectorAll('button').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.display === S.display);
    });
    D.chkDiff.checked = S.showDiff;
    D.chkMask.checked = S.showMask;
  }

  function updateToolHint() {
    var hints = {
      pan: '拖动平移视图 · 滚轮缩放 · F 适应窗口',
      brush: '左键绘制 · 右键擦除 · 空格+拖动平移 · [ ] 调整笔刷',
      eraser: '左键擦除为空闲 · 右键同样擦除 · 空格+拖动平移',
      line: '拖出一条直线 / 墙线 · 右键取消 · 线宽可调',
      rect: '拖出矩形 · 右键取消 · 可切换填充或描边',
      polygon: '逐点单击 · 双击 / Enter / 点回起点闭合 · 右键删点 · Esc 取消',
      fill: '点击填充连通区域 · 右键填为空白 · 可调容差'
    };
    var pre = S.layer === 'keepout' ? '禁行区 · ' : '';
    var txt = pre + (hints[S.tool] || '');
    D.toolHint.textContent = txt;
  }

  function refreshChrome() {
    D.stDirty.classList.toggle('hidden', !(S.loaded && S.dirty));
    D.fileTitle.textContent = S.loaded ? (S.fileName + (S.dirty ? ' · 未保存' : '')) : '未打开地图';
    D.stFile.textContent = S.loaded ? S.fileName : '未打开地图';
    document.title = S.loaded ? (S.fileName + (S.dirty ? ' *' : '') + ' — Nav2 地图精修') : 'Nav2 地图精修';
    D.btnSave.disabled = !S.loaded;
    D.btnSaveAs.disabled = !S.loaded;
    D.stSize.textContent = S.loaded ? (S.w + ' × ' + S.h + ' px') : '—';
    D.stRes.textContent = S.loaded ? (fmtNum(S.meta.resolution) + ' m/px') : '—';
  }

  function fmtNum(v) {
    if (!isFinite(v)) return '—';
    return String(Number(v.toFixed(6)));
  }

  function syncMetaInputs() {
    if (!S.loaded) return;
    D.metaFile.textContent = S.fileName;
    D.metaSize.textContent = S.w + ' × ' + S.h;
    D.metaFormat.textContent = S.sourceFormat + ' · 8-bit';
    if (D.metaTags) {
      D.metaTags.textContent = (S.meta.mode || 'trinary') + ' · neg ' + (S.meta.negate ? 1 : 0) +
        ' · ' + fmtNum(S.meta.occupied_thresh) + '/' + fmtNum(S.meta.free_thresh);
      D.metaTags.title = 'mode=' + (S.meta.mode || 'trinary') + '  negate=' + (S.meta.negate ? 1 : 0) +
        '  occupied_thresh=' + S.meta.occupied_thresh + '  free_thresh=' + S.meta.free_thresh;
    }
    D.inResolution.value = fmtNum(S.meta.resolution);
    D.inOriginX.value = fmtNum(S.meta.origin[0]);
    D.inOriginY.value = fmtNum(S.meta.origin[1]);
    D.inOriginYaw.value = fmtNum(S.meta.origin[2]);
    D.inResolution.disabled = false;
    D.inOriginX.disabled = false;
    D.inOriginY.disabled = false;
    D.inOriginYaw.disabled = false;
  }

  function updateMetaWarn() {
    if (!S.loaded) { D.metaWarn.classList.add('hidden'); return; }
    var msgs = [];
    if (S.negateConverted) {
      msgs.push('原图 negate=1，已归一化为标准灰度；导出时写入 negate: 0。');
    }
    if (S.meta.free_thresh > 0.19608) {
      msgs.push('free_thresh=' + fmtNum(S.meta.free_thresh) +
        '：205 会被当作自由，不能阻挡；请用“障碍”。');
    }
    if (S.meta.mode && S.meta.mode !== 'trinary') {
      msgs.push('YAML mode = ' + S.meta.mode + '，编辑器按 trinary 语义查看与编辑。');
    }
    if (msgs.length) {
      D.metaWarnText.textContent = msgs.join(' ');
      D.metaWarn.classList.remove('hidden');
    } else {
      D.metaWarn.classList.add('hidden');
    }
  }

  /* ------------------------------------------------------------ 打开地图 */

  async function loadPGM(buf, name, yamlText, source) {
    if (!confirmDiscard()) return;
    showBusy('正在解析 ' + name + ' …');
    await delay(20);
    try {
      var pgm = C.parsePGM(buf);
      var meta = yamlText ? C.parseYAML(yamlText) : defaultMeta();
      applyMap(pgm, meta, name, source, !!yamlText);
      closeDialog(D.openDlg);
      if (!yamlText) {
        toast('未找到配套 YAML，分辨率与原点使用默认值，请在右侧修改。', 'warn', 5600);
      }
    } catch (err) {
      toastError('打开失败：' + (err && err.message ? err.message : err), 7000);
    } finally {
      hideBusy();
    }
  }

  function defaultMeta() {
    return {
      image: null,
      mode: 'trinary',
      resolution: 0.05,
      origin: [0, 0, 0],
      negate: 0,
      occupied_thresh: 0.65,
      free_thresh: 0.196
    };
  }

  function normalizeMeta(raw) {
    raw = raw || {};
    var m = {
      image: raw.image || null,
      mode: raw.mode || 'trinary',
      resolution: Number(raw.resolution),
      origin: Array.isArray(raw.origin) ? raw.origin.map(Number) : [0, 0, 0],
      negate: raw.negate ? 1 : 0,
      occupied_thresh: Number(raw.occupied_thresh),
      free_thresh: Number(raw.free_thresh)
    };
    if (!(m.resolution > 0)) m.resolution = 0.05;
    if (m.origin.length < 3 || m.origin.some(function (v) { return !isFinite(v); })) m.origin = [0, 0, 0];
    if (!(m.occupied_thresh > 0 && m.occupied_thresh < 1)) m.occupied_thresh = 0.65;
    if (!(m.free_thresh >= 0 && m.free_thresh < 1)) m.free_thresh = 0.196;
    return m;
  }

  function deNegate(data, meta) {
    var out = new Uint8Array(data.length);
    var ot = meta.occupied_thresh;
    var ft = meta.free_thresh;
    for (var i = 0; i < data.length; i++) {
      var occ = data[i] / 255;
      out[i] = occ > ot ? OCC : (occ < ft ? FREE : UNK);
    }
    return out;
  }

  function applyMap(pgm, meta, fileName, source, yamlLoaded) {
    if (!pgm || !pgm.width || !pgm.height) throw new Error('地图数据为空');
    var w = pgm.width, h = pgm.height;
    if (w * h > 120000000) throw new Error('地图过大，超出浏览器画布处理能力');

    meta = normalizeMeta(meta);
    var data = pgm.data;
    var negated = false;
    if (meta.negate) {
      data = deNegate(data, meta);
      meta.negate = 0;
      negated = true;
    }

    S.w = w;
    S.h = h;
    S.data = data;
    S.original = data.slice();
    S.mask = new Uint8Array(w * h);
    S.meta = meta;
    S.fileName = /\.pgm$/i.test(fileName) ? fileName : (fileName + '.pgm');
    S.baseName = S.fileName.replace(/\.pgm$/i, '');
    S.yamlLoaded = !!yamlLoaded;
    S.yamlDirty = false;
    S.negateConverted = negated;
    S.sourceFormat = pgm.format || 'P5';
    S.sourceMaxval = pgm.maxval || 255;
    S.source = source || null;
    S.handle = (source && source.handle) || null;
    S.loaded = true;
    S.dirty = false;
    S.undo = [];
    S.redo = [];
    curStroke = null;
    polyPoints = [];
    polyCursor = null;
    dragPreview = null;
    dragActive = false;
    lastPaint = null;

    baseCanvas.width = w;
    baseCanvas.height = h;
    maskCanvas.width = w;
    maskCanvas.height = h;
    baseCtx = baseCanvas.getContext('2d');
    maskCtx = maskCanvas.getContext('2d');
    fullBase = true;
    fullMask = true;
    dirtyBase = null;
    dirtyMask = null;

    D.emptyState.classList.add('hidden');
    syncToolUI();
    syncMetaInputs();
    updateMetaWarn();
    syncDisplayUI();
    updateMinimapSize();
    updateUndoButtons();
    updateStats();
    fitView();
    refreshChrome();
    requestRender();
    render();

    if (negated) toast('检测到 negate=1，已转换为标准灰度，导出时写为 negate: 0。', 'warn', 5200);
  }

  function confirmDiscard() {
    if (!S.dirty) return true;
    return window.confirm('当前地图有未保存的修改，确定要放弃吗？');
  }

  /* ------------------------------------------------------------ 本地打开 */

  async function openLocalPicker() {
    D.openDlg.close();
    if (window.showOpenFilePicker) {
      try {
        var handles = await window.showOpenFilePicker({
          multiple: true,
          excludeAcceptAllOption: false,
          types: [
            { description: 'PGM 地图', accept: { 'image/x-portable-graymap': ['.pgm'] } },
            { description: 'YAML 元数据', accept: { 'application/x-yaml': ['.yaml', '.yml'] } }
          ]
        });
        var entries = [];
        for (var i = 0; i < handles.length; i++) {
          entries.push({ file: await handles[i].getFile(), handle: handles[i] });
        }
        await openEntries(entries);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        // file:// 或其他受限环境：回退到 input
      }
    }
    D.fileInput.value = '';
    D.fileInput.click();
  }

  async function openEntries(entries) {
    var pgm = null, yaml = null;
    for (var i = 0; i < entries.length; i++) {
      if (/\.pgm$/i.test(entries[i].file.name)) { pgm = entries[i]; break; }
    }
    if (!pgm) {
      toastError('请选择 .pgm 地图文件（可同时选择同名 .yaml）');
      return;
    }
    var base = pgm.file.name.replace(/\.pgm$/i, '').toLowerCase();
    for (var j = 0; j < entries.length; j++) {
      var nm = entries[j].file.name;
      if (/\.ya?ml$/i.test(nm) && nm.replace(/\.ya?ml$/i, '').toLowerCase() === base) {
        yaml = entries[j];
        break;
      }
    }
    if (!yaml) {
      var proceed = await askMissingYaml(pgm.file.name);
      if (!proceed) return;
    }
    try {
      var buf = await pgm.file.arrayBuffer();
      var yamlText = yaml ? await yaml.file.text() : null;
      await loadPGM(buf, pgm.file.name, yamlText, {
        kind: 'local',
        handle: pgm.handle || null
      });
    } catch (err) {
      toastError('读取文件失败：' + (err && err.message ? err.message : err));
    }
  }

  async function handleFileInput() {
    var files = Array.prototype.slice.call(D.fileInput.files || []);
    var entries = files.map(function (f) { return { file: f, handle: null }; });
    await openEntries(entries);
  }

  async function handleDrop(e) {
    e.preventDefault();
    D.dropVeil.classList.add('hidden');
    var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
    if (!files.length) return;
    var entries = files.map(function (f) { return { file: f, handle: null }; });
    await openEntries(entries);
  }

  /* -------------------------------------------------------------- 示例地图 */

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function makeDemoMap() {
    var w = 960, h = 640;
    var d = new Uint8Array(w * h).fill(FREE);
    var rnd = mulberry32(20260518);

    function rect(x, y, ww, hh, v) {
      var x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
      var x1 = Math.min(w, (x + ww) | 0), y1 = Math.min(h, (y + hh) | 0);
      for (var yy = y0; yy < y1; yy++) {
        var row = yy * w;
        for (var xx = x0; xx < x1; xx++) d[row + xx] = v;
      }
    }

    // 外墙
    rect(26, 26, w - 52, 9, OCC);
    rect(26, h - 35, w - 52, 9, OCC);
    rect(26, 26, 9, h - 52, OCC);
    rect(w - 35, 26, 9, h - 52, OCC);
    // 门洞
    rect(150, 26, 46, 9, FREE);
    rect(w - 200, h - 35, 52, 9, FREE);

    // 内部隔墙
    rect(500, 26, 8, 205, OCC);
    rect(500, 300, 8, 205, OCC);
    rect(500, 505, 8, 110, OCC);
    rect(26, 330, 210, 8, OCC);
    rect(330, 330, 120, 8, OCC);
    rect(700, 200, 225, 8, OCC);
    rect(700, 200, 8, 180, OCC);
    // 一处 1px 墙缝，便于测试“闭运算”
    rect(750, 200, 2, 8, FREE);

    // 房间内的障碍物 / 家具
    rect(80, 80, 120, 44, OCC);
    rect(80, 150, 54, 120, OCC);
    rect(250, 90, 60, 60, OCC);
    rect(250, 210, 160, 26, OCC);
    rect(560, 70, 90, 70, OCC);
    rect(800, 70, 70, 90, OCC);
    rect(600, 380, 140, 40, OCC);
    rect(600, 460, 40, 100, OCC);
    rect(780, 380, 100, 120, OCC);
    rect(70, 400, 90, 70, OCC);
    rect(220, 430, 46, 46, OCC);
    rect(120, 520, 140, 30, OCC);

    // 未探索区域
    rect(560, 250, 80, 56, UNK);
    rect(860, 300, 60, 40, UNK);
    for (var u = 0; u < 24; u++) {
      var ux = 560 + Math.floor(rnd() * 78);
      var uy = 250 + Math.floor(rnd() * 54);
      if (rnd() < 0.5) d[uy * w + ux] = FREE;
    }

    // 零散噪点（用于测试“移除小障碍”）
    for (var i = 0; i < 110; i++) {
      var x = 60 + Math.floor(rnd() * (w - 120));
      var y = 60 + Math.floor(rnd() * (h - 120));
      if (d[y * w + x] !== FREE) continue;
      var sw = 1 + (rnd() < 0.45 ? 1 : 0);
      var sh = 1 + (rnd() < 0.45 ? 1 : 0);
      rect(x, y, sw, sh, OCC);
    }

    // 一条斜向摆放的长椅
    for (var t = 0; t < 60; t++) {
      rect(420 + t, 470 + Math.floor(t * 0.6), 3, 3, OCC);
    }

    return {
      width: w,
      height: h,
      maxval: 255,
      format: 'P5',
      data: d,
      meta: {
        image: 'demo_map.pgm',
        mode: 'trinary',
        resolution: 0.05,
        origin: [-(w * 0.05) / 2, -(h * 0.05) / 2, 0],
        negate: 0,
        occupied_thresh: 0.65,
        free_thresh: 0.196
      }
    };
  }

  function loadDemo(silent) {
    if (!silent && !confirmDiscard()) return;
    var demo = makeDemoMap();
    applyMap(demo, demo.meta, 'demo_map.pgm', null, false);
    S.dirty = false;
    refreshChrome();
    updateStats();
    toast('已载入示例地图，可直接试用画笔、多边形和批量修复。', 'ok', 4200);
  }

  /* ---------------------------------------------------------------- 保存 */

  function dirOf(name) {
    var str = String(name || '').replace(/\\/g, '/');
    var i = str.lastIndexOf('/');
    return i >= 0 ? str.slice(0, i + 1) : '';
  }

  function makePGMBlob() {
    return new Blob([C.encodePGM(S.w, S.h, S.data)], { type: 'application/octet-stream' });
  }

  function makeMaskBytes() {
    var n = S.w * S.h;
    var md = new Uint8Array(n);
    for (var i = 0; i < n; i++) md[i] = S.mask[i] ? OCC : FREE;
    return C.encodePGM(S.w, S.h, md);
  }

  function maskMeta() {
    return {
      mode: 'trinary',
      resolution: S.meta.resolution,
      origin: S.meta.origin.slice(),
      negate: 0,
      occupied_thresh: 0.65,
      free_thresh: 0.196
    };
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function downloadText(text, name) {
    downloadBlob(new Blob([text], { type: 'text/yaml;charset=utf-8' }), name);
  }

  async function postFile(name, bytes) {
    var r = await fetch('api/save?name=' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes
    });
    var j = null;
    try { j = await r.json(); } catch (e) { /* ignore */ }
    if (!r.ok || !j || !j.ok) {
      throw new Error((j && j.error) || ('HTTP ' + r.status));
    }
    return j;
  }

  function markSaved() {
    S.dirty = false;
    S.yamlDirty = false;
    S.yamlLoaded = true;
    S.original = S.data.slice();
    if (S.showDiff) fullBase = true;
    refreshChrome();
    scheduleStats();
    requestRender();
  }

  async function saveDirect() {
    if (!S.loaded) return;
    endStroke();
    var bytes = C.encodePGM(S.w, S.h, S.data);
    var yamlText = C.buildYAML(S.meta, MAP_FILE);

    if (S.source && S.source.kind === 'server' && S.server) {
      var dir = dirOf(S.fileName);
      var target = dir + MAP_FILE;
      showBusy('正在保存到服务器…');
      try {
        await postFile(target, bytes);
        await postFile(dir + MAP_YAML, new TextEncoder().encode(yamlText));
        S.fileName = target;
        S.baseName = 'map';
        S.source = { kind: 'server', name: target };
        S.handle = null;
        markSaved();
        syncMetaInputs();
        toastOk('已保存 map.pgm + map.yaml 到 ' + S.server.dir + '/' + dir);
      } catch (err) {
        toastError('保存失败：' + (err && err.message ? err.message : err), 7000);
      } finally {
        hideBusy();
      }
      return;
    }

    downloadBlob(makePGMBlob(), MAP_FILE);
    downloadText(yamlText, MAP_YAML);
    S.fileName = MAP_FILE;
    S.baseName = 'map';
    S.source = { kind: 'local', handle: null };
    S.handle = null;
    markSaved();
    syncMetaInputs();
    toastOk('已下载 map.pgm + map.yaml');
  }

  function openSaveDialog() {
    if (!S.loaded) return;
    var hasMask = maskHasPixels();
    D.chkSaveMask.checked = hasMask;
    D.chkSaveMask.disabled = !hasMask;
    var hasServer = !!(S.server && S.server.ok);
    D.saveTargetServer.classList.toggle('hidden', !hasServer);
    var isServer = !!(S.source && S.source.kind === 'server');
    var dir = isServer ? dirOf(S.fileName) : '';
    if (hasServer) {
      D.saveTargetServer.querySelector('input').checked = isServer;
      D.saveTargetRow.querySelector('input[value="local"]').checked = !isServer;
      D.saveServerDirHint.textContent = '目录：' + S.server.dir + '/' + dir;
    } else {
      D.saveTargetRow.querySelector('input[value="local"]').checked = true;
    }
    D.saveNote.textContent = hasServer
      ? '服务器模式会写入 map.pgm + map.yaml，并自动保留时间戳备份；下载模式会下载两个文件。'
      : '本机会下载 map.pgm + map.yaml 两个文件；若浏览器询问，请允许下载多个文件。';
    showDialog(D.saveDlg);
  }

  async function confirmSaveAs() {
    if (!S.loaded) return;
    var includeMask = D.chkSaveMask.checked && maskHasPixels();
    var targetEl = D.saveTargetRow.querySelector('input[name="saveTarget"]:checked');
    var target = targetEl ? targetEl.value : 'local';
    var bytes = C.encodePGM(S.w, S.h, S.data);
    var yamlText = C.buildYAML(S.meta, MAP_FILE);

    if (target === 'server' && S.server && S.server.ok) {
      var dir = (S.source && S.source.kind === 'server') ? dirOf(S.fileName) : '';
      var targetName = dir + MAP_FILE;
      showBusy('正在导出到服务器…');
      try {
        await postFile(targetName, bytes);
        await postFile(dir + MAP_YAML, new TextEncoder().encode(yamlText));
        if (includeMask) {
          await postFile(dir + MASK_FILE, makeMaskBytes());
          await postFile(dir + MASK_YAML, new TextEncoder().encode(C.buildYAML(maskMeta(), MASK_FILE)));
        }
        S.fileName = targetName;
        S.baseName = 'map';
        S.source = { kind: 'server', name: targetName };
        S.handle = null;
        markSaved();
        syncMetaInputs();
        updateStats();
        closeDialog(D.saveDlg);
        toastOk('已导出 map.pgm + map.yaml 到 ' + S.server.dir + '/' + dir);
      } catch (err) {
        closeDialog(D.saveDlg);
        toastError('导出失败：' + (err && err.message ? err.message : err), 7000);
      } finally {
        hideBusy();
      }
      return;
    }

    downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), MAP_FILE);
    downloadText(yamlText, MAP_YAML);
    if (includeMask) {
      downloadBlob(new Blob([makeMaskBytes()], { type: 'application/octet-stream' }), MASK_FILE);
      downloadText(C.buildYAML(maskMeta(), MASK_FILE), MASK_YAML);
    }
    S.fileName = MAP_FILE;
    S.baseName = 'map';
    S.source = { kind: 'local', handle: null };
    S.handle = null;
    markSaved();
    syncMetaInputs();
    updateStats();
    closeDialog(D.saveDlg);
    toastOk('已导出 map.pgm + map.yaml' + (includeMask ? ' + 禁行区掩膜' : ''));
  }

  async function exportMask() {
    if (!S.loaded || !maskHasPixels()) { toast('禁行区为空'); return; }
    if (S.server && S.source && S.source.kind === 'server') {
      var dir = dirOf(S.fileName);
      showBusy('正在保存掩膜到服务器…');
      try {
        await postFile(dir + MASK_FILE, makeMaskBytes());
        await postFile(dir + MASK_YAML, new TextEncoder().encode(C.buildYAML(maskMeta(), MASK_FILE)));
        toastOk('掩膜已保存到 ' + S.server.dir + '/' + dir + MASK_FILE);
      } catch (err) {
        toastError('保存掩膜失败：' + (err && err.message ? err.message : err));
      } finally {
        hideBusy();
      }
      return;
    }
    downloadBlob(new Blob([makeMaskBytes()], { type: 'application/octet-stream' }), MASK_FILE);
    downloadText(C.buildYAML(maskMeta(), MASK_FILE), MASK_YAML);
    toastOk('已下载 map_keepout.pgm + map_keepout.yaml');
  }

  function askMissingYaml(fileName) {
    D.pairFileName.textContent = fileName || 'map.pgm';
    return new Promise(function (resolve) {
      pairResolver = resolve;
      showDialog(D.pairDlg);
    });
  }

  function finishPair(ok) {
    var resolve = pairResolver;
    pairResolver = null;
    closeDialog(D.pairDlg);
    if (resolve) resolve(ok);
  }

  /* -------------------------------------------------------------- 服务器 */

  async function probeServer() {
    try {
      var r = await fetch('api/info', { cache: 'no-store' });
      if (!r.ok) return;
      var info = await r.json();
      if (!info || !info.ok) return;
      S.server = info;
      D.tabServer.classList.remove('hidden');
      D.saveTargetServer.classList.remove('hidden');
      D.saveTargetServer.querySelector('input').disabled = false;
      D.serverDir.textContent = info.dir;
      var params = new URLSearchParams(location.search);
      var openName = params.get('open');
      if (openName && !S.loaded) {
        await loadFromServer(openName, true);
      }
    } catch (err) {
      // 直接以 file:// 打开，或使用其他静态服务器：没有 API，忽略
    }
  }

  async function refreshServerList() {
    try {
      var r = await fetch('api/info', { cache: 'no-store' });
      var info = await r.json();
      if (!info || !info.ok) throw new Error('无效响应');
      S.server = info;
      D.serverDir.textContent = info.dir;
      renderServerList(info.files || []);
    } catch (err) {
      D.serverFileList.innerHTML = '<div class="empty-list"></div>';
      D.serverFileList.firstChild.textContent =
        '无法读取服务器目录：' + (err && err.message ? err.message : err);
    }
  }

  function renderServerList(files) {
    D.serverFileList.innerHTML = '';
    if (!files.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-list';
      empty.textContent = '目录下没有 .pgm 地图文件';
      D.serverFileList.appendChild(empty);
      return;
    }
    files.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML =
        '<div class="fi"><svg><use href="#i-file"/></svg></div>' +
        '<div class="fn"><b></b><span></span></div>' +
        '<span class="badge"></span>';
      row.querySelector('b').textContent = f.name;
      row.querySelector('.fn span').textContent = fmtBytes(f.size) + ' · ' + (f.mtime || '');
      var badge = row.querySelector('.badge');
      if (f.has_yaml) { badge.textContent = 'YAML'; badge.classList.add('has'); }
      else badge.textContent = '仅 PGM';
      row.addEventListener('click', function () { loadFromServer(f.name, false); });
      D.serverFileList.appendChild(row);
    });
  }

  function fmtBytes(n) {
    if (!n && n !== 0) return '—';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  async function loadFromServer(name, isStartup) {
    if (!isStartup && !confirmDiscard()) return;
    showBusy('正在从开发板载入 ' + name + ' …');
    await delay(20);
    try {
      var rr = await fetch('api/file?name=' + encodeURIComponent(name));
      if (!rr.ok) throw new Error('服务器返回 HTTP ' + rr.status);
      var buf = await rr.arrayBuffer();
      var base = name.replace(/\.pgm$/i, '');
      var yamlText = null;
      var exts = ['yaml', 'yml'];
      for (var i = 0; i < exts.length; i++) {
        var yr = await fetch('api/file?name=' + encodeURIComponent(base + '.' + exts[i]));
        if (yr.ok) { yamlText = await yr.text(); break; }
      }
      var pgm = C.parsePGM(buf);
      var meta = yamlText ? C.parseYAML(yamlText) : defaultMeta();
      applyMap(pgm, meta, name, { kind: 'server', name: name }, !!yamlText);
      closeDialog(D.openDlg);
      if (!isStartup) toastOk('已载入 ' + name);
      if (!yamlText) toast('未找到配套 YAML，分辨率和原点使用默认值。', 'warn', 5200);
    } catch (err) {
      closeDialog(D.openDlg);
      toastError('载入失败：' + (err && err.message ? err.message : err), 7000);
    } finally {
      hideBusy();
    }
  }

  /* ------------------------------------------------------------ 辅助 UI */

  function toast(msg, kind, ms) {
    kind = kind || 'ok';
    ms = ms || 3200;
    var icons = { ok: '#i-check', err: '#i-x', warn: '#i-warn' };
    var t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.innerHTML = '<svg><use href="' + (icons[kind] || icons.ok) + '"/></svg><span></span>';
    t.querySelector('span').textContent = msg;
    D.toasts.appendChild(t);
    while (D.toasts.children.length > 4) D.toasts.removeChild(D.toasts.firstChild);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 220);
    }, ms);
  }

  function toastOk(msg, ms) { toast(msg, 'ok', ms); }
  function toastError(msg, ms) { toast(msg, 'err', ms || 6500); }

  function showBusy(text) {
    D.busyText.textContent = text || '处理中…';
    D.busy.classList.remove('hidden');
  }

  function hideBusy() {
    D.busy.classList.add('hidden');
  }

  function delay(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  function anyDialogOpen() {
    return !!document.querySelector('dialog[open]');
  }

  function showDialog(dlg) {
    if (dlg && !dlg.open) dlg.showModal();
  }

  function closeDialog(dlg) {
    if (dlg && dlg.open) dlg.close();
  }

  function isTyping(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  /* -------------------------------------------------------------- 事件绑定 */

  function bindEvents() {
    // 顶栏
    D.btnOpen.addEventListener('click', function () {
      showDialog(D.openDlg);
      if (S.server) renderServerList((S.server.files || []));
    });
    D.emptyOpen.addEventListener('click', function () {
      showDialog(D.openDlg);
    });
    D.emptyDemo.addEventListener('click', function () { loadDemo(false); });
    D.btnSave.addEventListener('click', saveDirect);
    D.btnSaveAs.addEventListener('click', openSaveDialog);
    D.btnUndo.addEventListener('click', undo);
    D.btnRedo.addEventListener('click', redo);
    D.btnFit.addEventListener('click', fitView);
    D.btnHelp.addEventListener('click', function () { showDialog(D.helpDlg); });
    D.btnTheme.addEventListener('click', function () {
      applyTheme(theme === 'dark' ? 'light' : 'dark', false);
    });

    // 工具栏
    D.toolBar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tool]');
      if (!btn) return;
      setTool(btn.dataset.tool);
    });

    // 显示
    D.displaySeg.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-display]');
      if (!btn) return;
      S.display = btn.dataset.display;
      syncDisplayUI();
      fullBase = true;
      requestRender();
    });
    D.chkDiff.addEventListener('change', function () {
      S.showDiff = D.chkDiff.checked;
      fullBase = true;
      requestRender();
      scheduleStats();
    });
    D.chkMask.addEventListener('change', function () {
      S.showMask = D.chkMask.checked;
      requestRender();
    });

    // 图层 / 数值
    D.layerSeg.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-layer]');
      if (!btn) return;
      endStroke();
      S.layer = btn.dataset.layer;
      syncLayerUI();
      requestRender();
    });
    D.valueSeg.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-value]');
      if (!btn || btn.disabled) return;
      S.paint = Number(btn.dataset.value);
      D.valueSeg.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      requestRender();
    });

    // 笔刷
    D.brushSize.addEventListener('input', function () {
      S.brushSize = Number(D.brushSize.value);
      D.brushSizeOut.textContent = S.brushSize;
      requestRender();
    });
    D.shapeSeg.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-shape]');
      if (!btn) return;
      S.brushShape = btn.dataset.shape;
      D.shapeSeg.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      requestRender();
    });
    D.lineWidth.addEventListener('input', function () {
      S.lineWidth = Number(D.lineWidth.value);
      D.lineWidthOut.textContent = S.lineWidth;
    });
    D.chkRectFill.addEventListener('change', function () {
      S.rectFill = D.chkRectFill.checked;
    });
    D.tolerance.addEventListener('input', function () {
      S.tolerance = Number(D.tolerance.value);
      D.toleranceOut.textContent = S.tolerance;
    });

    // 元数据
    [D.inResolution, D.inOriginX, D.inOriginY, D.inOriginYaw].forEach(function (inp) {
      inp.addEventListener('input', onMetaInput);
      inp.addEventListener('change', onMetaInput);
    });

    // 批量修复
    D.btnRemoveSmall.addEventListener('click', function () {
      if (!S.loaded) return;
      var min = Math.max(2, parseInt(D.minBlob.value, 10) || 30);
      var res = bulkEdit('map', '移除小障碍', function () {
        return C.removeSmallObstacles(S.data, S.w, S.h, min, FREE, getScratch());
      });
      if (res) toastOk('已移除 ' + (res.components || 0) + ' 个小障碍（' + (res.changed || 0) + ' px）');
    });
    D.btnDilate.addEventListener('click', function () { morph('dilate', '膨胀'); });
    D.btnErode.addEventListener('click', function () { morph('erode', '腐蚀'); });
    D.btnClose.addEventListener('click', function () { morph('close', '闭运算'); });

    // 禁行区
    D.btnMaskClear.addEventListener('click', function () {
      if (!S.loaded || !maskHasPixels()) return;
      bulkEdit('keepout', '清空禁行区', function () {
        S.mask.fill(0);
        return {};
      });
      fullMask = true;
      requestRender();
      scheduleStats();
      toast('禁行区已清空');
    });
    D.btnMaskToOcc.addEventListener('click', function () { bakeMask(OCC); });
    D.btnMaskToUnk.addEventListener('click', function () { bakeMask(UNK); });
    D.btnMaskExport.addEventListener('click', exportMask);

    // 缩放
    D.zoomIn.addEventListener('click', function () { zoomAt(viewW / 2, viewH / 2, 1.25); });
    D.zoomOut.addEventListener('click', function () { zoomAt(viewW / 2, viewH / 2, 0.8); });
    D.zoomFit.addEventListener('click', fitView);

    // 画布
    viewCanvas.addEventListener('pointerdown', onPointerDown);
    viewCanvas.addEventListener('pointermove', onPointerMove);
    viewCanvas.addEventListener('pointerup', onPointerUp);
    viewCanvas.addEventListener('pointercancel', onPointerUp);
    viewCanvas.addEventListener('pointerleave', onPointerLeave);
    viewCanvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    viewCanvas.addEventListener('wheel', onWheel, { passive: false });
    viewCanvas.addEventListener('dblclick', function (e) {
      if (!S.loaded) return;
      if (S.tool === 'polygon' && polyPoints.length >= 3) {
        e.preventDefault();
        finishPolygon();
      }
    });

    // 小地图
    D.miniWrap.addEventListener('pointerdown', function (e) {
      miniDrag = true;
      try { D.miniWrap.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      minimapCenter(e);
    });
    D.miniWrap.addEventListener('pointermove', function (e) {
      if (miniDrag) minimapCenter(e);
    });
    D.miniWrap.addEventListener('pointerup', function () { miniDrag = false; });
    D.miniWrap.addEventListener('pointercancel', function () { miniDrag = false; });
    D.miniWrap.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // 打开对话框
    D.openTabs.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tab]');
      if (!btn) return;
      openTab(btn.dataset.tab);
    });
    D.btnPickLocal.addEventListener('click', openLocalPicker);
    D.btnServerRefresh.addEventListener('click', refreshServerList);
    D.fileInput.addEventListener('change', handleFileInput);
    document.querySelectorAll('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var dlg = document.getElementById(btn.dataset.close);
        if (dlg && dlg.open) dlg.close();
      });
    });

    // 保存对话框
    D.btnSaveConfirm.addEventListener('click', confirmSaveAs);

    // PGM / YAML 配对提示
    D.pairContinue.addEventListener('click', function () { finishPair(true); });
    D.pairRetry.addEventListener('click', function () {
      finishPair(false);
      setTimeout(openLocalPicker, 30);
    });
    D.pairDlg.addEventListener('close', function () {
      if (pairResolver) {
        var resolve = pairResolver;
        pairResolver = null;
        resolve(false);
      }
    });

    // 拖放
    window.addEventListener('dragover', function (e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      D.dropVeil.classList.remove('hidden');
    });
    window.addEventListener('dragleave', function (e) {
      if (e.relatedTarget === null) D.dropVeil.classList.add('hidden');
    });
    window.addEventListener('drop', handleDrop);

    // 键盘
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', function (e) {
      if (e.code === 'Space') {
        P.space = false;
        updateCursorClass();
      }
    });

    window.addEventListener('blur', function () {
      if (curStroke) endStroke();
      P.space = false;
      P.down = false;
      P.panning = false;
      updateCursorClass();
    });

    // 离开提示
    window.addEventListener('beforeunload', function (e) {
      if (S.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    window.addEventListener('error', function (e) {
      if (e && e.message) toastError('脚本错误：' + e.message, 8000);
    });
    window.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason;
      toastError('操作失败：' + (r && r.message ? r.message : r), 8000);
    });
  }

  function onMetaInput() {
    if (!S.loaded) return;
    var res = parseFloat(D.inResolution.value);
    var x = parseFloat(D.inOriginX.value);
    var y = parseFloat(D.inOriginY.value);
    var yaw = parseFloat(D.inOriginYaw.value);
    if (isFinite(res) && res > 0) S.meta.resolution = res;
    if (isFinite(x)) S.meta.origin[0] = x;
    if (isFinite(y)) S.meta.origin[1] = y;
    if (isFinite(yaw)) S.meta.origin[2] = yaw;
    S.yamlDirty = true;
    S.dirty = true;
    refreshChrome();
    updateMetaWarn();
    requestRender();
  }

  function morph(op, label) {
    if (!S.loaded) return;
    var r = Math.max(1, Math.min(40, parseInt(D.morphRadius.value, 10) || 2));
    var res = bulkEdit('map', label, function () {
      return C.morphology(S.data, S.w, S.h, op, r);
    });
    if (res) toastOk(label + '完成：' + (res.changed || 0) + ' px');
  }

  function bakeMask(value) {
    if (!S.loaded || !maskHasPixels()) return;
    var res = bulkEdit('map', '禁行区写回地图', function () {
      var d = S.data, m = S.mask, n = 0;
      for (var i = 0; i < d.length; i++) {
        if (m[i] && d[i] !== value) { d[i] = value; n++; }
      }
      return { changed: n };
    });
    if (res) {
      toastOk('已把禁行区写为' + (value === OCC ? '障碍' : '未知') + '：' + (res.changed || 0) + ' px');
      if (value === UNK && S.meta.free_thresh > 0.19608) {
        toast('注意：当前 free_thresh 让 205 被 Nav2 视为自由，不会阻挡通行。', 'warn', 6000);
      }
    }
  }

  function setTool(tool) {
    if (S.tool === tool) return;
    endStroke();
    dragPreview = null;
    dragActive = false;
    if (tool !== 'polygon') { polyPoints = []; polyCursor = null; }
    S.tool = tool;
    syncToolUI();
    requestRender();
  }

  function openTab(tab) {
    D.openTabs.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    D.openLocalPane.classList.toggle('hidden', tab !== 'local');
    D.openServerPane.classList.toggle('hidden', tab !== 'server');
    if (tab === 'server') refreshServerList();
  }

  function onWheel(e) {
    if (!S.loaded) return;
    e.preventDefault();
    var pos = getPos(e);
    var dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= 100;
    var factor = Math.exp(-dy * 0.0015);
    if (e.shiftKey && !e.ctrlKey) {
      S.view.ox -= dy * 0.7;
      requestRender();
      return;
    }
    zoomAt(pos.x, pos.y, factor);
  }

  function onKeyDown(e) {
    var typing = isTyping(e.target);
    var mod = e.ctrlKey || e.metaKey;

    if (mod && !e.altKey) {
      var k = (e.key || '').toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (k === 'y') { e.preventDefault(); redo(); return; }
      if (k === 's') {
        e.preventDefault();
        if (e.shiftKey) openSaveDialog(); else saveDirect();
        return;
      }
      if (k === 'o') { e.preventDefault(); showDialog(D.openDlg); return; }
    }

    if (typing || anyDialogOpen()) return;
    if (mod || e.altKey) return;

    if (e.code === 'Space') {
      e.preventDefault();
      P.space = true;
      updateCursorClass();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelInteractions();
      return;
    }
    if (e.key === 'Enter' && S.tool === 'polygon' && polyPoints.length >= 3) {
      e.preventDefault();
      finishPolygon();
      return;
    }
    if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      S.brushSize = Math.max(1, Math.min(120, S.brushSize + (e.key === ']' ? 2 : -2)));
      D.brushSize.value = String(S.brushSize);
      D.brushSizeOut.textContent = S.brushSize;
      requestRender();
      return;
    }
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      var val = e.key === '1' ? OCC : e.key === '2' ? FREE : UNK;
      if (S.layer === 'keepout') return;
      S.paint = val;
      D.valueSeg.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', Number(b.dataset.value) === val);
      });
      return;
    }
    if (e.key === '?') {
      e.preventDefault();
      showDialog(D.helpDlg);
      return;
    }

    var key = (e.key || '').toLowerCase();
    var tools = { h: 'pan', b: 'brush', e: 'eraser', l: 'line', r: 'rect', p: 'polygon', g: 'fill' };
    if (tools[key]) { setTool(tools[key]); return; }
    if (key === 'f') { fitView(); return; }
  }

  /* -------------------------------------------------------------- 自动化 API
   * 供脚本 / 控制台使用。loadBuffer 是同步的，便于无头浏览器截图与集成测试。 */

  window.Nav2MapEditor = {
    version: C.VERSION,
    loadBuffer: function (buffer, name, yamlText, options) {
      var pgm = C.parsePGM(buffer);
      var meta = yamlText ? C.parseYAML(yamlText) : defaultMeta();
      applyMap(pgm, meta, name || 'map.pgm', (options && options.source) || null, !!yamlText);
      if (!options || options.dirty !== true) {
        S.dirty = false;
        refreshChrome();
      }
      updateStats();
      return { width: S.w, height: S.h };
    },
    loadDemo: function () { loadDemo(true); },
    pixelAt: function (x, y) {
      if (!S.loaded || x < 0 || y < 0 || x >= S.w || y >= S.h) return null;
      return S.data[y * S.w + x];
    },
    pixelAtLayer: function (layer, x, y) {
      if (!S.loaded || x < 0 || y < 0 || x >= S.w || y >= S.h) return null;
      return layer === 'keepout' ? S.mask[y * S.w + x] : S.data[y * S.w + x];
    },
    mapToScreen: function (mx, my) { return toScreen(mx, my); },
    screenToMap: function (sx, sy) { return toMap(sx, sy); },
    getState: function () {
      return {
        loaded: S.loaded,
        width: S.w,
        height: S.h,
        fileName: S.fileName,
        dirty: S.dirty,
        scale: S.view.scale,
        undo: S.undo.length,
        redo: S.redo.length
      };
    },
    fit: fitView,
    render: render,
    refreshStats: updateStats
  };

})();
