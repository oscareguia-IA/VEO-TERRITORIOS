
/* VEO · Motor cartográfico local fluido para selección GPS.
   Sin Leaflet/CDN JS. Imágenes Esri World Imagery y Esri World Topographic Map,
   calles respaldo CARTO Voyager. NO usa tile.openstreetmap.org (403).
   Pan mediante compositor GPU, inercia, zoom focal, doble clic y gestos táctiles. */
(function(){'use strict';
const TILE=256, MIN=3, MAX=19, MAXLAT=85.05112878;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const merc=(lat,lng,z)=>{const n=TILE*2**z,r=clamp(lat,-MAXLAT,MAXLAT)*Math.PI/180;return{x:(lng+180)*n/360,y:(1-Math.asinh(Math.tan(r))/Math.PI)*n/2}};
const unmerc=(x,y,z)=>{const n=TILE*2**z;return{lat:Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI,lng:((x/n*360%360)+360)%360-180}};
const providers={satellite:{label:'Imágenes © Esri / Maxar / Earthstar Geographics',url:(z,x,y)=>`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`},streets:{label:'Mapa topográfico © Esri y colaboradores',url:(z,x,y)=>`https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`,fallback:(z,x,y)=>`https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`}};
class VEOMapNative{
 constructor(el,{center=[25.6866,-100.3161],zoom=12,mode='streets',onPoint,onMarker,onEmptyClick,markers=[]}={}){
  this.el=el;this.center={lat:center[0],lng:center[1]};this.zoom=clamp(Number(zoom),MIN,MAX);this.mode=mode;this.onPoint=onPoint;
  this.point=null;this.markers=markers;this.markerNodes=new Map();this.onMarker=onMarker;this.onEmptyClick=onEmptyClick;this.destroyed=false;this.images=new Map();this.visibleKeys=new Set();this.loaded={satellite:0,streets:0};this.streetFallbackUsed=false;this.errors={satellite:0,streets:0};this.contacts=new Map();this.drag=null;this.pinch=null;this.wheelTimer=null;this.commitTimer=null;this.zoomFrame=null;this.viewFrame=null;this.userNavigated=false;this.targetZoom=this.zoom;this.zoomAnchor=null;this.frame=null;this.renderQueued=false;this.transitioning=false;
  el.classList.add('veo-native-map');el.tabIndex=0;el.setAttribute('aria-label','Mapa interactivo. Arrastra para desplazarte, rueda para acercar y pulsa para seleccionar un predio');
  this.tilesPane=document.createElement('div');this.tilesPane.className='veo-tiles';el.append(this.tilesPane);this.routeSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  this.routeSvg.classList.add('veo-corridor-route-svg');this.routeSvg.setAttribute('aria-hidden','true');this.tilesPane.append(this.routeSvg);
  this.routeLines=[];this.routeColor='#ff416d';
  this.markerPane=document.createElement('div');this.markerPane.className='veo-opportunity-layer';this.tilesPane.append(this.markerPane);this.onMarkerClick=e=>{const b=e.target.closest('[data-opportunity-id]');if(b){e.preventDefault();e.stopPropagation();this.onMarker?.(Number(b.dataset.opportunityId));}};this.markerPane.addEventListener('click',this.onMarkerClick);
  this.pin=document.createElement('div');this.pin.className='veo-map-pin hidden';this.pin.innerHTML='<span class="veo-map-pin-dot"></span>';this.pin.title='Arrastra para ajustar la ubicación';el.append(this.pin);
  this.controls=document.createElement('div');this.controls.className='veo-map-zoom';this.controls.innerHTML='<button type="button" data-zoom="1" aria-label="Acercar">+</button><button type="button" data-zoom="-1" aria-label="Alejar">−</button>';el.append(this.controls);
  this.attribution=document.createElement('div');this.attribution.className='veo-map-attribution';el.append(this.attribution);
  this.status=document.createElement('div');this.status.className='veo-map-status';el.append(this.status);
  this.onDown=e=>{
   if(e.target.closest('a,button,[data-opportunity-id],.veo-pin-hover'))return;
   this.userNavigated=true;this.stopFitAnimation();this.cancelZoom();this.cancelAnimation();this.contacts.set(e.pointerId,{x:e.clientX,y:e.clientY});
   this.el.setPointerCapture?.(e.pointerId);
   if(this.contacts.size===2){const points=[...this.contacts.values()];this.pinch={distance:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y),zoom:this.zoom};this.drag=null;return}
   const pinDrag=!!e.target.closest('.veo-map-pin');this.drag={id:e.pointerId,startX:e.clientX,startY:e.clientY,dx:0,dy:0,dist:0,dragPin:pinDrag,t0:performance.now(),samples:[{x:e.clientX,y:e.clientY,t:performance.now()}]};
   this.el.classList.add('is-panning');
  };
  this.onMove=e=>{
   if(!this.contacts.has(e.pointerId))return;this.contacts.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(this.contacts.size===2&&this.pinch){const p=[...this.contacts.values()];const dist=Math.max(16,Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y));const mid={clientX:(p[0].x+p[1].x)/2,clientY:(p[0].y+p[1].y)/2};this.setZoom(this.zoom+Math.log2(dist/Math.max(16,this.pinch.distance)),mid,true);this.pinch.distance=dist;return}
   const d=this.drag;if(!d||d.id!==e.pointerId)return;
   d.dx=e.clientX-d.startX;d.dy=e.clientY-d.startY;d.dist=Math.hypot(d.dx,d.dy);
   const now=performance.now();d.samples.push({x:e.clientX,y:e.clientY,t:now});d.samples=d.samples.filter(s=>now-s.t<110);
   if(d.dragPin){const p=this.toCoordinates(e.clientX,e.clientY);if(p)this.setPin(p,false);return}
   this.tilesPane.style.transform=`translate3d(${d.dx}px,${d.dy}px,0)`;
   this.pin.style.translate=`${d.dx}px ${d.dy}px`;
  };
  this.onUp=e=>{
   if(!this.contacts.has(e.pointerId))return;
   this.contacts.delete(e.pointerId);
   if(this.pinch){if(this.contacts.size<2){this.pinch=null;this.contacts.clear();this.drag=null;this.tilesPane.style.transform='';this.pin.style.translate='';this.el.classList.remove('is-panning');this.render()}return}
   const d=this.drag;if(!d||d.id!==e.pointerId)return;this.drag=null;this.el.classList.remove('is-panning');
   if(d.dragPin){this.pin.style.translate='';if(this.point)this.onPoint?.(this.point);return}
   if(d.dist<7){this.tilesPane.style.transform='';this.pin.style.translate='';if(![...this.visibleKeys].some(k=>this.images.get(k)?.dataset.loaded==='1')){this.showStatus('Cargando imágenes. Selecciona el pin cuando aparezca la cartografía.');return}const p=this.toCoordinates(e.clientX,e.clientY);if(p){if(this.onPoint)this.setPin(p);else this.onEmptyClick?.(p)}return}
   const last=d.samples[d.samples.length-1],first=d.samples[0],dt=Math.max(16,last.t-first.t);const vX=clamp((last.x-first.x)/dt,-2.4,2.4),vY=clamp((last.y-first.y)/dt,-2.4,2.4);
   const deltaX=clamp(vX*185,-420,420),deltaY=clamp(vY*185,-420,420);
   if(Math.abs(vX)+Math.abs(vY)>0.25){this.tilesPane.style.transition='transform 280ms cubic-bezier(.16,1,.3,1)';this.pin.style.transition='translate 280ms cubic-bezier(.16,1,.3,1)';this.tilesPane.style.transform=`translate3d(${d.dx+deltaX}px,${d.dy+deltaY}px,0)`;this.pin.style.translate=`${d.dx+deltaX}px ${d.dy+deltaY}px`;this.commitTimer=setTimeout(()=>this.commitPan(d.dx+deltaX,d.dy+deltaY),290)}
   else this.commitPan(d.dx,d.dy);
  };
  // Zoom continuo con anclaje al cursor, animado por requestAnimationFrame.
  // Los mosaicos ya cargados permanecen visibles entre niveles, sin salto brusco.
  this.onWheel=e=>{e.preventDefault();this.userNavigated=true;this.stopFitAnimation();const normalized=e.deltaY*(e.deltaMode===1?18:e.deltaMode===2?380:1);
   const step=clamp(-normalized*.003,-.65,.65);this.queueZoom((this.targetZoom??this.zoom)+step,{clientX:e.clientX,clientY:e.clientY});};
  this.onDbl=e=>{e.preventDefault();this.userNavigated=true;this.stopFitAnimation();this.queueZoom((this.targetZoom??this.zoom)+1,{clientX:e.clientX,clientY:e.clientY})};
  this.onControls=e=>{const b=e.target.closest('[data-zoom]');if(b){e.preventDefault();e.stopPropagation();this.userNavigated=true;this.stopFitAnimation();this.queueZoom((this.targetZoom??this.zoom)+Number(b.dataset.zoom))}};
  this.onKeyboard=e=>{if(['+','='].includes(e.key))this.userNavigated=true;this.stopFitAnimation();if(['+','='].includes(e.key)){e.preventDefault();this.queueZoom(this.zoom+1)}else if(e.key==='-'){e.preventDefault();this.queueZoom(this.zoom-1)}else if(e.key.startsWith('Arrow')){e.preventDefault();const dx=e.key==='ArrowLeft'?90:e.key==='ArrowRight'?-90:0,dy=e.key==='ArrowUp'?90:e.key==='ArrowDown'?-90:0;this.commitPan(dx,dy)}};
  el.addEventListener('pointerdown',this.onDown);el.addEventListener('pointermove',this.onMove);el.addEventListener('pointerup',this.onUp);el.addEventListener('pointercancel',this.onUp);el.addEventListener('wheel',this.onWheel,{passive:false});el.addEventListener('dblclick',this.onDbl);el.addEventListener('keydown',this.onKeyboard);this.controls.addEventListener('click',this.onControls);
  this.resizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(()=>this.render()):null;this.resizeObserver?.observe(el);this.render();
 }
 getSize(){const r=this.el.getBoundingClientRect();return{w:r.width||950,h:r.height||470}}
 toCoordinates(clientX,clientY){const r=this.el.getBoundingClientRect(),{w,h}=this.getSize(),o=merc(this.center.lat,this.center.lng,this.zoom);return unmerc(o.x+(clientX-r.left-w/2),o.y+(clientY-r.top-h/2),this.zoom)}
 cancelAnimation(){clearTimeout(this.commitTimer);clearTimeout(this.wheelTimer);this.tilesPane.style.transition='none';this.pin.style.transition='none';this.tilesPane.style.transform='';this.pin.style.translate='';}
 commitPan(dx,dy){const p=merc(this.center.lat,this.center.lng,this.zoom);this.center=unmerc(p.x-dx,p.y-dy,this.zoom);this.cancelAnimation();this.render();}
 stopFitAnimation(){if(this.viewFrame)cancelAnimationFrame(this.viewFrame);this.viewFrame=null;}
 // Ajusta el encuadre al trazado real: calcula la vista máxima utilizable según
 // el tamaño actual del mapa, también en celular y tablet (Mercator). Norte arriba.
 fitBounds(bounds,{padding=44,maxZoom=15.5,minZoom=8.5,animate=true,duration=440}={}){
  if(!bounds||this.destroyed)return false;
  const south=Number(bounds.south),west=Number(bounds.west),north=Number(bounds.north),east=Number(bounds.east);
  if(![south,west,north,east].every(Number.isFinite)||south>north||west>east)return false;
  const a=merc(south,west,0),b=merc(north,east,0),{w,h}=this.getSize();
  const paddingX=typeof padding==='number'?padding:(padding.x||44),paddingY=typeof padding==='number'?padding:(padding.y||44);
  const availableW=Math.max(48,w-2*paddingX),availableH=Math.max(48,h-2*paddingY);
  const dx=Math.max(Math.abs(a.x-b.x),0.000008),dy=Math.max(Math.abs(a.y-b.y),0.000008);
  const zoom=clamp(Math.log2(Math.min(availableW/dx,availableH/dy)),Math.max(MIN,minZoom),Math.min(MAX,maxZoom));
  const midpoint=unmerc((a.x+b.x)/2,(a.y+b.y)/2,0);
  this.cancelZoom();this.stopFitAnimation();this.cancelAnimation();
  if(!animate||Math.hypot(this.center.lat-midpoint.lat,this.center.lng-midpoint.lng)<0.00001&&Math.abs(this.zoom-zoom)<0.03){
   this.center=midpoint;this.zoom=zoom;this.targetZoom=zoom;this.render();return true;
  }
  const start=merc(this.center.lat,this.center.lng,0),end=merc(midpoint.lat,midpoint.lng,0),startZoom=this.zoom,startTime=performance.now();
  const frame=now=>{
   if(this.destroyed)return;
   const t=clamp((now-startTime)/Math.max(80,duration),0,1),e=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
   this.center=unmerc(start.x+(end.x-start.x)*e,start.y+(end.y-start.y)*e,0);
   this.zoom=startZoom+(zoom-startZoom)*e;this.targetZoom=this.zoom;this.render();
   if(t<1)this.viewFrame=requestAnimationFrame(frame);else{this.viewFrame=null;this.center=midpoint;this.zoom=zoom;this.targetZoom=zoom;this.render();}
  };
  this.viewFrame=requestAnimationFrame(frame);return true;
 }
 cancelZoom(){if(this.zoomFrame)cancelAnimationFrame(this.zoomFrame);this.zoomFrame=null;this.targetZoom=this.zoom;}
 queueZoom(z,origin){this.targetZoom=clamp(z,MIN,MAX);this.zoomAnchor=origin||null;
  if(this.zoomFrame)return;
  const tick=()=>{if(this.destroyed){this.zoomFrame=null;return}this.zoomFrame=null;
   const diff=this.targetZoom-this.zoom;
   if(Math.abs(diff)<.008){if(Math.abs(diff)>1e-5)this.setZoom(this.targetZoom,this.zoomAnchor,true);return}
   this.setZoom(this.zoom+diff*.37,this.zoomAnchor,true);this.zoomFrame=requestAnimationFrame(tick)};
  this.zoomFrame=requestAnimationFrame(tick);
 }
 setZoom(z,origin,internal=false){z=clamp(Number(z),MIN,MAX);if(Math.abs(z-this.zoom)<1e-7)return;
  if(!internal)this.cancelZoom();this.cancelAnimation();
  const {w,h}=this.getSize(),r=this.el.getBoundingClientRect(),mx=origin?origin.clientX-r.left-w/2:0,my=origin?origin.clientY-r.top-h/2:0;
  const a=merc(this.center.lat,this.center.lng,this.zoom),focus=unmerc(a.x+mx,a.y+my,this.zoom),b=merc(focus.lat,focus.lng,z);
  this.center=unmerc(b.x-mx,b.y-my,z);this.zoom=z;this.render();
 }
 flyTo(coords,z=13){this.stopFitAnimation();this.cancelZoom();this.cancelAnimation();this.center={lat:+coords[0],lng:+coords[1]};this.zoom=clamp(Number(z),MIN,MAX);this.targetZoom=this.zoom;this.render()}
 setView(coords,z=this.zoom){this.flyTo(coords,z)}
 setMode(mode){if(mode===this.mode)return;if(!providers[mode])return;this.cancelZoom();this.cancelAnimation();this.mode=mode;this.render()}
 setRoute(lines,{color='#ff416d'}={}){
  this.routeLines=Array.isArray(lines)?lines.filter(a=>Array.isArray(a)&&a.length>=2):[];
  this.routeColor=color;this.renderRoute();
 }
 renderRoute(){if(!this.routeSvg||this.destroyed)return;const {w,h}=this.getSize();
  this.routeSvg.setAttribute('viewBox',`0 0 ${Math.max(1,w)} ${Math.max(1,h)}`);
  if(!this.routeLines?.length){this.routeSvg.replaceChildren();return}
  const origin=merc(this.center.lat,this.center.lng,this.zoom),fragments=[];
  for(const segment of this.routeLines){const pts=segment.filter(p=>Array.isArray(p)&&p.length>=2&&p.every(Number.isFinite));if(pts.length<2)continue;
   fragments.push(pts.map((point,i)=>{const v=merc(point[0],point[1],this.zoom);return `${i?'L':'M'}${(w/2+v.x-origin.x).toFixed(1)} ${(h/2+v.y-origin.y).toFixed(1)}`}).join(' '));
  }
  const d=fragments.join(' '),svgNS='http://www.w3.org/2000/svg';this.routeSvg.replaceChildren();
  if(!d)return;
  for(const [klass,width,stroke] of [['veo-route-halo',13,'#061528'],['veo-route-line',6,this.routeColor]]){
   const path=document.createElementNS(svgNS,'path');path.setAttribute('d',d);path.setAttribute('fill','none');path.setAttribute('stroke',stroke);path.setAttribute('stroke-width',width);
   path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');path.setAttribute('class',klass);this.routeSvg.append(path)
  }
 }
 setMarkers(markers){this.markers=Array.isArray(markers)?markers:[];this.renderMarkers()}
 renderMarkers(){
  if(this.destroyed||!this.markerPane)return;
  // Reuse marker DOM nodes: pointer hover/focus and links stay stable while the map pans/zooms.
  const {w,h}=this.getSize(),c=merc(this.center.lat,this.center.lng,this.zoom),seen=new Set();
  for(const item of this.markers){
   if(!Number.isFinite(item.lat)||!Number.isFinite(item.lng))continue;
   const k=String(item.id),p=merc(item.lat,item.lng,this.zoom),x=w/2+p.x-c.x,y=h/2+p.y-c.y;
   if(x < -240||x>w+240||y < -240||y>h+240)continue;
   seen.add(k);let wrap=this.markerNodes.get(k);
   if(!wrap){
    wrap=document.createElement('div');wrap.className='veo-pin-wrap';
    const label=document.createElement('div');label.className='veo-pin-name';wrap.append(label);
    const b=document.createElement('button');b.type='button';b.className='veo-opportunity-marker';b.dataset.opportunityId=item.id;
    b.innerHTML='<span class="veo-opportunity-marker-core"></span>';wrap.append(b);
    const bubble=document.createElement('div');bubble.className='veo-pin-hover';
    const heading=document.createElement('strong'),sub=document.createElement('small');bubble.append(heading,sub);
    const a=document.createElement('a');a.className='veo-google-action';a.target='_blank';a.rel='noopener noreferrer';a.textContent='↗ Ver en Google Maps';
    a.addEventListener('pointerdown',e=>e.stopPropagation());
    a.addEventListener('pointerup',e=>e.stopPropagation());
    a.addEventListener('click',e=>e.stopPropagation());
    bubble.append(a);wrap.append(bubble);this.markerPane.append(wrap);this.markerNodes.set(k,wrap);
   }
   wrap.style.display='block';wrap.style.left=x+'px';wrap.style.top=y+'px';wrap.style.setProperty('--marker-color',item.color||'#fa3b74');
   wrap.querySelector('.veo-pin-name').textContent=item.name||item.label||'Predio VEO';
   const btn=wrap.querySelector('.veo-opportunity-marker');btn.title=item.label||'Abrir expediente';btn.setAttribute('aria-label',item.label||'Ver expediente');
   wrap.querySelector('.veo-pin-hover strong').textContent=item.name||'Predio VEO';
   wrap.querySelector('.veo-pin-hover small').textContent=item.code||'';
   const anchor=wrap.querySelector('.veo-google-action');if(item.googleUrl){anchor.href=item.googleUrl;anchor.hidden=false}else{anchor.removeAttribute('href');anchor.hidden=true}
  }
  for(const [k,el] of this.markerNodes){if(!seen.has(k)){el.remove();this.markerNodes.delete(k)}}
 }
 setPin(point,notify=true){if(!point||!Number.isFinite(point.lat)||!Number.isFinite(point.lng))return;this.point={lat:point.lat,lng:point.lng};this.renderPin();if(notify)this.onPoint?.(this.point)}
 renderPin(){if(!this.point)return;const{w,h}=this.getSize(),c=merc(this.center.lat,this.center.lng,this.zoom),p=merc(this.point.lat,this.point.lng,this.zoom);this.pin.classList.remove('hidden');this.pin.style.left=(w/2+p.x-c.x)+'px';this.pin.style.top=(h/2+p.y-c.y)+'px'}
 render(){if(this.destroyed||this.renderQueued)return;this.renderQueued=true;this.frame=requestAnimationFrame(()=>{this.renderQueued=false;this.paint()})}
 paint(){if(this.destroyed)return;const{w,h}=this.getSize();if(w<4||h<4)return;
  // Tile resolution uses floor(zoom); positions scale smoothly at fractional zoom.
  const zTile=Math.floor(this.zoom),scale=2**(this.zoom-zTile),c=merc(this.center.lat,this.center.lng,zTile);
  const left=c.x-w/(2*scale),top=c.y-h/(2*scale);
  const x0=Math.floor(left/TILE)-1,y0=Math.floor(top/TILE)-1,x1=Math.ceil((left+w/scale)/TILE)+1,y1=Math.ceil((top+h/scale)/TILE)+1,limit=2**zTile;
  const visible=new Set(),data=providers[this.mode];for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++){
   if(ty<0||ty>=limit)continue;const x=(tx%limit+limit)%limit,key=`${this.mode}:${zTile}:${x}:${ty}`;visible.add(key);let img=this.images.get(key);
   if(!img){img=document.createElement('img');img.className='veo-tile';img.alt='';img.draggable=false;img.decoding='async';img.dataset.zoom=zTile;img.dataset.mode=this.mode;img.dataset.key=key;img.dataset.loaded='0';img.loading='eager';img.referrerPolicy='no-referrer';img.addEventListener('load',()=>{if(this.destroyed)return;img.dataset.loaded='1';this.loaded[img.dataset.mode]++;this.updateStatus()});img.addEventListener('error',()=>{if(this.destroyed)return;const [m,z,tx0,ty0]=key.split(':');if(m==='streets'&&!img.dataset.fallback){img.dataset.fallback='1';this.streetFallbackUsed=true;img.src=providers.streets.fallback(+z,+tx0,+ty0);this.attribution.textContent='Mapa © CARTO · datos © OpenStreetMap contributors';return}img.dataset.failed='1';this.errors[m]++;this.updateStatus()});img.src=data.url(zTile,x,ty);this.tilesPane.append(img);this.images.set(key,img)}
   img.style.left=((tx*TILE-left)*scale)+'px';img.style.top=((ty*TILE-top)*scale)+'px';img.style.width=(TILE*scale+0.8)+'px';img.style.height=(TILE*scale+0.8)+'px';img.style.opacity='1';img.style.display='block';img.style.transform='';
  }
  for(const[k,img]of this.images){if(!visible.has(k)){img.style.display='none';if(this.images.size>170){img.remove();this.images.delete(k)}}}
  this.visibleKeys=visible;this.renderRoute();this.renderPin();this.renderMarkers();this.attribution.textContent=this.mode==='streets'&&this.streetFallbackUsed?'Mapa © CARTO / Esri · datos © OpenStreetMap contributors':data.label;this.updateStatus();
 }
 showStatus(message){this.status.textContent=message;this.status.classList.add('is-visible')}
 updateStatus(){const loaded=[...this.visibleKeys].some(k=>this.images.get(k)?.dataset.loaded==='1');const count=[...this.visibleKeys].filter(k=>this.images.get(k)?.dataset.failed==='1').length;
  if(loaded){this.status.classList.remove('is-visible');return}if(count>=3){this.showStatus(this.mode==='streets'?'No se pudo cargar el mapa de calles. Revisa tu conexión o el servicio de cartografía.':'La imagen satelital no respondió. Verifica conexión o prueba Calles.')}else this.showStatus('Cargando cartografía en línea…')}
 remove(){this.destroyed=true;this.stopFitAnimation();this.cancelZoom();this.cancelAnimation();cancelAnimationFrame(this.frame);this.resizeObserver?.disconnect();this.el.removeEventListener('pointerdown',this.onDown);this.el.removeEventListener('pointermove',this.onMove);this.el.removeEventListener('pointerup',this.onUp);this.el.removeEventListener('pointercancel',this.onUp);this.el.removeEventListener('wheel',this.onWheel);this.el.removeEventListener('dblclick',this.onDbl);this.el.removeEventListener('keydown',this.onKeyboard);this.controls.removeEventListener('click',this.onControls);this.markerPane.removeEventListener('click',this.onMarkerClick);this.images.clear();this.markerNodes.clear();this.el.replaceChildren();this.el.classList.remove('veo-native-map')}
}
window.VEOMapNative=VEOMapNative;
})();

