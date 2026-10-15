import { icon } from '../components/panels.js';
import { clone, createLayer, checkSize } from '../model/document.js';
import { isSelectionTool } from '../model/pixel-region.js';
import { canGradient, isPath, pathBounds, tracePath, validGradient, editableStops, addGradientStop, gradientOffset } from '../model/vector.js';
import { localToWorld } from './geometry.js';
import { sourcePoint, paintSize, paintSurface, selectionMask, stamp, brushScale, strokeSamples, composeStroke, pngBlob } from '../rendering/paint.js';
import { surface } from '../rendering/effects.js';
import { floodFill } from '../rendering/flood-fill.js';

const names={eyedropper:'Eyedropper',brush:'Brush',eraser:'Eraser',fill:'Fill',pen:'Pen',gradient:'Gradient'};
const paintTools=['brush','eraser','fill'];
const penStyleKeys=['fill','stroke','fillOpacity','strokeWidth','strokeOpacity'];
const pathStyle=shape=>Object.fromEntries(penStyleKeys.map(key=>[key,shape[key]]));
const toolIcons={eyedropper:'eyedropper',brush:'paint-brush',eraser:'eraser-tool',fill:'paint-bucket',pen:'pen',gradient:'color-background'};
const hexRGB=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Keep protected endpoints at the edges when stops share a position.
const stopPositionOrder=(a,b)=>a.offset-b.offset || (a.order===1?Infinity:a.order)-(b.order===1?Infinity:b.order);
const anchor=p=>({...p,in:{...p},out:{...p}});
const field=(label,key,value,min,max,step=1)=>`<label><span>${label}</span><input data-setting="${key}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;

const toolButton=(action,label,glyph,disabled=false)=>`<button type="button" data-tool-action="${action}" title="${label}" ${disabled?'disabled':''}>${icon(glyph)}<span>${label}</span></button>`;
const slider=(label,key,value,min,max,step=1,scope='setting',accessibleLabel=label)=>`<label class="tool-slider"><span>${label}</span><input aria-label="${accessibleLabel}" data-${scope}="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"><output>${max===1?Math.round(value*100)+'%':value}</output></label>`;

export class ToolController {
  constructor(workspace,options) {
    this.workspace=workspace;Object.assign(this,options);
    this.settings={foreground:'#000000',background:'#ffffff',opacity:1,size:20,hardness:1,tolerance:0,gradientType:'linear'};
    this.penStyle={fill:'#6799f5',stroke:'#000000',fillOpacity:0,strokeWidth:2,strokeOpacity:1};
    this.penStyleEdit=null;this.gradientEdit=null;
    this.token=0;this.revision=0;this.anchorIndex=0;this.stopIndex=0;this.gesture=null;this.path=null;this.pathLayer=null;this.cursor=null;this.busy=false;
    const area=workspace.element;
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','dblclick'])area.addEventListener(type,e=>this.route(type,e),true);
    area.addEventListener('keydown',e=>this.gradientKey(e),true);
    area.addEventListener('wheel',e=>this.strokeSizeWheel(e),{capture:true,passive:false});
    this.controls.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.controls.querySelector(':popover-open')){e.preventDefault();e.stopPropagation();this.finishGradientEdit(false);this.controls.querySelector(':popover-open')?.hidePopover();this.renderControls();}});
    area.addEventListener('pointerleave',()=>{this.cursor=null;workspace.draw();});
    this.controls.addEventListener('change',e=>this.change(e));
    this.controls.addEventListener('input',e=>{
      if(e.target.dataset.stop){this.changeStop(e.target,false);}
      if(e.target.dataset.penStyle){this.changePenStyle(e.target,false);}
      if(e.target.type!=='range')return;
      const output=e.target.closest('label').querySelector('output');
      output.value=Number(e.target.max)===1?Math.round(Number(e.target.value)*100)+'%':e.target.value;
      if(e.target.dataset.setting)this.change(e);
    });
    document.addEventListener('click',e=>this.action(e));
    window.addEventListener('blur',()=>this.cancel());
  }
  strokeSizeWheel(e){
    if(!['brush','eraser'].includes(this.workspace.tool)||!e.shiftKey||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('#tool-options,button,input,select,textarea,[contenteditable]'))return;
    // Shift-wheel can arrive as horizontal scrolling on some platforms.
    const delta=e.deltaY||e.deltaX;if(!delta)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(this.gesture||this.busy||this.workspace.gesture||!this.canUse(this.workspace.tool))return;
    const step=Math.max(1,Math.round(this.settings.size*.1));
    this.settings.size=Math.max(1,Math.min(1024,Math.round(this.settings.size)+(delta<0?step:-step)));
    this.cursor=this.workspace.point(e);
    const input=this.controls.querySelector('[data-setting="size"]');if(input)input.value=this.settings.size;
    this.workspace.draw();
  }
  active(){return !!names[this.workspace.tool];}
  eligible(layer=this.getLayer()){return layer?.type==='image'&&layer.visible&&!layer.locked;}
  canUse(tool) {
    if(!paintTools.includes(tool))return true;
    if(!this.eligible())return false;
    const image=this.getAssets().images.get(this.getLayer().assetId);
    if(!image)return false;
    const size=tool==='fill'?image:paintSize(this.getLayer(),image);
    try{checkSize(size.width,size.height);return true;}catch{return false;}
  }
  local(p,layer){return sourcePoint(p,layer.transform,1,1);}
  world(p,layer){const t=layer.transform;return localToWorld({x:(p.x-.5)*t.width,y:(p.y-.5)*t.height},t);}
  sync(){
    const layer=this.getLayer();
    if(this.pathLayer && (layer!==this.pathLayer || layer.locked || !layer.visible || !this.getDocument().layers.includes(layer)))this.cancel();
    if(this.gesture && (this.gesture.layer && (layer!==this.gesture.layer||layer.locked||!layer.visible)))this.cancel();
    if(this.gradientEdit&&(this.gradientEdit.layer!==this.gradientState().layer||this.gradientState().disabled||this.gradientEdit.document!==this.getDocument()))this.finishGradientEdit(false);
    if(this.controlsLayer!==layer||!this.controls.contains(document.activeElement))this.renderControls();
  }
  canClosePath(){
    const layer=this.penStyleTarget();
    return isPath(layer)&&layer.visible&&!layer.locked&&!layer.shape.closed&&(this.path?.length||layer.shape.anchors.length)>=3;
  }
  canFinishPath(){return !!this.pathLayer && (this.path?.length || 0)>=2;}
  updateFinishButton(){const button=this.controls.querySelector('[data-tool-action="finish-path"]');if(button){button.disabled=!this.canFinishPath();button.hidden=!this.canFinishPath();}}
  renderControls(){
    const tool=this.workspace.tool,s=this.settings,l=this.getLayer();
    this.controls.hidden=!this.active();if(!this.active())return;
    this.controls.setAttribute('aria-label',`${names[tool]} tool options`);
    let html=icon(toolIcons[tool]);
    if(tool==='pen'){
      const target=this.penStyleTarget(),style=target?.shape || this.penStyle;
      const disabled=target&&(target.locked||!target.visible);
      html+=`<fieldset class="pen-style-options" aria-label="Fill" ${disabled?'disabled':''}><label>Fill<input aria-label="Path fill colour" data-pen-style="fill" type="color" value="${style.fill}"></label>${slider('Opacity','fillOpacity',style.fillOpacity,0,1,.01,'pen-style','Fill opacity')}</fieldset><fieldset class="pen-style-options pen-stroke-options" aria-label="Stroke" ${disabled?'disabled':''}><label>Stroke<input aria-label="Path stroke colour" data-pen-style="stroke" type="color" value="${style.stroke}"></label>${slider('Width','strokeWidth',style.strokeWidth,0,100,1,'pen-style','Stroke width')}${slider('Opacity','strokeOpacity',style.strokeOpacity,0,1,.01,'pen-style','Stroke opacity')}</fieldset>`;
    }else if(tool==='brush')html+=`<label>Colour<input aria-label="Brush colour" data-setting="foreground" type="color" value="${s.foreground}"></label>`;
    else if(!['gradient','eraser'].includes(tool))html+=`<label>Foreground<input aria-label="Foreground colour" data-setting="foreground" type="color" value="${s.foreground}"></label><label>Background<input aria-label="Background colour" data-setting="background" type="color" value="${s.background}"></label>`;
    if(['eraser','fill','eyedropper'].includes(tool))html+=slider('Opacity','opacity',s.opacity,0,1,.01);
    if(['brush','eraser'].includes(tool))html+=field('Size (px)','size',s.size,1,1024)+slider('Hardness','hardness',s.hardness,0,1,.01);
    if(tool==='fill')html+=slider('Tolerance','tolerance',s.tolerance,0,255);
    if(tool==='pen'){
      let actions='';
      if(this.canFinishPath())actions+=toolButton('finish-path','Finish path','checkmark-circle');
      if(!this.path&&isPath(l)&&!l.locked&&l.visible){this.anchorIndex=Math.min(this.anchorIndex,l.shape.anchors.length-1);
        actions+=toolButton('smooth','Smooth','bezier-curve')+toolButton('corner','Corner','square')+toolButton('delete-anchor','Delete anchor','delete');
      }
      if(this.canClosePath())actions+=toolButton('close-shape','Close shape','pentagon');
      if(actions)html+=`<div class="pen-path-actions" role="group" aria-label="Path actions">${actions}</div>`;
    }
    if(tool==='gradient')html+=this.gradientControls();
    this.controlsLayer=l;this.controls.innerHTML=html;
  }
  gradientState(){
    const layer=this.getLayer(),g=canGradient(layer)&&layer.shape.gradient;
    if(!this.gradientDefaults)this.gradientDefaults=editableStops([{offset:0,colour:this.settings.foreground,opacity:this.settings.opacity},{offset:1,colour:this.settings.background,opacity:1}]);
    return {layer:g?layer:null,stops:g?editableStops(g.stops):clone(this.gradientDefaults),disabled:!!layer&&(layer.locked||!layer.visible)};
  }
  gradientControls(){
    const {layer,stops,disabled}=this.gradientState(),type=layer?.shape.gradient.type||this.settings.gradientType;
    let html=`<fieldset class="gradient-options" ${disabled?'disabled':''}><label>Type<select aria-label="Gradient type" data-setting="gradientType"><option value="linear" ${type==='linear'?'selected':''}>Linear</option><option value="radial" ${type==='radial'?'selected':''}>Radial</option></select></label><div class="gradient-stops" role="group" aria-label="Gradient stops">`;
    [...stops].sort(stopPositionOrder).forEach((stop,i)=>{
      const label=`Stop ${i+1}`,id=`gradient-stop-${stop.order}`;
      html+=`<div class="gradient-stop" data-stop-order="${stop.order}"><span>${label}</span><button type="button" class="gradient-swatch" data-tool-action="edit-stop" aria-label="${label} colour and opacity" aria-haspopup="dialog" aria-controls="${id}" style="--stop-colour:${stop.colour};--stop-opacity:${stop.opacity}"><span></span></button>`;
      if(stop.order>1)html+=`<button type="button" data-tool-action="remove-stop" aria-label="Remove ${label.toLowerCase()}" title="Remove ${label.toLowerCase()}">${icon('delete')}</button>`;
      html+=`<div id="${id}" class="gradient-colour-editor" popover role="dialog" aria-label="${label} colour and opacity"><label>Colour<input aria-label="${label} colour" data-stop="colour" type="color" value="${stop.colour}"></label>${slider('Opacity','opacity',stop.opacity,0,1,.01,'stop',label+' opacity')}${toolButton('sample-stop','Pick stop colour','eyedropper')}</div></div>`;
    });
    return html+`</div><div class="gradient-add">${toolButton('add-stop','Add stop','add',stops.length>=6)}</div></fieldset>`;
  }
  writeStops(stops,label='Edit gradient'){
    const state=this.gradientState();if(state.disabled)return;
    if(state.layer){const shape=clone(state.layer.shape);shape.gradient.stops=stops;if(!same(shape,state.layer.shape))this.patch(state.layer,{shape},label);}
    else this.gradientDefaults=clone(stops);
  }
  changeStop(control,commit){
    const state=this.gradientState();if(state.disabled)return;
    const order=Number(control.closest('[data-stop-order]').dataset.stopOrder),key=control.dataset.stop;
    const value=key==='colour'?control.value:Number(control.value);
    if(key==='colour'?!/^#[\da-f]{6}$/i.test(value):!Number.isFinite(value)||value<0||value>1)return;
    if(!this.gradientEdit)this.gradientEdit={layer:state.layer,before:state.layer?clone(state.layer.shape):clone(this.gradientDefaults),document:this.getDocument()};
    const stops=state.stops,stop=stops.find(s=>s.order===order);if(!stop)return;stop[key]=value;
    if(state.layer)state.layer.shape.gradient.stops=stops;else this.gradientDefaults=stops;
    this.stopIndex=order;
    const swatch=control.closest('[data-stop-order]').querySelector('.gradient-swatch');swatch.style.setProperty('--stop-colour',stop.colour);swatch.style.setProperty('--stop-opacity',stop.opacity);
    this.preview();this.workspace.draw();if(commit)this.finishGradientEdit(true);
  }
  finishGradientEdit(commit){
    const edit=this.gradientEdit;if(!edit)return;this.gradientEdit=null;
    if(edit.layer){const after=clone(edit.layer.shape);edit.layer.shape=edit.before;
      if(commit&&edit.document===this.getDocument()&&this.getDocument().layers.includes(edit.layer)&&!edit.layer.locked&&edit.layer.visible&&!same(edit.before,after))this.patch(edit.layer,{shape:after},'Edit gradient colour');
    }else if(!commit)this.gradientDefaults=edit.before;
    this.preview();this.workspace.draw();
  }
  gradientAction(action,button){
    if(!['edit-stop','add-stop','remove-stop','sample-stop'].includes(action))return false;
    const state=this.gradientState();if(state.disabled)return true;
    const order=Number(button.closest('[data-stop-order]')?.dataset.stopOrder ?? this.stopIndex);
    this.stopIndex=order;
    if(action==='edit-stop'){
      const popover=button.parentElement.querySelector('[popover]'),box=button.getBoundingClientRect();
      popover.style.left=Math.max(8,Math.min(box.left,window.innerWidth-280))+'px';popover.style.top=Math.min(box.bottom+8,window.innerHeight-160)+'px';popover.showPopover();this.workspace.draw();return true;
    }
    if(action==='sample-stop'){
      this.finishGradientEdit(true);button.closest('[popover]')?.hidePopover();this.sampleTarget={layer:state.layer,order,document:this.getDocument()};this.notify('Click the canvas to sample this stop.');return true;
    }
    this.finishGradientEdit(true);
    if(action==='add-stop'){const added=addGradientStop(state.stops);if(!added)return true;this.stopIndex=added.order;}
    if(action==='remove-stop'){if(order<2)return true;state.stops=state.stops.filter(s=>s.order!==order);this.stopIndex=0;}
    this.writeStops(state.stops);this.renderControls();this.workspace.draw();return true;
  }
  gradientKey(e){
    const handle=e.target.closest('[data-gradient-stop]');if(!handle||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();e.stopPropagation();const state=this.gradientState();if(state.disabled||!state.layer)return;
    const order=Number(handle.dataset.gradientStop),stop=state.stops.find(s=>s.order===order);if(!stop||order<2)return;
    stop.offset=Math.max(0,Math.min(1,stop.offset+(['ArrowRight','ArrowUp'].includes(e.key)?1:-1)*(e.shiftKey ? .1 : .01)));
    state.stops.sort((a,b)=>a.offset-b.offset);this.stopIndex=order;this.writeStops(state.stops,'Move gradient stop');this.renderControls();this.workspace.draw();
    this.workspace.element.querySelector(`[data-gradient-stop="${order}"]`)?.focus();
  }
  penStyleTarget(){return this.pathLayer || (!this.path&&isPath(this.getLayer())?this.getLayer():null);}
  changePenStyle(control,commit){
    const key=control.dataset.penStyle;if(!penStyleKeys.includes(key))return;
    const target=this.penStyleTarget();if(target&&(target.locked||!target.visible))return;
    let value=control.type==='color'?control.value:Number(control.value);
    if(control.type==='color'){if(!/^#[\da-f]{6}$/i.test(value))return;}
    else{if(!Number.isFinite(value))return;value=Math.max(0,Math.min(key==='strokeWidth'?100:1,value));}
    if(target){
      if(this.penStyleEdit&&(this.penStyleEdit.target!==target||this.penStyleEdit.control!==control))this.finishPenStyleEdit();
      if(!this.penStyleEdit)this.penStyleEdit={target,control,before:clone(target.shape)};
      target.shape[key]=value;
      if(key==='fill')delete target.shape.gradient;
      this.penStyle=pathStyle(target.shape);this.preview();this.workspace.draw();
      if(commit)this.finishPenStyleEdit();
    }else this.penStyle[key]=value;
  }
  finishPenStyleEdit(){
    const edit=this.penStyleEdit;if(!edit)return;this.penStyleEdit=null;
    const after=clone(edit.target.shape);edit.target.shape=edit.before;
    if(!same(edit.before,after)&&this.getDocument().layers.includes(edit.target))this.patch(edit.target,{shape:after},'Change path style');
  }
  change(e){
    if(e.target.dataset.stop){this.changeStop(e.target,true);return;}
    if(e.target.dataset.penStyle){this.changePenStyle(e.target,true);return;}
    const el=e.target,key=el.dataset.setting,l=this.getLayer(),numeric=['number','range'].includes(el.type);
    if(key){let value=numeric?Number(el.value):el.value;if(numeric){if(el.value===''||!Number.isFinite(value))return;value=Math.max(Number(el.min),Math.min(Number(el.max),value));el.value=value;}this.settings[key]=value;
      if(key==='gradientType'&&canGradient(l)&&l.shape.gradient&&!l.locked&&l.visible){const shape=clone(l.shape);shape.gradient.type=value;this.patch(l,{shape},'Change gradient type');}return;}
  }

  action(e){
    const button=e.target.closest('[data-tool-action]'),action=button?.dataset.toolAction;if(!action||button.disabled)return;
    if(this.gradientAction(action,button))return;
    const l=this.getLayer();
    if(action==='rasterise'){this.cancel();this.rasterise();return;}
    if(action==='finish-path'){this.finishPath(false);return;}
    if(action==='close-shape'){
      if(!this.canClosePath())return;
      this.finishPenStyleEdit();
      if(this.pathLayer)this.finishPath(true);
      else{this.patch(l,{shape:{...clone(l.shape),closed:true}},'Close path');this.renderControls();}
      return;
    }
    if(!l||l.locked||!l.visible)return;
    if(['smooth','corner','delete-anchor'].includes(action)&&isPath(l)){
      if(this.pathLayer===l)this.finishPath(false);
      const shape=clone(l.shape),i=this.anchorIndex,a=shape.anchors[i];
      if(action==='delete-anchor'){if(shape.anchors.length<=2){this.notify('A path needs at least two anchors.');return;}shape.anchors.splice(i,1);this.anchorIndex=Math.max(0,i-1);}
      if(action==='corner'){a.in={x:a.x,y:a.y};a.out={x:a.x,y:a.y};}
      if(action==='smooth'){const p=shape.anchors[(i+shape.anchors.length-1)%shape.anchors.length],n=shape.anchors[(i+1)%shape.anchors.length];a.in={x:a.x-(n.x-p.x)/6,y:a.y-(n.y-p.y)/6};a.out={x:a.x+(n.x-p.x)/6,y:a.y+(n.y-p.y)/6};}
      this.commitPathEdit(l,shape);this.renderControls();return;
    }
    if(!l.shape?.gradient)return;const shape=clone(l.shape),g=shape.gradient;
    if(action==='solid'){shape.fillOpacity=g.solidFillOpacity ?? shape.fillOpacity;delete shape.gradient;}
    this.patch(l,{shape},'Edit gradient');this.renderControls();
  }
  route(type,e){
    if(e.target.closest('#tool-options, button, input, select, label'))return;
    const w=this.workspace,ps=this.selection;
    if(type==='pointercancel'||type==='lostpointercapture'){
      if(this.gesture?.pointerId===e.pointerId)this.cancel();
      if(ps.draft?.kind!=='polygon-lasso')ps.cancelDraft();return;
    }
    if(isSelectionTool(w.tool)){
      if(type==='pointerdown')ps.down(e);if(type==='pointermove')ps.move(e);
      if(type==='pointerup'&&ps.draft?.pointerId===e.pointerId){e.stopImmediatePropagation();ps.complete();}
      if(type==='dblclick'&&ps.draft?.kind==='polygon-lasso'){e.preventDefault();e.stopImmediatePropagation();ps.complete();}return;
    }
    if(!this.active())return;
    if(type==='pointermove'){w.pointer={clientX:e.clientX,clientY:e.clientY};this.cursor=w.point(e);}
    if(w.gesture?.type==='pan'||type==='pointerdown'&&(e.button===1||w.space))return;
    if(type==='pointerdown'&&e.button!==0)return;
    e.stopImmediatePropagation();if(type!=='pointermove')e.preventDefault();
    if(type==='pointerdown'){this.beforeGesture();w.element.focus({preventScroll:true});this.down(e);}
    if(type==='pointermove')this.move(e);
    if(type==='pointerup')this.up(e);
  }
  capture(e){this.gesture.pointerId=e.pointerId;this.workspace.element.setPointerCapture(e.pointerId);}
  release(g){if(g?.pointerId!==undefined&&this.workspace.element.hasPointerCapture(g.pointerId))this.workspace.element.releasePointerCapture(g.pointerId);}
  cancel(){
    const hadGradientEdit=!!this.gradientEdit;
    this.finishGradientEdit(false);
    this.finishPenStyleEdit();
    const hadPath=!!this.path;
    this.token++;this.workerReject?.(new Error('Fill cancelled.'));this.workerReject=null;this.worker?.terminate();this.worker=null;this.busy=false;const g=this.gesture;this.gesture=null;
    if(g?.before&&g.layer){g.layer.shape=g.before;g.layer.transform=g.transform;}
    this.path=null;this.pathLayer=null;this.updateFinishButton();this.sampleTarget=null;this.renderer.preview=null;this.release(g);this.preview();this.workspace.draw();if(hadPath||hadGradientEdit||g?.type==='gradient')this.renderControls();
  }
  down(e){
    if(this.busy||this.gesture)return;const p=this.workspace.point(e),tool=this.workspace.tool,l=this.getLayer();
    if(tool==='eyedropper'||this.sampleTarget){this.sample(p);return;}
    if(paintTools.includes(tool)){
      if(!this.eligible()){this.notify('Select an unlocked image or create a paint layer.');return;}
      try{
        const base=paintSurface(l,this.getAssets().images.get(l.assetId),tool!=='fill'),point=sourcePoint(p,l.transform,base.width,base.height);
        // Strokes can begin outside the bitmap; canvas clipping limits their
        // marks to the layer. Flood fill still needs an actual source pixel.
        if(tool==='fill'&&(point.x<0||point.y<0||point.x>=base.width||point.y>=base.height))return;
        const mask=selectionMask(this.selection.current()?.points,base.width,base.height);
        this.gesture={type:tool,layer:l,snapshot:clone(l),document:this.getDocument(),assets:this.getAssets(),base,mask,last:point,scale:brushScale(l.transform,base.width,base.height),settings:{...this.settings,opacity:tool==='brush'?1:this.settings.opacity}};
        if(tool==='fill'){this.fill(point);return;}
        this.gesture.stroke=surface(base.width,base.height);stamp(this.gesture.stroke.getContext('2d'),point,this.settings.size,this.settings.hardness,this.settings.foreground,this.gesture.scale);this.capture(e);this.paintPreview();
      }catch(error){this.gesture=null;this.notify(error.message,true);}return;
    }
    if(tool==='pen'){
      const handle=e.target.closest('[data-anchor-handle]');
      if(!this.path&&handle&&isPath(l)&&!l.locked&&l.visible){this.anchorIndex=Number(handle.dataset.anchorIndex);this.gesture={type:'anchor',layer:l,before:clone(l.shape),transform:clone(l.transform),part:handle.dataset.anchorHandle,index:this.anchorIndex,start:p};this.capture(e);this.renderControls();this.workspace.draw();return;}
      if(this.path&&this.path.length>=2&&Math.hypot(p.x-this.path[0].x,p.y-this.path[0].y)*this.workspace.view.zoom<8){this.finishPath(true);return;}
      const beforePath=clone(this.path);
      if(!this.path){if(isPath(l))this.penStyle=pathStyle(l.shape);this.path=[];}
      if(this.path.length>=4096){this.notify('Finish this path before adding more anchors.');return;}
      this.path.push(anchor(p));this.updateFinishButton();this.gesture={type:'pen-point',index:this.path.length-1,beforePath};this.capture(e);this.workspace.draw();return;
    }
    if(tool==='gradient'){
      if(l&&(l.locked||!l.visible)){this.notify('Select a visible, unlocked layer.');return;}
      let layer=l,isNew=!canGradient(l);
      if(isNew){layer=createLayer('shape',this.getDocument().canvas,{name:'Gradient'});Object.assign(layer.transform,{width:this.getDocument().canvas.width,height:this.getDocument().canvas.height});layer.shape.radius=0;}
      const before=clone(layer.shape),point=this.local(p,layer),handle=e.target.closest('[data-gradient-handle]')?.dataset.gradientHandle,stopHandle=e.target.closest('[data-gradient-stop]');
      const g=clone(layer.shape.gradient)||{type:this.settings.gradientType,solidFillOpacity:before.fillOpacity,start:point,end:point,stops:clone(this.gradientState().stops)};
      g.stops=editableStops(g.stops);
      if(stopHandle)this.stopIndex=Number(stopHandle.dataset.gradientStop);
      if(!handle&&!stopHandle){g.start=point;g.end={x:point.x+1e-7,y:point.y};}
      layer.shape.gradient=g;layer.shape.fillOpacity=before.gradient ? before.fillOpacity : before.fillOpacity || 1;
      this.gesture={type:'gradient',layer,before,transform:clone(layer.transform),isNew,part:stopHandle?'stop':handle||'end',order:this.stopIndex,start:p};this.capture(e);this.workspace.draw();
    }
  }
  move(e){
    const g=this.gesture,p=this.workspace.point(e);if(!g){if(['brush','eraser'].includes(this.workspace.tool))this.workspace.draw();return;}
    if(g.pointerId!==undefined&&g.pointerId!==e.pointerId)return;
    if(['brush','eraser'].includes(g.type)){
      const point=sourcePoint(p,g.layer.transform,g.base.width,g.base.height),ctx=g.stroke.getContext('2d');
      for(const sample of strokeSamples({x:g.last.x/g.scale.x,y:g.last.y/g.scale.y},{x:point.x/g.scale.x,y:point.y/g.scale.y},g.settings.size))stamp(ctx,{x:sample.x*g.scale.x,y:sample.y*g.scale.y},g.settings.size,g.settings.hardness,g.settings.foreground,g.scale);g.last=point;this.paintPreview();return;
    }
    if(g.type==='pen-point'){const a=this.path[g.index];a.out={...p};a.in={x:2*a.x-p.x,y:2*a.y-p.y};}
    if(g.type==='anchor'){
      // Selecting an anchor must not move it to a rounded screen coordinate.
      if(!g.moved&&Math.hypot(p.x-g.start.x,p.y-g.start.y)*this.workspace.view.zoom<1)return;
      g.moved=true;
      const a=g.layer.shape.anchors[g.index],point=this.local(p,g.layer);
      if(g.part==='point'){const dx=point.x-a.x,dy=point.y-a.y;for(const h of [a.in,a.out]){h.x+=dx;h.y+=dy;}a.x=point.x;a.y=point.y;}
      else{a[g.part]=point;if(!e.altKey)a[g.part==='in'?'out':'in']={x:2*a.x-point.x,y:2*a.y-point.y};}this.preview();
    }
    if(g.type==='gradient'){const gradient=g.layer.shape.gradient,point=this.local(p,g.layer);
      if(g.part==='stop'){const stop=gradient.stops.find(s=>s.order===g.order);if(stop&&stop.order>1&&Math.hypot(p.x-g.start.x,p.y-g.start.y)*this.workspace.view.zoom>1){stop.offset=Math.round(gradientOffset(point,gradient,g.layer.transform)*1e6)/1e6;gradient.stops.sort((a,b)=>a.offset-b.offset);this.renderControls();}}
      else gradient[g.part]=point;this.preview();}
    this.workspace.draw();
  }
  up(e){
    const g=this.gesture;if(!g||g.pointerId!==e.pointerId)return;
    // Include the release position even when the browser coalesced the last move.
    this.move(e);
    if(['brush','eraser'].includes(g.type)){this.gesture=null;this.release(g);this.commitPaint(g,g.output);return;}
    this.gesture=null;this.release(g);
    if(g.type==='pen-point'&&this.path.length>=2&&!this.commitDraftPath())this.path=g.beforePath;
    if(g.type==='anchor'&&g.moved){const shape=clone(g.layer.shape);g.layer.shape=g.before;this.commitPathEdit(g.layer,shape);}
    if(g.type==='gradient'){
      const shape=clone(g.layer.shape);g.layer.shape=g.before;
      if(validGradient(shape.gradient)&&Math.hypot((shape.gradient.end.x-shape.gradient.start.x)*g.layer.transform.width,(shape.gradient.end.y-shape.gradient.start.y)*g.layer.transform.height)>=1){
        if(g.isNew){g.layer.shape=shape;this.insert(g.layer);}else if(!same(shape,g.before))this.patch(g.layer,{shape},'Draw gradient');
      }else this.preview();
    }
    this.workspace.draw();this.renderControls();
    if(g.type==='gradient'&&g.part==='stop')this.workspace.element.querySelector(`[data-gradient-stop="${g.order}"]`)?.focus({preventScroll:true});
  }
  paintPreview(){const g=this.gesture;if(!g)return;g.output=composeStroke(g.base,g.stroke,g.mask,g.settings.opacity,g.type==='eraser',g.buffers ||= {});this.renderer.preview={layerId:g.layer.id,canvas:g.output,revision:++this.revision};this.preview();this.workspace.draw();}
  async fill(point){
    const g=this.gesture,token=++this.token;this.busy=true;
    try{
      const ctx=g.base.getContext('2d'),image=ctx.getImageData(0,0,g.base.width,g.base.height),mask=g.mask?.getContext('2d').getImageData(0,0,g.base.width,g.base.height).data;
      const args={width:g.base.width,height:g.base.height,x:point.x,y:point.y,colour:hexRGB(g.settings.foreground),opacity:g.settings.opacity,tolerance:g.settings.tolerance};
      let data;
      if(typeof Worker!=='undefined'){
        data=await new Promise((resolve,reject)=>{const worker=new Worker(new URL('../rendering/fill-worker.js',import.meta.url),{type:'module'});this.worker=worker;this.workerReject=reject;worker.onmessage=({data:r})=>{worker.terminate();this.worker=null;this.workerReject=null;r.error?reject(new Error(r.error)):resolve(new Uint8ClampedArray(r.buffer));};worker.onerror=()=>{worker.terminate();this.worker=null;reject(new Error('Fill processing failed.'));};worker.postMessage({...args,buffer:image.data.buffer,mask:mask?.buffer},[image.data.buffer,...(mask?[mask.buffer]:[])]);});
      }else data=floodFill(image.data,args.width,args.height,args.x,args.y,args.colour,args.opacity,args.tolerance,mask);
      if(token!==this.token)return;
      const out=surface(args.width,args.height);out.getContext('2d').putImageData(new ImageData(data,args.width,args.height),0,0);this.gesture=null;await this.commitPaint(g,out);
    }catch(error){if(token===this.token){this.gesture=null;this.busy=false;this.notify(error.message,true);}}
  }
  async commitPaint(g,canvas){
    const token=++this.token;this.busy=true;let meta,committed=false;
    const valid=()=>token===this.token&&g.document===this.getDocument()&&g.assets===this.getAssets()&&this.getLayer()===g.layer&&g.document.layers.includes(g.layer)&&same(g.layer,g.snapshot);
    try{
      const before=g.base.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,after=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      if(before.every((v,i)=>v===after[i]))return;
      const blob=await pngBlob(canvas);if(!valid())return;meta=await g.assets.add(blob);if(!valid())return;
      meta.name=`${g.layer.name}.png`;g.document.assets.push(meta);this.renderer.preview=null;this.patch(g.layer,{assetId:meta.id,eraseRegions:[]},names[g.type]+' pixels');committed=true;
    }catch(error){if(token===this.token)this.notify(error.message,true);}
    finally{if(meta&&!committed)g.assets.remove(meta.id);if(token===this.token){this.busy=false;this.renderer.preview=null;this.preview();}}
  }
  async newPaint(){
    const doc=this.getDocument(),assets=this.getAssets(),token=++this.token;this.busy=true;let meta,inserted=false;
    try{const canvas=surface(doc.canvas.width,doc.canvas.height),blob=await pngBlob(canvas);if(token!==this.token||doc!==this.getDocument())return;meta=await assets.add(blob);if(token!==this.token||doc!==this.getDocument())return;meta.name='Paint.png';doc.assets.push(meta);const l=createLayer('image',doc.canvas,{name:'Paint',assetId:meta.id});Object.assign(l.transform,{width:doc.canvas.width,height:doc.canvas.height});this.insert(l);inserted=true;}
    catch(error){if(token===this.token)this.notify(error.message,true);}finally{if(meta&&!inserted)assets.remove(meta.id);if(token===this.token)this.busy=false;}
  }
  async sample(p){
    const token=++this.token,doc=this.getDocument(),target=this.sampleTarget;this.sampleTarget=null;
    try{if(p.x<0||p.y<0||p.x>=doc.canvas.width||p.y>=doc.canvas.height)return;
      const canvas=surface(doc.canvas.width,doc.canvas.height);await this.renderer.renderDocument(clone(doc),this.getAssets(),canvas);if(token!==this.token||doc!==this.getDocument())return;
      const rgba=canvas.getContext('2d').getImageData(Math.floor(p.x),Math.floor(p.y),1,1).data;if(!rgba[3]){this.notify('This pixel is fully transparent.');return;}
      const colour='#'+[...rgba.slice(0,3)].map(v=>v.toString(16).padStart(2,'0')).join(''),opacity=rgba[3]/255;
      if(target){
        if(target.document!==doc)return;
        if(target.layer){if(this.getLayer()!==target.layer||!doc.layers.includes(target.layer)||target.layer.locked||!target.layer.visible||!target.layer.shape.gradient)return;
          const shape=clone(target.layer.shape);shape.gradient.stops=editableStops(shape.gradient.stops);const stop=shape.gradient.stops.find(s=>s.order===target.order);if(!stop)return;Object.assign(stop,{colour,opacity});this.patch(target.layer,{shape},'Sample gradient colour');
        }else{const stop=this.gradientDefaults?.find(s=>s.order===target.order);if(stop)Object.assign(stop,{colour,opacity});}
      }else{Object.assign(this.settings,{foreground:colour,opacity});this.notify(`Sampled ${colour}`);}this.renderControls();

    }catch(error){this.notify(error.message,true);}
  }
  normalise(layer,shape){
    const t=layer.transform,anchors=shape.anchors.map(a=>({x:a.x*t.width,y:a.y*t.height,in:{x:a.in.x*t.width,y:a.in.y*t.height},out:{x:a.out.x*t.width,y:a.out.y*t.height}})),b=pathBounds(anchors);
    checkSize(Math.ceil(b.width),Math.ceil(b.height));
    const point=p=>({x:(p.x-b.x)/b.width,y:(p.y-b.y)/b.height});
    shape.anchors=anchors.map(a=>({...point(a),in:point(a.in),out:point(a.out)}));
    if(shape.gradient){for(const key of ['start','end'])shape.gradient[key]=point({x:shape.gradient[key].x*t.width,y:shape.gradient[key].y*t.height});}
    const centre=localToWorld({x:b.x+b.width/2-t.width/2,y:b.y+b.height/2-t.height/2},t);
    return {shape,transform:{...t,...centre,width:b.width,height:b.height}};
  }
  commitPathEdit(l,shape){try{const changes=this.normalise(l,shape);if(!same(changes,{shape:l.shape,transform:l.transform}))this.patch(l,changes,'Edit path');}catch(error){this.notify(error.message,true);this.preview();}}
  commitDraftPath(closed=false){
    if(!this.path || this.path.length<2)return false;
    const layer=this.pathLayer || createLayer('shape',this.getDocument().canvas,{name:'Path'}),b=pathBounds(this.path);
    try{
      checkSize(Math.ceil(b.width),Math.ceil(b.height));
      const point=p=>({x:(p.x-b.x)/b.width,y:(p.y-b.y)/b.height});
      const shape={...clone(layer.shape),kind:'path',closed,anchors:this.path.map(a=>({...point(a),in:point(a.in),out:point(a.out)}))};
      const transform={...layer.transform,x:b.x+b.width/2,y:b.y+b.height/2,width:b.width,height:b.height};
      this.anchorIndex=this.path.length-1;
      if(this.pathLayer){
        if(!same({shape,transform},{shape:layer.shape,transform:layer.transform}))this.patch(layer,{shape,transform},closed?'Close path':'Edit path anchors');
      }else{
        Object.assign(shape,this.penStyle);
        Object.assign(layer,{shape,transform});this.pathLayer=layer;this.insert(layer);
      }
      return true;
    }catch(error){this.notify(error.message,true);return false;}
  }
  finishPath(closed){
    if(!this.canFinishPath())return;
    if(!this.commitDraftPath(closed))return;
    this.path=null;this.pathLayer=null;const g=this.gesture;this.gesture=null;this.release(g);this.renderControls();this.workspace.draw();
  }
  removeDraftAnchor(){
    // End any current pointer sample before removing its anchor.
    const g=this.gesture;this.gesture=null;this.release(g);
    const before=clone(this.path);this.path.pop();
    if(this.pathLayer){
      if(this.path.length<2){const layer=this.pathLayer;this.pathLayer=null;this.remove(layer);}
      else if(!this.commitDraftPath())this.path=before;
    }
    if(!this.path.length)this.path=null;
    this.renderControls();this.workspace.draw();
  }
  key(e){
    if(e.key==='Escape'&&(this.gesture||this.path||this.busy||this.sampleTarget)){e.preventDefault();this.cancel();return true;}
    if(this.workspace.tool==='pen'&&this.path&&['Enter','Backspace','Delete'].includes(e.key)){e.preventDefault();if(e.key==='Enter')this.finishPath(false);else this.removeDraftAnchor();return true;}
    if(this.workspace.tool==='pen'&&isPath(this.getLayer())&&['Backspace','Delete'].includes(e.key)){e.preventDefault();this.action({target:{closest:()=>({dataset:{toolAction:'delete-anchor'}})}});return true;}
    return false;
  }
  overlay(){
    if(!this.active())return null;const l=this.getLayer(),z=this.workspace.view.zoom,r=5/z;
    let html=this.selection.current()?this.selection.overlay(l,z):'';
    const circle=(p,attrs='',selected=false)=>`<circle cx="${p.x}" cy="${p.y}" r="${selected?6.5/z:r}" fill="${selected?'#447af0':'white'}" stroke="${selected?'white':'#6799f5'}" stroke-width="${(selected?2:1)/z}" ${attrs}/>`;
    if(['brush','eraser'].includes(this.workspace.tool)&&this.cursor&&this.eligible()){
      const p=this.cursor;
      html+=`<circle cx="${p.x}" cy="${p.y}" r="${this.settings.size/2}" fill="none" stroke="white" stroke-width="${1/z}" style="filter:drop-shadow(0 0 1px black)" pointer-events="none"/>`;
    }
    if(this.workspace.tool==='pen'){
      const points=this.path||(isPath(l)&&l.visible&&!l.locked?l.shape.anchors.map(a=>({...this.world(a,l),in:this.world(a.in,l),out:this.world(a.out,l)})):[]);
      if(this.path?.length){const commands=[];tracePath({moveTo:(x,y)=>commands.push(`M${x} ${y}`),bezierCurveTo:(...v)=>commands.push('C'+v.join(' ')),closePath:()=>commands.push('Z')},{anchors:points,closed:false},1,1);html+=`<path d="${commands.join(' ')}" fill="none" stroke="#6799f5" stroke-width="${2/z}" pointer-events="none"/>`;}
      points.forEach((a,i)=>{for(const h of ['in','out']){html+=`<path d="M${a.x} ${a.y}L${a[h].x} ${a[h].y}" stroke="#6799f5" stroke-width="${1/z}" pointer-events="none"/>`;if(Math.hypot(a[h].x-a.x,a[h].y-a.y)>1e-6)html+=circle(a[h],`data-anchor-handle="${h}" data-anchor-index="${i}" style="pointer-events:all"`);}const selected=i===(this.path?this.path.length-1:this.anchorIndex);html+=circle(a,`data-anchor-handle="point" data-anchor-index="${i}" data-selected-anchor="${selected}" style="pointer-events:all"`,selected);});
    }
    const gl=this.gesture?.type==='gradient'?this.gesture.layer:l;
    if(this.workspace.tool==='gradient'&&gl?.visible&&!gl.locked&&gl?.shape?.gradient){
      const g=gl.shape.gradient,a=this.world(g.start,gl),b=this.world(g.end,gl),length=Math.hypot(b.x-a.x,b.y-a.y)||1;
      html+=`<path d="M${a.x} ${a.y}L${b.x} ${b.y}" stroke="#6799f5" stroke-width="${2/z}" pointer-events="none"/>`+circle(a,'data-gradient-handle="start" style="pointer-events:all"')+circle(b,'data-gradient-handle="end" style="pointer-events:all"');
      const stops=editableStops(g.stops),ordered=[...stops].sort(stopPositionOrder);
      for(const stop of stops.filter(s=>s.order>1)){
        const index=ordered.indexOf(stop),x=a.x+(b.x-a.x)*stop.offset,y=a.y+(b.y-a.y)*stop.offset;
        // Stagger coincident stops so every stop remains reachable; endpoints use geometry handles only.
        const lane=stops.filter(s=>s.order>1&&s.order<stop.order&&Math.abs(s.offset-stop.offset)*length*z<14).length;
        const distance=(16+lane*16)/z,hx=x-(b.y-a.y)/length*distance,hy=y+(b.x-a.x)/length*distance;
        html+=`<path d="M${x} ${y}L${hx} ${hy}" stroke="#6799f5" stroke-width="${1/z}" pointer-events="none"/><circle cx="${hx}" cy="${hy}" r="${6/z}" fill="${stop.colour}" stroke="${stop.order===this.stopIndex?'#fff':'#6799f5'}" stroke-width="${(stop.order===this.stopIndex?3:1.5)/z}" data-gradient-stop="${stop.order}" tabindex="0" role="slider" aria-label="Stop ${index+1} position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(stop.offset*100)}" style="pointer-events:all;cursor:ew-resize"/>`;
      }
    }
    return html;
  }
}
