#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把孙宏伟结构化学课件里的 VRML 模型清洗成浏览器可直接渲染的数据。

处理内容：
  1. 递归收集 *.wrl / *.WRL（大小写不敏感）
  2. 词法分析 -> 轻量 AST
  3. 展开 PROTO 自定义节点（VMDMat / VMDCyl / VMDFace / Surface）
  4. 剔除 Script / ROUTE / 传感器 / 插值器 / Text 等 three.js 不支持的节点
  5. 修正带连字符的 DEF/USE 标识符（Axis-2 -> Axis_2）
  6. 输出按需加载的 JS 数据文件与搜索索引

用法：python tools/build_site.py
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

SRC = Path(r"D:\结构化学\孙宏伟")
OUT = SRC / "WRL模型图谱"
MODELS = OUT / "data" / "models"

RESERVED = {"TRUE", "FALSE", "NULL"}

# three.js VRMLLoader 能构建的节点；其余一律丢弃
KEEP_NODES = {
    "Anchor", "Billboard", "Collision", "Group", "Transform",
    "Inline", "LOD", "Switch",
    "Shape", "Appearance", "Material", "ImageTexture", "PixelTexture",
    "TextureTransform",
    "Box", "Cone", "Cylinder", "ElevationGrid", "Extrusion",
    "IndexedFaceSet", "IndexedLineSet", "PointSet", "Sphere",
    "Color", "Coordinate", "Normal", "TextureCoordinate",
}

TOKEN_RE = re.compile(
    r"""
      (?P<ws>\s+|,)
    | (?P<comment>\#[^\r\n]*)
    | (?P<string>"(?:\\.|[^"\\])*")
    | (?P<hex>0[xX][0-9a-fA-F]+)
    | (?P<number>[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)
    | (?P<ident>[A-Za-z_][A-Za-z0-9_.]*)
    | (?P<punct>[\[\]{}])
    | (?P<other>.)
    """,
    re.VERBOSE,
)


@dataclass
class Token:
    kind: str
    text: str
    start: int
    end: int


def tokenize(text: str) -> list[Token]:
    raw: list[Token] = []
    for m in TOKEN_RE.finditer(text):
        kind = m.lastgroup
        if kind in ("ws", "comment", "other"):
            continue
        raw.append(Token(kind, m.group(), m.start(), m.end()))

    # VRML 里 Axis-2 这种带连字符的标识符：IDENT 紧邻负数 token，合并成 Axis_2
    merged: list[Token] = []
    i = 0
    while i < len(raw):
        tok = raw[i]
        if (
            tok.kind == "ident"
            and i + 1 < len(raw)
            and raw[i + 1].kind == "number"
            and raw[i + 1].text.startswith("-")
            and raw[i + 1].start == tok.end
        ):
            num = raw[i + 1].text
            merged.append(Token("ident", tok.text + "_" + num.lstrip("-"), tok.start, raw[i + 1].end))
            i += 2
            continue
        merged.append(tok)
        i += 1
    return merged


# --------------------------------------------------------------------------
# AST
# --------------------------------------------------------------------------


@dataclass
class Scalar:
    text: str


@dataclass
class IsRef:
    name: str


@dataclass
class Array:
    items: list = field(default_factory=list)


@dataclass
class VField:
    name: str
    values: list = field(default_factory=list)


@dataclass
class VNode:
    name: str
    def_name: str | None = None
    fields: list[VField] = field(default_factory=list)
    use_name: str | None = None


@dataclass
class Proto:
    name: str
    defaults: dict
    body: list


def find_match(tokens: list[Token], open_idx: int, open_ch: str, close_ch: str) -> int:
    depth = 0
    for j in range(open_idx, len(tokens)):
        t = tokens[j].text
        if t == open_ch:
            depth += 1
        elif t == close_ch:
            depth -= 1
            if depth == 0:
                return j
    raise ValueError(f"未闭合的 {open_ch}，起始位置 {open_idx}")


def skip_route(tokens: list[Token], i: int, end: int) -> int:
    """ROUTE a.b TO c.d —— 跳到 TO 之后的下一个 token。"""
    j = i + 1
    while j < end:
        if tokens[j].text == "TO":
            return min(j + 2, end)
        j += 1
    return min(j, end)


