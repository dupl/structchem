/* WRL 模型图谱 — 搜索与界面逻辑 */
(function () {
  'use strict';

  var ICONS = {
    dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
    cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 2.6 21 7v10l-9 4.4L3 17V7z"/><path d="M3 7l9 4.4L21 7M12 11.4v10"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/></svg>',
    compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.4 8.6 13.7 13.7 8.6 15.4 10.3 10.3z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.2-2h5l1.2 2h1.8A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/><circle cx="12" cy="12.5" r="3.2"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>'
  };

  var GROUPS = ['原子轨道', '分子轨道', '势箱波函数', '分子对称性', '晶体与点群', '晶体结构'];
  var QUICK = ['1s', '2p', '3d', '4f', 'CH4', '苯', 'C2v', '石英'];
  var VIEWS = [
    { key: 'iso', label: '等轴视角' },
    { key: 'front', label: '正视（沿 z）' },
    { key: 'top', label: '俯视（沿 y）' },
    { key: 'side', label: '侧视（沿 x）' }
  ];

  var isLocal = location.protocol === 'file:';
  var all = WRL.index().slice();
  var byId = Object.create(null);
  all.forEach(function (e) { byId[e.id] = e; });

  var state = {
    query: '',
    group: '全部',
    view: 'search',
    selected: null,
    filtered: all.slice(),
    mode: 'dark',
    rotating: false,
    wireframe: false,
    viewIndex: 0,
    loadToken: 0
  };

  var el = function (id) { return document.getElementById(id); };
  var viewer = null;
  var searchTimer = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function highlight(text) {
    var q = state.query.trim();
    if (!q) return escapeHtml(text);
    var tokens = q.split(/\s+/).filter(Boolean).map(escapeRe);
    if (!tokens.length) return escapeHtml(text);
    return escapeHtml(text).replace(new RegExp('(' + tokens.join('|') + ')', 'ig'), '<mark>$1</mark>');
  }

  function score(e, q) {
    if (!q) return 1;
    var fields = [
      e.name.toLowerCase(), e.pretty.toLowerCase(), e.desc.toLowerCase(),
      e.group.toLowerCase(), e.chapterName.toLowerCase(), e.chapter.toLowerCase(),
      e.alias.toLowerCase(), e.tags.join(' ').toLowerCase(), e.file.toLowerCase()
    ];
    var total = 0;
    q.split(/\s+/).filter(Boolean).forEach(function (t) {
      var best = 0;
      fields.forEach(function (f, i) {
        if (f === t) best = Math.max(best, 120 - i);
        else if (f.indexOf(t) === 0) best = Math.max(best, 80 - i);
        else if (f.indexOf(t) >= 0) best = Math.max(best, 45 - Math.min(i, 10));
      });
      if (!best) { total = -1e9; return; }
      total += best;
      if (e.name.toLowerCase() === t) total += 200;
    });
    return total;
  }

  function refresh() {
    var q = state.query.trim().toLowerCase();
    var list = all.filter(function (e) {
      return (state.group === '全部' || e.group === state.group) && score(e, q) > -1e8;
    });
    if (q || state.group !== '全部') {
      list.forEach(function (e) { e.__score = score(e, q); });
      list.sort(function (a, b) {
        return b.__score - a.__score || a.name.length - b.name.length ||
               a.name.localeCompare(b.name, 'zh-CN');
      });
    } else {
      list.sort(function (a, b) {
        return GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) ||
               a.chapter.localeCompare(b.chapter, 'zh-CN') ||
               a.name.localeCompare(b.name, 'zh-CN');
      });
    }
    state.filtered = list;
    el('resultCount').textContent = list.length;
    el('resultHint').textContent = q ? '按相关度排序' : '按章节排列';
    renderResults();
    if (state.view === 'gallery') renderGallery();
  }

  function thumbHtml(e, cls) {
    var src = 'data/thumbs/' + encodeURIComponent(e.id) + '.jpg';
    return '<div class="' + cls + '"><img src="' + src + '" alt="" loading="lazy"' +
           ' onerror="this.style.display=\'none\';this.parentNode.innerHTML=\'<span class=ph>ψ</span>\'">' +
           '</div>';
  }

  function renderResults() {
    var root = el('results');
    if (!state.filtered.length) {
      root.innerHTML = '<div style="padding:34px 14px;text-align:center;color:var(--muted);font-size:12.5px">' +
                       '没有匹配结果<br><span style="font-size:11px">换个关键词，或切换分类</span></div>';
      el('empty').classList.add('show');
      return;
    }
    el('empty').classList.remove('show');
    var grouped = !state.query.trim() && state.group === '全部';
    var html = [], last = null;
    state.filtered.forEach(function (e) {
      if (grouped && e.group !== last) {
        html.push('<div class="group-title">' + escapeHtml(e.group) + '</div>');
        last = e.group;
      }
      html.push(
        '<div class="card' + (state.selected === e.id ? ' active' : '') + '" data-id="' + escapeHtml(e.id) + '">' +
          thumbHtml(e, 'thumb') +
          '<div class="card-main">' +
            '<div class="card-name">' + highlight(e.name) + '</div>' +
            '<div class="card-desc">' + escapeHtml(e.desc) + '</div>' +
          '</div>' +
          '<span class="card-badge">' + escapeHtml(e.chapter.replace('第 ', '').replace(' 章', '')) + ' 章</span>' +
        '</div>'
      );
    });
    root.innerHTML = html.join('');
  }

  function renderGallery() {
    el('galleryHint').textContent = '共 ' + state.filtered.length + ' 个 · 点击卡片在三维查看器中打开';
    el('gallery').innerHTML = state.filtered.map(function (e) {
      return '<div class="gcard" data-id="' + escapeHtml(e.id) + '">' +
        thumbHtml(e, 'gimg') +
        '<div class="gmeta"><div class="gname">' + highlight(e.name) + '</div>' +
        '<div class="ginfo">' + escapeHtml(e.group) + ' · ' + escapeHtml(e.chapterName) + '</div></div></div>';
    }).join('');
  }

  function updateActiveCards() {
    Array.prototype.forEach.call(document.querySelectorAll('.card'), function (c) {
      c.classList.toggle('active', c.getAttribute('data-id') === state.selected);
    });
    var active = document.querySelector('.card.active');
    if (active && active.scrollIntoView) {
      var box = active.getBoundingClientRect(), root = el('results').getBoundingClientRect();
      if (box.top < root.top || box.bottom > root.bottom) active.scrollIntoView({ block: 'nearest' });
    }
  }

  function fileUrl(e) {
    var parts = e.abs.split('/');
    return 'file:///' + parts[0] + '/' + parts.slice(1).map(encodeURIComponent).join('/');
  }

  function showOverlay(text, sub) {
    el('overlay').classList.remove('error');
    el('overlay').classList.add('show');
    el('overlayText').textContent = text;
    el('overlaySub').textContent = sub || '';
  }
  function hideOverlay() { el('overlay').classList.remove('show'); }
  function showError(msg) {
    el('overlay').classList.add('error', 'show');
    el('overlayText').textContent = '模型加载失败';
    el('overlaySub').textContent = msg;
  }

  var toastTimer;
  function toast(msg) {
    var t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }

  function select(id) {
    var e = byId[id];
    if (!e) return;
    state.selected = id;
    updateActiveCards();

    el('stageName').innerHTML = e.pretty;
    el('stageEyebrow').textContent = e.group.toUpperCase();
    el('stageSub').textContent = e.chapter + ' · ' + e.chapterName + ' · ' + e.name + '.wrl';
    el('infoName').textContent = e.name + '.wrl';
    el('infoDesc').textContent = e.desc;
    el('infoPath').textContent = isLocal ? e.abs : e.file;
    el('infoQuantum').textContent = e.quantum || '';
    el('infoQuantum').hidden = !e.quantum;
    el('infoTags').innerHTML = e.tags.slice(0, 4).map(function (t) {
      return '<span>' + escapeHtml(t) + '</span>';
    }).join('');
    el('statusRight').textContent = '正在加载 ' + e.name + '.wrl';

    var token = ++state.loadToken;
    showOverlay('正在解析三维模型…', e.name + '.wrl · ' + (e.size / 1024).toFixed(0) + ' KB');
    // 先让浏览器把 loading 状态画出来，再做同步解析
    setTimeout(function () {
      WRL.load(id).then(function (text) {
        if (token !== state.loadToken) return;
        var stats = viewer.setModel(text);
        viewer.setAutoRotate(state.rotating);
        viewer.setWireframe(state.wireframe);
        el('stageStats').innerHTML = '三角面 ' + stats.triangles.toLocaleString('en-US') +
          ' · 对象 ' + stats.objects + ' · 文件 ' + (e.size / 1024).toFixed(0) + ' KB';
        el('statusRight').textContent = e.name + '.wrl · ' + stats.triangles.toLocaleString('en-US') + ' 个三角面';
        hideOverlay();
      }).catch(function (err) {
        if (token !== state.loadToken) return;
        showError(String(err.message || err));
        el('statusRight').textContent = '加载失败';
      });
    }, 24);
  }

  function setView(view) {
    state.view = view;
    Array.prototype.forEach.call(el('tabs').children, function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === view);
    });
    el('workspace').classList.toggle('gallery-mode', view === 'gallery');
    el('galleryWrap').classList.toggle('show', view === 'gallery');
    el('app').classList.toggle('view-gallery', view === 'gallery');
    if (view === 'gallery') renderGallery();
    else if (viewer) setTimeout(function () { viewer.resize(); }, 30);
  }

  function buildToolbar() {
    var defs = [
      { id: 'tbRotate', icon: 'rotate', title: '自动旋转', act: function (b) {
          state.rotating = !state.rotating;
          viewer.setAutoRotate(state.rotating);
          b.classList.toggle('on', state.rotating);
          toast(state.rotating ? '已开启自动旋转' : '已关闭自动旋转');
        } },
      { id: 'tbBg', icon: 'moon', title: '切换背景（深色 / 浅色）', act: function (b) {
          state.mode = state.mode === 'dark' ? 'light' : 'dark';
          viewer.applyMode(state.mode);
          el('stage').classList.toggle('light', state.mode === 'light');
          b.innerHTML = ICONS[state.mode === 'dark' ? 'moon' : 'sun'];
          toast(state.mode === 'dark' ? '深色背景' : '浅色背景');
        } },
      { id: 'tbWire', icon: 'cube', title: '线框模式', act: function (b) {
          state.wireframe = !state.wireframe;
          viewer.setWireframe(state.wireframe);
          b.classList.toggle('on', state.wireframe);
          toast(state.wireframe ? '线框模式' : '实体模式');
        } },
      { sep: true },
      { id: 'tbReset', icon: 'reset', title: '复位视角', act: function () {
          viewer.resetView(); toast('视角已复位');
        } },
      { id: 'tbView', icon: 'compass', title: '切换标准视角', act: function () {
          state.viewIndex = (state.viewIndex + 1) % VIEWS.length;
          var v = VIEWS[state.viewIndex];
          viewer.setView(v.key); toast(v.label);
        } },
      { id: 'tbShot', icon: 'camera', title: '保存当前画面为 PNG', act: function () {
          try {
            var a = document.createElement('a');
            a.href = viewer.snapshot();
            a.download = (state.selected || 'model') + '.png';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            toast('已保存 PNG 截图');
          } catch (err) { toast('截图失败：' + err.message); }
        } },
      { id: 'tbFull', icon: 'expand', title: '全屏查看', act: function () {
          var s = el('stage');
          if (document.fullscreenElement) document.exitFullscreen();
          else if (s.requestFullscreen) s.requestFullscreen();
          else toast('当前浏览器不支持全屏');
        } }
    ];
    el('toolbar').innerHTML = defs.map(function (d) {
      return d.sep ? '<div class="tsep"></div>'
        : '<button class="tbtn" id="' + d.id + '" title="' + d.title + '">' + ICONS[d.icon] + '</button>';
    }).join('');
    defs.forEach(function (d) {
      if (d.sep) return;
      el(d.id).addEventListener('click', function () { d.act(el(d.id)); });
    });
  }

  function buildChips() {
    var counts = {};
    all.forEach(function (e) { counts[e.group] = (counts[e.group] || 0) + 1; });
    var items = [{ name: '全部', n: all.length }].concat(GROUPS.map(function (g) {
      return { name: g, n: counts[g] || 0 };
    }).filter(function (x) { return x.n; }));
    el('groupChips').innerHTML = items.map(function (x) {
      return '<button class="chip' + (x.name === '全部' ? ' active' : '') + '" data-group="' +
        escapeHtml(x.name) + '">' + escapeHtml(x.name) + '<span class="n">' + x.n + '</span></button>';
    }).join('');
    el('groupChips').addEventListener('click', function (ev) {
      var b = ev.target.closest('.chip');
      if (!b) return;
      state.group = b.getAttribute('data-group');
      Array.prototype.forEach.call(this.children, function (c) { c.classList.toggle('active', c === b); });
      refresh();
    });
    el('quickChips').innerHTML = QUICK.map(function (q) {
      return '<button class="chip" data-q="' + escapeHtml(q) + '">' + escapeHtml(q) + '</button>';
    }).join('');
    el('quickChips').addEventListener('click', function (ev) {
      var b = ev.target.closest('.chip');
      if (!b) return;
      el('search').value = b.getAttribute('data-q');
      state.query = el('search').value;
      el('clearBtn').classList.add('show');
      state.group = '全部';
      Array.prototype.forEach.call(el('groupChips').children, function (c) {
        c.classList.toggle('active', c.getAttribute('data-group') === '全部');
      });
      setView('search');
      refresh();
      if (state.filtered.length) select(state.filtered[0].id);
    });
  }

  function bindEvents() {
    var input = el('search');
    // 手机键盘弹起时，让三维舞台占满可视区；收起后结果列表自动回来
    input.addEventListener('focus', function () { document.body.classList.add('searching'); });
    input.addEventListener('blur', function () { document.body.classList.remove('searching'); });
    input.addEventListener('input', function () {
      state.query = input.value;
      el('clearBtn').classList.toggle('show', !!input.value);
      setView('search');
      refresh();
      // 输入停顿后自动渲染最佳匹配，实现「搜 1s 就出 1s 轨道图」
      clearTimeout(searchTimer);
      if (state.query.trim()) {
        searchTimer = setTimeout(function () {
          if (state.filtered.length && state.filtered[0].id !== state.selected) {
            select(state.filtered[0].id);
          }
        }, 420);
      }
    });
    el('clearBtn').addEventListener('click', function () {
      input.value = ''; state.query = '';
      el('clearBtn').classList.remove('show');
      refresh(); input.focus();
    });
    el('results').addEventListener('click', function (ev) {
      var c = ev.target.closest('.card');
      if (c) select(c.getAttribute('data-id'));
    });
    el('gallery').addEventListener('click', function (ev) {
      var c = ev.target.closest('.gcard');
      if (!c) return;
      setView('search');
      select(c.getAttribute('data-id'));
    });
    el('tabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (b) setView(b.getAttribute('data-view'));
    });
    el('randomBtn').addEventListener('click', function () {
      var pool = state.filtered.length ? state.filtered : all;
      setView('search');
      select(pool[Math.floor(Math.random() * pool.length)].id);
    });
    el('openBtn').addEventListener('click', function () {
      var e = byId[state.selected];
      if (!e) return;
      window.open(fileUrl(e), '_blank', 'noopener');
    });
    el('copyBtn').addEventListener('click', function () {
      var e = byId[state.selected];
      if (!e) return;
      var text = e.abs;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('已复制文件路径'); },
          function () { legacyCopy(text); });
      } else legacyCopy(text);
    });
    document.addEventListener('keydown', function (ev) {
      var typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
      if (ev.key === '/' && !typing) { ev.preventDefault(); el('search').focus(); return; }
      if (ev.key === 'Escape') {
        if (typing) { el('search').blur(); }
        else if (state.query) { el('search').value = ''; state.query = ''; el('clearBtn').classList.remove('show'); refresh(); }
        return;
      }
      if (ev.key === 'Enter' && typing) {
        ev.preventDefault();
        clearTimeout(searchTimer);
        if (state.filtered.length) select(state.filtered[0].id);
        el('search').blur();
        return;
      }
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      if (!state.filtered.length) return;
      ev.preventDefault();
      var i = state.filtered.findIndex(function (x) { return x.id === state.selected; });
      i = ev.key === 'ArrowDown' ? Math.min(i + 1, state.filtered.length - 1) : Math.max(i - 1, 0);
      select(state.filtered[i].id);
    });
    document.addEventListener('fullscreenchange', function () {
      setTimeout(function () { if (viewer) viewer.resize(); }, 80);
    });
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制文件路径'); }
    catch (err) { toast('复制失败，请手动选择路径'); }
    document.body.removeChild(ta);
  }

  function init() {
    el('totalCount').textContent = all.length;
    el('randomBtn').innerHTML = ICONS.dice;
    if (!isLocal) {
      document.body.classList.add('online');
      el('statusSource').innerHTML = '<i class="dot"></i>在线浏览 · 数据来自孙宏伟教授课件 VRML 模型';
    }
    buildChips();
    buildToolbar();
    try {
      viewer = new WRLCore.Viewer(el('stage'));
    } catch (err) {
      showError('WebGL 初始化失败：' + err.message);
      return;
    }
    bindEvents();
    refresh();
    if (byId['1s']) select('1s');
    else if (all.length) select(all[0].id);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
