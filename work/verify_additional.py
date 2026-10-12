"""Run after (and includes) validate_design.py. No third-party dependencies."""
import contextlib, io, json, re, runpy, subprocess, collections
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
with contextlib.redirect_stdout(io.StringIO()): n=runpy.run_path(str(ROOT/'work/validate_design.py'))
real=collections.Counter()
for seed in range(180):
 for economy in n['INITIAL']:
  trait=n['TRAITS'][int(n['draw'](seed,f'family:{economy}:trait')*6)]
  for style in ['RESEARCH','CAREER','BALANCED','RANDOM']:
   s=n['new'](seed,economy,trait)
   for event in ['HS_01','HS_02']:n['choose_event'](s,event,style)
   for stage in range(1,9):n['term'](s,style,'UG',stage)
   of=n['offers'](s,'UG');ms=n['masters'](s,of)
   real['runs']+=1;real['masters_eligible']+=bool(ms);real['no_offer']+=not any(of.values())
found={}
for seed in range(500):
 trait=n['TRAITS'][int(n['draw'](seed,'family:LOW:trait')*6)]
 s=n['new'](seed,'LOW',trait)
 def choose(eid):
  opts=[c for c in n['ALL'][eid]['choices'] if s['stats']['money']+c['effects']['money']>=0]
  c=max(opts,key=lambda x:4*x['effects']['money']+x['effects']['academics']+.2*x['effects']['wellbeing'])
  n['apply'](s,[c['effects'][k] for k in n['K']]);s['flags'].update(c['setFlags']);s['history'].append((eid,c['id']))
 choose('HS_01');choose('HS_02')
 seq=['WORK','STUDY','WORK','STUDY','WORK','STUDY','WORK','WORK']
 for stage,f in enumerate(seq,1):
  s['stats']['money']=n['clamp'](s['stats']['money']+6);n['focus'](s,f);choose(f'CORE_{stage:02}')
  if 2<=stage<=7:
   slot='A' if stage%2==0 else 'B';beat=stage//2 if slot=='A' else (stage-1)//2
   if beat==1:n['assign_arc'](s,slot)
   choose(f'ARC_{s["arcs"][slot]}_{beat}')
  n['settle'](s)
 of=n['offers'](s,'UG');opts=n['masters'](s,of)
 if len(opts)==2:
  found={'seed':seed,'economy':'LOW','trait':trait,'focus':seq,'stats':s['stats'],'choices':s['history'],'probabilities':n['probabilities'](s,'UG'),'offers':of,'masters_options':opts};break
assert found
admission=(ROOT/'docs/13_ADMISSIONS_AND_TEMPO.md').read_text()
anchors={}
for line in admission.splitlines():
 cells=[x.strip() for x in line.split('|')[1:-1]]
 if len(cells)==7 and cells[0] in ['REACH','STEADY'] and cells[1] in ['0','50','100']:
  anchors[(cells[0],int(cells[1]))]=list(map(int,cells[2:]))
assert len(anchors)==6
admission_cases=0
for strategy in ['REACH','STEADY']:
 previous=None
 for r in range(101):
  low=0 if r<=50 else 50;d=r-low
  w=[a*(50-d)+b*d for a,b in zip(anchors[(strategy,low)],anchors[(strategy,low+50)])]
  assert sum(w)==5000 and min(w)>=0
  prefixes=[sum(w[:k]) for k in range(1,5)]
  if previous is not None:assert all(a>=b for a,b in zip(prefixes,previous))
  previous=prefixes
  units=[9*x//50 for x in w]
  order=sorted(range(5),key=lambda i:(-(9*w[i]%50),i))
  for i in order[:900-sum(units)]:units[i]+=1
  assert sum(units)+100==1000
  admission_cases+=1
assert admission_cases==202
engine=(ROOT/'docs/06_ENGINE_AND_DATA_CONTRACT.md').read_text()
js=re.search(r'```ts\n(.*?)\n```',engine,re.S).group(1).replace(': string','').replace(': number','')
result_path=ROOT/'work/validation_results.json';result=json.loads(result_path.read_text())
js+='\nconst fixtures='+json.dumps(result['rng_vectors'])+';\nfor(const t of fixtures){if(hash32(`${t.seed}:${t.key}`)!==t.u32)throw Error("RNG_MISMATCH");}\n'
subprocess.run(['node','-e',js],check=True,capture_output=True,text=True)
for f in ROOT.rglob('*.md'):
 for name in re.findall(r'\b(?:0[0-9]|1[0-3])_[A-Z_]+\.md',f.read_text()):assert (ROOT/'docs'/name).is_file(),(f,name)
result['actual_profile_tests']=dict(real);result['actual_low_masters_example']=found
result['admissions_cases']=admission_cases;result['rng_cross_language_vectors']=5
result['markdown_files']=len(list(ROOT.rglob('*.md')))
result_path.write_text(json.dumps(result,ensure_ascii=False,indent=2))
(ROOT/'work/low_funding_example.json').write_text(json.dumps(found,ensure_ascii=False,indent=2))
print(json.dumps({'events':result['events'],'choices':result['choices'],'parameter_trajectories':result['undergraduate_simulations'],'actual_profiles':dict(real),'admission_cases':admission_cases,'rng_vectors':5,'low_funding_seed':found['seed'],'markdown_files':result['markdown_files']},ensure_ascii=False,indent=2))
