"""Single source of truth for Teeko design tokens -> tokens.json, tokens.css, tailwind.preset.js, contrast report."""
import json
P = {
 "navy":   {"900":"#1F2A44","800":"#2A3654","700":"#3A4766","500":"#5C6886","300":"#A3AABD","100":"#E4E7EE","50":"#F1F3F7"},
 "orange": {"700":"#A44E20","600":"#C2602A","500":"#E07A3F","300":"#F0B48C","100":"#FBE7D9","50":"#FDF3EC"},
 "teal":   {"700":"#17665C","600":"#1F7F73","500":"#2A9D8F","300":"#8CCFC6","100":"#DDF0ED","50":"#EEF8F6"},
 "cream":  {"50":"#FBF8F2","100":"#F6F1E7","200":"#EDE5D6","300":"#DDD3C0"},
 "ink":    {"900":"#1F2A44","700":"#4A5268","500":"#5E6478","400":"#8A8F9C","200":"#C9CCD4"},
 "white":"#FFFFFF",
 "success":{"700":"#2A7148","100":"#E3F1E8"},
 "warning":{"700":"#87590A","600":"#A87410","500":"#E3A21A","100":"#FBF0D9"},
 "error":  {"700":"#B83A2A","100":"#F9E3DF"},
 # mascot-only palette (illustration fills; never use as UI text/background tokens)
 "mascot": {"body":"#EE7A30","shade":"#D7631F","face":"#FFF4DF","beak":"#FCC23A","beak-shade":"#E39A1A","mouth":"#9E3A17","tongue":"#F2806F","cheek":"#F79E98","eye":"#1F2A44","icon-bg":"#F7A04A"},
}
SEM = {  # semantic aliases (what components use)
 "bg-page":"cream.50","bg-surface":"white","bg-subtle":"cream.100","bg-sunken":"cream.200","bg-inverse":"navy.900",
 "text-primary":"navy.900","text-secondary":"ink.700","text-tertiary":"ink.500","text-disabled":"ink.400",
 "text-inverse":"cream.100","text-accent":"orange.700","text-link":"teal.700",
 "border-subtle":"cream.200","border-default":"cream.300","border-strong":"ink.200",
 "brand-primary":"navy.900","brand-primary-hover":"navy.800","brand-accent":"orange.500","brand-accent-hover":"orange.300","brand-secondary":"teal.500",
 "focus-ring":"teal.500",
 "turn":"orange.500","turn-soft":"orange.100","turn-ink":"navy.900",
 "live":"teal.500","live-soft":"teal.100","live-ink":"teal.700",
 "processing":"navy.500","processing-soft":"navy.100",
 "success":"success.700","success-soft":"success.100",
 "warning":"warning.700","warning-mark":"warning.500","warning-soft":"warning.100",
 "error":"error.700","error-soft":"error.100",
 "annotation":"orange.600","border-input":"ink.400",
 "star":"mascot.beak","star-empty":"cream.300","star-edge":"mascot.beak-shade",
 # v0.3 lesson status lights (iPad lesson screen). Each also differs by shape/motion — see DESIGN.md §7.9
 "status-speaking":"navy.900","status-speaking-glow":"teal.300",
 "status-turn":"orange.500","status-turn-soft":"orange.50",
 "status-listening":"teal.500","status-listening-soft":"teal.50",
 "status-thinking":"warning.600","status-thinking-glow":"warning.500","status-thinking-soft":"warning.100",
 "status-paused":"navy.300","status-paused-soft":"navy.50",
 "status-reconnecting":"navy.500",
 "read-highlight":"teal.50","read-pointer":"teal.600","target-highlight":"orange.100","target-mark":"orange.600",
}
FONT = {
 "display":"'Nunito', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
 "body":"'Inter', 'Noto Sans SC', 'Noto Sans CJK SC', 'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei', system-ui, sans-serif",
 "reading":"'Andika', 'Inter', 'Noto Sans SC', 'Literata', 'Noto Serif SC', 'Noto Serif CJK SC', Georgia, serif",
 "mono":"'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
}
# name: (family, weight, size desktop, line-height, letter-spacing, size mobile)
TYPE = {
 "display":("display",900,64,1.05,"-0.02em",40),
 "h1":("display",800,48,1.1,"-0.015em",34),
 "h2":("display",800,36,1.15,"-0.01em",28),
 "h3":("display",800,24,1.25,"0",21),
 "h4":("body",600,18,1.4,"0",17),
 "body-lg":("body",400,18,1.6,"0",17),
 "body":("body",400,16,1.6,"0",16),
 "body-sm":("body",400,14,1.55,"0",14),
 "label":("body",600,14,1.3,"0.01em",14),
 "caption":("body",500,12,1.4,"0.02em",12),
 "overline":("body",700,12,1.3,"0.08em",12),
 "lesson-word":("display",800,34,1.2,"0",28),   # key words on the textbook page (v0.3: was 40/30)
 "lesson-line":("reading",500,24,1.5,"0",20),   # dialogue lines on the textbook page (v0.3: was Nunito 700 28/22)
}
RADIUS = {"xs":4,"sm":8,"md":12,"lg":16,"xl":20,"full":9999}  # v0.3: tightened for 10–12 (was 6/10/14/20/28)
SPACE = {"0":0,"1":4,"2":8,"3":12,"4":16,"5":20,"6":24,"8":32,"10":40,"12":48,"16":64,"20":80,"24":96,"32":128}
SHADOW = {
 "xs":"0 1px 2px rgba(31,42,68,0.06)",
 "sm":"0 1px 2px rgba(31,42,68,0.06), 0 2px 8px rgba(31,42,68,0.05)",
 "md":"0 2px 4px rgba(31,42,68,0.05), 0 8px 24px rgba(31,42,68,0.08)",
 "lg":"0 4px 8px rgba(31,42,68,0.06), 0 20px 48px rgba(31,42,68,0.12)",
 "page":"0 1px 0 rgba(31,42,68,0.04), 0 12px 32px rgba(31,42,68,0.10)",
 "turn":"0 0 0 6px rgba(224,122,63,0.18), 0 8px 24px rgba(224,122,63,0.30)",
 "glow-speaking":"0 0 0 6px rgba(140,207,198,0.45), 0 0 32px 8px rgba(42,157,143,0.18)",
 "glow-thinking":"0 0 0 6px rgba(227,162,26,0.22), 0 0 32px 8px rgba(227,162,26,0.20)",
 "child-turn":"0 0 0 3px #E07A3F, 0 0 0 9px rgba(224,122,63,0.16)",
 "child-listening":"0 0 0 3px #2A9D8F, 0 0 0 9px rgba(42,157,143,0.16)",
 "focus":"0 0 0 2px #FBF8F2, 0 0 0 4px #2A9D8F",
}
MOTION = {
 "duration":{"instant":80,"fast":120,"base":200,"slow":320,"handoff":640,"pulse":1600},
 "easing":{"standard":"cubic-bezier(0.2, 0, 0, 1)","exit":"cubic-bezier(0.4, 0, 1, 1)","emphasized":"cubic-bezier(0.3, 0, 0, 1)","spring":"cubic-bezier(0.34, 1.56, 0.64, 1)","pulse":"cubic-bezier(0.4, 0, 0.6, 1)"},
}
BREAK = {"sm":640,"md":768,"lg":1024,"xl":1280,"2xl":1440}
LAYOUT = {"container-max":1200,"columns":12,"gutter":24,"margin-mobile":20,"margin-tablet":32,"margin-desktop":48,"nav-height":72,"study-rail":400,"study-toolbar":64,"tap-min":44,"tap-kid":56,"mic-size":80,"mascot-study":180,"mascot-hero":300,
 "ipad-w":1194,"ipad-h":834,"lesson-margin":24,"lesson-page-w":840,"lesson-avatar":168,"lesson-child-w":232,"lesson-child-h":174,"lesson-progress":3,"lesson-corner-icon":40}

