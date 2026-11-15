// VEO · Georreferencia de fotografías.
// 1) Lee el GPS que la cámara guarda en el EXIF de la foto (JPEG).
// 2) Si la foto no trae GPS, usa la ubicación actual del dispositivo (con permiso).
(function(){
  'use strict';

  // ── Lector EXIF mínimo (solo JPEG): GPS + fecha de toma ──
  function readExifGps(buffer){
    const v=new DataView(buffer);
    if(v.byteLength<4||v.getUint16(0)!==0xFFD8)return null; // no es JPEG
    let off=2;
    while(off+4<=v.byteLength){
      const marker=v.getUint16(off);
      if((marker&0xFF00)!==0xFF00)return null;
      const size=v.getUint16(off+2);
      if(marker===0xFFE1&&off+10<=v.byteLength&&v.getUint32(off+4)===0x45786966){ // "Exif"
        return parseTiff(v,off+10);
      }
      if(marker===0xFFDA)return null; // inicio de imagen: ya no hay metadatos
      off+=2+size;
    }
    return null;
  }

  function parseTiff(v,start){
    if(start+8>v.byteLength)return null;
    const little=v.getUint16(start)===0x4949;
    const u16=o=>v.getUint16(start+o,little),u32=o=>v.getUint32(start+o,little);
    const inRange=o=>start+o>=0&&start+o<v.byteLength;
    function entries(ifd){
      const out={};if(!inRange(ifd+2))return out;
      const n=u16(ifd);
      for(let i=0;i<n;i++){
        const e=ifd+2+i*12;if(!inRange(e+12))break;
        out[u16(e)]={type:u16(e+2),count:u32(e+4),valueOff:e+8,ptr:u32(e+8)};
      }
      return out;
    }
    const rationals=(t,count)=>{const r=[];for(let i=0;i<count;i++){const o=t.ptr+i*8;if(!inRange(o+8))return null;const d=u32(o+4);r.push(d?u32(o)/d:0)}return r};
    const ascii=t=>{const o=t.count>4?t.ptr:t.valueOff;let s='';for(let i=0;i<t.count-1;i++){if(!inRange(o+i))break;s+=String.fromCharCode(v.getUint8(start+o+i))}return s};
    const ifd0=entries(u32(4));
    let takenAt=null;
    if(ifd0[0x8769]){const ex=entries(ifd0[0x8769].ptr);const t=ex[0x9003]||ex[0x9004];if(t){const m=ascii(t).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);if(m)takenAt=`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`}}
    if(!ifd0[0x8825])return null;
    const g=entries(ifd0[0x8825].ptr);
    if(!g[2]||!g[4])return null;
    const lat=rationals(g[2],3),lng=rationals(g[4],3);if(!lat||!lng)return null;
    const ref=(t,def)=>t?String.fromCharCode(v.getUint8(start+t.valueOff)):def;
    let la=lat[0]+lat[1]/60+lat[2]/3600,lo=lng[0]+lng[1]/60+lng[2]/3600;
    if(ref(g[1],'N')==='S')la=-la;
    if(ref(g[3],'E')==='W')lo=-lo;
    if(!Number.isFinite(la)||!Number.isFinite(lo)||Math.abs(la)>90||Math.abs(lo)>180||(la===0&&lo===0))return null;
    return {lat:la,lng:lo,takenAt};
  }

  function deviceLocation(){
    return new Promise((resolve,reject)=>{
      if(!navigator.geolocation)return reject(new Error('Este navegador no permite obtener la ubicación. Usa una foto tomada con el GPS de la cámara activado.'));
      navigator.geolocation.getCurrentPosition(
        p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:Math.round(p.coords.accuracy||0)}),
        err=>reject(new Error(err.code===1
          ?'La foto no trae ubicación GPS y no se dio permiso de ubicación. Activa la ubicación para este sitio en el navegador (ícono de candado junto a la dirección) e inténtalo de nuevo.'
          :'No se pudo obtener la ubicación del dispositivo. Revisa que el GPS esté encendido e inténtalo de nuevo.')),
        {enableHighAccuracy:true,timeout:20000,maximumAge:60000});
    });
  }

  const isImage=file=>/^image\//.test(file.type)||/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name||'');

  // Devuelve {geo_lat,geo_lng,geo_source,geo_accuracy_m,taken_at} o null.
  // required=true → si la foto no trae GPS se usa (y exige) la ubicación del dispositivo.
  async function geoForFile(file,{required=false}={}){
    if(!isImage(file))return null;
    let exif=null;
    try{exif=readExifGps(await file.slice(0,512*1024).arrayBuffer())}catch(_){exif=null}
    if(exif)return {geo_lat:+exif.lat.toFixed(7),geo_lng:+exif.lng.toFixed(7),geo_source:'exif',geo_accuracy_m:null,taken_at:exif.takenAt};
    if(!required)return null;
    const d=await deviceLocation();
    return {geo_lat:+d.lat.toFixed(7),geo_lng:+d.lng.toFixed(7),geo_source:'dispositivo',geo_accuracy_m:d.accuracy||null,taken_at:null};
  }

  function distanceMeters(a,b){
    const R=6371000,rad=x=>x*Math.PI/180;
    const dLat=rad(b.lat-a.lat),dLng=rad(b.lng-a.lng);
    const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
  }

  window.VEOGeoFoto={geoForFile,isImage,distanceMeters,readExifGps};
})();
