const {chromium}=require('playwright');(async()=>{const jobs=require(process.argv[2]);const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});
for(const j of jobs){await p.goto('file://'+j);await p.screenshot({path:j.replace('.html','.png'),omitBackground:true});}await b.close()})();