def parse_node(tokens: list[Token], i: int, end: int) -> tuple[VNode | None, int]:
    def_name = None
    if tokens[i].text == "DEF" and i + 1 < end:
        def_name = tokens[i + 1].text
        i += 2
    if i >= end:
        return None, i
    if tokens[i].text == "USE" and i + 1 < end:
        return VNode("USE", use_name=tokens[i + 1].text), i + 2
    if tokens[i].kind != "ident":
        return None, i + 1
    name = tokens[i].text
    i += 1
    if i >= end or tokens[i].text != "{":
        return None, i
    close = find_match(tokens, i, "{", "}")
    fields = parse_fields(tokens, i + 1, close)
    return VNode(name, def_name, fields), close + 1


def parse_value(tokens: list[Token], i: int, end: int):
    """返回 (value, next_i)；None 表示这不是值（通常是下一个字段名）。"""
    if i >= end:
        return None, i
    tk = tokens[i]
    if tk.text in ("}", "]"):
        return None, i
    if tk.text == "IS" and i + 1 < end and tokens[i + 1].kind == "ident":
        return IsRef(tokens[i + 1].text), i + 2
    if tk.text in RESERVED or tk.kind in ("string", "number", "hex"):
        return Scalar(tk.text), i + 1
    if tk.text == "[":
        close = find_match(tokens, i, "[", "]")
        return Array(parse_items(tokens, i + 1, close)), close + 1
    if tk.kind == "ident":
        if tk.text in ("DEF", "USE") or (i + 1 < end and tokens[i + 1].text == "{"):
            node, ni = parse_node(tokens, i, end)
            if node is None:
                return None, i + 1
            return node, ni
        return None, i
    return None, i + 1


def parse_items(tokens: list[Token], i: int, end: int) -> list:
    items = []
    while i < end:
        if tokens[i].text == "ROUTE":
            i = skip_route(tokens, i, end)
            continue
        val, ni = parse_value(tokens, i, end)
        if val is None:
            i = max(ni, i + 1)
            continue
        items.append(val)
        i = ni
    return items


def parse_fields(tokens: list[Token], i: int, end: int) -> list[VField]:
    fields: list[VField] = []
    while i < end:
        if tokens[i].text == "ROUTE":
            i = skip_route(tokens, i, end)
            continue
        if tokens[i].kind != "ident":
            i += 1
            continue
        fname = tokens[i].text
        i += 1
        values = []
        while i < end:
            val, ni = parse_value(tokens, i, end)
            if val is None:
                break
            values.append(val)
            i = ni
        fields.append(VField(fname, values))
    return fields


def parse_interface(tokens: list[Token], i: int, end: int) -> dict:
    """PROTO 接口：field <type> <name> <default> ..."""
    keywords = {"field", "exposedField", "eventIn", "eventOut"}
    defaults: dict = {}
    while i < end:
        if tokens[i].text not in keywords:
            i += 1
            continue
        j = i + 1
        if j < end and tokens[j].kind == "ident":  # 类型，如 SFFloat
            j += 1
        if j >= end or tokens[j].kind != "ident":
            i += 1
            continue
        fname = tokens[j].text
        j += 1
        values = []
        while j < end:
            if tokens[j].text in keywords:
                break
            val, nj = parse_value(tokens, j, end)
            if val is None:
                j += 1
                continue
            values.append(val)
            j = nj
        defaults[fname] = values
        i = j
    return defaults


