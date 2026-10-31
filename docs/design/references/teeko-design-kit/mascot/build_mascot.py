"""Teeko sparrow — hand-built flat vector rig. Run: python3 build_mascot.py
Outputs SVGs in ./svg and the head icon. All shapes are plain paths/ellipses; no raster."""
import os, math
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "svg")
os.makedirs(OUT, exist_ok=True)

C = dict(
    body="#EE7A30", shade="#D7631F", face="#FFF4DF", beak="#FCC23A", beak_shade="#E39A1A",
    mouth="#9E3A17", tongue="#F2806F", eye="#1F2A44", hi="#FFFFFF", cheek="#F79E98",
    feet="#E39A1A", shadow="#1F2A44", mic="#1F2A44", mic_head="#3A4766", mic_grille="#A3AABD",
    teal="#2A9D8F", cream="#F6F1E7",
)

# ---------- mouths (front view). Each is a self-contained <g>; upper beak drawn on top ----------
UPPER = f'<path class="beak-upper" d="M103,137 C110,128.5 130,128.5 137,137 C133.5,145 127,151 120,155.5 C113,151 106.5,145 103,137 Z" fill="{C["beak"]}"/>' \
        f'<path d="M110,134.5 C114,132.5 119,132 123,132.6" stroke="#FFE08A" stroke-width="2.4" stroke-linecap="round" fill="none"/>'

def mouth(kind):
    if kind == "closed":
        inner = f'<path d="M109,147 Q120,161 131,147 Q120,155 109,147 Z" fill="{C["beak_shade"]}"/>'
    elif kind == "small":
        inner = (f'<path d="M107,145 Q120,166 133,145 Z" fill="{C["mouth"]}"/>'
                 f'<path d="M107,145 Q120,170 133,145 Q120,163 107,145 Z" fill="{C["beak_shade"]}"/>')
    elif kind == "wide":
        inner = (f'<path d="M104,143 Q120,183 136,143 Z" fill="{C["mouth"]}"/>'
                 f'<ellipse cx="120" cy="156" rx="7.5" ry="4.2" fill="{C["tongue"]}"/>'
                 f'<path d="M104,143 Q120,188 136,143 Q120,178 104,143 Z" fill="{C["beak_shade"]}"/>')
    elif kind == "oo":
        inner = (f'<ellipse cx="120" cy="155" rx="7" ry="7.5" fill="{C["mouth"]}"/>'
                 f'<path d="M111,152 Q111,167.5 120,167.5 Q129,167.5 129,152 Q127.5,163 120,163 Q112.5,163 111,152 Z" fill="{C["beak_shade"]}"/>')
    else:
        raise ValueError(kind)
    up = UPPER
    if kind == "oo":  # pursed: narrower upper beak
        up = f'<path class="beak-upper" d="M107,137 C112,129 128,129 133,137 C131,144 126,149 120,152 C114,149 109,144 107,137 Z" fill="{C["beak"]}"/>' \
             f'<path d="M112,134.5 C115,133 119,132.6 122,133" stroke="#FFE08A" stroke-width="2.2" stroke-linecap="round" fill="none"/>'
    return f'<g id="mouth-{kind}" data-viseme="{kind}">{inner}{up}</g>'

# ---------- eyes ----------
def eyes(kind="open", dx=0, dy=0):
    L, R, y = 92 + dx, 148 + dx, 121 + dy
    if kind == "open":
        e = ""
        for x in (L, R):
            e += f'<ellipse cx="{x}" cy="{y}" rx="11" ry="13.5" fill="{C["eye"]}"/>'
            e += f'<circle cx="{x+3.6}" cy="{y-4.8}" r="4.2" fill="{C["hi"]}"/><circle cx="{x-3.4}" cy="{y+5}" r="1.8" fill="{C["hi"]}" opacity=".8"/>'
        return f'<g class="eyes eyes-open">{e}</g>'
    if kind == "happy":
        e = "".join(f'<path d="M{x-10},{y+3} Q{x},{y-10} {x+10},{y+3}" stroke="{C["eye"]}" stroke-width="5" stroke-linecap="round" fill="none"/>' for x in (L, R))
        return f'<g class="eyes eyes-happy">{e}</g>'
    if kind == "blink":
        e = "".join(f'<path d="M{x-9},{y+1} Q{x},{y+6} {x+9},{y+1}" stroke="{C["eye"]}" stroke-width="4.5" stroke-linecap="round" fill="none"/>' for x in (L, R))
        return f'<g class="eyes eyes-blink">{e}</g>'
    raise ValueError(kind)

