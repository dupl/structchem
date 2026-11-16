# -*- coding: utf-8 -*-
"""诊断：对比原始 WRL 与清洗后文本中 point 数组的数值，定位丢失位置。"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build_site as bs  # noqa: E402

RAW = Path(r"D:\结构化学\孙宏伟\PPT Chap3 共价键理论基础\CH4-2.wrl")
CLEAN = Path(r"D:\结构化学\孙宏伟\WRL模型图谱\data\models\CH4-2.js")

raw = RAW.read_text(encoding="utf-8", errors="replace")
m = re.search(r"point\s*\[([^\]]*)\]", raw, re.I | re.S)
raw_nums = re.findall(r"[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?", m.group(1))

s = CLEAN.read_text(encoding="utf-8")
v = json.loads(s[s.index(", ") + 2 : s.rindex(");")])
m2 = re.search(r"point \[ ([^\]]*) \]", v)
clean_nums = m2.group(1).split()

print("原始数值个数:", len(raw_nums), " 清洗后:", len(clean_nums))
for i, (x, y) in enumerate(zip(raw_nums, clean_nums)):
    if x != y:
        print("首个差异位置", i, repr(x), repr(y))
        print("原始上下文", raw_nums[max(0, i - 8) : i + 8])
        print("清洗上下文", clean_nums[max(0, i - 8) : i + 8])
        break
else:
    print("前缀一致，清洗后缺失的尾部:", raw_nums[len(clean_nums) : len(clean_nums) + 15])

# 用词法器查看数组里被丢弃的 token 类型
toks = bs.tokenize(m.group(1))
kinds = {}
for t in toks:
    kinds[t.kind] = kinds.get(t.kind, 0) + 1
print("数组 token 统计:", kinds)
print("非数字 token 样本:", [(t.kind, t.text) for t in toks if t.kind != "number"][:20])
