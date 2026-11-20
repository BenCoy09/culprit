(function(){
  const el=document.getElementById('honest');if(!el)return;
  C.status().then(s=>{
    if(!s){el.textContent='Could not reach the server.';return}
    el.innerHTML=s.mode==='real'
      ?'<b style="color:var(--ink)">This server runs the real Kane CLI.</b> Each visitor gets '+s.perVisitor+' runs a day so the free credits last.'
      :'<b style="color:var(--ink)">This server is in stand-in mode.</b> Search, undo and verify are real; browser replays are simulated. The recorded run shows real Kane.';
  });
})();
