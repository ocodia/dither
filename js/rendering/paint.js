import { surface } from './effects.js';
import { applyErasures } from './image-pixels.js';
import { traceRegion } from '../model/pixel-region.js';
import { worldToLocal } from '../interaction/geometry.js';
import { checkSize } from '../model/document.js';

export function sourcePoint(point, transform, width, height) {
  const p=worldToLocal(point,transform);
  return {x:(p.x/transform.width+.5)*width,y:(p.y/transform.height+.5)*height};
}
// Inverse layer scale keeps new marks circular in document coordinates.
export function brushScale(transform, width, height) {
  return { x: width / transform.width, y: height / transform.height };
}
export function strokeSamples(a,b,size) {
  const count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/Math.max(.25,size*.1)));
  return Array.from({length:count},(_,i)=>({x:a.x+(b.x-a.x)*(i+1)/count,y:a.y+(b.y-a.y)*(i+1)/count}));
}
export function paintSize(layer,image) {
  // Grow each stretched axis independently; never discard existing source detail.
  return {width:Math.max(image.width,Math.ceil(layer.transform.width)),height:Math.max(image.height,Math.ceil(layer.transform.height))};
}
export function paintSurface(layer,image,grow=false) {
  const {width,height}=grow?paintSize(layer,image):image;
  checkSize(width,height);
  const canvas=surface(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(image,0,0,width,height);applyErasures(ctx,layer.eraseRegions,width,height);return canvas;
}
export function selectionMask(points,width,height) {
  if(!points)return null;
  const canvas=surface(width,height),ctx=canvas.getContext('2d');traceRegion(ctx,points,width,height);ctx.fill('evenodd');return canvas;
}
export function stamp(ctx,p,size,hardness,colour,scale={x:1,y:1}) {
  ctx.save();ctx.translate(p.x,p.y);ctx.scale(scale.x,scale.y);p={x:0,y:0};
  const radius=size/2;ctx.fillStyle=colour;
  if(hardness<1){const g=ctx.createRadialGradient(p.x,p.y,radius*hardness,p.x,p.y,radius);g.addColorStop(0,colour);g.addColorStop(1,`${colour}00`);ctx.fillStyle=g;}
  ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();ctx.restore();
}
export function composeStroke(base,stroke,mask,opacity,erase,buffers={}) {
  const ink=buffers.ink ||= surface(base.width,base.height),i=ink.getContext('2d');i.globalCompositeOperation='source-over';i.clearRect(0,0,ink.width,ink.height);i.drawImage(stroke,0,0);
  if(mask){i.globalCompositeOperation='destination-in';i.drawImage(mask,0,0);}
  const out=buffers.out ||= surface(base.width,base.height),ctx=out.getContext('2d');ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.clearRect(0,0,out.width,out.height);ctx.drawImage(base,0,0);ctx.globalAlpha=opacity;ctx.globalCompositeOperation=erase?'destination-out':'source-over';ctx.drawImage(ink,0,0);return out;
}
export const pngBlob = canvas => new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not encode painted pixels.')),'image/png'));
