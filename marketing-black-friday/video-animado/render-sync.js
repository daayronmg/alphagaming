const {chromium}=require('playwright');(async()=>{const dir=process.argv[2],fps=30;
const O=[0,3,6,9,12.5,16,18.5,23], N=[0,3.55,5.1,7.1,10.2,13.5,16.0,21.5], dur=N[N.length-1];
const map=t=>{for(let i=0;i<N.length-1;i++){if(t<N[i+1]||i==N.length-2){const k=(t-N[i])/(N[i+1]-N[i]);return O[i]+k*(O[i+1]-O[i])}}};
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});
await p.goto('file://'+dir+'/video.html');await p.waitForTimeout(500);
require('fs').mkdirSync(dir+'/frames',{recursive:true});
for(let i=0;i<Math.round(fps*dur);i++){await p.evaluate(t=>render(t),Math.min(map(i/fps),22.99));await p.screenshot({path:`${dir}/frames/f${String(i).padStart(4,'0')}.jpg`,type:'jpeg',quality:88});}
await b.close();})();
