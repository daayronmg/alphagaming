const {chromium}=require('playwright');(async()=>{const dir=process.argv[2],fps=30,dur=+process.argv[3]||88.9;
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--allow-file-access-from-files']});
const p=await b.newPage({viewport:{width:1080,height:1920}});p.on('console',m=>console.log('console:',m.text()));p.on('pageerror',e=>console.log('err:',e.message));
await p.goto('file://'+dir+'/index.html');await p.waitForFunction(()=>window.ready===true,{timeout:20000});
require('fs').mkdirSync(dir+'/frames',{recursive:true});
for(let i=0;i<Math.round(fps*dur);i++){await p.evaluate(t=>render(t),i/fps);await p.screenshot({path:`${dir}/frames/f${String(i).padStart(4,'0')}.jpg`,type:'jpeg',quality:90});}
await b.close();})();
