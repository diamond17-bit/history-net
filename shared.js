/* ===== 历史关联网 · 共享题库与工具 ===== */
const LS_KEY = "history_net_v1";
const LS_GAMES = "history_net_games_v1";

/* 人物题库：由 data/db.js 从《历史人物知识库》加载后填充（不再写死） */
var DB = [];

const DIM_NAMES = { name:"姓名", event:"事件", work:"作品", dyn:"朝代", caliber:"字/号", identity:"身份" };
const GROUP_COLORS = ["#4A918C","#D98E48","#7A5EA7","#C94E72","#5E88BA","#6FB870","#B7843B","#5B8D8E"];
const LEVELS = [
  { nDim:2, dims:["event"],                              name:"1 级 · 二元",   task:"谁做了这件事" },
  { nDim:3, dims:["event","work"],                        name:"2 级 · 三元",   task:"他写了什么" },
  { nDim:4, dims:["event","work","dyn"],                  name:"3 级 · 四元",   task:"他活在哪个时代" },
  { nDim:5, dims:["event","work","dyn","caliber"],        name:"4 级 · 五元",   task:"别人怎么称呼他" },
  { nDim:6, dims:["event","work","dyn","caliber","identity"], name:"5 级 · 六元", task:"六项齐全的完整侧面" },
];
const ERA_ORDER = ["先秦","秦汉","三国两晋南北朝","隋唐","五代十国","宋元","明清","近现代","当代","外国古代","外国近现代"];
const NET_COL_MAX = 6;   // 关系网每列最多展示人数（人物库已扩充到几百人）
const NATION_LABEL = { C:"中国", F:"外国" };
const ROLE_LABELS = { s:"学生", t:"教师", a:"管理员", g:"游客" };

/* ===== 持久化 API ===== */
const LS_SCORES = "history_net_scores_v1";   // 按学号的成绩仓库（教师/管理员查看）
const LS_CLASSES = "history_net_classes_v1"; // 教师班级
const LS_EXTRA = "history_net_accounts_v1";  // 管理员新增账号
const LS_PW = "history_net_pw_v1";           // 改密记录（accounts.js 为静态文件，只读，改密落在这里）

function loadAll(){
  try{ return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }catch(e){ return {}; }
}
function saveAll(data){ localStorage.setItem(LS_KEY, JSON.stringify(data)); }
function getUser(){ return loadAll().user || null; }
function saveUser(u){ const d=loadAll(); d.user=u; saveAll(d); }
function isLogin(){ return !!getUser(); }
function isGuest(){ const u=getUser(); return !!u && u.role==="g"; }
function logout(){ const d=loadAll(); d.user=null; saveAll(d); }
function requireLogin(){
  if(!isLogin()){ location.href = "login.html"; return null; }
  return loadAll();
}
/* 需要真实账号的页面（个人中心 / 教师端 / 人物库）：游客也送回登录页 */
function requireAccount(){
  const u = getUser();
  if(!u || u.role === "g"){ location.href = "login.html"; return null; }
  return loadAll();
}

/* 个人档案：按 角色|账号 隔离，教师/学生/管理员互不覆盖 */
function uid(){ const u=getUser(); return u ? (u.role+"|"+(u.no||u.name)) : "anon"; }
function profile(){ const d=loadAll(); return (d.profiles||{})[uid()] || { totalScore:0, bestLevel:1, done:{} }; }
function saveProfile(p){ const d=loadAll(); d.profiles=d.profiles||{}; d.profiles[uid()]=p; saveAll(d); }

/* 成绩仓库：学生提交时同步，供教师/管理员查看 */
function loadScores(){ try{ return JSON.parse(localStorage.getItem(LS_SCORES)) || {}; }catch(e){ return {}; } }
function saveScores(m){ localStorage.setItem(LS_SCORES, JSON.stringify(m)); }
function syncScoreStore(){
  const u=getUser(); if(!u || u.role!=="s" || !u.no) return;
  const p=profile(); const m=loadScores();
  m[u.no] = Object.assign(m[u.no]||{}, {
    score: p.totalScore||0, bestLevel: p.bestLevel||1,
    doneCount: Object.keys(p.done||{}).length, lastDate: today()
  });
  saveScores(m);
}