def parse_document(tokens: list[Token]) -> tuple[list, dict]:
    protos: dict = {}
    nodes: list = []
    i, end = 0, len(tokens)
    while i < end:
        tk = tokens[i]
        if tk.text == "PROTO" and i + 1 < end and tokens[i + 1].kind == "ident":
            name = tokens[i + 1].text
            j = i + 2
            while j < end and tokens[j].text != "[":
                j += 1
            if j >= end:
                break
            close_br = find_match(tokens, j, "[", "]")
            defaults = parse_interface(tokens, j + 1, close_br)
            k = close_br + 1
            while k < end and tokens[k].text != "{":
                k += 1
            if k >= end:
                break
            close_cu = find_match(tokens, k, "{", "}")
            body, nested = parse_document(tokens[k + 1 : close_cu])
            protos.update(nested)
            protos[name] = Proto(name, defaults, body)
            i = close_cu + 1
            continue
        if tk.text == "ROUTE":
            i = skip_route(tokens, i, end)
            continue
        if tk.kind == "ident" and (
            tk.text in ("DEF", "USE") or (i + 1 < end and tokens[i + 1].text == "{")
        ):
            node, ni = parse_node(tokens, i, end)
            if node is not None:
                nodes.append(node)
            i = ni if ni > i else i + 1
            continue
        i += 1
    return nodes, protos


# --------------------------------------------------------------------------
# PROTO 展开 + 清理
# --------------------------------------------------------------------------


def substitute(value, instance: dict, defaults: dict) -> list:
    if isinstance(value, IsRef):
        return list(instance.get(value.name, defaults.get(value.name, [])))
    if isinstance(value, Scalar):
        return [value]
    if isinstance(value, Array):
        out = []
        for it in value.items:
            out.extend(substitute(it, instance, defaults))
        return [Array(out)]
    if isinstance(value, VNode):
        return [VNode(value.name, value.def_name,
                      [VField(f.name, [x for v in f.values for x in substitute(v, instance, defaults)])
                       for f in value.fields],
                      value.use_name)]
    return []


def expand_values(values: list, protos: dict, depth: int = 0) -> list:
    if depth > 6:
        raise ValueError("PROTO 嵌套过深")
    out = []
    for v in values:
        out.extend(expand_value(v, protos, depth))
    return out


def expand_value(v, protos: dict, depth: int) -> list:
    if isinstance(v, VNode):
        if v.name in protos and v.name != "USE":
            proto = protos[v.name]
            inst = {f.name: f.values for f in v.fields}
            body: list = []
            for b in proto.body:
                body.extend(substitute(b, inst, proto.defaults))
            return expand_values(body, protos, depth + 1)
        return [VNode(v.name, v.def_name,
                      [VField(f.name, expand_values(f.values, protos, depth)) for f in v.fields],
                      v.use_name)]
    if isinstance(v, Array):
        return [Array(expand_values(v.items, protos, depth))]
    return [v]


def cleanup_values(values: list) -> list:
    out = []
    for v in values:
        c = cleanup_value(v)
        if c is not None:
            out.append(c)
    return out


def numbers_of(node: VNode, field_name: str):
    for f in node.fields:
        if f.name == field_name:
            for v in f.values:
                if isinstance(v, Array):
                    return [x.text for x in v.items if isinstance(x, Scalar)]
    return None


def child_of(node: VNode, field_name: str):
    for f in node.fields:
        if f.name == field_name:
            for v in f.values:
                if isinstance(v, VNode):
                    return v
    return None


def sanitize_indexed_faceset(node: VNode) -> None:
    """课件里有 coordIndex 越界（如 2s.WRL 用了索引 80 但只有 80 个点），
    three.js 会据此生成 NaN 顶点。这里把越界索引钳制到最后一个有效点。"""
    limits = {}
    coord = child_of(node, "coord")
    if coord:
        pts = numbers_of(coord, "point")
        if pts:
            limits["coordIndex"] = len(pts) // 3
    color = child_of(node, "color")
    if color:
        cols = numbers_of(color, "color")
        if cols:
            limits["colorIndex"] = len(cols) // 3
    normal = child_of(node, "normal")
    if normal:
        vec = numbers_of(normal, "vector")
        if vec:
            limits["normalIndex"] = len(vec) // 3
    for f in node.fields:
        limit = limits.get(f.name)
        if not limit:
            continue
        for v in f.values:
            if not isinstance(v, Array):
                continue
            for item in v.items:
                if not isinstance(item, Scalar):
                    continue
                t = item.text
                if not re.fullmatch(r"-?\d+", t):
                    continue
                x = int(t)
                if x >= limit:
                    item.text = str(limit - 1)
                elif x < -1:
                    item.text = "0"


