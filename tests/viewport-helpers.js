// Sample document coordinates from the viewport bitmap, accounting for pan,
// zoom and display density. Pass fractions for normalized document coordinates.
export function artworkPixel(page, x, y, normalized = false) {
  return page.locator('#artwork').evaluate((canvas, {x,y,normalized}) => {
    const stage=document.querySelector('#stage'), area=document.querySelector('#workspace');
    const matrix=new DOMMatrix(getComputedStyle(stage).transform);
    if(normalized){x*=parseFloat(stage.style.width);y*=parseFloat(stage.style.height);}
    const px=Math.floor((matrix.e+x*matrix.a)*canvas.width/area.clientWidth);
    const py=Math.floor((matrix.f+y*matrix.d)*canvas.height/area.clientHeight);
    return [...canvas.getContext('2d').getImageData(px,py,1,1).data];
  }, {x,y,normalized});
}
export function checkSavedRendering(page) {
  return page.evaluate(async()=>{
    const {loadProject,listProjects}=await import('./js/storage/projects.js'),{DocumentRenderer}=await import('./js/rendering/renderer.js');
    const {doc,assets}=await loadProject((await listProjects())[0].id),renderer=new DocumentRenderer();
    try{
      const png=await createImageBitmap(await renderer.exportPNG(doc,assets)),exported=document.createElement('canvas'),standard=document.createElement('canvas');
      exported.width=png.width;exported.height=png.height;exported.getContext('2d').drawImage(png,0,0);png.close();
      await renderer.renderDocument(doc,assets,standard);
      const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      const a=pixels(exported),b=pixels(standard),exportEqual=a.every((v,i)=>v===b[i]);
      const area=document.querySelector('#workspace'),stage=document.querySelector('#stage'),matrix=new DOMMatrix(getComputedStyle(stage).transform);
      const expected=document.createElement('canvas'),actual=document.querySelector('#artwork');
      await renderer.renderDocument(doc,assets,expected,{x:matrix.e,y:matrix.f,zoom:matrix.a,width:area.clientWidth,height:area.clientHeight,pixelRatio:devicePixelRatio});
      const c=pixels(expected),d=pixels(actual);
      return {equal:exportEqual&&c.length===d.length&&c.every((v,i)=>v===d[i]),width:doc.canvas.width,height:doc.canvas.height};
    }finally{assets.dispose();}
  });
}
