// Local, user-initiated DOM rendering. No page content is sent to a capture service.
export async function captureFeedbackPage({render,document:doc=document,viewport=window,timeout=2500}={}){
 const width=Math.min(2400,Math.max(1,Math.round(viewport.innerWidth))),height=Math.min(1600,Math.max(1,Math.round(viewport.innerHeight)));
 let expired=false,timer,original;
 const work=(async()=>{
  const draw=render||(await import('./vendor/html2canvas.esm.js')).default;
  if(expired)return null;
  original=await draw(doc.body,{width,height,x:viewport.scrollX||0,y:viewport.scrollY||0,windowWidth:viewport.innerWidth,windowHeight:viewport.innerHeight,scale:1,logging:false,allowTaint:false,useCORS:false,proxy:null,imageTimeout:1000,
   ignoreElements:node=>node.id==='feedback-dialog'||node.tagName==='IFRAME'||node.type==='password'||node.type==='file',
   onclone:clone=>{clone.getElementById('feedback-dialog')?.remove();}
  });
  if(expired){original.width=0;original.height=0;return null;}
  const canvas=doc.createElement('canvas');
  try{
   let scale=Math.min(1,1280/original.width,900/original.height);
   for(let attempt=0;attempt<4;attempt++){
    if(expired)return null;
    canvas.width=Math.max(1,Math.round(original.width*scale));canvas.height=Math.max(1,Math.round(original.height*scale));
    canvas.getContext('2d').drawImage(original,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',attempt===0?0.82:0.6));
    if(blob&&blob.size>=12&&blob.size<=150000&&blob.type==='image/jpeg')return blob;
    scale*=0.7;
   }
   return null;
  }finally{canvas.width=0;canvas.height=0;original.width=0;original.height=0;}
 })();
 try{return await Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>{expired=true;resolve(null);},timeout);})]);}catch{return null;}
 finally{clearTimeout(timer);expired=true;}
}
