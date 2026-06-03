module.exports = function createSyncEngine(opts){
  const { syncToCloud, getPendingFn, appendLog } = opts || {};
  let intervalMs = opts?.intervalMs || 30000;
  let timer = null;
  let running = false;
  let lastTickAt = 0;

  async function tick(){
    lastTickAt = Date.now();
    try{
      const pending = typeof getPendingFn === 'function' ? await getPendingFn() : undefined;
      const shouldRun = pending !== false && pending !== undefined && !(Array.isArray(pending) && pending.length === 0) && !(typeof pending === 'number' && pending === 0);
      if(!shouldRun) return;
      if(typeof syncToCloud === 'function'){
        await syncToCloud(false);
      }
    }catch(e){
      try{ if(typeof appendLog === 'function') appendLog('error','', 'sync_tick_failed', String(e), {}); }catch(_e){}
    }
  }

  function schedule(){
    if(timer) return;
    timer = setInterval(() => {
      if(!running) return;
      tick().catch((e)=>{
        try{ if(typeof appendLog === 'function') appendLog('error','', 'sync_engine_interval_error', String(e), {}); }catch(_e){}
      });
    }, intervalMs);
  }

  return {
    start(){ if(running) return; running = true; schedule(); void tick(); },
    stop(){ if(!running) return; running=false; if(timer){ clearInterval(timer); timer=null; } },
    trigger: async function(){ return tick(); },
    isRunning(){ return running; },
    lastTickAt(){ return lastTickAt; }
  };
};
