// VEO · Mapa de oportunidades sobre Google Maps (JavaScript API oficial, vista de calles).
// Expone la misma interfaz que VEOMapNative (mapa-fluido.js) para que crm.js no cambie:
//   new VEOGoogleMap(el,{center,zoom,markers,onMarker}) · fitBounds · flyTo · setRoute · setMarkers · setMode · remove · userNavigated
(function(){
  'use strict';

  const pinSvg=color=>'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">
      <path d="M17 1.5C8.4 1.5 1.5 8.3 1.5 16.8 1.5 28.3 17 42.5 17 42.5S32.5 28.3 32.5 16.8C32.5 8.3 25.6 1.5 17 1.5Z" fill="${color}" stroke="#fff" stroke-width="3"/>
      <circle cx="17" cy="16.5" r="5" fill="#fff"/></svg>`);

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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
      this.info=new gm.InfoWindow({disableAutoPan:true});
      this.routeLines=[];this.markerObjs=[];
      // Navegación manual del usuario (para no recentrar de golpe al llegar el trazado del corredor)
      this.map.addListener('dragstart',()=>{this.userNavigated=true});
      el.addEventListener('wheel',()=>{this.userNavigated=true},{passive:true});
      this.setMarkers(markers);
    }

    bounds({south,west,north,east}){return new this.gm.LatLngBounds({lat:south,lng:west},{lat:north,lng:east})}

    fitBounds(b,{padding={x:20,y:30},maxZoom=15}={}){
      if(!b||this.destroyed)return;
      this.map.fitBounds(this.bounds(b),{top:padding.y,bottom:padding.y,left:padding.x,right:padding.x});
      const once=this.gm.event.addListenerOnce(this.map,'idle',()=>{if(this.map.getZoom()>maxZoom)this.map.setZoom(maxZoom)});
      this._fitListener=once;
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
        // contorno blanco + línea de color para que resalte sobre las calles de Google
        this.routeLines.push(new this.gm.Polyline({map:this.map,path,strokeColor:'#ffffff',strokeOpacity:.9,strokeWeight:10,clickable:false,zIndex:10}));
        this.routeLines.push(new this.gm.Polyline({map:this.map,path,strokeColor:color,strokeOpacity:.95,strokeWeight:6,clickable:false,zIndex:11}));
      }
    }

    setMarkers(markers){
      for(const m of this.markerObjs)m.setMap(null);
      this.markerObjs=[];
      if(this.destroyed)return;
      const gm=this.gm;
      for(const item of markers||[]){
        if(!Number.isFinite(item.lat)||!Number.isFinite(item.lng))continue;
        const isPhoto=item.kind==='foto';
        const marker=new gm.Marker({
          map:this.map,position:{lat:item.lat,lng:item.lng},title:item.label||item.name||'',
          zIndex:isPhoto?5:20,optimized:true,
          icon:isPhoto
            ?{path:gm.SymbolPath.CIRCLE,scale:6,fillColor:item.color||'#fa3b74',fillOpacity:1,strokeColor:'#ffffff',strokeWeight:2}
            :{url:pinSvg(item.color||'#fa3b74'),scaledSize:new gm.Size(30,39),anchor:new gm.Point(15,38),labelOrigin:new gm.Point(15,-10)},
          label:isPhoto?null:{text:String(item.name||'').slice(0,28),className:'veo-gmap-label',color:'#ffffff',fontSize:'12px',fontWeight:'700'}
        });
        // Laptop: burbuja compacta al pasar el cursor; clic abre el expediente.
        // Celular / pantallas táctiles: tarjeta compacta abajo del mapa; el expediente se abre desde la tarjeta.
        marker.addListener('mouseover',()=>{if(this.isCompact())return;this.info.setContent(this.cardHtml(item,'veo-gmap-info'));this.info.open({map:this.map,anchor:marker})});
        marker.addListener('click',()=>{
          if(this.isCompact()){this.info.close();this.showCard(item);return}
          this.info.setContent(this.cardHtml(item,'veo-gmap-info'));this.info.open({map:this.map,anchor:marker});this.onMarker?.(Number(item.id));
        });
        this.markerObjs.push(marker);
      }
      if(!this._openHandler){
        this._openHandler=e=>{
          if(e.target.closest?.('[data-veo-close]')){e.preventDefault();this.hideCard();return}
          const b=e.target.closest?.('[data-veo-open]');if(b){e.preventDefault();this.hideCard();this.onMarker?.(Number(b.dataset.veoOpen))}
        };
        this.el.addEventListener('click',this._openHandler);
        this.map.addListener('click',()=>this.hideCard());
      }
    }

    isCompact(){return this.el.clientWidth<700||window.matchMedia?.('(hover: none)').matches}

    cardHtml(item,cls){
      const photo=item.photoUrl?`<a class="veo-gmap-photo" href="${esc(item.photoUrl)}" target="_blank" rel="noopener" title="Ver foto completa"><img src="${esc(item.photoUrl)}" alt="Foto del predio" loading="lazy" onerror="this.parentNode.remove()"></a>`:'';
      const close=cls==='veo-gmap-card'?'<button type="button" class="veo-gmap-close" data-veo-close aria-label="Cerrar">×</button>':'';
      return `<div class="${cls}${item.photoUrl?' has-photo':''}">${close}${photo}<div class="veo-gmap-text"><strong>${esc(item.name||'Predio VEO')}</strong><small>${esc(item.code||'')}</small>`+
        `<div class="veo-gmap-actions">`+
        (item.googleUrl?`<a class="veo-gmap-maps" href="${esc(item.googleUrl)}" target="_blank" rel="noopener noreferrer">↗ Google Maps</a>`:'')+
        `<button type="button" class="veo-gmap-open" data-veo-open="${esc(item.id)}">Expediente</button></div></div></div>`;
    }

    showCard(item){
      if(!this.card){this.card=document.createElement('div');this.card.className='veo-gmap-card-host';this.el.appendChild(this.card)}
      this.card.innerHTML=this.cardHtml(item,'veo-gmap-card');this.card.hidden=false;
    }

    hideCard(){if(this.card){this.card.hidden=true;this.card.innerHTML=''}}

    setMode(){this.map?.setMapTypeId('roadmap')} // siempre calles

    remove(){
      this.destroyed=true;
      try{this.info?.close();for(const m of this.markerObjs)m.setMap(null);for(const l of this.routeLines)l.setMap(null);this.gm.event.clearInstanceListeners(this.map)}catch(_){}
      if(this._openHandler)this.el.removeEventListener('click',this._openHandler);
      this.card?.remove();this.card=null;
      this.markerObjs=[];this.routeLines=[];
    }
  }

  window.VEOGoogleMap=VEOGoogleMap;
})();