def cleanup_value(v):
    if isinstance(v, Scalar):
        return v
    if isinstance(v, IsRef):
        return None
    if isinstance(v, Array):
        return Array(cleanup_values(v.items))
    if isinstance(v, VNode):
        if v.use_name is not None:
            return v  # USE 稍后统一校验目标是否存在
        if v.name not in KEEP_NODES:
            return None
        fields = []
        for f in v.fields:
            vals = cleanup_values(f.values)
            if vals:
                fields.append(VField(f.name, vals))
        # Shape 没有 geometry 就整体丢掉，避免 three.js 解析出空几何
        if v.name == "Shape" and not any(f.name == "geometry" for f in fields):
            return None
        if v.name in ("Group", "Transform", "Collision", "Anchor", "Billboard", "LOD", "Switch"):
            if not any(f.name == "children" for f in fields):
                return None
        # 值为空的字段不能序列化（VRMLLoader 要求至少一个值）
        fields = [f for f in fields if f.values]
        node = VNode(v.name, v.def_name, fields)
        if v.name == "IndexedFaceSet":
            sanitize_indexed_faceset(node)
        return node
    return None


def collect_defs(values: list, acc: set) -> None:
    for v in values:
        if isinstance(v, VNode):
            if v.def_name:
                acc.add(v.def_name)
            for f in v.fields:
                collect_defs(f.values, acc)
        elif isinstance(v, Array):
            collect_defs(v.items, acc)


def drop_dangling_use(v, defs: set):
    if isinstance(v, VNode):
        if v.use_name is not None and v.use_name not in defs:
            return None
        return VNode(v.name, v.def_name,
                     [VField(f.name, [x for x in (drop_dangling_use(y, defs) for y in f.values) if x is not None])
                      for f in v.fields], v.use_name)
    if isinstance(v, Array):
        return Array([x for x in (drop_dangling_use(y, defs) for y in v.items) if x is not None])
    return v


def serialize_value(v) -> str:
    if isinstance(v, Scalar):
        t = v.text
        # VRML 字符串不允许出现裸换行（three.js 词法器会报错）
        if len(t) >= 2 and t.startswith('"') and t.endswith('"'):
            inner = t[1:-1].replace("\r\n", "\n").replace("\r", "").replace("\n", "\\n")
            return '"' + inner + '"'
        # 原文件里有 "0." 这类写法，three.js 的 NumberLiteral 要求小数点后必须有数字
        m = re.fullmatch(r"([+-]?\d+)\.([eE][+-]?\d+)?", t)
        if m:
            return m.group(1) + ".0" + (m.group(2) or "")
        return t
    if isinstance(v, Array):
        return "[ " + " ".join(serialize_value(x) for x in v.items) + " ]"
    if isinstance(v, VNode):
        return serialize_node(v)
    return ""


def serialize_node(n: VNode) -> str:
    if n.use_name is not None:
        return "USE " + n.use_name
    head = ("DEF " + n.def_name + " " if n.def_name else "") + n.name + " {"
    lines = [head]
    for f in n.fields:
        vals = [serialize_value(v) for v in f.values]
        vals = [x for x in vals if x]
        if not vals:
            continue
        lines.append("  " + f.name + " " + " ".join(vals))
    lines.append("}")
    return "\n".join(lines)


def clean_vrml(text: str) -> tuple[str, int]:
    tokens = tokenize(text)
    nodes, protos = parse_document(tokens)
    expanded = expand_values(nodes, protos)
    cleaned = [c for c in (cleanup_value(v) for v in expanded) if c is not None]
    defs: set = set()
    collect_defs(cleaned, defs)
    final = [x for x in (drop_dangling_use(v, defs) for v in cleaned) if x is not None]
    out = "#VRML V2.0 utf8\n" + "\n".join(serialize_node(n) for n in final) + "\n"
    return out, len(protos)


# --------------------------------------------------------------------------
# 元数据 / 分类
# --------------------------------------------------------------------------

ORBITAL_INFO = {
    "s": (0, "s", "球形对称"),
    "p": (1, "p", "哑铃形，1 个角节面"),
    "d": (2, "d", "花瓣形，2 个角节面"),
    "f": (3, "f", "复杂多瓣，3 个角节面"),
}

