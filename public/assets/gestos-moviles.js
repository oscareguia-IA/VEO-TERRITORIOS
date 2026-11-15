
/* VEO Mobile · gestures, non-destructive enhancement. */
(function(){
 let lastTap=0,lastPoint=null;
 document.addEventListener('touchend',function(e){
   const el=e.target.closest?.('#aforo-lienzo');
   if(!el||e.touches.length)return;
   const t=Date.now(),p=e.changedTouches?.[0];
   if(t-lastTap<335&&p&&lastPoint&&Math.hypot(p.clientX-lastPoint.x,p.clientY-lastPoint.y)<48){
      e.preventDefault();if(typeof aforoEscala==='function'){const zoom=typeof aforoZoomActual!=='undefined'?aforoZoomActual:100;aforoEscala(zoom>100?100:200)};
      lastTap=0;lastPoint=null;
   }else{lastTap=t;lastPoint=p?{x:p.clientX,y:p.clientY}:null;}
 },{passive:false});
 // Prevent overlay content from accidentally initiating navigation on taps.
 document.addEventListener('click',function(e){
   if(e.target.closest?.('.mobile-nav button')){
      const active=e.target.closest('button');active?.setAttribute('aria-live','polite');
   }
 });
})();
