module.exports = function createSyncEngine(opts){
  const { syncToCloud, getPendingFn, appendLog } = opts || {};
  let intervalMs = opts?.intervalMs || 30000;
  let timer = null;
  let running = false;

  async function tick(){
    try{
      if(typeof getPendingFn === 'function'){
        const pending = await getPendingFn();
        if(
          pending === false ||
          pending === undefined ||
          (Array.isArray(pending) && pending.length===0) ||
          (typeof pending === 'number' && pending === 0)
        ) return;
      }
      if(typeof syncToCloud === 'function'){
        await syncToCloud(false);
      }
    }catch(e){
      try{ if(typeof appendLog === 'function') appendLog('error','', 'sync_tick_failed', String(e), {}); }catch(_e){}
    }
  }

  return {
    start(){ if(running) return; running = true; timer = setInterval(tick, intervalMs); },
    stop(){ if(!running) return; running=false; if(timer){ clearInterval(timer); timer=null; } },
    trigger: async function(){ return tick(); },
    isRunning(){ return running; }
  };
};
