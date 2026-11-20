const {chromium}=require('playwright');(async()=>{const dir=process.argv[2],fps=30,dur=86.6;
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});
await p.goto('file://'+dir+'/video.html');await p.waitForTimeout(500);
require('fs').mkdirSync(dir+'/frames',{recursive:true});
for(let i=0;i<fps*dur;i++){await p.evaluate(t=>render(t),i/fps);await p.screenshot({path:`${dir}/frames/f${String(i).padStart(4,'0')}.jpg`,type:'jpeg',quality:88});}
await b.close();})();