ORIENT_LABEL = {
    "": "",
    "x": "x", "y": "y", "z": "z",
    "xy": "xy", "xz": "xz", "yz": "yz",
    "z2": "z²", "x2-y2": "x²−y²",
    "x(x2-3y2)": "x(x²−3y²)", "y(3x2-y2)": "y(3x²−y²)",
    "xz2": "xz²", "yz2": "yz²", "z(x2-y2)": "z(x²−y²)",
    "z3": "z³", "zxy": "zxy",
}

SUPERSCRIPTS = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")


def chapter_of(rel: str) -> tuple[str, str]:
    first = rel.split(os.sep)[0]
    m = re.match(r"PPT Chap(\d+)\s+(.+)", first)
    if m:
        return "第 " + m.group(1) + " 章", m.group(2).strip()
    return "其他", first


def classify(stem: str, chapter_no: str) -> dict:
    low = stem.lower()
    group, desc, tags, alias = "其他", stem, [], ""

    m = re.fullmatch(r"(\d)([spdf])(.*)", low)
    if m and m.group(3) in ORIENT_LABEL:
        n, letter, orient = m.group(1), m.group(2), m.group(3)
        l, lname, shape = ORBITAL_INFO[letter]
        label = ORIENT_LABEL.get(orient, orient)
        pretty = f"{n}{lname}" + (f"<sub>{label}</sub>" if label else "")
        group = "原子轨道"
        desc = f"{n}{lname} 轨道 · n={n}, l={l} · {shape}"
        tags = ["原子轨道", f"{lname} 轨道", f"n={n}", f"l={l}", "量子数"]
        if label:
            tags.append(label)
        alias = f"{n}{letter}轨道 轨道 {n}{lname}"
        return {"group": group, "desc": desc, "tags": tags, "alias": alias, "pretty": pretty,
                "quantum": f"n = {n} · l = {l} · 径向节面 {int(n) - l - 1}"}

    if re.fullmatch(r"(2dbox|3dbox)\d+", low):
        dim = "二维" if low.startswith("2d") else "三维"
        digits = re.sub(r"^[23]dbox", "", low)
        idx = "".join(d.translate(SUPERSCRIPTS) for d in digits)
        group, desc = "势箱波函数", f"{dim}势箱中的定态波函数 ψ{idx}"
        tags, alias = ["势箱", "波函数", dim + "势箱"], "势箱 波函数 box particle"
        pretty = f"ψ{idx} · {dim}势箱"
        return {"group": group, "desc": desc, "tags": tags, "alias": alias, "pretty": pretty, "quantum": ""}

    if re.fullmatch(r"cb-?\d+", low):
        group, desc = "势箱波函数", "一维能带 / 晶体轨道示意 " + stem
        tags, alias = ["能带", "晶体轨道", "Bloch"], "能带 晶体轨道 band CB"
        return {"group": group, "desc": desc, "tags": tags, "alias": alias, "pretty": stem, "quantum": ""}

    if low.startswith(("ch4", "h2o", "hf-", "f1", "f2", "f12", "ben-")):
        mol = {"ch4": "甲烷 CH₄", "h2o": "水 H₂O", "hf": "氟化氢 HF",
               "ben": "苯（HMO）"}.get(next((k for k in ("ch4", "h2o", "hf", "ben") if low.startswith(k)), ""), "")
        if low.startswith(("f1", "f2", "f12")):
            mol = "双原子分子轨道"
        num = re.search(r"-(\d+)$", low) or re.search(r"(\d+)", low)
        ordinal = num.group(1) if num else ""
        group, desc = "分子轨道", f"{mol} · 第 {ordinal} 号分子轨道 / 电子密度等值面"
        tags = ["分子轨道", "电子密度", mol, "等值面"]
        alias = "分子轨道 " + mol + " " + ("甲烷 methane" if "ch4" in low else "") + \
                ("水 water" if "h2o" in low else "") + ("苯 benzene HMO" if "ben" in low else "")
        return {"group": group, "desc": desc, "tags": tags, "alias": alias, "pretty": stem, "quantum": ""}

    if chapter_no in ("第 6 章", "第 7 章") or low.startswith(("017-", "quartz", "cry-surf")):
        gname = re.match(r"^([CDOST][a-z0-9]*(?:-[0-9a-z]+)?|Ci|Cs|Th|Td|Oh)", stem)
        group = "分子对称性" if chapter_no == "第 6 章" else "晶体与点群"
        label = gname.group(1) if gname else stem
        if low.startswith("quartz"):
            label, group = "石英晶体", "晶体与点群"
        if low.startswith("cry-surf"):
            label, group = "晶体表面", "晶体与点群"
        desc = f"{label} · 对称元素 / 点群示意图"
        if low.startswith("quartz"):
            desc = "石英（α-SiO₂）晶体外形与晶面示意"
        if low.startswith("cry-surf"):
            desc = "晶体表面 / 晶面结构示意"
        tags = ["点群", "对称元素", label]
        alias = "对称 点群 " + label + " symmetry group"
        return {"group": group, "desc": desc, "tags": tags, "alias": alias, "pretty": stem, "quantum": ""}

    if low.startswith("a3-"):
        group, desc = "晶体结构", "金属离子晶体堆积示意 " + stem
        tags, alias = ["晶体结构", "堆积"], "晶体 堆积 金属"
        return {"group": group, "desc": desc, "tags": tags, "alias": alias, "pretty": stem, "quantum": ""}

    return {"group": group, "desc": desc, "tags": tags, "alias": alias, "pretty": stem, "quantum": ""}