def cheeks(dx=0):
    return f'<g class="cheeks" opacity=".9"><ellipse cx="{68+dx}" cy="{150}" rx="12" ry="7.5" fill="{C["cheek"]}"/><ellipse cx="{172+dx}" cy="{150}" rx="12" ry="7.5" fill="{C["cheek"]}"/></g>'

# ---------- parts ----------
WING = "M-7,-6 C13,-12 27,8 25,40 C24,58 10,70 -3,63 C-13,55 -15,14 -7,-6 Z"
def wing(side, angle, extra="", sc=1):
    # side: 'r' (viewer right) or 'l'. angle: deg; negative = raise outward, positive = swing inward/across body
    px, sx = (174, 1) if side == "r" else (66, -1)
    return (f'<g class="wing wing-{side}" transform="translate({px},172) scale({sx*sc},{sc}) rotate({angle})">'
            f'{extra}<path d="{WING}" fill="{C["shade"]}"/>'
            f'<path d="M4,30 C8,40 8,50 3,57" stroke="{C["body"]}" stroke-width="3" stroke-linecap="round" fill="none" opacity=".7"/></g>')

def mic(x, y, rot=0, s=1):
    return (f'<g class="mic-prop" transform="translate({x},{y}) rotate({rot}) scale({s})">'
            f'<rect x="-5.5" y="4" width="11" height="34" rx="5.5" fill="{C["mic"]}"/>'
            f'<rect x="-8" y="2" width="16" height="6" rx="3" fill="{C["body"]}"/>'
            f'<circle cx="0" cy="-9" r="13" fill="{C["mic_head"]}"/>'
            f'<path d="M-8,-15 H8 M-11,-9 H11 M-8,-3 H8" stroke="{C["mic_grille"]}" stroke-width="2" stroke-linecap="round"/>'
            f'<circle cx="-5" cy="-15" r="2.4" fill="#fff" opacity=".55"/></g>')

def feet(lift=0, spread=0):
    y = 258 - lift
    g = f'<g class="feet" stroke="{C["feet"]}" stroke-linecap="round" fill="none">'
    for x in (102 - spread, 138 + spread):
        g += f'<path d="M{x},{y} V{y+15}" stroke-width="7"/>'
        g += f'<path d="M{x},{y+15} l-9,6 M{x},{y+15} l0,8 M{x},{y+15} l9,6" stroke-width="5.5"/>'
    return g + '</g>'

def shadow(scale=1.0):
    return f'<ellipse class="ground" cx="120" cy="285" rx="{58*scale:.1f}" ry="{7*scale:.1f}" fill="{C["shadow"]}" opacity=".12"/>'

TUFT = (f'<g class="tuft"><path d="M114,44 C104,30 104,18 110,10 C118,18 120,32 118,44 Z" fill="{C["body"]}"/>'
        f'<path d="M120,44 C122,30 128,20 138,16 C138,28 132,38 124,46 Z" fill="{C["shade"]}"/></g>')
TAIL_FRONT = (f'<g class="tail"><path d="M168,232 C186,234 206,240 218,252 C204,256 186,254 170,246 Z" fill="{C["shade"]}"/>'
              f'<path d="M166,240 C182,248 196,258 202,270 C188,268 174,260 164,250 Z" fill="{C["body"]}"/></g>')

def body_front():
    return (f'<defs><clipPath id="clip-body"><ellipse cx="120" cy="202" rx="72" ry="62"/></clipPath>'
            f'<clipPath id="clip-head"><circle cx="120" cy="112" r="76"/></clipPath></defs>'
            f'<g class="body"><ellipse cx="120" cy="202" rx="72" ry="62" fill="{C["body"]}"/>'
            f'<ellipse cx="120" cy="218" rx="52" ry="50" fill="{C["face"]}" clip-path="url(#clip-body)"/></g>')

