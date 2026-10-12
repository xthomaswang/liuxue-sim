"""导出 Python 参考实现（validate_design.py）的逐学期轨迹，供 TypeScript 引擎逐步对拍。

不修改 validate_design.py，也不改写它生成的 validation_results.json。无第三方依赖。
用法：python3 work/export_trajectories.py   →  tests/fixtures/trajectories.json
"""
import contextlib, copy, io, json, runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests' / 'fixtures' / 'trajectories.json'

# validate_design.py 在载入结束时会重写 validation_results.json；载入期间把写文件临时换成空操作。
_original_write_text = Path.write_text
Path.write_text = lambda self, *args, **kwargs: 0
try:
    with contextlib.redirect_stdout(io.StringIO()):
        n = runpy.run_path(str(ROOT / 'work' / 'validate_design.py'))
finally:
    Path.write_text = _original_write_text

# run_path 返回的是全局表的拷贝；函数内部查找的是原表，所以要改原表才能记录投入选择。
g = n['term'].__globals__
K = g['K']
STYLES = ['RESEARCH', 'CAREER', 'BALANCED', 'RANDOM']
picks = []
_original_pick = g['pick_focus']


def _recording_pick(state, style, index):
    focus = _original_pick(state, style, index)
    picks.append(focus)
    return focus


g['pick_focus'] = _recording_pick


def snapshot(state):
    return [state['stats'][k] for k in K]


def play_term(state, style, degree, term_index, node=None):
    before = len(state['history'])
    picks.clear()
    g['term'](state, style, degree, term_index, node)
    assert len(picks) == 1
    return {'focus': picks[0], 'events': [[e, c] for e, c in state['history'][before:]], 'stats': snapshot(state)}


def run_one(seed, economy, style):
    trait = g['TRAITS'][int(g['draw'](seed, f'family:{economy}:trait') * 6)]
    s = g['new'](seed, economy, trait)
    g['choose_event'](s, 'HS_01', style)
    g['choose_event'](s, 'HS_02', style)
    out = {
        'seed': seed, 'economy': economy, 'trait': trait, 'style': style,
        'hs': [c for _, c in s['history']], 'hsStats': snapshot(s),
        'terms': [play_term(s, style, 'UG', t) for t in range(1, 9)],
    }
    offers = g['offers'](s, 'UG')
    out.update({
        'arcs': dict(s['arcs']), 'counts': dict(s['counts']),
        'ugProb': g['probabilities'](s, 'UG'), 'ugOffers': offers, 'masters': [],
    })
    for years, _terms, fee in g['masters'](s, offers):
        ms = copy.deepcopy(s)
        ms['stats']['money'] -= fee
        nodes = [1, 4] if years == 1 else [1, 2, 3, 4]
        terms = [play_term(ms, style, 'MS', i, node) for i, node in enumerate(nodes, 1)]
        out['masters'].append({
            'years': years, 'fee': fee, 'terms': terms, 'counts': dict(ms['counts']),
            'prob': g['probabilities'](ms, 'MS'), 'offers': g['offers'](ms, 'MS'),
        })
    return out


runs = [run_one(seed, economy, style) for seed in range(25) for economy in g['INITIAL'] for style in STYLES]
# 硕士入口在自然档案下较少出现：再从后面的 seed 里补一批能读硕士的局，保证续篇也被对拍。
extra = []
for seed in range(25, 700):
    for economy in g['INITIAL']:
        for style in STYLES:
            if len(extra) >= 45:
                break
            run = run_one(seed, economy, style)
            if run['masters']:
                extra.append(run)
runs.extend(extra)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({'source': 'work/validate_design.py', 'runs': runs}, ensure_ascii=False, separators=(',', ':')) + '\n')
print(json.dumps({
    'runs': len(runs), 'withMasters': sum(1 for r in runs if r['masters']),
    'mastersContinuations': sum(len(r['masters']) for r in runs), 'bytes': OUT.stat().st_size,
}))
