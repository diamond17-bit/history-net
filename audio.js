/* ===== 历史关联网 · 游戏音频（Web Audio 现场合成，不引用任何外部音频文件） =====
   只在游戏页（play_single / play_versus）加载：
   - 背景音乐：C 大调 I–vi–IV–V，96 BPM，4 小节 10 秒循环；Pad 铺底 + 八分音符拨弦琶音 + 轻拍 + 反拍沙锤，
     第 4 小节琶音上行并加十六分音符抢拍，制造轻微推进感；不含打击感强的鼓组。
   - 音效：点牌短提示音（约 100ms）；提交判定正确上行 / 错误下行（约 300ms）。
   - 浏览器自动播放限制：AudioContext 只在用户交互（开始游戏 / 点牌 / 点开关）时创建或 resume；
     若仍被拦，注册一次性手势兜底。切后台降到极低音量，回来恢复，结算弹层自动压低（duck）。
   数据层与判分逻辑完全不碰，仅暴露 window.HNAudio 供页面调用。 */
(function(){
  "use strict";

  var LS_AUDIO = "history_net_audio_v1";   // { music:1, sfx:1 }

  /* ---------- 音乐参数（乐理部分集中在这里，便于调） ---------- */
  var BPM = 96;
  var BEAT = 60 / BPM;          // 0.625s
  var BAR = BEAT * 4;           // 2.5s，4 小节 = 10s 无缝循环
  var MUSIC_LEVEL = 0.34;       // 音乐总线正常音量（中低）
  var DUCK_LEVEL = 0.06;        // 结算弹层时压低
  var BG_LEVEL = 0.05;          // 切到后台标签页时压低
  var SWING = 0.03;             // 八分音符摇摆量（×BEAT），带来轻微前倾

  /* Cmaj7 → Am7 → Fmaj7 → G，明亮大调、不过分甜腻 */
  var CHORDS = [
    { pad:[48,52,55,59], bass:36, arp:[60,64,67,71] },  // Cmaj7  C3 E3 G3 B3 / 低音 C2
    { pad:[45,48,52,57], bass:33, arp:[57,60,64,69] },  // Am7    A2 C3 E3 A3 / 低音 A1
    { pad:[41,45,48,53], bass:41, arp:[53,57,60,65] },  // Fmaj7  F2 A2 C3 F3 / 低音 F2
    { pad:[43,47,50,55], bass:43, arp:[55,59,62,67] }   // G      G2 B2 D3 G3 / 低音 G2
  ];
  /* 每小节 8 个八分音符的琶音走向；第 4 小节 4 表示再高三度并上行，收束回第 1 小节 */
  var ARP_PATTERNS = [
    [0,1,2,1,0,2,3,2],
    [0,2,1,2,0,3,2,1],
    [0,1,2,3,2,1,2,3],
    [0,1,2,3,4,3,2,1]
  ];

  var ctx = null;
  var musicMix = null, musicFade = null, sfxMix = null, sfxFade = null;
  var musicAnalyser = null, sfxAnalyser = null;
  var noiseBuf = null;

  var schedTimer = null, barIdx = 0, nextBarTime = 0;
  var pageStarted = false;     // 本页是否已开局（决定重新开音乐时是否恢复）
  var bgmWanted = false;       // 期望播放 BGM
  var duckOn = false;          // 结算压低
  var liveVoices = 0;

  var musicEnabled = true, sfxEnabled = true, lastClickAt = 0;

  /* ---------- 小工具 ---------- */
  function mtof(m){ return 440 * Math.pow(2, (m - 69) / 12); }

  function loadCfg(){
    try{
      var v = JSON.parse(localStorage.getItem(LS_AUDIO) || "{}");
      if(v && typeof v === "object"){
        musicEnabled = v.music === undefined ? true : !!v.music;
        sfxEnabled = v.sfx === undefined ? true : !!v.sfx;
      }
    }catch(e){}
  }
  function saveCfg(){
    try{ localStorage.setItem(LS_AUDIO, JSON.stringify({ music: musicEnabled, sfx: sfxEnabled })); }catch(e){}
  }
  loadCfg();

  /* ---------- AudioContext 与总线 ---------- */
  function ensure(){
    if(!ctx){
      var AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return null;
      try{ ctx = new AC({ latencyHint: "interactive" }); }catch(e){ try{ ctx = new AC(); }catch(e2){ return null; } }

      /* 音乐：mix(1) → 压缩器 → 淡入淡出增益 → 分析器 → 输出 */
      musicMix = ctx.createGain(); musicMix.gain.value = 1;
      var mc = ctx.createDynamicsCompressor();
      mc.threshold.value = -14; mc.knee.value = 12; mc.ratio.value = 3;
      mc.attack.value = 0.01; mc.release.value = 0.2;
      musicFade = ctx.createGain(); musicFade.gain.value = 0.0001;
      musicAnalyser = ctx.createAnalyser(); musicAnalyser.fftSize = 1024;
      musicMix.connect(mc); mc.connect(musicFade); musicFade.connect(musicAnalyser); musicAnalyser.connect(ctx.destination);

      /* 音效：mix → 压缩器（防止连点叠音爆掉） → 开关增益 → 分析器 → 输出 */
      sfxMix = ctx.createGain(); sfxMix.gain.value = 0.9;
      var sc = ctx.createDynamicsCompressor();
      sc.threshold.value = -10; sc.knee.value = 10; sc.ratio.value = 6;
      sc.attack.value = 0.003; sc.release.value = 0.12;
      sfxFade = ctx.createGain(); sfxFade.gain.value = sfxEnabled ? 1 : 0.0001;
      sfxAnalyser = ctx.createAnalyser(); sfxAnalyser.fftSize = 1024;
      sfxMix.connect(sc); sc.connect(sfxFade); sfxFade.connect(sfxAnalyser); sfxAnalyser.connect(ctx.destination);

      /* 沙锤用的一段短噪声 */
      var len = Math.floor(ctx.sampleRate * 0.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for(var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      /* 自动播放兜底：被拦时，用户下一次手势（点牌/点按钮/按键）即恢复 */
      ["pointerdown","keydown","touchstart"].forEach(function(evt){
        document.addEventListener(evt, function once(){
          if(ctx && ctx.state === "suspended"){
            ctx.resume().catch(function(){});
            if(bgmWanted && !schedTimer) startSched();
            fadeMusic(targetLevel(), 0.8);
          }
          document.removeEventListener(evt, once);
        }, { passive: true });
      });
    }
    if(ctx.state === "suspended"){
      try{ ctx.resume().catch(function(){}); }catch(e){}
    }
    return ctx;
  }

  function fadeMusic(v, secs){
    if(!ctx || !musicFade) return;
    var now = ctx.currentTime;
    var cur = Math.max(0.0001, musicFade.gain.value);
    musicFade.gain.cancelScheduledValues(now);
    musicFade.gain.setValueAtTime(cur, now);
    musicFade.gain.linearRampToValueAtTime(Math.max(0.0001, v), now + (secs || 0.5));
  }
  function targetLevel(){
    if(!musicEnabled) return 0.0001;
    if(document.hidden) return BG_LEVEL;
    return duckOn ? DUCK_LEVEL : MUSIC_LEVEL;
  }

  /* ---------- 音符 ---------- */
  function tone(o){
    if(!ctx) return;
    var t = o.t, dur = o.dur || 0.3, peak = Math.max(0.0005, o.gain || 0.05);
    var osc = ctx.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.freq, t);
    if(o.detune) osc.detune.setValueAtTime(o.detune, t);

    var g = ctx.createGain();
    var attack = o.attack || 0.006;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    var node = osc;
    if(o.lp){
      var f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.setValueAtTime(o.lp, t); f.Q.value = o.q || 0.6;
      osc.connect(f); node = f;
    }
    node.connect(g); g.connect(o.dest || musicMix);

    liveVoices++;
    osc.onended = function(){ liveVoices = Math.max(0, liveVoices - 1); try{ g.disconnect(); }catch(e){} };
    osc.start(t); osc.stop(t + dur + 0.03);
  }

  function kick(t){
    if(!ctx) return;
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(112, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g); g.connect(musicMix);
    liveVoices++;
    osc.onended = function(){ liveVoices = Math.max(0, liveVoices - 1); try{ g.disconnect(); }catch(e){} };
    osc.start(t); osc.stop(t + 0.25);
  }

  function shaker(t){
    if(!ctx || !noiseBuf) return;
    var src = ctx.createBufferSource(); src.buffer = noiseBuf;
    var hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 6200;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.02, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(hp); hp.connect(g); g.connect(musicMix);
    src.start(t); src.stop(t + 0.09);
  }

  /* ---------- 编曲与调度 ---------- */
  function scheduleBar(bar, t0){
    var ch = CHORDS[bar % 4];
    var pat = ARP_PATTERNS[bar % 4];
    var last = bar % 4 === 3;

    /* Pad：跨小节轻微重叠（dur > BAR），保证循环无缝隙 */
    ch.pad.forEach(function(m, i){
      tone({ freq: mtof(m), t: t0, dur: BAR + 0.5, gain: 0.042, type: "triangle",
             attack: 0.32, lp: 1500, q: 0.4, detune: i % 2 ? 3 : -3 });
    });

    /* 低音：正拍 1 与第 3 拍前半拍（略前倾），最后一小节加一个抢拍导向下一个循环 */
    [0, 1.75].forEach(function(beat){
      tone({ freq: mtof(ch.bass), t: t0 + beat * BEAT, dur: 0.55, gain: 0.11,
             type: "triangle", attack: 0.008, lp: 420 });
    });
    if(last) tone({ freq: mtof(ch.bass + 7), t: t0 + 3.5 * BEAT, dur: 0.35, gain: 0.08, type: "triangle", attack: 0.008, lp: 420 });

    /* 琶音：八分音符，奇数位轻微摇摆 */
    pat.forEach(function(k, i){
      var at = t0 + i * (BEAT / 2) + (i % 2 ? BEAT * SWING : 0);
      var m = ch.arp[k % ch.arp.length] + (k >= ch.arp.length ? 12 : 0);
      tone({ freq: mtof(m), t: at, dur: 0.34, gain: 0.034, type: "sine", attack: 0.006 });
      tone({ freq: mtof(m + 12), t: at, dur: 0.16, gain: 0.012, type: "sine", attack: 0.004 });
    });
    /* 第 4 小节尾部十六分抢拍：只给一点点紧迫感，不是战斗节奏 */
    if(last){
      [3.25, 3.75].forEach(function(beat){
        tone({ freq: mtof(ch.arp[2]), t: t0 + beat * BEAT, dur: 0.18, gain: 0.028, type: "sine", attack: 0.004 });
      });
    }

    /* 轻拍：1、3 拍；沙锤：反拍八分 */
    kick(t0);
    kick(t0 + 2 * BEAT);
    [0.5, 1.5, 2.5, 3.5].forEach(function(beat){ shaker(t0 + beat * BEAT); });
  }

  function tick(){
    if(!ctx) return;
    var guard = 0;
    while(nextBarTime < ctx.currentTime + 0.7 && guard++ < 8){
      scheduleBar(barIdx, nextBarTime);
      nextBarTime += BAR;
      barIdx++;
    }
  }
  function startSched(){
    if(!ctx || schedTimer || !bgmWanted) return;
    nextBarTime = ctx.currentTime + 0.06;
    barIdx = 0;
    tick();
    schedTimer = setInterval(tick, 100);
  }

  /* ---------- 对外：背景音乐 ---------- */
  function play(){
    pageStarted = true;
    if(!musicEnabled){ updateBtn(); return; }
    ensure();
    if(!ctx) return;
    bgmWanted = true;
    duckOn = false;
    startSched();
    fadeMusic(document.hidden ? BG_LEVEL : MUSIC_LEVEL, 1.3);   // 淡入
    updateBtn();
  }
  function stop(fade){
    bgmWanted = false;
    duckOn = false;
    if(ctx) fadeMusic(0.0001, fade == null ? 0.5 : fade);
    if(schedTimer){
      var t = schedTimer;
      setTimeout(function(){ clearInterval(t); }, 260);
      schedTimer = null;
    }
  }
  function duck(){
    duckOn = true;
    if(ctx && bgmWanted) fadeMusic(DUCK_LEVEL, 0.75);
  }
  function unduck(){
    duckOn = false;
    if(ctx && bgmWanted && musicEnabled) fadeMusic(document.hidden ? BG_LEVEL : MUSIC_LEVEL, 0.9);
  }

  /* ---------- 对外：音效 ---------- */
  function sfxReady(){
    if(!sfxEnabled) return false;
    ensure();
    /* 上下文还没 running 时不排音，避免恢复瞬间堆积成爆音 */
    return !!ctx && ctx.state === "running";
  }

  /* 点牌提示音：C6+G6 木质短音，约 100ms；60ms 节流，连点不叠爆 */
  function click(soft){
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    if(now - lastClickAt < 60) return;
    lastClickAt = now;
    if(!sfxReady()) return;
    var t = ctx.currentTime + 0.002;
    var base = soft ? 1046.5 : 1174.66;      // 详情卡用更柔和一点的音高
    tone({ freq: base, t: t, dur: 0.1, gain: 0.045, type: "triangle", attack: 0.004, lp: 3200, dest: sfxMix });
    tone({ freq: base * 1.5, t: t, dur: 0.06, gain: 0.018, type: "sine", attack: 0.003, dest: sfxMix });
  }

  /* 提交判定：正确上行 C6-E6-G6；错误下行 G5-E5-C5，都不长不吵 */
  function chime(ok){
    if(!sfxReady()) return;
    var seq = ok ? [1046.5, 1318.5, 1568.0] : [784.0, 659.3, 523.3];
    var t = ctx.currentTime + 0.003;
    seq.forEach(function(f, i){
      tone({ freq: f, t: t + i * 0.085, dur: 0.26, gain: 0.05, type: "sine", attack: 0.008, dest: sfxMix });
      tone({ freq: f * 2, t: t + i * 0.085, dur: 0.14, gain: 0.012, type: "sine", attack: 0.005, dest: sfxMix });
    });
  }

  /* ---------- 开关 UI（顶部导航右侧，两个图标按钮并列） ---------- */
  var ICON = {
    musicOn: '<circle cx="6.6" cy="17.6" r="2.7"/><circle cx="16.6" cy="15.6" r="2.7"/><path d="M9.3 17.6V6.4l10-2v11.2"/><path d="M9.3 9.1l10-2"/>',
    musicOff:'<circle cx="6.6" cy="17.6" r="2.7"/><circle cx="16.6" cy="15.6" r="2.7"/><path d="M9.3 17.6V6.4l10-2v11.2"/><path d="M3.4 3.4l17.2 17.2"/>',
    sfxOn:  '<path d="M4 9.4h3.2L12 6v12l-4.8-3.4H4z"/><path d="M15.4 9.2a4 4 0 0 1 0 5.6"/><path d="M17.9 6.7a7.4 7.4 0 0 1 0 10.6"/>',
    sfxOff: '<path d="M4 9.4h3.2L12 6v12l-4.8-3.4H4z"/><path d="M15.4 9.2a4 4 0 0 1 0 5.6"/><path d="M3.4 3.4l17.2 17.2"/>'
  };
  function btnHtml(kind){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<g class="ico-on">' + (kind === "music" ? ICON.musicOn : ICON.sfxOn) + '</g>' +
      '<g class="ico-off">' + (kind === "music" ? ICON.musicOff : ICON.sfxOff) + '</g>' +
      '</svg>';
  }
  function updateBtn(){
    var mb = document.getElementById("audioMusicBtn");
    var sb = document.getElementById("audioSfxBtn");
    if(mb){
      mb.classList.toggle("off", !musicEnabled);
      mb.title = musicEnabled ? "背景音乐：开（点击静音）" : "背景音乐：关（点击开启）";
      mb.setAttribute("aria-pressed", musicEnabled ? "true" : "false");
    }
    if(sb){
      sb.classList.toggle("off", !sfxEnabled);
      sb.title = sfxEnabled ? "音效：开（点击关闭）" : "音效：关（点击开启）";
      sb.setAttribute("aria-pressed", sfxEnabled ? "true" : "false");
    }
  }
  function mountButtons(){
    var bar = document.querySelector(".topbar");
    if(!bar || document.getElementById("audioMusicBtn")) return updateBtn();
    var wrap = document.createElement("div");
    wrap.className = "audio-group";
    wrap.innerHTML =
      '<button class="audio-btn" id="audioMusicBtn" type="button" aria-pressed="true">' + btnHtml("music") + '</button>' +
      '<button class="audio-btn" id="audioSfxBtn" type="button" aria-pressed="true">' + btnHtml("sfx") + '</button>';
    var pill = bar.querySelector(".user-pill");
    if(pill) bar.insertBefore(wrap, pill); else bar.appendChild(wrap);
    document.getElementById("audioMusicBtn").addEventListener("click", function(){
      musicEnabled = !musicEnabled;
      saveCfg(); updateBtn();
      if(musicEnabled){ if(pageStarted) play(); else ensure(); click(); }
      else{ bgmWanted = false; duckOn = false; if(ctx) fadeMusic(0.0001, 0.4);
            if(schedTimer){ var t = schedTimer; setTimeout(function(){ clearInterval(t); }, 300); schedTimer = null; } }
    });
    document.getElementById("audioSfxBtn").addEventListener("click", function(){
      sfxEnabled = !sfxEnabled;
      saveCfg(); updateBtn();
      if(sfxEnabled) ensure();
      if(ctx && sfxFade){
        var now = ctx.currentTime, cur = Math.max(0.0001, sfxFade.gain.value);
        sfxFade.gain.cancelScheduledValues(now);
        sfxFade.gain.setValueAtTime(cur, now);
        sfxFade.gain.linearRampToValueAtTime(sfxEnabled ? 1 : 0.0001, now + 0.18);
      }
      if(sfxEnabled) click();
    });
    updateBtn();
  }

  /* ---------- 页面生命周期：切后台降低、回来恢复 ---------- */
  document.addEventListener("visibilitychange", function(){
    if(!ctx || !bgmWanted) return;
    fadeMusic(document.hidden ? BG_LEVEL : (duckOn ? DUCK_LEVEL : MUSIC_LEVEL), 0.6);
  });
  window.addEventListener("pagehide", function(){ if(ctx) fadeMusic(0.0001, 0.2); });

  /* ---------- 诊断（无真实耳朵，用状态 / 增益 / 输出峰值代替听感） ---------- */
  function peak(which, ms){
    var an = which === "sfx" ? sfxAnalyser : musicAnalyser;
    if(!ctx || !an) return Promise.resolve(0);
    var buf = new Float32Array(an.fftSize);
    var until = (window.performance && performance.now ? performance.now() : Date.now()) + (ms || 320);
    var max = 0;
    return new Promise(function(res){
      (function loop(){
        an.getFloatTimeDomainData(buf);
        for(var i = 0; i < buf.length; i += 2){
          var v = buf[i] < 0 ? -buf[i] : buf[i];
          if(v > max) max = v;
        }
        var nowMs = (window.performance && performance.now ? performance.now() : Date.now());
        if(nowMs < until) setTimeout(loop, 16); else res(+max.toFixed(5));
      })();
    });
  }

  function state(){
    return {
      ctx: ctx ? ctx.state : "none",
      time: ctx ? +ctx.currentTime.toFixed(2) : 0,
      musicGain: musicFade ? +musicFade.gain.value.toFixed(4) : 0,
      sfxGain: sfxFade ? +sfxFade.gain.value.toFixed(4) : 0,
      music: musicEnabled, sfx: sfxEnabled,
      bgm: bgmWanted, ducked: duckOn, sched: !!schedTimer,
      bar: barIdx, voices: liveVoices, hidden: document.hidden
    };
  }

  window.HNAudio = {
    play: play, stop: stop, duck: duck, unduck: unduck,
    click: click, chime: chime,
    mountButtons: mountButtons, state: state, peak: peak
  };
  loadCfg();
})();