def head_front(eyes_svg, mouth_svg, cheek_dx=0, extra=""):
    return (f'<g class="head"><circle cx="120" cy="112" r="76" fill="{C["body"]}"/>'
            f'<ellipse cx="120" cy="142" rx="68" ry="58" fill="{C["face"]}" clip-path="url(#clip-head)"/>'
            f'<path d="M70,82 C80,62 100,52 118,50" stroke="#F59A5A" stroke-width="5" stroke-linecap="round" fill="none" opacity=".55"/>'
            f'{cheeks(cheek_dx)}{eyes_svg}<g class="mouth-slot" transform="translate(120,142) scale(1.22) translate(-120,-142)">{mouth_svg}</g>{extra}</g>')

def svg(inner, w=240, h=300, vb=None, title="Teeko sparrow"):
    vb = vb or f"0 0 {w} {h}"
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w}" height="{h}"><title>{title}</title>{inner}</svg>'

def write(name, content, **kw):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(svg(content, **kw))

# ---------- poses ----------
def pose_idle():
    sound = (f'<g class="listen-arcs" stroke="{C["teal"]}" stroke-width="4" stroke-linecap="round" fill="none">'
             f'<path d="M206,92 Q214,104 206,116"/><path d="M216,82 Q230,104 216,126" opacity=".6"/></g>')
    g = shadow() + '<g class="sparrow">' + feet() + TAIL_FRONT + TUFT
    g += body_front() + wing("l", 10)
    g += '<g transform="rotate(-7,120,176)">' + head_front(eyes("open", 3, 0), mouth("closed")) + '</g>'
    g += wing("r", -150) + sound + '</g>'
    return g

def pose_talking():
    marks = (f'<g class="talk-marks" stroke="{C["eye"]}" stroke-width="4" stroke-linecap="round">'
             f'<path d="M206,106 L220,98"/><path d="M210,126 L226,126"/><path d="M206,146 L220,154"/></g>')
    g = shadow() + '<g class="sparrow">' + feet() + TAIL_FRONT + TUFT
    g += body_front() + wing("l", -70) + wing("r", 12)
    g += '<g transform="rotate(4,120,176)">' + head_front(eyes("open"), mouth("wide")) + '</g>' + marks + '</g>'
    return g

def pose_handoff():
    # leans toward viewer-right, right wing extended holding the mic out to the child
    g = shadow() + '<g class="sparrow" transform="rotate(5,120,282)">' + feet() + TAIL_FRONT + TUFT
    g += body_front() + wing("l", 14)
    g += '<g transform="rotate(6,120,176)">' + head_front(eyes("open", 4, 2), mouth("small")) + '</g>'
    g += wing("r", -72)
    g += mic(238, 152, 12, 1.25)
    g += f'<ellipse cx="236" cy="190" rx="10" ry="8" fill="{C["shade"]}" transform="rotate(-20,236,190)"/>'
    g += '</g>'
    spark = (f'<g class="spark" fill="{C["body"]}"><path d="M268,112 l3,8 8,3 -8,3 -3,8 -3,-8 -8,-3 8,-3 Z"/>'
             f'<circle cx="276" cy="150" r="3.5" fill="{C["teal"]}"/></g>')
    return g + spark

def pose_thinking():
    dots = (f'<g class="think"><circle cx="184" cy="62" r="5" fill="{C["mic_grille"]}"/><circle cx="196" cy="46" r="6.5" fill="{C["mic_grille"]}"/>'
            f'<g transform="translate(214,24)"><circle cx="0" cy="0" r="17" fill="#fff" stroke="{C["mic_grille"]}" stroke-width="3"/>'
            f'<path d="M-5,-5 Q-5,-11 0,-11 Q6,-11 6,-5 Q6,-1 0,1 V4" stroke="{C["eye"]}" stroke-width="3.5" stroke-linecap="round" fill="none"/><circle cx="0" cy="9" r="2.2" fill="{C["eye"]}"/></g></g>')
    g = shadow() + '<g class="sparrow">' + feet() + TAIL_FRONT + TUFT
    g += body_front() + wing("l", 10)
    g += '<g transform="rotate(-5,120,176)">' + head_front(eyes("open", 4, -5), mouth("oo")) + '</g>'
    g += wing("r", 106, sc=0.8) + '</g>' + dots
    return g

