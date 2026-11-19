// VEO · Mapa de oportunidades sobre Google Maps (JavaScript API oficial, vista de calles).
// Expone la misma interfaz que VEOMapNative (mapa-fluido.js) para que crm.js no cambie:
//   new VEOGoogleMap(el,{center,zoom,markers,onMarker}) · fitBounds · flyTo · setRoute · setMarkers · setMode · remove · userNavigated
(function(){
  'use strict';

  const pinSvg=color=>'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">
      <path d="M17 1.5C8.4 1.5 1.5 8.3 1.5 16.8 1.5 28.3 17 42.5 17 42.5S32.5 28.3 32.5 16.8C32.5 8.3 25.6 1.5 17 1.5Z" fill="${color}" stroke="#fff" stroke-width="3"/>
      <circle cx="17" cy="16.5" r="5" fill="#fff"/></svg>`);

  const clusterSvg=(n)=>{const r=n<10?20:n<50?24:28,d=r*2+12;return {d,url:'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}" viewBox="0 0 ${d} ${d}"><circle cx="${d/2}" cy="${d/2}" r="${r+5}" fill="#fa3b74" fill-opacity=".28"/><circle cx="${d/2}" cy="${d/2}" r="${r}" fill="#fa3b74" stroke="#fff" stroke-width="3"/></svg>`)}};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fecha=v=>{const d=new Date(v);return isNaN(d)?'':d.toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'})};
  const mediaUrl=m=>'/api/documents/'+encodeURIComponent(m.id)+'/content';

  class VEOGoogleMap{
    constructor(el,{center=[25.6866,-100.3161],zoom=12,markers=[],onMarker}={}){
      const gm=window.google.maps;this.gm=gm;this.el=el;this.onMarker=onMarker;this.userNavigated=false;
      this.map=new gm.Map(el,{
        center:{lat:center[0],lng:center[1]},zoom,mapTypeId:'roadmap',
        mapTypeControl:false,streetViewControl:false,fullscreenControl:true,rotateControl:false,
        clickableIcons:false,gestureHandling:'greedy',keyboardShortcuts:true,
        zoomControl:true,zoomControlOptions:{position:gm.ControlPosition.RIGHT_BOTTOM},
        styles:[{featureType:'poi.business',stylers:[{visibility:'off'}]},{featureType:'poi',elementType:'labels.icon',stylers:[{visibility:'off'}]}]
      });
      this.info=new gm.InfoWindow({maxWidth:270});
      this.openKey=null;
      this.info.addListener('closeclick',()=>{this.openKey=null});
      this.info.addListener('domready',()=>this.wireGallery());
      this.routeLines=[];this.markerObjs=[];
      this.map.addListener('dragstart',()=>{this.userNavigated=true});
      this.map.addListener('click',()=>this.closeInfo());
      el.addEventListener('wheel',()=>{this.userNavigated=true},{passive:true});
      // Botones dentro del globo (expediente, flechas del carrusel)
      this._clickHandler=e=>{
        const nav=e.target.closest?.('[data-veo-nav]');
        if(nav){e.preventDefault();const track=nav.closest('.veo-gmap-media')?.querySelector('.veo-gmap-track');if(track){track.scrollBy({left:(nav.dataset.veoNav==='next'?1:-1)*track.clientWidth,behavior:'smooth'});setTimeout(()=>track._veoFit?.(),420)}return}
        const b=e.target.closest?.('[data-veo-open]');
        if(b){e.preventDefault();this.closeInfo();this.onMarker?.(Number(b.dataset.veoOpen))}
      };
      el.addEventListener('click',this._clickHandler);
      this.setMarkers(markers);
      this.watchTiles();
    }

    // Vigilancia de la cartografía: si los mosaicos no terminan de cargar (red móvil lenta,
    // pestaña en segundo plano, cambio de tamaño), se piden de nuevo; si aun así no llegan,
    // se muestra un botón para recargar sólo el mapa.
    watchTiles(){
      const gm=this.gm;this.tilesOk=false;this._tries=0;
      const ok=()=>{this.tilesOk=true;clearTimeout(this._tileTimer);this.el.querySelector('.veo-gmap-retry')?.remove()};
      const pending=()=>{if(this.destroyed)return;this.tilesOk=false;clearTimeout(this._tileTimer);this._tileTimer=setTimeout(check,6000)};
      const drawn=()=>[...this.el.querySelectorAll('.gm-style img')].some(i=>i.complete&&i.naturalWidth>=256);
      const check=()=>{if(this.destroyed||this.tilesOk)return;if(drawn()){ok();return}
        if(this._tries<2){this._tries++;this.nudge();this._tileTimer=setTimeout(check,6000);return}
        this.showRetry()};
      this.map.addListener('tilesloaded',ok);
      this.map.addListener('zoom_changed',pending);
      this._onWake=()=>{if(document.visibilityState!=='hidden'&&!this.tilesOk&&!this.destroyed){this._tries=0;this.nudge();pending()}};
      document.addEventListener('visibilitychange',this._onWake);window.addEventListener('online',this._onWake);
      this._resizeObs=window.ResizeObserver?new ResizeObserver(()=>{if(!this.destroyed)this.nudge()}):null;this._resizeObs?.observe(this.el);
      pending();
    }
    nudge(){ // vuelve a solicitar los mosaicos visibles sin mover el mapa de forma perceptible
      const c=this.map?.getCenter();if(!c)return;this.map.panBy(0,1);this.map.panBy(0,-1);this.map.setCenter(c)
    }
    showRetry(){
      if(this.el.querySelector('.veo-gmap-retry'))return;
      const b=document.createElement('button');b.type='button';b.className='veo-gmap-retry';b.textContent='↻ Recargar cartografía';
      b.addEventListener('click',e=>{e.stopPropagation();b.remove();(window.veoReloadMap||(()=>{this._tries=0;this.nudge()}))()});
      this.el.appendChild(b);
    }

    bounds({south,west,north,east}){return new this.gm.LatLngBounds({lat:south,lng:west},{lat:north,lng:east})}

    fitBounds(b,{padding={x:20,y:30},maxZoom=15}={}){
      if(!b||this.destroyed)return;
      this.map.fitBounds(this.bounds(b),{top:padding.y,bottom:padding.y,left:padding.x,right:padding.x});
      this.gm.event.addListenerOnce(this.map,'idle',()=>{if(this.map.getZoom()>maxZoom)this.map.setZoom(maxZoom)});
    }

    flyTo(center,zoom){
      if(this.destroyed)return;
      const target={lat:+center[0],lng:+center[1]};
      if(zoom!=null&&Math.abs(this.map.getZoom()-zoom)>2){this.map.setZoom(zoom);this.map.setCenter(target)}
      else{this.map.panTo(target);if(zoom!=null)this.map.setZoom(zoom)}
    }

    setRoute(lines,{color='#ff416d'}={}){
      for(const l of this.routeLines)l.setMap(null);
      this.routeLines=[];
      if(this.destroyed||!Array.isArray(lines))return;
      for(const pts of lines){
        if(!pts?.length)continue;
        const path=pts.map(p=>({lat:+p[0],lng:+p[1]}));
        this.routeLines.push(new this.gm.Polyline({map:this.map,path,strokeColor:'#ffffff',strokeOpacity:.9,strokeWeight:10,clickable:false,zIndex:10}));
        this.routeLines.push(new this.gm.Polyline({map:this.map,path,strokeColor:color,strokeOpacity:.95,strokeWeight:6,clickable:false,zIndex:11}));
      }
    }

    setMarkers(markers){
      try{this.clusterer?.clearMarkers();this.clusterer?.setMap?.(null)}catch(_){}this.clusterer=null;
      for(const m of this.markerObjs)m.setMap(null);
      this.markerObjs=[];this.byPredio=new Map();this.closeInfo();
      if(this.destroyed)return;
      // Agrupación de pines al alejar el mapa (librería oficial de Google); si no cargó, pines sueltos.
      const MC=window.markerClusterer,predioMarkers=[];
      const gm=this.gm,hover=!window.matchMedia?.('(hover: none)').matches;
      for(const item of markers||[]){
        if(!Number.isFinite(item.lat)||!Number.isFinite(item.lng))continue;
        const isPhoto=item.kind==='foto',key=String(item.key||item.id);
        const marker=new gm.Marker({
          map:(MC&&!isPhoto)?null:this.map,position:{lat:item.lat,lng:item.lng},title:item.label||item.name||'',
          zIndex:isPhoto?5:20,optimized:true,
          icon:isPhoto
            ?{path:gm.SymbolPath.CIRCLE,scale:6,fillColor:item.color||'#fa3b74',fillOpacity:1,strokeColor:'#ffffff',strokeWeight:2}
            :{url:pinSvg(item.color||'#fa3b74'),scaledSize:new gm.Size(30,39),anchor:new gm.Point(15,38),labelOrigin:new gm.Point(15,-10)},
          label:isPhoto?null:{text:String(item.name||'').slice(0,28),className:'veo-gmap-label',color:'#ffffff',fontSize:'12px',fontWeight:'700'}
        });
        const show=()=>{if(this.openKey===key)return;this.openKey=key;this.info.setContent(this.balloonHtml(item));this.info.open({map:this.map,anchor:marker})};
        // Si el pin está dentro de un grupo, acercar hasta que se separe y luego abrir su globo
        const open=()=>{if(this.clusterer&&!marker.getMap()){this.map.panTo(marker.getPosition());this.map.setZoom(Math.max(this.map.getZoom()||0,17));gm.event.addListenerOnce(this.map,'idle',()=>setTimeout(show,120))}else show()};
        if(!isPhoto)this.byPredio.set(Number(item.id),open);
        if(hover)marker.addListener('mouseover',open);
        marker.addListener('click',open); // celular y laptop: el globo se abre; el expediente desde su botón
        this.markerObjs.push(marker);
        if(MC&&!isPhoto)predioMarkers.push(marker);
      }
      if(MC&&predioMarkers.length){
        this.clusterer=new MC.MarkerClusterer({map:this.map,markers:predioMarkers,
          algorithm:new MC.SuperClusterAlgorithm({radius:72,maxZoom:15}),
          renderer:{render:({count,position})=>{const ic=clusterSvg(count);return new gm.Marker({position,zIndex:1000+count,title:count+' predios · toca para acercar',
            icon:{url:ic.url,scaledSize:new gm.Size(ic.d,ic.d),anchor:new gm.Point(ic.d/2,ic.d/2)},
            label:{text:String(count),color:'#ffffff',fontSize:count<100?'14px':'12px',fontWeight:'800'}})}},
          onClusterClick:(e,cluster,map)=>{this.userNavigated=true;this.closeInfo();if(cluster.bounds)map.fitBounds(cluster.bounds,{top:60,bottom:60,left:40,right:40});else{map.panTo(cluster.position);map.setZoom((map.getZoom()||12)+2)}}});
      }
    }

    closeInfo(){this.info?.close();this.openKey=null}

    // Abre el globo de un predio (usado al tocarlo en la lista "Predios georreferenciados")
    openMarker(id){const open=this.byPredio?.get(Number(id));if(!open)return false;this.openKey=null;this.el.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>{if(!this.destroyed)open()},450);return true}

    balloonHtml(item){
      const media=Array.isArray(item.media)?item.media:[];
      let gallery='';
      if(media.length){
        const slides=media.map(m=>{
          const url=esc(mediaUrl(m));
          const body=m.kind==='video'
            ?`<video src="${url}" controls playsinline preload="metadata"></video>`
            :`<a href="${url}" target="_blank" rel="noopener" title="Ver foto completa"><img src="${url}" alt="${esc(m.name||'Foto del predio')}" loading="lazy" onerror="this.closest('.veo-gmap-slide').classList.add('is-broken')"></a>`;
          return `<figure class="veo-gmap-slide">${body}<figcaption>${m.kind==='video'?'🎬 ':'📷 '}${esc(m.by||'Sin autor')} · ${esc(fecha(m.at))}</figcaption></figure>`;
        }).join('');
        const nav=media.length>1?`<button type="button" class="veo-gmap-nav prev" data-veo-nav="prev" aria-label="Anterior">‹</button><button type="button" class="veo-gmap-nav next" data-veo-nav="next" aria-label="Siguiente">›</button><span class="veo-gmap-count">1 / ${media.length}</span>`:'';
        gallery=`<div class="veo-gmap-media"><div class="veo-gmap-track">${slides}</div>${nav}</div>`;
      }
      return `<div class="veo-gmap-info">${gallery}`+
        `<strong class="veo-gmap-title">${esc(item.name||'Predio VEO')}</strong>`+
        `<small class="veo-gmap-sub">${esc(item.code||'')}</small>`+
        (item.corridorName?`<small class="veo-gmap-corr">${esc(item.corridorName)}</small>`:'')+
        `<div class="veo-gmap-actions">`+
        (item.googleUrl?`<a class="veo-gmap-maps" href="${esc(item.googleUrl)}" target="_blank" rel="noopener noreferrer">↗ Google Maps</a>`:'')+
        `<button type="button" class="veo-gmap-open" data-veo-open="${esc(item.id)}">Expediente</button></div></div>`;
    }

    // Contador "n / total" al deslizar y pausa de videos que salen de vista
    wireGallery(){
      const track=this.el.querySelector('.veo-gmap-info .veo-gmap-track');if(!track||track.dataset.wired)return;
      track.dataset.wired='1';
      const count=track.parentNode.querySelector('.veo-gmap-count'),total=track.children.length;
      // El visor toma la altura de la foto/video que se está viendo: horizontal (16:9) más bajo,
      // vertical (9:16) más alto, siempre mostrando la imagen completa.
      const current=()=>Math.min(total-1,Math.max(0,Math.round(track.scrollLeft/Math.max(1,track.clientWidth))));
      const fit=()=>{const s=track.children[current()];if(s&&s.offsetHeight)track.style.height=s.offsetHeight+'px'};
      track.querySelectorAll('img').forEach(img=>{if(!img.complete)img.addEventListener('load',fit,{once:true});img.addEventListener('error',fit,{once:true})});
      track.querySelectorAll('video').forEach(v=>v.addEventListener('loadedmetadata',fit,{once:true}));
      requestAnimationFrame(fit);track._veoFit=fit;track.addEventListener('scrollend',fit,{passive:true});
      let t=null;
      track.addEventListener('scroll',()=>{clearTimeout(t);t=setTimeout(()=>{
        const i=current();fit();
        if(count)count.textContent=(i+1)+' / '+total;
        [...track.querySelectorAll('video')].forEach((v,idx)=>{if(v.closest('.veo-gmap-slide')!==track.children[i])v.pause()});
      },80)},{passive:true});
    }

    setMode(){this.map?.setMapTypeId('roadmap')} // siempre calles

    remove(){
      this.destroyed=true;clearTimeout(this._tileTimer);this._resizeObs?.disconnect();document.removeEventListener('visibilitychange',this._onWake);window.removeEventListener('online',this._onWake);
      try{this.info?.close();this.clusterer?.clearMarkers();this.clusterer?.setMap?.(null);for(const m of this.markerObjs)m.setMap(null);for(const l of this.routeLines)l.setMap(null);this.gm.event.clearInstanceListeners(this.map);this.gm.event.clearInstanceListeners(this.info)}catch(_){}
      this.el.removeEventListener('click',this._clickHandler);
      this.markerObjs=[];this.routeLines=[];
    }
  }

  window.VEOGoogleMap=VEOGoogleMap;
})();