def res(ref):
    if ref=="white": return P["white"]
    a,b=ref.split("."); return P[a][b]
def flat():
    out={}
    for k,v in P.items():
        if isinstance(v,str): out[k]=v
        else:
            for s,h in v.items(): out[f"{k}-{s}"]=h
    return out
# tokens.json (W3C design-tokens-ish)
J={"$description":"Teeko design tokens v0.3 (generated by build_tokens.py). Semantic tokens reference primitives.",
 "color":{k:({"$type":"color","$value":v} if isinstance(v,str) else {s:{"$type":"color","$value":h} for s,h in v.items()}) for k,v in P.items()},
 "semantic":{k:{"$type":"color","$value":"{color."+v+"}","resolved":res(v)} for k,v in SEM.items()},
 "font":{"family":{k:{"$type":"fontFamily","$value":v} for k,v in FONT.items()},
         "type":{k:{"family":f,"weight":w,"size":f"{s}px","lineHeight":lh,"letterSpacing":ls,"sizeMobile":f"{m}px"} for k,(f,w,s,lh,ls,m) in TYPE.items()}},
 "radius":{k:f"{v}px" for k,v in RADIUS.items()},"space":{k:f"{v}px" for k,v in SPACE.items()},
 "shadow":SHADOW,"motion":{"duration":{k:f"{v}ms" for k,v in MOTION["duration"].items()},"easing":MOTION["easing"]},
 "breakpoint":{k:f"{v}px" for k,v in BREAK.items()},"layout":{k:(f"{v}px" if k!="columns" else v) for k,v in LAYOUT.items()}}