def js_string(s: str) -> str:
    # 避免 </script> 提前结束脚本标签
    return json.dumps(s, ensure_ascii=False).replace("<", "\\u003c")


def main() -> int:
    if not SRC.is_dir():
        print(f"源目录不存在：{SRC}", file=sys.stderr)
        return 1
    MODELS.mkdir(parents=True, exist_ok=True)
    (OUT / "data" / "thumbs").mkdir(parents=True, exist_ok=True)

    files = sorted(
        (p for p in SRC.rglob("*") if p.is_file() and p.suffix.lower() == ".wrl"
         and "WRL模型图谱" not in p.parts),
        key=lambda p: str(p).lower(),
    )
    print(f"找到 {len(files)} 个 WRL 文件")

    index = []
    used_ids: dict[str, int] = {}
    failed = []
    for n, path in enumerate(files, 1):
        rel = str(path.relative_to(SRC))
        stem = path.stem
        base = re.sub(r"[^A-Za-z0-9_.-]", "_", stem)
        used_ids[base] = used_ids.get(base, 0) + 1
        mid = base if used_ids[base] == 1 else f"{base}-{used_ids[base]}"

        raw = path.read_bytes().decode("utf-8", errors="replace")
        try:
            cleaned, nproto = clean_vrml(raw)
        except Exception as exc:  # 明确报错，不静默跳过
            failed.append((rel, repr(exc)))
            print(f"  !! 解析失败 {rel}: {exc}")
            continue

        chapter_no, chapter_name = chapter_of(rel)
        meta = classify(stem, chapter_no)
        entry = {
            "id": mid,
            "name": stem,
            "file": rel.replace("\\", "/"),
            "abs": str(path).replace("\\", "/"),
            "chapter": chapter_no,
            "chapterName": chapter_name,
            "group": meta["group"],
            "desc": meta["desc"],
            "pretty": meta["pretty"],
            "quantum": meta["quantum"],
            "tags": meta["tags"],
            "alias": meta["alias"],
            "size": path.stat().st_size,
            "proto": nproto,
        }
        index.append(entry)

        payload = "WRL.set(" + js_string(mid) + ", " + js_string(cleaned) + ");\n"
        (MODELS / (mid + ".js")).write_text(payload, encoding="utf-8")
        if n % 40 == 0 or n == len(files):
            print(f"  已处理 {n}/{len(files)}")

    (OUT / "data" / "index.js").write_text(
        "WRL.setIndex(" + json.dumps(index, ensure_ascii=False) + ");\n", encoding="utf-8"
    )
    print(f"完成：{len(index)} 个模型，失败 {len(failed)} 个")
    for rel, err in failed:
        print("  失败:", rel, err)
    if failed:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
