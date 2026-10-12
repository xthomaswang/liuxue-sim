import json, math, re, collections, copy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ['04_MAIN_STORY.md','05_BRANCH_STORIES.md','10_MASTERS_STORY.md','12_HIGH_SCHOOL_STORY.md']
K = ['money','academics','career','wellbeing']
F = ['STUDY','CAREER','CAMPUS','WORK','REST']
ARCS = ['RESEARCH','INTERNSHIP','FRIENDSHIP','FAMILY','REORIENTATION','CREATIVE']
TRAITS = ['FOCUSED','PRACTICAL','OUTGOING','FRUGAL','RESILIENT','REFLECTIVE']
BASE = {'STUDY':[0,11,1,-7],'CAREER':[0,2,10,-6],'CAMPUS':[0,3,4,6],'WORK':[12,1,3,-7],'REST':[0,1,0,15]}
STIPEND = {'LOW':6,'MID':10,'HIGH':14}
INITIAL = {'LOW':28,'MID':42,'HIGH':56}
ALL = {}
errors=[]
for file in FILES:
    blocks=re.findall(r'```json\s*\n(.*?)\n```', (ROOT/'docs'/file).read_text(), re.S)
    assert len(blocks)==1,(file,len(blocks))
    events=json.loads(blocks[0])
    for e in events:
        assert e['id'] not in ALL,e['id']
        ALL[e['id']]=e
assert len(ALL)==32,len(ALL)
flags={f'{e["id"]}_{c["id"]}' for e in ALL.values() for c in e['choices']}
assert len(flags)==64
for e in ALL.values():
    assert [c['id'] for c in e['choices']]==['A','B'],e['id']
    assert e.get('summary') and e.get('body'),e['id']
    assert any(c['effects']['money']>=0 for c in e['choices']),e['id']
    for c in e['choices']:
        assert set(c['effects'])==set(K),(e['id'],c['id'])
        assert all(type(v)==int and abs(v)<=8 for v in c['effects'].values()),e['id']
        assert sum(abs(v) for v in c['effects'].values())<=16,e['id']
        assert c['setFlags']==[f'{e["id"]}_{c["id"]}'],e['id']
        assert c.get('shortResult') and c.get('result'),e['id']
    for cb in e['callbacks']:
        assert cb['ifFlag'] in flags,(e['id'],cb['ifFlag'])
        assert cb.get('shortText') and cb.get('text'),e['id']
        previous=ALL[cb['ifFlag'].rsplit('_',1)[0]]
        if e['kind']=='arc':
            assert previous.get('arc')==e['arc'] and previous['beat']<e['beat'],e['id']
        elif e['kind']=='core':
            assert previous['kind']=='core' and previous['stage']<e['stage'],e['id']
        elif e['kind']=='masters':
            assert previous['kind'] in ['core','masters'],e['id']
            assert previous['kind']=='core' or previous['node']<e['node'],e['id']
        elif e['kind']=='highschool':
            assert previous['kind']=='highschool' and previous['node']<e['node'],e['id']

def hash32(text):
    h=0x811c9dc5
    for b in text.encode('utf-8'): h=((h^b)*0x01000193)&0xffffffff
    h ^= h>>16; h=(h*0x85ebca6b)&0xffffffff
    h ^= h>>13; h=(h*0xc2b2ae35)&0xffffffff
    h ^= h>>16
    return h&0xffffffff
def draw(seed,key): return hash32(f'{seed & 0xffffffff}:{key}')/4294967296
def clamp(x): return min(100,max(0,x))
def apply(s,d):
    for k,v in zip(K,d): s['stats'][k]=clamp(s['stats'][k]+v)
def new(seed,economy,trait):
    return {'seed':seed,'economy':economy,'trait':trait,'stats':dict(zip(K,[INITIAL[economy],18,12,70])),
      'counts':dict.fromkeys(F,0),'flags':set(),'arcs':{},'history':[],'shortfalls':0}
def focus(s,f):
    before=s['stats']['wellbeing']; d=BASE[f].copy(); t=s['trait']
    if t=='FOCUSED' and f=='STUDY': d[1]+=2
    if t=='PRACTICAL' and f=='CAREER': d[2]+=2
    if t=='OUTGOING' and f=='CAMPUS': d[2]+=2
    if t=='RESILIENT' and d[3]<0: d[3]=min(0,d[3]+2)
    if t=='REFLECTIVE' and f=='REST': d[1]+=1;d[3]+=3
    factor=10 if before>=40 else 8 if before>=20 else 6
    d[1]=(d[1]*factor+5)//10;d[2]=(d[2]*factor+5)//10
    s['counts'][f]+=1;apply(s,d)