def pose_celebrate():
    conf = ""
    for (x, y, r, col) in [(26, 60, 0, C["body"]), (212, 40, 30, C["teal"]), (40, 190, 50, C["beak"]), (210, 182, -20, C["body"]),
                           (60, 18, 15, C["teal"]), (190, 110, 0, C["beak"])]:
        conf += f'<rect x="{x}" y="{y}" width="12" height="6" rx="3" fill="{col}" transform="rotate({r},{x+6},{y+3})"/>'
    star = lambda x, y, s, col: f'<path transform="translate({x},{y}) scale({s})" d="M0,-10 L3,-3 10,-3 4.5,1.5 6.5,9 0,4.5 -6.5,9 -4.5,1.5 -10,-3 -3,-3 Z" fill="{col}"/>'
    conf += star(30, 120, 1.1, C["beak"]) + star(214, 76, 1.3, C["body"]) + star(200, 18, 0.9, C["teal"])
    g = shadow(0.75) + conf + '<g class="sparrow" transform="translate(0,-12)">' + feet() + TAIL_FRONT + TUFT
    g += body_front() + wing("l", -138) + wing("r", -138)
    g += head_front(eyes("happy"), mouth("wide")) + '</g>'
    return g

# ---------- turnaround ----------
def view_front():
    return shadow() + '<g class="sparrow">' + feet() + TAIL_FRONT + TUFT + body_front() + wing("l", 10) + wing("r", 10) + head_front(eyes("open"), mouth("closed")) + '</g>'

def view_threequarter():
    # facing viewer-left (like the app icon)
    d = (f'<defs><clipPath id="c3b"><ellipse cx="124" cy="202" rx="70" ry="62"/></clipPath><clipPath id="c3h"><circle cx="122" cy="112" r="76"/></clipPath></defs>')
    g = d + shadow() + '<g class="sparrow">' + feet(0, 0).replace('M102,', 'M98,').replace('M138,', 'M134,')
    g += f'<g class="tail"><path d="M180,228 C200,230 218,238 228,250 C212,254 194,252 178,244 Z" fill="{C["shade"]}"/><path d="M178,238 C194,246 206,256 210,268 C196,266 184,258 174,248 Z" fill="{C["body"]}"/></g>'
    g += TUFT.replace('M114,44', 'M118,44').replace('M120,44', 'M126,44')
    g += f'<g transform="translate(60,176) scale(-1,1) rotate(4)"><path d="{WING}" fill="{C["shade"]}" opacity=".9"/></g>'
    g += f'<ellipse cx="124" cy="202" rx="70" ry="62" fill="{C["body"]}"/><ellipse cx="108" cy="218" rx="48" ry="50" fill="{C["face"]}" clip-path="url(#c3b)"/>'
    g += f'<circle cx="122" cy="112" r="76" fill="{C["body"]}"/><ellipse cx="104" cy="143" rx="66" ry="58" fill="{C["face"]}" clip-path="url(#c3h)"/>'
    g += f'<path d="M78,80 C90,62 108,52 126,50" stroke="#F59A5A" stroke-width="5" stroke-linecap="round" fill="none" opacity=".55"/>'
    g += f'<ellipse cx="54" cy="150" rx="7" ry="6.5" fill="{C["cheek"]}" opacity=".9"/><ellipse cx="156" cy="151" rx="13" ry="8" fill="{C["cheek"]}" opacity=".9"/>'
    g += f'<ellipse cx="68" cy="121" rx="8.5" ry="12.5" fill="{C["eye"]}"/><circle cx="70.5" cy="116" r="3.2" fill="#fff"/>'
    g += f'<ellipse cx="130" cy="121" rx="11.5" ry="14" fill="{C["eye"]}"/><circle cx="134" cy="116" r="4.4" fill="#fff"/><circle cx="126.5" cy="126.5" r="1.8" fill="#fff" opacity=".8"/>'
    g += (f'<path d="M84,148 Q96,160 104,148 Q96,154 84,148 Z" fill="{C["beak_shade"]}"/>'
          f'<path d="M106,136 C100,128 86,128 72,138 C66,142 68,146 74,148 C86,151 98,150 108,146 Z" fill="{C["beak"]}"/>'
          f'<path d="M80,136 C86,132.5 94,132 100,133" stroke="#FFE08A" stroke-width="2.4" stroke-linecap="round" fill="none"/>')
    g += f'<g transform="translate(178,174) rotate(10)"><path d="{WING}" fill="{C["shade"]}"/></g></g>'
    return g