/* 班级 */
function loadClasses(){ try{ return JSON.parse(localStorage.getItem(LS_CLASSES)) || []; }catch(e){ return []; } }
function saveClasses(c){ localStorage.setItem(LS_CLASSES, JSON.stringify(c)); }
function makeClassCode(){
  const s="ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let r="";
  for(let i=0;i<6;i++) r+=s[Math.floor(Math.random()*s.length)];
  return r;
}

/* 账号：accounts.js 基础表 + 管理员新增 */
function loadExtra(){ try{ return JSON.parse(localStorage.getItem(LS_EXTRA)) || {}; }catch(e){ return {}; } }
function saveExtra(x){ localStorage.setItem(LS_EXTRA, JSON.stringify(x)); }
function allAccounts(role){
  const base = (typeof ACCOUNTS!=="undefined" && ACCOUNTS[role]) ? ACCOUNTS[role] : [];
  return base.concat((loadExtra()[role]||[]));
}
function findStudent(no){ return allAccounts("s").find(a=> a.id===no) || null; }

/* 改密：accounts.js 是静态文件，浏览器无法回写；新密码按「角色|账号」存到本地存储，
   登录校验 (login.html) 与展示统一走 effectivePw()，因此改完立即生效、下次登录用新密码。 */
function loadPwOverrides(){ try{ return JSON.parse(localStorage.getItem(LS_PW)) || {}; }catch(e){ return {}; } }
function savePwOverrides(m){ localStorage.setItem(LS_PW, JSON.stringify(m)); }
function pwKeyOf(role, id){ return role + "|" + id; }
function effectivePw(role, id, fallback){
  const m = loadPwOverrides();
  const k = pwKeyOf(role, id);
  return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : (fallback == null ? "" : fallback);
}
function setPassword(role, id, pw){
  const m = loadPwOverrides();
  m[pwKeyOf(role, id)] = String(pw);
  savePwOverrides(m);
}
function hasPwOverride(role, id){ return Object.prototype.hasOwnProperty.call(loadPwOverrides(), pwKeyOf(role, id)); }

function persistAddScore(lv, score){
  const u=getUser(); if(!u || u.role==="g") return;   // 游客试玩不计分
  if(u.role!=="s") return;                              // 教师/管理员只测掌握情况，不记分
  const p=profile();
  p.totalScore = (p.totalScore||0) + score;
  p.bestLevel = Math.max(p.bestLevel||1, lv);
  saveProfile(p); syncScoreStore();
}
function persistMarkDone(personKey){
  const u=getUser(); if(!u || u.role==="g") return;    // 游客不点亮关系网
  const p=profile(); p.done = p.done || {};
  p.done[personKey] = Math.max(p.done[personKey]||0, 6);
  saveProfile(p); syncScoreStore();
}
function persistAddGame(record){
  const u=getUser(); if(!u || u.role==="g") return;    // 游客不记战绩
  const arr = JSON.parse(localStorage.getItem(LS_GAMES)||"[]");
  arr.unshift(Object.assign({ who:uid(), role:u.role }, record));
  localStorage.setItem(LS_GAMES, JSON.stringify(arr.slice(0,50)));
  syncScoreStore();
}
function persistRecent(){
  const me = uid();
  return JSON.parse(localStorage.getItem(LS_GAMES)||"[]").filter(r => r.who===me);
}

