/* ============================================================
   历史关联网 · 统一数据访问层（HNDB）
   ------------------------------------------------------------
   数据来源（自动降级）：
     1) 浏览器直接读取同目录 历史人物知识库.xlsx（需用静态服务器/站点访问）
     2) 读取失败时（如 file:// 双击打开）回退到 data/kb-data.js 快照
   全站页面只调用 HNDB.*，不再写死人物数据。
   ============================================================ */
(function () {
  "use strict";

  /* 12 列原始字段：英文键 ←→ 中文表头 */
  var KEYS = ["no", "name", "ziHao", "dynasty", "identity", "event",
              "work", "intro", "note", "sourceType", "stage", "sourceDetail"];
  var HEADERS = ["序号", "姓名", "字/号", "朝代/时期", "身份领域", "代表事件/成就",
                 "代表作品", "人物简介", "易错辨析/考点", "出处类型", "学段", "出处明细"];

  var ERA_ORDER = ["先秦", "秦汉", "三国两晋南北朝", "隋唐", "五代十国", "宋元",
                   "明清", "近现代", "当代", "外国古代", "外国近现代"];
  var STAGE_ORDER = ["小学", "初中", "高中"];

  var EDIT_KEY = "hn_kb_edits_v1";   // 网页端修改（落 localStorage）
  var XLSX_PATHS = ["历史人物知识库.xlsx"];   // 发布版：站点内相对路径
  var LORE_MAX = 3;                  // 每人最多自动关联几人
  var LORE_GROUP_MAX = 8;            // 同篇目人数过多则不连（避免噪声）

  /* ---------- 小工具 ---------- */
  function txt(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function blank(v) { var s = txt(v); return !s || s === "—" || s === "-" || s === "无"; }
  function uniq(a) { return Array.from(new Set(a)); }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- 字/号拆分（游戏维度用） ---------- */
  function parseZiHao(raw) {
    var s = txt(raw), out = { zi: "", hao: "" };
    if (blank(s)) return out;
    var mz = s.match(/字([^，,；;、\s]{1,4})/);
    if (mz) out.zi = mz[1];
    var mh = s.match(/(?:世称|号)([^，,；;]{1,12})/);
    if (mh) out.hao = mh[1].trim();
    return out;
  }

  /* ---------- 原始数据 → 统一记录 ---------- */
  function pickRaw(src, key, idx) {
    if (src[key] !== undefined && src[key] !== null) return src[key];
    var h = HEADERS[idx];
    return src[h] !== undefined && src[h] !== null ? src[h] : "";
  }

  function makeRecord(src) {
    var p = {};
    for (var i = 0; i < KEYS.length; i++) p[KEYS[i]] = txt(pickRaw(src, KEYS[i], i));
    var n = Number(p.no);
    p.no = isFinite(n) && n > 0 ? n : 0;
    refreshDerived(p);
    p.lore = [];
    return p;
  }

  /* 由原始字段派生游戏/统计用字段 */
  function refreshDerived(p) {
    var dyn = txt(p.dynasty);
    p.dyn = dyn;
    p.era = dyn;
    p.nation = /^外国/.test(dyn) ? "F" : "C";
    p.caliber = blank(p.ziHao) ? "" : txt(p.ziHao);
    var z = parseZiHao(p.ziHao);
    p.zi = z.zi;
    p.hao = z.hao;
  }

  /* ---------- 关联关系：同一篇课文/同一部名著的人物互相连线 ---------- */
  function buildLore(list) {
    var byTitle = {};
    list.forEach(function (p) {
      p.lore = [];
      var re = /《([^》]{1,25})》/g, m, titles = [];
      while ((m = re.exec(txt(p.sourceDetail))) !== null) {
        if (titles.indexOf(m[1]) < 0) titles.push(m[1]);
      }
      p.__titles = titles;
      titles.forEach(function (t) { (byTitle[t] = byTitle[t] || []).push(p); });
    });
    Object.keys(byTitle).forEach(function (t) {
      var g = byTitle[t];
      if (g.length < 2 || g.length > LORE_GROUP_MAX) return;
      g.forEach(function (p) {
        if (p.lore.length >= LORE_MAX) return;
        for (var i = 0; i < g.length && p.lore.length < LORE_MAX; i++) {
          var q = g[i];
          if (q === p) continue;
          if (p.lore.some(function (l) { return l.b === q.name; })) continue;
          p.lore.push({ b: q.name, text: "同见《" + t + "》" });
        }
      });
    });
    list.forEach(function (p) { delete p.__titles; });
  }

  /* ---------- 本地修改（localStorage 覆盖层） ---------- */
  function loadEdits() {
    try {
      var o = JSON.parse(localStorage.getItem(EDIT_KEY));
      if (!o || typeof o !== "object") o = {};
      o.edits = o.edits || {};
      o.adds = o.adds || [];
      o.removed = o.removed || [];
      return o;
    } catch (e) { return { edits: {}, adds: [], removed: [] }; }
  }
  function saveEdits(o) { localStorage.setItem(EDIT_KEY, JSON.stringify(o)); }

  /* ---------- 组装 ---------- */
  var DB = window.DB || (window.DB = []);   // shared.js 中声明的数组（保持引用不变）
  var state = { mode: "empty", count: 0, sourceMtime: "", generatedAt: "" };
  var rawCache = null;

  function applyOverlay(list) {
    var st = loadEdits();
    var byName = {};
    list.forEach(function (p) { byName[p.name] = p; });

    Object.keys(st.edits).forEach(function (n) {
      if (!byName[n]) return;
      var patch = st.edits[n] || {};
      KEYS.forEach(function (k) {
        if (patch[k] !== undefined && k !== "no") byName[n][k] = txt(patch[k]);
      });
      refreshDerived(byName[n]);
      byName[n].edited = true;
    });

    var maxNo = 0;
    list.forEach(function (p) { if (p.no > maxNo) maxNo = p.no; });

    var removed = {};
    st.removed.forEach(function (n) { removed[n] = true; });

    var out = list.filter(function (p) { return !removed[p.name]; });

    st.adds.forEach(function (a) {
      var p = makeRecord(a);
      p.no = maxNo + 1; maxNo += 1;
      p.added = true;
      if (!out.some(function (x) { return x.name === p.name; })) out.push(p);
    });

    return out;
  }

  function rebuild(rawList) {
    var list = rawList.map(makeRecord);
    list = applyOverlay(list);
    buildLore(list);
    list.sort(function (a, b) { return (a.no || 1e9) - (b.no || 1e9); });
    DB.length = 0;
    for (var i = 0; i < list.length; i++) DB.push(list[i]);
    state.count = DB.length;
  }

  /* ---------- 从 xlsx 读取 ---------- */
  function rowsFromWorkbook(wb) {
    var ws = wb.Sheets["教材人物总表"] || wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("工作表为空");
    var aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
    var hi = -1;
    for (var i = 0; i < aoa.length && i < 20; i++) {
      if (txt(aoa[i][1]) === "姓名") { hi = i; break; }
    }
    if (hi < 0) throw new Error("找不到表头行");
    var cols = {};
    aoa[hi].forEach(function (h, j) {
      var name = txt(h);
      if (HEADERS.indexOf(name) >= 0) cols[name] = j;
    });
    var rows = [];
    for (var r = hi + 1; r < aoa.length; r++) {
      var row = aoa[r];
      var name = txt(row[cols["姓名"]]);
      if (!name) continue;
      var o = {};
      for (var k = 0; k < KEYS.length; k++) o[KEYS[k]] = txt(row[cols[HEADERS[k]]]);
      rows.push(o);
    }
    if (!rows.length) throw new Error("未解析到人物数据");
    return rows;
  }

  function loadXlsx() {
    if (typeof window.XLSX === "undefined") return Promise.reject(new Error("SheetJS 未加载"));
    var i = 0;
    function next() {
      if (i >= XLSX_PATHS.length) return Promise.reject(new Error("xlsx 不可读"));
      var url = XLSX_PATHS[i++];
      return fetch(url, { cache: "no-store" })
        .then(function (resp) {
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          return resp.arrayBuffer();
        })
        .then(function (buf) {
          var wb = window.XLSX.read(buf, { type: "array" });
          return rowsFromWorkbook(wb);
        })
        .catch(function () { return next(); });
    }
    return next();
  }

  /* ---------- 初始化：先用快照（同步），再尝试 xlsx（异步） ---------- */
  var snapshot = window.HN_KB || null;
  if (snapshot && snapshot.people && snapshot.people.length) {
    rawCache = snapshot.people;
    state.mode = "snapshot";
    state.sourceMtime = snapshot.sourceMtime || "";
    state.generatedAt = snapshot.generatedAt || "";
    rebuild(rawCache);
  } else {
    rebuild([]);
  }

  var ready = Promise.resolve().then(function () {
    return loadXlsx().then(function (rows) {
      rawCache = rows;
      state.mode = "xlsx";
      state.count = rows.length;
      rebuild(rows);
      window.dispatchEvent(new CustomEvent("hn-db-updated", { detail: { mode: "xlsx" } }));
      return true;
    }).catch(function () {
      // file:// 或服务器未提供 xlsx：保持快照
      state.mode = state.mode === "xlsx" ? "xlsx" : "snapshot";
      return false;
    });
  });

  /* ---------- 查询 / 筛选 ---------- */
  function all(filters) {
    var f = filters || {};
    var r = DB.slice();
    if (f.stage) r = r.filter(function (p) { return p.stage.indexOf(f.stage) >= 0; });
    if (f.dynasty) r = r.filter(function (p) { return p.dyn === f.dynasty; });
    if (f.identity) r = r.filter(function (p) { return p.identity.indexOf(f.identity) >= 0; });
    if (f.sourceType) r = r.filter(function (p) { return p.sourceType.indexOf(f.sourceType) >= 0; });
    if (f.nation) r = r.filter(function (p) { return p.nation === f.nation; });
    if (f.keyword) {
      var k = txt(f.keyword);
      if (k) r = r.filter(function (p) {
        return [p.name, p.ziHao, p.dynasty, p.identity, p.event, p.work,
                p.intro, p.note, p.sourceType, p.stage, p.sourceDetail].join(" ").indexOf(k) >= 0;
      });
    }
    return r;
  }
  function get(name) {
    for (var i = 0; i < DB.length; i++) if (DB[i].name === name) return DB[i];
    return null;
  }
  function dynasties() {
    var present = uniq(DB.map(function (p) { return p.dyn; }));
    return ERA_ORDER.filter(function (e) { return present.indexOf(e) >= 0; })
      .concat(present.filter(function (e) { return ERA_ORDER.indexOf(e) < 0; }));
  }
  function stages() { return STAGE_ORDER.slice(); }
  function identities() {
    var m = {};
    DB.forEach(function (p) {
      txt(p.identity).split("、").forEach(function (x) {
        x = x.trim(); if (x) m[x] = (m[x] || 0) + 1;
      });
    });
    return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
  }
  function sources() {
    var m = {};
    DB.forEach(function (p) {
      txt(p.sourceType).split("、").forEach(function (x) {
        x = x.trim(); if (x) m[x] = (m[x] || 0) + 1;
      });
    });
    return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
  }

  /* ---------- 随机抽题：同批人物在各维度上不重复，避免一张牌对应两人 ---------- */
  function pick(pool, n, dims) {
    dims = dims || ["name"];
    var used = {}, out = [];
    shuffle(pool.slice()).forEach(function (p) {
      if (out.length >= n) return;
      var ok = dims.every(function (d) {
        var v = p[d];
        if (!v) return false;
        return !(used[d] && used[d][v]);
      });
      if (!ok) return;
      out.push(p);
      dims.forEach(function (d) { if (p[d]) (used[d] = used[d] || {})[p[d]] = true; });
    });
    if (out.length < n) {                      // 兜底：忽略重复约束补齐
      shuffle(pool.slice()).forEach(function (p) {
        if (out.length < n && out.indexOf(p) < 0) out.push(p);
      });
    }
    return out;
  }

  /* ---------- 统计 ---------- */
  function counts(getKeys) {
    var m = {};
    DB.forEach(function (p) {
      getKeys(p).forEach(function (k) {
        k = txt(k); if (k) m[k] = (m[k] || 0) + 1;
      });
    });
    return m;
  }
  function withPct(m, order) {
    var total = DB.length || 1;
    var arr = Object.keys(m).map(function (k) {
      return { k: k, c: m[k], pct: m[k] * 100 / total };
    });
    if (order) {
      arr.sort(function (a, b) { return order.indexOf(a.k) - order.indexOf(b.k); });
    } else {
      arr.sort(function (a, b) { return b.c - a.c; });
    }
    return arr;
  }
  function stats() {
    return {
      total: DB.length,
      stages: withPct(counts(function (p) { return p.stage.split("、"); }), STAGE_ORDER),
      dynasties: withPct(counts(function (p) { return [p.dyn]; }), dynasties()),
      sources: withPct(counts(function (p) { return p.sourceType.split("、"); })),
      identities: withPct(counts(function (p) { return p.identity.split("、"); }))
    };
  }

  /* ---------- 编辑 / 保存 ---------- */
  function saveEdit(name, patch) {
    var st = loadEdits();
    var base = st.edits[name] || {};
    KEYS.forEach(function (k) {
      if (patch[k] !== undefined && k !== "no") base[k] = txt(patch[k]);
    });
    st.edits[name] = base;
    saveEdits(st); state.edited = true;
  }
  function addPerson(rec) {
    var st = loadEdits();
    st.adds.push(rec);
    saveEdits(st); state.edited = true;
  }
  function removePerson(name) {
    var st = loadEdits();
    if (st.adds.some(function (a) { return txt(a.name) === name; })) {
      st.adds = st.adds.filter(function (a) { return txt(a.name) !== name; });
    } else {
      if (st.removed.indexOf(name) < 0) st.removed.push(name);
    }
    saveEdits(st); state.edited = true;
  }
  function resetEdits() { localStorage.removeItem(EDIT_KEY); }
  function hasEdits() {
    var st = loadEdits();
    return Object.keys(st.edits).length > 0 || st.adds.length > 0 || st.removed.length > 0;
  }

  /* ---------- 导出 ---------- */
  function toChineseList() {
    return DB.map(function (p) {
      var o = {};
      for (var i = 1; i < KEYS.length; i++) o[HEADERS[i]] = p[KEYS[i]];
      return o;
    });
  }
  function download(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function exportJSON(filename) {
    var text = JSON.stringify(toChineseList(), null, 1);
    download(new Blob([text], { type: "application/json;charset=utf-8" }),
      filename || "历史人物知识库_网页导出.json");
  }
  function exportXLSX(filename) {
    if (typeof window.XLSX === "undefined") { alert("SheetJS 未加载，无法导出 xlsx"); return; }
    var aoa = [[txt("历史人物知识库 · 教材人物总表")], ["共 " + DB.length + " 位人物"], HEADERS];
    DB.forEach(function (p) {
      var row = KEYS.map(function (k) { return k === "no" ? (p.no || "") : p[k]; });
      aoa.push(row);
    });
    var ws = window.XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } }
    ];
    ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 20 }, { wch: 14 }, { wch: 14 },
                   { wch: 34 }, { wch: 30 }, { wch: 36 }, { wch: 30 }, { wch: 20 },
                   { wch: 10 }, { wch: 32 }];
    ws["!autofilter"] = { ref: "A3:L" + aoa.length };

    var st = stats();
    var s2 = [["历史人物知识库 · 统计概览"]];
    s2.push(["按学段分布", "", "", "按朝代/时期分布"]);
    var n = Math.max(st.stages.length, st.dynasties.length);
    for (var i = 0; i < n; i++) {
      var l = st.stages[i], r = st.dynasties[i];
      s2.push([l ? l.k : "", l ? l.c : "", l ? l.pct.toFixed(1) + "%" : "",
               r ? r.k : "", r ? r.c : "", r ? r.pct.toFixed(1) + "%" : ""]);
    }
    s2.push([]);
    s2.push(["按身份领域分布（前 20）"]);
    st.identities.slice(0, 20).forEach(function (x) { s2.push([x.k, x.c, x.pct.toFixed(1) + "%"]); });
    s2.push([]);
    s2.push(["按出处类型分布"]);
    st.sources.forEach(function (x) { s2.push([x.k, x.c, x.pct.toFixed(1) + "%"]); });

    var ws2 = window.XLSX.utils.aoa_to_sheet(s2);
    ws2["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
      { s: { r: 1, c: 3 }, e: { r: 1, c: 5 } }
    ];
    ws2["!cols"] = [{ wch: 26 }, { wch: 8 }, { wch: 9 }, { wch: 26 }, { wch: 8 }, { wch: 9 }];

    var wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "教材人物总表");
    window.XLSX.utils.book_append_sheet(wb, ws2, "统计概览");
    window.XLSX.writeFile(wb, filename || "历史人物知识库_网页导出.xlsx");
  }

  /* ---------- 对外接口 ---------- */
  window.HNDB = {
    fields: KEYS,
    headers: HEADERS,
    eraOrder: dynasties,
    stages: stages,
    identities: identities,
    sources: sources,
    all: all,
    get: get,
    pick: pick,
    stats: stats,
    saveEdit: saveEdit,
    addPerson: addPerson,
    removePerson: removePerson,
    resetEdits: resetEdits,
    hasEdits: hasEdits,
    exportJSON: exportJSON,
    exportXLSX: exportXLSX,
    refresh: function () { rebuild(rawCache && rawCache.length ? rawCache : []); },
    reload: function () {
      return loadXlsx().then(function (rows) {
        rawCache = rows; state.mode = "xlsx";
        rebuild(rows);
        return true;
      }).catch(function () { return false; });
    },
    ready: ready,
    shuffle: shuffle,
    info: function () {
      return {
        mode: state.mode,
        count: DB.length,
        sourceMtime: state.sourceMtime,
        generatedAt: state.generatedAt,
        hasEdits: hasEdits()
      };
    }
  };
})();