def view_side():
    d = (f'<defs><clipPath id="csb"><ellipse cx="134" cy="202" rx="66" ry="62"/></clipPath><clipPath id="csh"><circle cx="118" cy="112" r="72"/></clipPath></defs>')
    g = d + shadow() + '<g class="sparrow">'
    g += f'<g class="feet" stroke="{C["feet"]}" stroke-linecap="round" fill="none"><path d="M130,258 V273" stroke-width="7"/><path d="M130,273 l-12,4 M130,273 l-6,8 M130,273 l6,4" stroke-width="5.5"/>'
    g += f'<path d="M144,256 V273" stroke-width="7" opacity=".85"/><path d="M144,273 l-12,4 M144,273 l-6,8" stroke-width="5.5" opacity=".85"/></g>'
    g += f'<g class="tail"><path d="M184,218 C206,214 226,218 238,226 C224,236 204,240 186,236 Z" fill="{C["shade"]}"/><path d="M186,230 C204,234 220,242 226,254 C210,254 194,248 182,240 Z" fill="{C["body"]}"/></g>'
    g += f'<g class="tuft"><path d="M120,42 C116,28 120,16 128,10 C132,22 130,34 126,42 Z" fill="{C["body"]}"/><path d="M128,44 C134,32 144,26 154,26 C150,36 142,44 132,48 Z" fill="{C["shade"]}"/></g>'
    g += f'<ellipse cx="134" cy="202" rx="66" ry="62" fill="{C["body"]}"/><ellipse cx="96" cy="214" rx="46" ry="52" fill="{C["face"]}" clip-path="url(#csb)"/>'
    g += f'<circle cx="118" cy="112" r="72" fill="{C["body"]}"/><ellipse cx="74" cy="140" rx="56" ry="56" fill="{C["face"]}" clip-path="url(#csh)"/>'
    g += f'<path d="M90,62 C106,50 126,46 144,52" stroke="#F59A5A" stroke-width="5" stroke-linecap="round" fill="none" opacity=".55"/>'
    g += f'<ellipse cx="82" cy="150" rx="11" ry="7" fill="{C["cheek"]}" opacity=".9"/>'
    g += f'<ellipse cx="76" cy="120" rx="10.5" ry="13.5" fill="{C["eye"]}"/><circle cx="72.5" cy="115" r="4.2" fill="#fff"/><circle cx="79.5" cy="126" r="1.8" fill="#fff" opacity=".8"/>'
    g += (f'<path d="M50,146 Q40,154 34,150 Q42,146 50,144 Z" fill="{C["beak_shade"]}"/>'
          f'<path d="M54,130 C42,130 30,136 24,142 C30,147 44,148 56,146 Z" fill="{C["beak"]}"/>'
          f'<path d="M34,137 C40,134.5 46,133.6 52,133.6" stroke="#FFE08A" stroke-width="2.4" stroke-linecap="round" fill="none"/>')
    g += f'<g transform="translate(150,168) rotate(-22)"><path d="M-12,-8 C14,-16 38,10 34,48 C32,68 16,80 0,72 C-16,62 -22,16 -12,-8 Z" fill="{C["shade"]}"/><path d="M6,34 C12,46 12,58 6,66" stroke="{C["body"]}" stroke-width="3" stroke-linecap="round" fill="none" opacity=".7"/></g>'
    return g + '</g>'

