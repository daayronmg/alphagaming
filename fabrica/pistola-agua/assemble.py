import subprocess,os,sys
sys.path.insert(0,'.')
from build import V
D=os.getcwd()
CX={'6160411':0.22,'6160412':0.27,'853784':0.72,'17712334':0.5,'8242982':0.5}
def run(c): subprocess.run(c,check=True)
os.makedirs('seg',exist_ok=True)
for v,segs in V.items():
  parts=[]
  for i,(clip,st,du,txt) in enumerate(segs):
    out=f'seg/{v}{i}.mp4'; ov=f'overlays/{v}{i}.png'
    if clip=='END':
      prev=segs[i-1]; src=f'clips/{prev[0]}.mp4'; st=prev[1]+prev[2]
      vf=f"scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2,eq=brightness=-0.15"
    else:
      src=f'clips/{clip}.mp4'
      # cover crop 9:16 with slow push-in + punch at start
      z=f"(1+0.06*t/{du}+0.10*exp(-t*10))"
      cx=CX[clip];vf=f"scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:x='max(0,min(iw-1080,iw*{cx}-540))':y=0,scale=w='trunc(1080*{z}/2)*2':h='trunc(1920*{z}/2)*2':eval=frame,crop=1080:1920,eq=saturation=1.18:contrast=1.06"
    fc=f"[0:v]{vf},fps=30,setsar=1[b];[1:v]format=rgba,fade=t=in:st=0:d=0.15:alpha=1[o];[b][o]overlay=0:0,format=yuv420p[v]"
    run(['ffmpeg','-v','error','-y','-ss',str(st),'-t',str(du),'-i',src,'-loop','1','-t',str(du),'-i',ov,'-filter_complex',fc,'-map','[v]','-an','-c:v','libx264','-crf','19','-preset','veryfast','-r','30',out])
    parts.append(out)
  open(f'seg/{v}.txt','w').write(''.join(f"file '{os.path.abspath(p)}'\n" for p in parts))
  run(['ffmpeg','-v','error','-y','-f','concat','-safe','0','-i',f'seg/{v}.txt','-f','lavfi','-i','anullsrc=r=44100:cl=stereo','-shortest','-c:v','libx264','-crf','19','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',f'pistola-{v}-sin-voz.mp4'])
  print(v,'ok')
