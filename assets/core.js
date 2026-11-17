/* WRL 模型图谱 — 数据装载与三维渲染核心
 * 依赖：three.min.js / chevrotain.min.js / VRMLLoader.js / OrbitControls.js（均为本地经典脚本）
 * 数据以 <script> 方式按需加载，因此 file:// 直接双击打开也能工作。
 */
(function (global) {
  'use strict';

  var store = Object.create(null);
  var index = [];
  var pending = Object.create(null);

  var WRL = {
    set: function (id, text) { store[id] = text; },
    setIndex: function (arr) { index = arr; },
    index: function () { return index; },
    has: function (id) { return Object.prototype.hasOwnProperty.call(store, id); },

    load: function (id) {
      if (Object.prototype.hasOwnProperty.call(store, id)) {
        return Promise.resolve(store[id]);
      }
      if (pending[id]) return pending[id];
      pending[id] = new Promise(function (resolve, reject) {
        var tag = document.createElement('script');
        tag.src = 'data/models/' + encodeURIComponent(id) + '.js';
        tag.onload = function () {
          delete pending[id];
          if (Object.prototype.hasOwnProperty.call(store, id)) resolve(store[id]);
          else reject(new Error('模型数据为空：' + id));
          tag.parentNode && tag.parentNode.removeChild(tag);
        };
        tag.onerror = function () {
          delete pending[id];
          reject(new Error('无法加载模型文件：' + id + '.js'));
          tag.parentNode && tag.parentNode.removeChild(tag);
        };
        document.head.appendChild(tag);
      });
      return pending[id];
    }
  };
  global.WRL = WRL;

  var BG = {
    dark: 0x0d1726,
    light: 0xf2f6fb,
    midnight: 0x060b14
  };

  function makeRenderer(w, h) {
    var coarse = global.matchMedia && global.matchMedia('(pointer: coarse)').matches;
    var maxRatio = coarse ? 1.5 : 2;
    var r = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    // 高分屏手机按 3x 渲染几十万三角面会明显掉帧，触屏设备上限 1.5x
    r.setPixelRatio(Math.min(global.devicePixelRatio || 1, maxRatio));
    r.setSize(w, h, false);
    r.outputEncoding = THREE.sRGBEncoding;
    return r;
  }

  function addLights(scene) {
    scene.add(new THREE.AmbientLight(0xffffff, 0.58));
    var a = new THREE.DirectionalLight(0xffffff, 0.68);
    a.position.set(1.0, 1.2, 1.6);
    scene.add(a);
    var b = new THREE.DirectionalLight(0xdce8ff, 0.22);
    b.position.set(-1.2, -0.6, -1.0);
    scene.add(b);
  }

  /* VRML 的 shininess 取值 0~1，而 three.js 的 MeshPhongMaterial 用 0~128；
     直接照搬会让高光铺满整个曲面、把模型洗成白色。这里统一归一化。 */
  function normalizeMaterials(root) {
    root.traverse(function (o) {
      if (!o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        // VRML 里省略 appearance、只给顶点色的 Shape，加载器会生成黑色 MeshBasicMaterial，
        // 结果曲面全黑；这里让它按顶点色正常显示。
        if (m.isMeshBasicMaterial && m.vertexColors && m.color && m.color.getHex() === 0x000000) {
          m.color.setHex(0xffffff);
        }
        if (!m.isMeshPhongMaterial) return;
        if (m.shininess < 3) m.shininess = 80 + m.shininess * 60;
        if (m.specular) m.specular.multiplyScalar(0.26);
        if (m.emissive) m.emissive.multiplyScalar(0.35);
      });
    });
  }

  function parseModel(text) {
    var loader = new THREE.VRMLLoader();
    var parsed = loader.parse(text);
    var group = new THREE.Group();
    while (parsed.children.length) group.add(parsed.children[0]);
    normalizeMaterials(group);
    return group;
  }

  function boundsOf(obj) {
    var box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) {
      return { center: new THREE.Vector3(0, 0, 0), radius: 8, box: box };
    }
    var sphere = box.getBoundingSphere(new THREE.Sphere());
    var size = box.getSize(new THREE.Vector3());
    var flat = Math.max(size.x, size.y, size.z);
    return {
      center: sphere.center.clone(),
      radius: Math.max(sphere.radius, 1e-3),
      box: box,
      size: size,
      flat: flat
    };
  }

  function placeCamera(camera, controls, bounds, tilt) {
    var fov = camera.fov * Math.PI / 180;
    var dist = bounds.radius / Math.sin(fov / 2) * 1.15;
    var k = tilt === undefined ? 1 : tilt;
    var dir = new THREE.Vector3(0.30 * k, 0.22 * k, 1.0).normalize();
    camera.near = Math.max(bounds.radius / 2000, 1e-4);
    camera.far = Math.max(bounds.radius * 200, 1000);
    camera.position.copy(bounds.center).addScaledVector(dir, dist);
    camera.up.set(0, 1, 0);
    camera.lookAt(bounds.center);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(bounds.center);
      controls.minDistance = bounds.radius * 0.05;
      controls.maxDistance = bounds.radius * 40;
      controls.update();
    }
  }

  function disposeObject(obj) {
    obj.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
  }

  function countTriangles(obj) {
    var n = 0;
    obj.traverse(function (o) {
      if (!o.geometry) return;
      var g = o.geometry;
      if (g.index) n += g.index.count / 3;
      else if (g.attributes && g.attributes.position) n += g.attributes.position.count / 3;
    });
    return Math.round(n);
  }

  /** 主查看器 */
  function Viewer(container, opts) {
    opts = opts || {};
    this.container = container;
    this.renderer = makeRenderer(container.clientWidth || 800, container.clientHeight || 600);
    this.renderer.domElement.className = 'wrl-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG.dark);
    addLights(this.scene);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100000);
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.75;
    this.controls.zoomSpeed = 0.9;
    this.controls.autoRotateSpeed = 1.1;

    this.mode = 'dark';
    this.model = null;
    this.bounds = null;
    this.wireframe = false;
    this.grid = null;
    this.running = true;

    var self = this;
    this._onResize = function () { self.resize(); };
    global.addEventListener('resize', this._onResize);
    // iOS 上虚拟键盘弹出/收起不一定触发 window.resize
    if (global.visualViewport) {
      this._onVVResize = function () { self.resize(); };
      global.visualViewport.addEventListener('resize', this._onVVResize);
    }
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(function () { self.resize(); });
      this._ro.observe(container);
    }
    this.resize();
    this._animate = function () { self.tick(); };
    this.tick();
  }

  Viewer.prototype.resize = function () {
    var w = this.container.clientWidth;
    var h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  Viewer.prototype.tick = function () {
    if (!this.running) return;
    global.requestAnimationFrame(this._animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  Viewer.prototype.setModel = function (text) {
    if (this.model) {
      this.scene.remove(this.model);
      disposeObject(this.model);
      this.model = null;
    }
    var group = parseModel(text);
    this.model = group;
    this.scene.add(group);
    this.bounds = boundsOf(group);
    this.applyMode(this.mode);
    this.resetView();
    return {
      triangles: countTriangles(group),
      objects: (function () { var n = 0; group.traverse(function () { n++; }); return n; })(),
      radius: this.bounds.radius
    };
  };

  Viewer.prototype.applyMode = function (mode) {
    this.mode = mode;
    this.scene.background = new THREE.Color(BG[mode] || BG.dark);
    if (!this.model) return;
    var light = mode === 'light';
    this.model.traverse(function (o) {
      if (!o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m.color || m.vertexColors) return;
        if (m.userData.__wrlColor === undefined) m.userData.__wrlColor = m.color.getHex();
        if (!light) { m.color.setHex(m.userData.__wrlColor); return; }
        var c = new THREE.Color(m.userData.__wrlColor);
        var lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        // 浅色背景下把近白色材质压暗，避免模型"消失"
        m.color.setHex(lum > 0.86 ? 0x5d6f88 : m.userData.__wrlColor);
      });
    });
  };

  Viewer.prototype.setWireframe = function (on) {
    this.wireframe = !!on;
    if (!this.model) return;
    var flag = this.wireframe;
    this.model.traverse(function (o) {
      if (!o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) { if ('wireframe' in m) m.wireframe = flag; });
    });
  };

  Viewer.prototype.setAutoRotate = function (on) { this.controls.autoRotate = !!on; };
  Viewer.prototype.resetView = function () {
    if (this.bounds) placeCamera(this.camera, this.controls, this.bounds);
  };
  Viewer.prototype.setView = function (name) {
    if (!this.bounds) return;
    var b = this.bounds;
    var fov = this.camera.fov * Math.PI / 180;
    var dist = b.radius / Math.sin(fov / 2) * 1.15;
    var dirs = {
      front: new THREE.Vector3(0, 0, 1),
      top: new THREE.Vector3(0, 1, 0.0001),
      side: new THREE.Vector3(1, 0, 0),
      iso: new THREE.Vector3(0.30, 0.22, 1).normalize()
    };
    var d = dirs[name] || dirs.iso;
    this.camera.position.copy(b.center).addScaledVector(d, dist);
    this.camera.lookAt(b.center);
    this.controls.target.copy(b.center);
    this.controls.update();
  };
  Viewer.prototype.snapshot = function () {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  };
  Viewer.prototype.destroy = function () {
    this.running = false;
    global.removeEventListener('resize', this._onResize);
    if (this._onVVResize && global.visualViewport) {
      global.visualViewport.removeEventListener('resize', this._onVVResize);
    }
    if (this._ro) this._ro.disconnect();
  };

  /** 离线缩略图：用独立的小渲染器渲染一次并返回 JPEG data URL */
  function renderThumb(text, w, h, mode) {
    w = w || 320; h = h || 240;
    mode = mode || 'dark';
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    renderer.outputEncoding = THREE.sRGBEncoding;
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(BG[mode] || BG.dark);
    addLights(scene);
    var camera = new THREE.PerspectiveCamera(36, w / h, 0.01, 100000);
    var group;
    try {
      group = parseModel(text);
    } catch (e) {
      renderer.dispose();
      throw e;
    }
    scene.add(group);
    var bounds = boundsOf(group);
    placeCamera(camera, null, bounds, 0.8);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    var url = canvas.toDataURL('image/jpeg', 0.82);
    disposeObject(group);
    renderer.dispose();
    renderer.forceContextLoss && renderer.forceContextLoss();
    return url;
  }

  global.WRLCore = {
    Viewer: Viewer,
    renderThumb: renderThumb,
    parseModel: parseModel,
    boundsOf: boundsOf,
    BG: BG
  };
})(window);