def view_back():
    g = shadow() + '<g class="sparrow">' + feet()
    g += TUFT + f'<circle cx="120" cy="112" r="76" fill="{C["body"]}"/><ellipse cx="120" cy="202" rx="72" ry="62" fill="{C["body"]}"/>'
    g += f'<path d="M72,150 C90,170 150,170 168,150" stroke="{C["shade"]}" stroke-width="5" stroke-linecap="round" fill="none" opacity=".5"/>'
    for (x, y) in [(104, 192), (120, 186), (136, 192), (112, 214), (128, 214)]:
        g += f'<path d="M{x},{y} q4,8 0,14" stroke="{C["shade"]}" stroke-width="5" stroke-linecap="round" fill="none"/>'
    g += f'<g transform="translate(66,172) scale(-1,1) rotate(6)"><path d="{WING}" fill="{C["shade"]}"/></g><g transform="translate(174,172) rotate(6)"><path d="{WING}" fill="{C["shade"]}"/></g>'
    g += f'<path d="M100,246 C92,262 96,280 108,290 C114,282 116,272 120,262 C124,272 126,282 132,290 C144,280 148,262 140,246 Z" fill="{C["shade"]}"/>'
    return g + '</g>'

# ---------- head icon: crop of the 3/4 head, beak open ----------
def head34(open_mouth=True):
    g = (f'<defs><clipPath id="ih34"><circle cx="122" cy="112" r="76"/></clipPath></defs>'
         f'<circle cx="122" cy="112" r="76" fill="{C["body"]}"/><ellipse cx="104" cy="143" rx="66" ry="58" fill="{C["face"]}" clip-path="url(#ih34)"/>'
         f'<rect x="20" y="160" width="220" height="70" fill="{C["face"]}"/>'
         f'<path d="M78,80 C90,62 108,52 126,50" stroke="#F59A5A" stroke-width="5" stroke-linecap="round" fill="none" opacity=".55"/>'
         f'<ellipse cx="54" cy="150" rx="7" ry="6.5" fill="{C["cheek"]}" opacity=".9"/><ellipse cx="156" cy="151" rx="13" ry="8" fill="{C["cheek"]}" opacity=".9"/>'
         f'<ellipse cx="68" cy="121" rx="8.5" ry="12.5" fill="{C["eye"]}"/><circle cx="70.5" cy="116" r="3.2" fill="#fff"/>'
         f'<ellipse cx="130" cy="121" rx="11.5" ry="14" fill="{C["eye"]}"/><circle cx="134" cy="116" r="4.4" fill="#fff"/><circle cx="126.5" cy="126.5" r="1.8" fill="#fff" opacity=".8"/>')
    if open_mouth:
        g += (f'<path d="M76,144 C84,166 104,170 112,150 Z" fill="{C["mouth"]}"/>'
              f'<path d="M86,156 C92,164 102,165 106,158 C100,160 92,159 86,156 Z" fill="{C["tongue"]}"/>'
              f'<path d="M76,146 C84,172 106,174 114,150 C106,166 88,166 76,146 Z" fill="{C["beak_shade"]}"/>')
    g += (f'<path d="M110,138 C104,128 88,127 72,136 C64,141 66,147 74,148 C88,150 100,148 112,145 Z" fill="{C["beak"]}"/>'
          f'<path d="M80,135 C86,131.5 94,131 100,132" stroke="#FFE08A" stroke-width="2.4" stroke-linecap="round" fill="none"/>')
    return g

def head_icon(size=512, bg="#F7A04A", radius=116):
    # 512 canvas; head geometry lives in the 240x300 rig space, scaled 3.3x and offset
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="{size}" height="{size}"><title>Teeko sparrow icon</title>'
            f'<defs><clipPath id="icr"><rect width="512" height="512" rx="{radius}"/></clipPath></defs>'
            f'<g clip-path="url(#icr)"><rect width="512" height="512" fill="{bg}"/>'
            f'<g transform="translate(-84,-72) scale(3.1)">{head34(True)}</g></g></svg>')