def settle(s):
    cost=11 if s['trait']=='FRUGAL' else 12
    short=max(0,cost-s['stats']['money'])
    stress=0 if short==0 else 6+math.ceil(short/3)
    s['stats']['money']=max(0,s['stats']['money']-cost)
    s['stats']['wellbeing']=max(0,s['stats']['wellbeing']-stress)
    s['shortfalls']+=bool(short)
    apply(s,[0,2,1,-3])
def choose_event(s,eid,style):
    e=ALL[eid]; opts=[c for c in e['choices'] if s['stats']['money']+c['effects']['money']>=0]
    assert opts,eid
    if style=='RANDOM': chosen=opts[int(draw(s['seed'],f'choice:{eid}')*len(opts))]
    else:
        st=s['stats']
        weights=[1.8 if st['money']<20 else .3, 1.4 if style=='RESEARCH' else .6,
            1.4 if style=='CAREER' else .6, 1.8 if st['wellbeing']<30 else .4]
        chosen=max(opts,key=lambda c:sum(w*(clamp(st[k]+c['effects'][k])-st[k]) for k,w in zip(K,weights)))
    assert f'{eid}_A' not in s['flags'] and f'{eid}_B' not in s['flags']
    s['flags'].update(chosen['setFlags']);apply(s,[chosen['effects'][k] for k in K]);s['history'].append((eid,chosen['id']))
def assign_arc(s,slot):
    c=s['counts'];st=s['stats'];t=s['trait']
    weights=[1+2*c['STUDY']+st['academics']//25,1+2*c['CAREER']+st['career']//25,
        1+2*c['CAMPUS']+2*(t=='OUTGOING'),1+(s['economy']=='LOW'),
        1+2*c['REST']+2*(st['wellbeing']<40),1+c['CAMPUS']+c['CAREER']+(t=='REFLECTIVE')]
    cand=[(a,w) for a,w in zip(ARCS,weights) if a not in s['arcs'].values()]
    r=draw(s['seed'],f'arc:{slot}')*sum(w for _,w in cand)
    for a,w in cand:
        if r<w:s['arcs'][slot]=a;return
        r-=w
    s['arcs'][slot]=cand[-1][0]
def pick_focus(s,style,i):
    if style=='RANDOM':return F[int(draw(s['seed'],f'focus:{i}')*5)]
    if s['stats']['money']<14:return 'WORK'
    if s['stats']['wellbeing']<25:return 'REST'
    if style=='RESEARCH':return 'STUDY'
    if style=='CAREER':return 'CAREER'
    return ['STUDY','WORK','CAREER','CAMPUS','STUDY','REST','CAREER','STUDY'][i%8]