json.dump(J,open("tokens.json","w"),indent=2)
# tokens.css
c=["/* Teeko design tokens v0.3 — generated by build_tokens.py, do not edit by hand */",":root {"]
c+= [f"  --tk-{k}: {v};" for k,v in flat().items()]
c+=["","  /* semantic */"]+[f"  --tk-{k}: var(--tk-{v.replace('.','-')});" for k,v in SEM.items()]
c+=["","  /* type */"]+[f"  --tk-font-{k}: {v};" for k,v in FONT.items()]
for k,(f,w,s,lh,ls,m) in TYPE.items():
    c+=[f"  --tk-text-{k}-size: {m}px;",f"  --tk-text-{k}-lh: {lh};",f"  --tk-text-{k}-weight: {w};",f"  --tk-text-{k}-tracking: {ls};",f"  --tk-text-{k}-family: var(--tk-font-{f});"]
c+=[""]+[f"  --tk-radius-{k}: {v}px;" for k,v in RADIUS.items()]
c+=[""]+[f"  --tk-space-{k}: {v}px;" for k,v in SPACE.items()]
c+=[""]+[f"  --tk-shadow-{k}: {v};" for k,v in SHADOW.items()]
c+=[""]+[f"  --tk-duration-{k}: {v}ms;" for k,v in MOTION["duration"].items()]+[f"  --tk-ease-{k}: {v};" for k,v in MOTION["easing"].items()]
c+=[""]+[f"  --tk-{k}: {v}{'' if k=='columns' else 'px'};" for k,v in LAYOUT.items()]
c+=["}","","/* desktop type sizes (mobile-first: mobile sizes above) */",f"@media (min-width: {BREAK['lg']}px) {{","  :root {"]
c+=[f"    --tk-text-{k}-size: {s}px;" for k,(f,w,s,lh,ls,m) in TYPE.items()]+["  }","}",""]
c+=["@media (prefers-reduced-motion: reduce) {","  :root { --tk-duration-handoff: 1ms; --tk-duration-pulse: 0ms; --tk-duration-slow: 1ms; --tk-duration-base: 1ms; }","}",""]
open("tokens.css","w").write("\n".join(c))
# tailwind preset
def nest():
    o={}
    for k,v in P.items(): o[k]=v
    for k,v in SEM.items(): o[k]=f"var(--tk-{k})"
    return o