if __name__ == "__main__":
    write("view-front.svg", view_front(), title="Teeko — front")
    write("view-three-quarter.svg", view_threequarter(), title="Teeko — 3/4")
    write("view-side.svg", view_side(), title="Teeko — side")
    write("view-back.svg", view_back(), title="Teeko — back")
    write("pose-idle-listening.svg", pose_idle(), title="Teeko — listening")
    write("pose-talking.svg", pose_talking(), title="Teeko — talking")
    write("pose-handoff.svg", pose_handoff(), w=290, vb="0 0 290 300", title="Teeko — your turn (hands the mic)")
    write("pose-thinking.svg", pose_thinking(), title="Teeko — thinking")
    write("pose-celebrate.svg", pose_celebrate(), title="Teeko — celebrating")
    for k in ("closed", "small", "wide", "oo"):
        write(f"mouth-{k}.svg", f'<rect x="88" y="118" width="64" height="72" rx="12" fill="{C["face"]}"/>' + mouth(k), w=64, h=72, vb="88 118 64 72", title=f"mouth {k}")
    # rig: front talking body with all 4 visemes; toggle with CSS: .mouth-slot > g{display:none} .mouth-slot > g.on{display:inline}
    rig = ('<style>.mouth-slot>g{display:none}.mouth-slot>g.on{display:inline}</style>' + shadow() + '<g class="sparrow">' + feet() + TAIL_FRONT + TUFT
           + body_front() + wing("l", 10) + wing("r", 10)
           + head_front(eyes("open") + eyes("blink").replace('class="eyes eyes-blink"', 'class="eyes eyes-blink" style="display:none"'),
                        "".join(mouth(k) for k in ("closed", "small", "wide", "oo")).replace('id="mouth-closed"', 'id="mouth-closed" class="on"')) + '</g>')
    write("teeko-rig-front.svg", rig, title="Teeko rig — swap .on between #mouth-closed/#mouth-small/#mouth-wide/#mouth-oo")
    with open(os.path.join(HERE, "teeko-head-icon.svg"), "w") as f:
        f.write(head_icon())
    with open(os.path.join(HERE, "teeko-head-icon-cream.svg"), "w") as f:
        f.write(head_icon(bg="#F6F1E7"))
    write("head-three-quarter.svg", head34(True), w=200, h=200, vb="22 30 200 200", title="Teeko head 3/4")
    print("ok")

# ---------- animated talking loop (pure SVG + CSS, works as <img> or inline) ----------
SEQ = ["closed", "small", "wide", "small", "oo", "small", "wide", "wide", "small", "closed", "oo", "small", "wide", "small", "closed", "closed"]
FRAME_MS = 90  # ~11 fps, matches typical viseme rate

def talking_svg():
    n = len(SEQ); dur = n * FRAME_MS
    css = [".mouth-slot>g{visibility:hidden}"]
    for k in ("closed", "small", "wide", "oo"):
        stops = []
        for i, f in enumerate(SEQ):
            stops.append(f"{i*100/n:.3f}%{{visibility:{'visible' if f==k else 'hidden'}}}")
        css.append(f"@keyframes v-{k}{{{''.join(stops)}100%{{visibility:{'visible' if SEQ[0]==k else 'hidden'}}}}}")
        css.append(f"#mouth-{k}{{animation:v-{k} {dur}ms steps(1,end) infinite}}")
    css.append("@keyframes bob{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-2px) rotate(2deg)}}")
    css.append(".head{transform-box:view-box;transform-origin:120px 176px;animation:bob 720ms ease-in-out infinite}")
    css.append("@keyframes blink{0%,92%,100%{visibility:visible}93%,97%{visibility:hidden}}@keyframes blink2{0%,92%,100%{visibility:hidden}93%,97%{visibility:visible}}")
    css.append(".eyes-open{animation:blink 3600ms steps(1,end) infinite}.eyes-blink{animation:blink2 3600ms steps(1,end) infinite}")
    css.append("@keyframes gest{0%,100%{transform:translate(66px,172px) scale(-1,1) rotate(-40deg)}50%{transform:translate(66px,172px) scale(-1,1) rotate(-70deg)}}")
    css.append(".wing-l{animation:gest 1440ms ease-in-out infinite}")
    css.append("@media (prefers-reduced-motion:reduce){.head,.wing-l{animation:none}}")
    inner = f'<style>{"".join(css)}</style>' + shadow() + '<g class="sparrow">' + feet() + TAIL_FRONT + TUFT + body_front()
    inner += wing("l", -40) + wing("r", 12)
    inner += head_front(eyes("open") + eyes("blink"), "".join(mouth(k) for k in ("closed", "small", "wide", "oo"))) + '</g>'
    return svg(inner, title="Teeko talking loop")

with open(os.path.join(OUT, "teeko-talking-loop.svg"), "w") as f:
    f.write(talking_svg())