def term(s,style,degree,n,node=None):
    s['stats']['money']=clamp(s['stats']['money']+STIPEND[s['economy']])
    focus(s,pick_focus(s,style,n-1 if degree=='UG' else n+7))
    choose_event(s,f'CORE_{n:02}' if degree=='UG' else f'MASTER_{node:02}',style)
    if degree=='UG' and n in [2,3,4,5,6,7]:
        slot='A' if n%2==0 else 'B';beat=(n//2 if slot=='A' else (n-1)//2)
        if beat==1:assign_arc(s,slot)
        choose_event(s,f'ARC_{s["arcs"][slot]}_{beat}',style)
    settle(s)
def probabilities(s,degree):
    c=s['counts'];a=s['stats']['academics'];b=s['stats']['career'];f=s['flags']
    S,J,W,U=[c[k] for k in ['STUDY','CAREER','WORK','CAMPUS']]
    ss,j,w=min(S,4),min(J,4),min(W,3)
    R,I,V,MR,MP=[int(k in f) for k in ['ARC_RESEARCH_3_A','ARC_INTERNSHIP_3_A','ARC_CREATIVE_3_A','MASTER_04_A','MASTER_04_B']]
    M=int(degree=='MS')
    eligible=[S>=3 or R or MR,J>=2 or I or V or MP,J>=1 or W>=2 or S>=2 or U>=3 or R or I or V or MR or MP]
    nums=[-2500+90*a+200*ss+1200*R+1000*M+600*MR,
        800+80*b+15*a+200*j+800*I+500*V+500*M+500*MP,
        2000+65*b+20*a+200*j+100*w+400*I+300*R+300*V+500*M+500*MP]
    return {k:(min(cap,max(8,(num+50)//100)) if ok else None)
      for k,num,cap,ok in zip(['PHD','LOCAL_JOB','HOME_JOB'],nums,[85 if degree=='UG' else 95,95,95],eligible)}
def offers(s,degree):
    probs=probabilities(s,degree)
    return {k:p is not None and draw(s['seed'],f'grad:{degree}:{k}')<p/100 for k,p in probs.items()}
def masters(s,off):
    if off['LOCAL_JOB'] or off['HOME_JOB'] or s['stats']['academics']<55:return []
    cost=11 if s['trait']=='FRUGAL' else 12;money=s['stats']['money'];inc=STIPEND[s['economy']]
    return [(years,n,fee) for years,n,fee in [(1,2,8),(2,4,12)] if money>=fee and money-fee+inc*n>=cost*n]

# Verify published formula snapshots independently of any trajectory.
cases=[('UG',50,50,3,2,0,[],[26,60,67]),('UG',72,47,3,2,2,[],[46,60,71]),
('UG',90,90,4,4,0,[],[64,95,95]),('UG',100,50,4,2,0,['ARC_RESEARCH_3_A'],[85,67,80]),
('UG',49,30,3,0,0,[],[25,None,49]),('UG',50,30,3,0,0,[],[26,None,50]),
('MS',80,60,4,2,0,['MASTER_04_A'],[71,77,84]),('MS',80,60,4,2,0,['MASTER_04_B'],[65,82,89]),
('MS',100,80,6,4,0,['ARC_RESEARCH_3_A','MASTER_04_A'],[95,95,95])]
for degree,a,c,S,J,W,fl,expected in cases:
    st=new(1,'MID','FRUGAL');st['stats']['academics']=a;st['stats']['career']=c
    st['counts'].update(STUDY=S,CAREER=J,WORK=W);st['flags']=set(fl)
    assert list(probabilities(st,degree).values())==expected,(degree,expected,probabilities(st,degree))

coverage=collections.Counter();summaries=[];examples={};count=0
for economy in INITIAL:
  for trait in TRAITS:
    for style in ['RESEARCH','CAREER','BALANCED','RANDOM']:
      group=collections.Counter()
      for seed in range(180):
        s=new(seed,economy,trait)
        choose_event(s,'HS_01',style);choose_event(s,'HS_02',style)
        for n in range(1,9):term(s,style,'UG',n)
        assert sum(s['counts'].values())==8
        assert len(s['history'])==16
        assert len(set(s['arcs'].values()))==2
        of=offers(s,'UG');options=masters(s,of)
        group['runs']+=1;group['masters_eligible']+=bool(options);group['UG_PHD_offer']+=of['PHD']
        for item in s['history']:coverage[item]+=1
        examples.setdefault(f'{economy}_UG',{'seed':seed,'trait':trait,'style':style,'stats':s['stats'].copy(),'counts':s['counts'].copy(),'p':probabilities(s,'UG'),'offers':of})
        for years,n,fee in options:
            ms=copy.deepcopy(s);ms['stats']['money']-=fee
            for term_n,node in enumerate([1,4] if years==1 else [1,2,3,4],1):term(ms,style,'MS',term_n,node)
            assert sum(ms['counts'].values())==8+n
            assert ('MASTER_04_A' in ms['flags']) != ('MASTER_04_B' in ms['flags'])
            for item in ms['history'][16:]:coverage[item]+=1
            group[f'MS_{years}Y']+=1
            examples.setdefault(f'{economy}_MS_{years}Y',{'seed':seed,'trait':trait,'style':style,'UGstats':s['stats'].copy(),'UGp':probabilities(s,'UG'),'UGoffers':of,'stats':ms['stats'].copy(),'p':probabilities(ms,'MS'),'offers':offers(ms,'MS')})
        count+=1
      summaries.append({'economy':economy,'trait':trait,'style':style,**group})

missing=sorted(flags-{f'{eid}_{choice}' for eid,choice in coverage})
assert not missing,missing
# Test depleted states against every event and every focus; no legal step deadlocks.
for e in ALL.values():
    s=new(42,'LOW','FOCUSED');s['stats']=dict.fromkeys(K,0)
    choose_event(s,e['id'],'RANDOM')
    assert all(0<=x<=100 for x in s['stats'].values())
for f in F:
    s=new(42,'LOW','FOCUSED');s['stats']=dict.fromkeys(K,0);focus(s,f);settle(s)
    assert all(0<=x<=100 for x in s['stats'].values())

totals=collections.Counter()
for g in summaries:
    for k,v in g.items():
        if isinstance(v,int):totals[k]+=v
result={'events':len(ALL),'choices':len(flags),'core':8,'arcs':18,'masters':4,'highschool':2,
        'formula_cases':len(cases),'undergraduate_simulations':count,'choice_coverage':len(coverage),
        'totals':dict(totals),'examples':examples,
        'rng_vectors':[{'seed':seed,'key':key,'u32':hash32(f'{seed}:{key}'),'roll':draw(seed,key)}
          for seed,key in [(0,'grad:UG:PHD'),(42,'grad:UG:PHD'),(42,'grad:MS:PHD'),(20261011,'arc:A'),(42,'admission:readiness')]]}
Path(__file__).with_name('validation_results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False,indent=2))
