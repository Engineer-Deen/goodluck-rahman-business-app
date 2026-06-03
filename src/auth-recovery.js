module.exports = function createAuthRecovery(opts){
  const { detachRemoteFirestoreListener, stopSyncEngine, localStore, setLoginOverlayMessage, signOut } = opts || {};

  function isAuthLikeError(err){
    if(!err) return false;
    const code = err.code || '';
    const msg = String(err.message||'').toLowerCase();
    if(code && String(code).startsWith('auth/')) return true;
    if(msg.includes('permission-denied') || msg.includes('unauth') || msg.includes('token')) return true;
    if(msg.includes('too many failed attempts') || msg.includes('auto-login blocked') || msg.includes('refresh token') || msg.includes('invalid token') || msg.includes('expired token')) return true;
    if(code === 'auth/too-many-requests' || code === 'auth/user-token-expired' || code === 'auth/id-token-expired' || code === 'auth/invalid-user-token' || code === 'auth/invalid-credential') return true;
    return false;
  }

  return async function handleAuthError(err, context={}){
    try{
      const ts = new Date().toISOString();
      const code = err?.code || '';
      const message = err?.message || String(err);
      const uid = (context && context.uid) || '';
      // Log locally if localStore available
      try{ if(localStore && typeof localStore.appendLog === 'function') localStore.appendLog('error', uid, code, message, { ts, context }); }catch(_e){}

      if(!isAuthLikeError(err)) return false;

      // Show friendly message in UI immediately (non-blocking)
      try{
        if(typeof setLoginOverlayMessage === 'function'){
          setLoginOverlayMessage('Your session has expired. Please sign in again.');
        } else if(typeof window !== 'undefined'){
          const overlay=document.getElementById('login-overlay');
          if(overlay) overlay.style.display='flex';
          const el=document.getElementById('login-error');
          if(el) el.textContent='Your session has expired. Please sign in again.';
        }
      }catch(_e){}

      // Run cleanup operations in parallel for faster sign-out
      const cleanupPromises = [];
      
      // Stop sync engine (non-blocking)
      cleanupPromises.push(Promise.resolve().then(()=>{
        try{ if(typeof stopSyncEngine === 'function') stopSyncEngine(); }catch(_e){}
      }));
      
      // Detach listeners (non-blocking)
      cleanupPromises.push(Promise.resolve().then(()=>{
        try{ if(typeof detachRemoteFirestoreListener === 'function') detachRemoteFirestoreListener(); }catch(_e){}
      }));
      
      // Clear auth-sensitive cached data (non-blocking)
      cleanupPromises.push(Promise.resolve().then(()=>{
        try{
          if(localStore && typeof localStore.deleteScoped === 'function'){
            const acct = (context && context.account) || '';
            if(acct) localStore.deleteScoped('glr_user_password', acct);
          }
        }catch(_e){}
      }));
      
      // Wait for all cleanup to complete in parallel
      await Promise.all(cleanupPromises);

      // Finally sign out (after cleanup)
      try{
        if(typeof signOut === 'function'){
          await signOut();
        } else if(typeof window !== 'undefined' && window.firebaseAuth && typeof window.firebaseAuth.signOut === 'function'){
          await window.firebaseAuth.signOut();
        }
      }catch(_e){}

      return true;
    }catch(e){
      try{ if(localStore && typeof localStore.appendLog === 'function') localStore.appendLog('error','', 'auth_recovery_failed', String(e), {}); }catch(_e){}
      return false;
    }
  };
};
