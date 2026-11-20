import subprocess, json, os, sys
D=os.path.dirname(os.path.abspath(__file__))
# clip: (file, start, dur); text; variant segments
V={
'A':[('8242982',1.0,2.6,'¿ESTO… SIN CABLES? 🤯'),('6160411',2.0,3.4,'una pasada y fuera mugre 💦'),('853784',2.0,3.2,'va con batería 🔋 + un cubo de agua 🪣'),('6160412',3.0,3.4,'coche · bici · terraza'),('17712334',4.0,3.2,'y sin pagar el túnel de lavado 💸'),('END',0,3.0,'está en la cesta 🛒')],
'B':[('17712334',2.0,2.8,'¿otra vez pagando el lavado del coche? 🙄'),('853784',1.0,2.8,'sin enchufe en el garaje… imposible, ¿no?'),('6160412',2.0,3.4,'pues con batería y un cubo de agua 🪣'),('6160411',5.0,3.4,'fuera mugre de la terraza 💦'),('8242982',3.0,3.0,'si no tienes enchufe cerca, esto te salva'),('END',0,3.0,'está en la cesta 🛒')],
'C':[('6160411',8.0,2.8,'vale, tengo que enseñaros esto 😳'),('853784',4.0,3.0,'pistola de agua a presión… sin cables'),('8242982',5.0,3.0,'pensaba que no iba a tener fuerza'),('6160412',8.0,3.4,'para algo profesional no, eh'),('17712334',8.0,3.0,'pero para el coche y la terraza, de lujo'),('END',0,3.0,'os la dejo en la cesta 🛒')],
}
def run(c): subprocess.run(c,check=True)
html='''<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0}body{width:1080px;height:1920px;background:transparent;font-family:'Inter','Noto Color Emoji',sans-serif}
.t{position:absolute;left:70px;right:70px;top:TOPpx;text-align:center}
.t span{font-weight:900;font-size:SIZEpx;line-height:1.35;color:#fff;background:BG;padding:8px 22px;border-radius:18px;box-decoration-break:clone;-webkit-box-decoration-break:clone;-webkit-text-stroke:STROKE;paint-order:stroke fill;text-shadow:SHADOW}
.lab{position:absolute;right:24px;bottom:24px;font-size:24px;color:#fff;opacity:.75;font-weight:600;text-shadow:0 0 4px #000}
</style></head><body><div class="t"><span>TXT</span></div>LAB</body></html>'''
os.makedirs(D+'/overlays',exist_ok=True)
jobs=[]
for v,segs in V.items():
  for i,(clip,st,du,txt) in enumerate(segs):
    end=clip=='END'; first=i==0
    h=html.replace('TOP','780' if end else ('260' if first else '1380')).replace('SIZE','96' if end or first else '64')
    h=h.replace('BG','#FE2C55' if end else ('transparent'))
    h=h.replace('STROKE','0' if end else '8px #000').replace('SHADOW','none' if end else '0 6px 18px rgba(0,0,0,.6)')
    h=h.replace('TXT',txt).replace('LAB','' if end else '<div class="lab">imagen ilustrativa · Pexels</div>')
    p=f'{D}/overlays/{v}{i}.html';open(p,'w').write(h);jobs.append(p)
json.dump(jobs,open(D+'/overlays/jobs.json','w'))
