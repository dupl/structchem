# 结构化学 · 三维模型图谱

把孙宏伟教授《结构化学》课件里散落的 **258 个 VRML 模型**（约 99.5 MB、7 个章节）收进一个可搜索、可交互的离线网页：输入 `1s` 就渲染 1s 轨道，输入 `2p` 就能在 2px / 2py / 2pz 之间切换。

纯静态站点，零后端、零联网依赖。three.js 与全部渲染依赖都在 `vendor/` 里，`file://` 双击即可运行。

> 模型数据来自孙宏伟教授课件，仅用于教学与个人学习。仓库目前公开，若用于公开分发请先确认版权。

## 本仓库的两个分支

| 分支 | 移动端搜索 | 说明 |
|---|---|---|
| `main` | **无浮层**：结果列表常驻，收起键盘后滑动选择 | 当前默认分支，界面最干净 · **本 README 所在分支** |
| `master` | **有候选下拉**：输入时搜索框下方弹出匹配项，点选即切换 | 键盘弹起时也能一步选到同类模型 |

两个分支功能完全一致，差异只有 `index.html`、`assets/app.css`、`assets/app.js`、`tools/verify_mobile.js` 四个文件。切换：`git checkout master` / `git checkout main`。

## 快速开始

| 方式 | 操作 |
|---|---|
| 本地双击 | 打开 `index.html` |
| Windows 一键 | `start.bat` |
| 本地 HTTP / 手机同局域网 | 项目根目录执行 `python -m http.server 8000`，手机访问 `http://<电脑IP>:8000/` |
| GitHub Pages | Settings → Pages → Deploy from a branch → 选 `main`（或 `master`）/ `(root)` → Save，访问 `https://dupl.github.io/structchem/` |

`file://` 与 `http(s)://` 均可。通过 HTTP 打开时会自动隐藏「复制本机路径 / 打开原文件」按钮——本机绝对路径在手机上没有意义。

## 功能

- **搜索**：即时过滤 + 停顿 0.42 秒自动渲染最佳匹配；支持中文别名（`苯`、`石英`）、多关键词、分类筛选、快捷检索。
- **模型覆盖**：原子轨道 30、分子轨道 23、势箱波函数 22、分子对称性 95、晶体与点群 86、晶体结构 2。
- **缩略图**：258 张离线渲染的真实预览，左侧结果列表与「总览」网格共用。
- **三维查看器**：拖动旋转、滚轮缩放、右键平移；自动取景、自动旋转、四种标准视角、深/浅背景、线框模式、复位、PNG 截图、全屏。
- **信息条**：轨道量子数（n / l / 径向节面）、章节、标签、原文件路径、复制路径、打开原文件。

### 键盘快捷键

| 键 | 作用 |
|---|---|
| `/` | 聚焦搜索框 |
| `↑` `↓` | 在结果中切换模型 |
| `Enter` | 打开当前匹配并收起键盘 |
| `Esc` | 搜索框失焦 / 清空搜索 |

## 移动端

- 竖屏：三维舞台在上、结果列表在下；`100dvh` + 刘海安全区；顶栏固定两行；工具条移到舞台底部、可横向滑动、40px 触摸目标；分类与快捷检索横向滑动。
- 横屏：恢复左右分栏（侧栏 232px），避免舞台被压扁。
- 触屏：单指旋转、双指缩放 / 平移；渲染倍率上限 1.5×，并监听虚拟键盘引起的视口变化。

**本分支（`main`）的搜索**：不弹任何浮层。输入 `2p` 时结果列表里 2px / 2py / 2pz 全部在，点页面空白处或按键盘「搜索 / 完成」键收起键盘即可滑动点选；搜索态不改布局，收键盘时卡片不会错位、点击不会落空。不需要退出全屏之类的绕路操作。

## 目录结构

```
index.html            站点入口
thumb.html            缩略图批量渲染页（构建用）
start.bat             Windows 双击启动
assets/
  app.css             界面样式（含响应式）
  app.js              搜索、筛选、交互
  core.js             three.js 场景 / VRML 解析封装
vendor/               three r147 + chevrotain + VRMLLoader + OrbitControls（全本地）
data/
  index.js            258 个模型的索引与元数据
  models/*.js         清洗后的 VRML 文本（按需加载）
  thumbs/*.jpg        258 张预览图
tools/
  build_site.py       VRML 清洗 → 索引 + 模型数据
  make_thumbs.js      headless Chrome 批量渲染缩略图
  verify.js           桌面端到端验证
  verify_mobile.js    多视口 / 触摸 / 在线模式验证
  ...                 诊断脚本（debug_lex / diag_geom / diag_points / sample_models）
```

## 数据与重建

课件增删 `.wrl` 后，在项目根目录：

```bash
python tools/build_site.py          # 重新扫描 D:\结构化学\孙宏伟，清洗并重建索引
cd tools && npm install && cd ..    # 首次需要：puppeteer-core
node tools/make_thumbs.js           # 重生成缩略图
```

`build_site.py` 里 `SRC` 是绝对路径 `D:\结构化学\孙宏伟`；`make_thumbs.js` / `verify*.js` 里的 `CHROME` 常量是本机 Chrome 路径，换机器需改成对应路径。

## 为什么要清洗 VRML

课件里的 `.wrl` 不能直接喂给浏览器，构建脚本做了这些处理：

1. 展开 4 类自定义 `PROTO`（`VMDMat` / `VMDCyl` / `VMDFace` / `Surface`）；剔除 `Script` / `ROUTE` / 传感器 / 插值器 / `Text` 等 three.js 不支持的节点。
2. 修正带连字符的 `DEF` / `USE` 标识符、`0.` 尾点数字、含真实换行的字符串，去掉会破坏词法的 `WorldInfo` 节点。
3. 钳制原文件里越界的 `coordIndex`（`2s.WRL` 自身用了索引 80 但只有 80 个点，会生成 NaN 顶点）。
4. 本地修正 three.js r147 `VRMLLoader.js` 把 `specularColor` 错写成 `emissiveColor` 的 bug；把 VRML 的 `shininess`(0~1) 归一化到 three.js 量纲；给只有顶点色、没有 `appearance` 的曲面补材质。

另外 `assets/app.css` 里 `.gallery` 加了 `grid-auto-rows: max-content`——否则带 `overflow:hidden` 的网格项会被压成 2px，258 张缩略图只剩细条纹。

## 验证

```bash
node tools/verify.js           # 桌面：搜索、渲染、总览、缩略图
node tools/verify_mobile.js    # 390/360/320 竖屏、844 横屏、1440 桌面 + file:// 回归
```

`verify_mobile.js` 会自起本地 HTTP 服务，用 headless Chrome 模拟触摸设备，检查布局尺寸、控制台报错、搜索 `2p` 时 2py / 2pz 是否可选、总览 258 张卡片是否完整。验证截图输出到 `tools/shots/`（该目录与 `tools/node_modules/` 均在 `.gitignore` 中）。

## 许可与说明

模型与课件内容的权利归原作者所有；本仓库只是做了一个便于检索与查看的本地工具。若用于课堂教学之外，请先取得授权。