/* ===== 渲染顶部导航（在 home / play_single / play_versus 页面调用） ===== */
function renderTopnav(active){
  const u = getUser();
  const isStaff = !!u && (u.role==="t" || u.role==="a");
  const guest = !!u && u.role==="g";
  const homeHref = isStaff ? "home.html" : "home_student.html";
  const logoHref = guest ? "lobby.html" : homeHref;
  const homeLabel = u && u.role==="t" ? "教师首页" : (u && u.role==="a" ? "管理首页" : "学生首页");
  const ic = {
    home:  '<path d="M3 10.8 12 3.5l9 7.3"/><path d="M5.8 9.6V20a1 1 0 0 0 1 1h10.4a1 1 0 0 0 1-1V9.6"/>',
    users: '<circle cx="9.2" cy="8.2" r="3.2"/><path d="M3.6 20c0-3.3 2.5-5.5 5.6-5.5s5.6 2.2 5.6 5.5"/><path d="M16.2 5.4a3 3 0 0 1 0 5.6"/><path d="M17.6 14.9c2 .6 3.2 2.3 3.2 4.4"/>',
    chart: '<path d="M4.5 19.5V4.5"/><path d="M4.5 19.5h15"/><path d="M8.5 16v-4.5"/><path d="M13 16V8"/><path d="M17.5 16V6"/>',
    class: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M8 10.5h8"/><path d="M8 14.5h5"/>',
    lobby: '<rect x="2.6" y="7" width="18.8" height="10" rx="4.4"/><path d="M6.6 12h3M8.1 10.5v3"/><circle cx="15.6" cy="10.9" r="1"/><circle cx="17.8" cy="13.1" r="1"/><path d="M9.6 7V5.6"/>',
    data:  '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>'
  };
  const item = (key, href, label) =>
    `<a class="${active===key?'on':''}" href="${href}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ic[key]}</svg><span>${label}</span></a>`;
  const pill = u ? `<div class="user-pill ${u.role||'g'}">
    ${u.avatar? `<img class="u-ic" src="${u.avatar}" alt="${u.name}">` : `<div class="u-ic">${(u.name||"?")[0]}</div>`}
    <div><div class="u-name">${guest ? "游客" : (u.name||"游客")}</div><div class="u-role">${guest ? "试玩模式 · 成绩不保存" : (ROLE_LABELS[u.role]||"")}${(!guest && u.no) ? " · "+u.no : ""}</div></div>
    ${guest
      ? `<a class="btn small primary" href="login.html">登录</a>`
      : `<button class="close" onclick="doLogout()">退出</button>`}
  </div>` : '';
  return `<div class="topbar">
    <div class="logo" onclick="location.href='${logoHref}'"><div class="dot">
      <svg viewBox="0 0 24 24" fill="none"><path d="M6 8.5 12 5l6 3.5v7L12 19l-6-3.5z" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" opacity=".9"/><circle cx="6" cy="8.5" r="1.9" fill="#fff"/><circle cx="12" cy="5" r="1.9" fill="#fff"/><circle cx="18" cy="8.5" r="1.9" fill="#fff"/><circle cx="12" cy="19" r="1.9" fill="#fff"/></svg>
    </div>
      <div><div class="title">历史关联网</div><div class="sub">HISTORY · NETWORK</div></div>
    </div>
    <div class="topnav">
      ${guest ? "" : item("home", homeHref, homeLabel)}
      ${isStaff ? item("users", "student_admin.html", "学生管理") : ""}
      ${u && u.role==="t" ? item("class", "class_create.html", "创建班级") : ""}
      ${u && u.role==="a" ? item("chart", "score_analysis.html", "成绩分析") : ""}
      ${item("lobby", "lobby.html", "游戏大厅")}
      ${isStaff ? item("data", "kb_admin.html", "人物库") : ""}
    </div>
    <div class="spacer"></div>
    ${pill}
  </div>`;
}
function doLogout(){ logout(); location.href = "login.html"; }
function personKey(name){ return name; }
function today(){
  const d = new Date();
  return `${d.getMonth()+1}月${d.getDate()}日`;
}
/* 把历史记录里的日期统一成 YYYY-MM-DD：兼容 today() 的「11月11日」与旧数据的 ISO 格式 */
function dateISO(v){
  const s = String(v == null ? "" : v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m) return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
  m = s.match(/^(\d{1,2})月(\d{1,2})日$/);
  if(m) return `${new Date().getFullYear()}-${String(m[1]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
  return "";
}
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }

/* ===== 出牌池：人物缺“字/号”等维度时自动降维，保证每组都能凑齐 ===== */
function dealDeck(lv, nation, era){
  const dims = lv.dims.slice();
  while(dims.length){
    const has = p => dims.every(d => p[d]);
    let pool = DB.filter(p => p.nation===nation && p.era===era && has(p));
    if(pool.length >= 3) return { dims, pool };
    pool = DB.filter(p => p.nation===nation && has(p));   // 朝代不够先放宽到本国
    if(pool.length >= 3) return { dims, pool };
    dims.pop();                                           // 再不行去掉末尾维度
  }
  const pool = DB.filter(p => p.nation===nation);
  return { dims, pool: pool.length ? pool : DB.slice() };
}
function erasOf(nation){
  return ERA_ORDER.filter(e =>
    (nation==="F" ? e.indexOf("外国")===0 : e.indexOf("外国")!==0) &&
    DB.filter(p => p.nation===nation && p.era===e).length >= 3);
}

/* ===== 动效工具：按钮水波 / 滚动进场 / 数字滚动 ===== */
function mountMotion(root){
  root = root || document;
  if(!document.__hnMotion){
    document.__hnMotion = true;
    document.addEventListener("pointerdown", function(e){
      const b = e.target && e.target.closest && e.target.closest(".btn,.radio-chip,.sort-btn,.tab,.role-tab");
      if(!b || b.disabled) return;
      const r = b.getBoundingClientRect();
      const size = Math.max(r.width, r.height);
      const d = document.createElement("span");
      d.className = "ripple";
      d.style.width = d.style.height = size + "px";
      d.style.left = (e.clientX - r.left - size/2) + "px";
      d.style.top  = (e.clientY - r.top  - size/2) + "px";
      b.appendChild(d);
      setTimeout(function(){ d.remove(); }, 640);
    });
    document.addEventListener("keydown", function(e){
      if(e.key !== "Enter") return;
      const b = e.target && e.target.closest && e.target.closest(".btn");
      if(b) b.click();
    });
  }
  revealIn(root);
  countUp(root);
}

function revealIn(root){
  const items = root.querySelectorAll ? [].slice.call(root.querySelectorAll(".reveal:not(.in)")) : [];
  if(!items.length) return;
  items.forEach(function(el,i){ if(!el.style.getPropertyValue("--i")) el.style.setProperty("--i", i % 8); });
  if(!("IntersectionObserver" in window)){ items.forEach(function(el){ el.classList.add("in"); }); return; }
  const io = new IntersectionObserver(function(es){
    es.forEach(function(en){
      if(en.isIntersecting){ en.target.classList.add("in"); io.unobserve(en.target); }
    });
  }, { threshold:.06, rootMargin:"0px 0px -40px 0px" });
  items.forEach(function(el){ io.observe(el); });
  // 兜底：若观察器未回调（无渲染帧环境）且元素已在视口内，直接显示
  setTimeout(function(){
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    items.forEach(function(el){
      if(el.classList.contains("in")) return;
      var r = el.getBoundingClientRect();
      if(r.top < vh + 40 && r.bottom > -40) el.classList.add("in");
    });
  }, 700);
}

function countUp(root){
  const els = root.querySelectorAll ? [].slice.call(root.querySelectorAll("[data-count]")) : [];
  function run(el){
    if(el.dataset.done) return;
    el.dataset.done = "1";
    const target = parseFloat(el.dataset.count) || 0;
    const st = performance.now(), dur = 720;
    function step(now){
      const p = Math.min(1, (now - st) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * e).toLocaleString("en-US");
      if(p < 1) requestAnimationFrame(step);
      else el.textContent = target.toLocaleString("en-US");
    }
    requestAnimationFrame(step);
  }
  if(!("IntersectionObserver" in window)){ els.forEach(run); return; }
  const io = new IntersectionObserver(function(es){
    es.forEach(function(en){ if(en.isIntersecting){ run(en.target); io.unobserve(en.target); } });
  }, { threshold:.35 });
  els.forEach(function(el){ io.observe(el); });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", function(){ mountMotion(document); });
} else {
  mountMotion(document);
}