tw={"theme":{"screens":{k:f"{v}px" for k,v in BREAK.items()},
 "extend":{"colors":nest(),
  "fontFamily":{k:[x.strip().strip("'") for x in v.split(",")] for k,v in FONT.items()},
  "fontSize":{k:[f"var(--tk-text-{k}-size)",{"lineHeight":str(lh),"letterSpacing":ls,"fontWeight":str(w)}] for k,(f,w,s,lh,ls,m) in TYPE.items()},
  "borderRadius":{k:f"{v}px" for k,v in RADIUS.items()},
  "spacing":{k:f"{v}px" for k,v in SPACE.items() if k!="0"},
  "boxShadow":SHADOW,
  "transitionDuration":{k:f"{v}ms" for k,v in MOTION["duration"].items()},
  "transitionTimingFunction":MOTION["easing"],
  "maxWidth":{"container":f"{LAYOUT['container-max']}px"},
  "keyframes":{"tk-turn-pulse":{"0%, 100%":{"boxShadow":"0 0 0 0 rgba(224,122,63,0.35)"},"50%":{"boxShadow":"0 0 0 12px rgba(224,122,63,0)"}},
               "tk-handoff":{"0%":{"transform":"translate(var(--tk-handoff-from-x,-120px), var(--tk-handoff-from-y,-40px)) rotate(-20deg) scale(.8)","opacity":"0"},"60%":{"opacity":"1"},"100%":{"transform":"translate(0,0) rotate(0) scale(1)","opacity":"1"}},
               "tk-wave":{"0%, 100%":{"transform":"scaleY(.35)"},"50%":{"transform":"scaleY(1)"}},
               "tk-dot":{"0%, 80%, 100%":{"opacity":".25"},"40%":{"opacity":"1"}}},
  "animation":{"turn-pulse":"tk-turn-pulse 1600ms cubic-bezier(0.4, 0, 0.6, 1) infinite","handoff":"tk-handoff 640ms cubic-bezier(0.34, 1.56, 0.64, 1) both","wave":"tk-wave 900ms ease-in-out infinite","dot":"tk-dot 1200ms ease-in-out infinite"}}}}
open("tailwind.preset.js","w").write("/** Teeko Tailwind preset — generated by build_tokens.py. Usage: presets: [require('./tailwind.preset.js')] and import tokens.css once globally. */\nmodule.exports = "+json.dumps(tw,indent=2)+";\n")
# contrast
def L(h):
    h=h.lstrip('#');c=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    c=[x/12.92 if x<=0.03928 else ((x+0.055)/1.055)**2.4 for x in c];return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]
def cr(a,b):
    x,y=sorted([L(a),L(b)],reverse=True);return (x+0.05)/(y+0.05)
pairs=[("text-primary on bg-page","navy.900","cream.50","text"),("text-primary on bg-subtle","navy.900","cream.100","text"),
("text-secondary on bg-page","ink.700","cream.50","text"),("text-secondary on bg-subtle","ink.700","cream.100","text"),
("text-tertiary on bg-surface","ink.500","white","text"),("text-tertiary on bg-subtle","ink.500","cream.100","text"),
("text-accent (orange-700) on bg-page","orange.700","cream.50","text"),("text-link (teal-700) on bg-page","teal.700","cream.50","text"),
("cream-100 on navy-900 (primary button, inverse)","cream.100","navy.900","text"),("navy-900 on orange-500 (accent button, turn)","navy.900","orange.500","text"),
("white on orange-500 (DON'T for text)","white","orange.500","text"),("orange-500 on bg-page (DON'T for text)","orange.500","cream.50","text"),
("orange-500 on navy-900 (wordmark 'ko', dark)","orange.500","navy.900","large"),("navy-900 on teal-100 (chip)","navy.900","teal.100","text"),("navy-900 on teal-50 (reading highlight)","navy.900","teal.50","text"),("navy-900 on orange-50 (target highlight)","navy.900","orange.50","text"),("thinking dots warning-600 vs cream-100 (UI 3:1)","warning.600","cream.100","ui"),("thinking dots warning-600 vs white (UI 3:1)","warning.600","white","ui"),
("teal-700 on teal-100 (live label)","teal.700","teal.100","text"),("success-700 on success-100","success.700","success.100","text"),
("warning-700 on warning-100","warning.700","warning.100","text"),("error-700 on error-100","error.700","error.100","text"),
("orange-700 on orange-100 (turn chip)","orange.700","orange.100","text"),
("teal-500 focus ring vs bg-page (UI 3:1)","teal.500","cream.50","ui"),("annotation orange-600 vs paper white (UI 3:1)","orange.600","white","ui"),("orange-500 decorative mark vs white (decorative only)","orange.500","white","ui"),
("border-input (ink-400) vs bg-surface","ink.400","white","ui"),("border-strong (decorative divider) vs white","ink.200","white","ui")]
rows=[]
for n,a,b,kind in pairs:
    r=cr(res(a),res(b)); need={"text":4.5,"large":3.0,"ui":3.0}[kind]
    rows.append({"pair":n,"fg":res(a),"bg":res(b),"ratio":round(r,2),"need":need,"pass":r>=need})
json.dump(rows,open("contrast.json","w"),indent=2)
for x in rows: print(f"{x['ratio']:5.2f} {'PASS' if x['pass'] else 'FAIL'} (≥{x['need']}) {x['pair']}")
