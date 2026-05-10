const electronAvailable = typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.storeGetSync === 'function';

const DB={
  get(k){
    try {
      if (electronAvailable) return window.electronAPI.storeGetSync(k);
      const v=localStorage.getItem(k);
      return v?JSON.parse(v):null;
    } catch(e){return null;}
  },
  set(k,v){
    try {
      if (electronAvailable) return window.electronAPI.storeSetSync(k,v);
      localStorage.setItem(k,JSON.stringify(v));
    } catch(e){}
  },
  delete(k){
    try {
      if (electronAvailable) return window.electronAPI.storeDeleteSync(k);
      localStorage.removeItem(k);
    } catch(e){}
  },
  getSales(){return this.get('glr_sales')||[];},
  setSales(v){this.set('glr_sales',v);},
  getAudit(){return this.get('glr_audit')||[];},
  setAudit(v){this.set('glr_audit',v);},
  getInventory(){return this.get('glr_inventory')||[];},
  setInventory(v){this.set('glr_inventory',v);},
  getSyncQueue(){return this.get('glr_sync_queue')||[];},
  setSyncQueue(v){this.set('glr_sync_queue',v);},
  getSyncState(){return this.get('glr_sync_state')||{};},
  setSyncState(v){this.set('glr_sync_state',v);},
};

const GOOGLE_SCRIPT_WEB_APP_URL=''; // Optional fallback. Preferred: set inside app when prompted.
const FIREBASE_CONFIG={
  apiKey:'AIzaSyDIQmttjgqP9hrJl9GW1OTBsNeeYljc_cI',
  authDomain:'my-desktop-app-4ee05.firebaseapp.com',
  projectId:'my-desktop-app-4ee05',
  storageBucket:'my-desktop-app-4ee05.firebasestorage.app',
  messagingSenderId:'700774432459',
  appId:'1:700774432459:web:1a0880f8952f9b11a7654e',
};
const OWNER_EMAIL=''; // Optional: lock login to one owner email if set.
const FIRESTORE_CONFIG_COLLECTION='meta';
const FIRESTORE_CONFIG_DOC='appConfig';
const DEFAULT_OWNER_PHOTO='assets/login-photo.png';
/** Try these bundled names if login-photo.png is missing (same folder: src/assets/). */
const BUNDLED_OWNER_PHOTO_CANDIDATES=[
  'assets/login-photo.png',
  'assets/login-photo.jpg',
  'assets/login-photo.jpeg',
  'assets/login-photo.webp',
];
const DEVICE_ID_KEY='glr_device_id';
const OWNER_PIN_KEY='glr_owner_pin';
const EXPLICIT_LOGOUT_KEY='glr_explicit_logout';
const OWNER_PROFILE_KEY='glr_owner_profile';
const SYNC_URL_KEY='glr_sync_url';
const UPDATE_URL_HELP='Example: https://goodluckrahmanenterprise.netlify.app/';
let syncDebounceTimer=null;
let syncInProgress=false;
let syncIntervalTimer=null;
let justLoggedIn=false;

function getOwnerPin(){
  return DB.get(OWNER_PIN_KEY) || '1234';
}
function setOwnerPin(pin){
  if(!pin) return;
  DB.set(OWNER_PIN_KEY, pin.trim());
}
function isExplicitLogout(){
  return DB.get(EXPLICIT_LOGOUT_KEY)===true;
}
function setExplicitLogout(value){
  DB.set(EXPLICIT_LOGOUT_KEY, !!value);
}
function getOwnerProfileData(){
  return DB.get(OWNER_PROFILE_KEY) || { name:'Owner', email:'owner@example.com', createdAt:'-' };
}
function saveOwnerProfile(email, fullName){
  const normalized=(email||'').toLowerCase().trim();
  const defaultName = 'Owner';
  let name = defaultName;
  if(fullName?.trim()){
    name = fullName.trim().split(/\s+/).map(word=>word[0]?.toUpperCase()+word.slice(1).toLowerCase()).join(' ');
  } else if(normalized){
    const rawName = normalized.split('@')[0] || defaultName;
    name = rawName.split(/[^a-zA-Z0-9]+/).filter(Boolean).map(word=>word[0]?.toUpperCase()+word.slice(1).toLowerCase()).join(' ') || defaultName;
  }
  const profile = getOwnerProfileData();
  const saved = {
    ...profile,
    name,
    email: normalized || profile.email,
    updatedAt: new Date().toISOString(),
    createdAt: profile.createdAt==='-' ? new Date().toISOString() : profile.createdAt,
  };
  DB.set(OWNER_PROFILE_KEY, saved);
  return saved;
}
function titleCase(value){
  if(!value) return '';
  return value.toString().trim().split(/\s+/).map(word=>word.charAt(0).toUpperCase()+word.slice(1).toLowerCase()).join(' ');
}
function renderOwnerProfile(){
  const profile=getOwnerProfileData();
  const img=document.getElementById('profile-owner-img');
  const placeholder=document.querySelector('#profile-owner-photo .owner-photo-placeholder');
  const stored=DB.get('owner_photo');
  const raw=stored||firstBundledOwnerPhotoPath();
  const headerAvatar=document.getElementById('header-owner-avatar');
  if(img){
    if(raw){
      img.src=resolveOwnerPhotoSrc(raw);
      img.style.display='block';
      if(placeholder) placeholder.style.display='none';
    } else {
      img.style.display='none';
      if(placeholder) placeholder.style.display='block';
    }
  }
  if(headerAvatar){
    if(raw){
      headerAvatar.src=resolveOwnerPhotoSrc(raw);
    } else {
      headerAvatar.src='';
    }
  }
  const nameEl=document.getElementById('profile-owner-name');
  const emailEl=document.getElementById('profile-owner-email');
  const createdEl=document.getElementById('profile-owner-created');
  const displayNameInput=document.getElementById('profile-owner-display-name');
  if(nameEl) nameEl.textContent=profile.name||'Owner';
  if(displayNameInput) displayNameInput.value=profile.name||'';
  if(emailEl) emailEl.textContent=profile.email||'Email not configured';
  if(createdEl) createdEl.textContent = profile.createdAt && profile.createdAt !== '-' ? `Profile created: ${new Date(profile.createdAt).toLocaleString()}` : '';
}
async function updateOwnerEmailConfig(newEmail){
  if(!firebaseStore || !newEmail) return;
  try{
    const normalized=newEmail.toLowerCase().trim();
    const configRef=firebaseStore.collection(FIRESTORE_CONFIG_COLLECTION).doc(FIRESTORE_CONFIG_DOC);
    await configRef.set({ ownerEmail:normalized, updatedAt:firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
    ownerEmailConfig=normalized;
  }catch(_e){
    // Ignore config save failure; user update still succeeds locally
  }
}
async function updateEmailPassword(){
  const currentPassword=(document.getElementById('profile-current-password')||{}).value?.trim();
  const newEmail=(document.getElementById('profile-new-email')||{}).value?.trim();
  const newPassword=(document.getElementById('profile-new-password')||{}).value?.trim();
  const confirmPassword=(document.getElementById('profile-confirm-password')||{}).value?.trim();
  if(!currentPassword){
    toast('Enter your current password to update account.', 'warning');
    return;
  }
  if(!newEmail && !newPassword){
    toast('Enter a new email or password before saving.', 'warning');
    return;
  }
  if(newPassword && newPassword !== confirmPassword){
    toast('Password confirmation does not match.', 'danger');
    return;
  }
  if(newPassword && newPassword.length < 6){
    toast('New password must be at least 6 characters.', 'warning');
    return;
  }
  const user=getCurrentUser();
  if(!user || !user.email){
    toast('No signed in user found.', 'danger');
    return;
  }
  if(!firebaseAuth){
    toast('Firebase authentication is not configured.', 'danger');
    return;
  }
  const credential=firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
  try{
    await user.reauthenticateWithCredential(credential);
    if(newEmail && newEmail !== user.email){
      await user.updateEmail(newEmail);
      saveOwnerProfile(newEmail);
      await updateOwnerEmailConfig(newEmail);
    }
    if(newPassword){
      await user.updatePassword(newPassword);
    }
    document.getElementById('profile-current-password').value='';
    document.getElementById('profile-new-password').value='';
    document.getElementById('profile-confirm-password').value='';
    if(document.getElementById('profile-new-email')) document.getElementById('profile-new-email').value='';
    renderOwnerProfile();
    toast('Account settings updated successfully.', 'success');
  }catch(err){
    console.error(err);
    const message = err?.message || 'Unable to update account settings. Please check your password and try again.';
    toast(message, 'danger');
  }
}

function updateOwnerDisplayName(){
  const newName=(document.getElementById('profile-owner-display-name')||{}).value?.trim();
  if(!newName){
    toast('Enter a name to save.', 'warning');
    return;
  }
  const profile=getOwnerProfileData();
  const saved=saveOwnerProfile(profile.email, newName);
  renderOwnerProfile();
  toast('Owner name updated successfully.', 'success');
}
function updateAppPin(){
  const currentPin=(document.getElementById('profile-current-pin')||{}).value?.trim();
  const newPin=(document.getElementById('profile-new-pin')||{}).value?.trim();
  if(!currentPin || !newPin){
    toast('Enter both current and new PIN.', 'warning');
    return;
  }
  if(currentPin !== getOwnerPin()){
    toast('Current PIN is incorrect.', 'danger');
    return;
  }
  if(newPin.length < 4){
    toast('New PIN must be at least 4 digits.', 'warning');
    return;
  }
  setOwnerPin(newPin);
  document.getElementById('profile-current-pin').value='';
  document.getElementById('profile-new-pin').value='';
  toast('Unlock PIN changed successfully.', 'success');
}
function shouldUsePinMode(){
  return !isExplicitLogout() && DB.get(OWNER_PROFILE_KEY) && DB.get(OWNER_PIN_KEY);
}
function setLoginMode(mode){
  const full=document.getElementById('full-login-mode');
  const pin=document.getElementById('pin-login-mode');
  const ownerNote=document.getElementById('owner-note');
  if(full) full.style.display = mode === 'pin' ? 'none' : 'block';
  if(pin) pin.style.display = mode === 'pin' ? 'block' : 'none';
  if(ownerNote){
    if(mode === 'pin'){
      ownerNote.textContent = 'Enter your PIN to unlock the app. Logout to sign in again.';
    } else {
      const configured = OWNER_EMAIL || ownerEmailConfig;
      ownerNote.textContent = configured
        ? 'Only the owner email can sign in to this app.'
        : 'Register only if you are the designated owner.';
    }
  }
  const errorEl=document.getElementById('login-error');
  if(errorEl) errorEl.textContent='';
}
function initLoginScreen(){
  if(shouldUsePinMode()){
    setLoginMode('pin');
  } else {
    setLoginMode('full');
  }
}
function switchToFullLogin(){
  setExplicitLogout(true);
  firebaseSignOut().catch(()=>{});
  setLoginMode('full');
  const pinField=document.getElementById('auth-pin');
  if(pinField) pinField.value='';
}
function doUnlock(){
  const pin=(document.getElementById('auth-pin')||{}).value?.trim();
  const errorEl=document.getElementById('login-error');
  if(!pin){
    if(errorEl) errorEl.textContent='Enter your PIN to unlock.';
    return;
  }
  if(pin === getOwnerPin()){
    if(errorEl) errorEl.textContent='';
    document.getElementById('login-overlay').style.display='none';
    document.getElementById('app').style.display='flex';
    setExplicitLogout(false);
    initApp();
    return;
  }
  if(errorEl) errorEl.textContent='Invalid PIN. Please try again.';
}

let firebaseApp=null;
let firebaseAuth=null;
let firebaseStore=null;
let authUser=null;
let ownerEmailConfig=null;
const AUTO_SYNC_INTERVAL_MS=30000;

function initFirebase(){
  if(firebaseApp||!window.firebase||!firebase.initializeApp) return;
  if(!FIREBASE_CONFIG.apiKey||!FIREBASE_CONFIG.authDomain||!FIREBASE_CONFIG.projectId) return;
  firebaseApp=firebase.initializeApp(FIREBASE_CONFIG);
  firebaseAuth=firebase.auth();
  firebaseStore=firebase.firestore();
  firebaseAuth.onAuthStateChanged(async (user)=>{
    authUser=user;
    if(user){
      await handleUserSignedIn(user);
    }
  });
}

function updateAuthActions(){
  const registerBtn=document.querySelector('.btn-secondary');
  const ownerNote=document.getElementById('owner-note');
  const configured=OWNER_EMAIL || ownerEmailConfig;
  if(registerBtn){
    registerBtn.style.display = configured ? 'none' : 'inline-flex';
  }
  if(ownerNote){
    ownerNote.textContent = configured
      ? 'Only the owner email can sign in to this app.'
      : 'Register only if you are the designated owner.';
  }
}

async function getOwnerEmailConfig(){
  if(OWNER_EMAIL) return OWNER_EMAIL.toLowerCase().trim();
  if(!firebaseStore) return null;
  try{
    const doc=await firebaseStore.collection(FIRESTORE_CONFIG_COLLECTION).doc(FIRESTORE_CONFIG_DOC).get();
    if(!doc.exists) return null;
    const data=doc.data();
    return (data?.ownerEmail||'').toLowerCase().trim() || null;
  }catch(_e){
    return null;
  }
}

async function resolveOwnerEmailConfig(){
  if(OWNER_EMAIL) return OWNER_EMAIL.toLowerCase().trim();
  if(ownerEmailConfig!==null) return ownerEmailConfig;
  ownerEmailConfig = await getOwnerEmailConfig();
  updateAuthActions();
  return ownerEmailConfig;
}

async function ensureOwnerConfig(email){
  if(OWNER_EMAIL) return OWNER_EMAIL.toLowerCase().trim();
  if(!firebaseStore) return null;
  const normalized=email.toLowerCase().trim();
  const configRef=firebaseStore.collection(FIRESTORE_CONFIG_COLLECTION).doc(FIRESTORE_CONFIG_DOC);
  const result=await firebase.firestore().runTransaction(async (tx)=>{
    const doc=await tx.get(configRef);
    if(doc.exists){
      const existing=(doc.data()?.ownerEmail||'').toLowerCase().trim();
      if(existing && existing!==normalized){
        throw new Error('An owner account has already been configured.');
      }
      return existing || normalized;
    }
    tx.set(configRef,{ownerEmail:normalized,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    return normalized;
  });
  ownerEmailConfig=result;
  updateAuthActions();
  return result;
}

async function canRegisterWithEmail(email){
  const normalized=email.toLowerCase().trim();
  if(!normalized) return false;
  const owner=await resolveOwnerEmailConfig();
  return !owner || owner===normalized;
}

async function canSignInWithEmail(email){
  const normalized=email.toLowerCase().trim();
  if(!normalized) return false;
  const owner=await resolveOwnerEmailConfig();
  return !owner || owner===normalized;
}

function getCurrentUser(){
  if(firebaseAuth) return firebaseAuth.currentUser;
  return authUser;
}

async function handleUserSignedIn(user){
  try{
    const normalized=user?.email?.toLowerCase().trim();
    const configured=await resolveOwnerEmailConfig();
    if(configured && normalized!==configured){
      await firebaseSignOut();
      const el=document.getElementById('login-error');
      if(el) el.textContent='This app is configured for a different owner email.';
      return;
    }
    if(!configured && normalized){
      await ensureOwnerConfig(normalized);
    }
    if(normalized){
      saveOwnerProfile(normalized);
      if(!DB.get(OWNER_PIN_KEY)) setOwnerPin('9252');
    }
    setExplicitLogout(false);
    await loadUserDataFromFirestore();
    document.getElementById('login-error').textContent='';
    if(!justLoggedIn && shouldUsePinMode()){
      setLoginMode('pin');
      document.getElementById('login-overlay').style.display='flex';
      document.getElementById('app').style.display='none';
      justLoggedIn=false;
      return;
    }
    justLoggedIn=false;
    document.getElementById('login-overlay').style.display='none';
    document.getElementById('app').style.display='flex';
    initApp();
  }catch(e){
    console.error('Firestore load failed',e);
    const el=document.getElementById('login-error');
    if(el) el.textContent=e.message||'Unable to sign in with this owner account.';
    toast('Signed in, but cloud restore failed.','warning');
  }
}

async function saveUserDataToFirestore(){
  const user=getCurrentUser();
  if(!user||!firebaseStore) return;
  const docRef=firebaseStore.collection('users').doc(user.uid);
  await docRef.set({
    email:user.email,
    updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
    sales:DB.getSales(),
    inventory:DB.getInventory(),
    audit:DB.getAudit(),
  },{merge:true});
}

async function loadUserDataFromFirestore(){
  const user=getCurrentUser();
  if(!user||!firebaseStore) return;
  const doc=await firebaseStore.collection('users').doc(user.uid).get();
  if(!doc.exists) return;
  const data=doc.data();
  if(data.sales) DB.setSales(data.sales);
  if(data.inventory) DB.setInventory(data.inventory);
  if(data.audit) DB.setAudit(data.audit);
  refreshSyncBadge();
}

async function firebaseSignIn(email,password){
  if(!firebaseAuth) throw new Error('Firebase not configured.');
  return firebaseAuth.signInWithEmailAndPassword(email,password);
}

async function firebaseSignUp(email,password){
  if(!firebaseAuth) throw new Error('Firebase not configured.');
  return firebaseAuth.createUserWithEmailAndPassword(email,password);
}

async function firebaseSignOut(){
  if(firebaseAuth) return firebaseAuth.signOut();
}

initFirebase();
updateAuthActions();
resolveOwnerEmailConfig().then(updateAuthActions).catch(()=>updateAuthActions());

function getSyncUrl(){
  const saved=(DB.get(SYNC_URL_KEY)||'').trim();
  if(saved)return saved;
  return (GOOGLE_SCRIPT_WEB_APP_URL||'').trim();
}

function getDeviceId(){
  let id=DB.get(DEVICE_ID_KEY);
  if(!id){
    id='DEV-'+Math.random().toString(36).slice(2,10).toUpperCase();
    DB.set(DEVICE_ID_KEY,id);
  }
  return id;
}

function makeAuditId(){
  return 'AUD-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7).toUpperCase();
}

function queueSync(op,payload){
  const q=DB.getSyncQueue();
  q.push({id:'Q-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6),op,payload,at:new Date().toISOString()});
  DB.setSyncQueue(q);
  refreshSyncBadge();
  if(navigator.onLine){
    if(syncDebounceTimer)clearTimeout(syncDebounceTimer);
    syncDebounceTimer=setTimeout(()=>syncToCloud(true),800);
  }
}

function refreshSyncBadge(){
  const badge=document.getElementById('pending-sync-badge');
  if(!badge)return;
  const queueCount=DB.getSyncQueue().length;
  const pendingSales=DB.getSales().filter(s=>!s.synced).length;
  const pending=queueCount||pendingSales;
  badge.textContent=`${pending} pending`;
  badge.className=`badge ${pending?'badge-pending':'badge-synced'}`;
}

function normalizeAuditEntries(){
  const audit=DB.getAudit();
  let changed=false;
  for(const entry of audit){
    if(!entry.auditId){entry.auditId=makeAuditId();changed=true;}
  }
  if(changed)DB.setAudit(audit);
}

function pid(){
  return 'PRD-'+Math.random().toString(36).slice(2,10).toUpperCase();
}

function setDefaultInventory(){
  DB.setInventory([
    {id:pid(),name:'Rahman Pack - Small',cost:500},
    {id:pid(),name:'Rahman Pack - Medium',cost:800},
    {id:pid(),name:'Rahman Pack - Large',cost:1200},
    {id:pid(),name:'Rahman Family Bundle',cost:2000},
    {id:pid(),name:'Signature Broth Jar',cost:600},
  ]);
}

function normalizeInventoryEntries(){
  const inventory=DB.getInventory();
  let changed=false;
  for(const item of inventory){
    if(!item.id){item.id=pid();changed=true;}
  }
  if(changed)DB.setInventory(inventory);
}

function normalizeSalesEntries(){
  const sales=DB.getSales();
  const inventory=DB.getInventory();
  let changed=false;
  for(const s of sales){
    if(!s.productId){
      let matched=inventory.find(p=>p.name===s.productName);
      if(!matched&&typeof s.productIndex==='number')matched=inventory[s.productIndex];
      if(matched){
        s.productId=matched.id;
        changed=true;
      }
    }
  }
  if(changed)DB.setSales(sales);
}

if(!DB.getInventory().length){
  setDefaultInventory();
}

async function doLogin(){
  const email=(document.getElementById('auth-email')||{}).value?.trim();
  const password=(document.getElementById('auth-password')||{}).value?.trim();
  const el=document.getElementById('login-error');
  if(!email||!password){
    el.textContent='Please enter email and password.';
    return;
  }
  if(firebaseAuth){
    try{
      if(!await canSignInWithEmail(email)){
        el.textContent='This app is configured for a different owner email.';
        return;
      }
      justLoggedIn=true;
      await firebaseSignIn(email,password);
      return;
    }catch(err){
      console.error(err);
      el.textContent=err.message||'Login failed. Please try again.';
      return;
    }
  }
  if(password==='1234'){
    justLoggedIn=true;
    setExplicitLogout(false);
    if(email) saveOwnerProfile(email);
    if(!DB.get(OWNER_PIN_KEY)) setOwnerPin('1234');
    document.getElementById('login-overlay').style.display='none';
    document.getElementById('app').style.display='flex';
    initApp();
    return;
  }
  el.textContent='Incorrect code. Please try again.';
}

async function doRegister(){
  const email=(document.getElementById('auth-email')||{}).value?.trim();
  const password=(document.getElementById('auth-password')||{}).value?.trim();
  const el=document.getElementById('login-error');
  if(!email||!password){
    el.textContent='Please enter email and password.';
    return;
  }
  const ownerName=(document.getElementById('auth-name')||{}).value?.trim();
  if(firebaseAuth){
    try{
      if(!ownerName){
        el.textContent='Please enter your full name to register.';
        return;
      }
      if(!await canRegisterWithEmail(email)){
        el.textContent='Registration is disabled. Use the configured owner email to sign in.';
        return;
      }
      await ensureOwnerConfig(email);
      justLoggedIn=true;
      const userCredential=await firebaseSignUp(email,password);
      const user=userCredential.user;
      if(user){
        DB.setSales([]);
        DB.setAudit([]);
        DB.setInventory([]);
        setDefaultInventory();
        await saveUserDataToFirestore();
        document.getElementById('login-overlay').style.display='none';
        document.getElementById('app').style.display='flex';
        setExplicitLogout(false);
        setOwnerPin('1234');
        saveOwnerProfile(email, ownerName);
        initApp();
        return;
      }
    }catch(err){
      console.error(err);
      el.textContent=err.message||'Registration failed. Please try again.';
      return;
    }
  }
  el.textContent='Registration is not available right now.';
}

document.getElementById('auth-password').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
document.getElementById('auth-pin')?.addEventListener('keydown',e=>{if(e.key==='Enter')doUnlock();});

const SALE_DELETE_REASONS=[
  'Customer Return - Unwanted',
  'Customer Return - Wrong Item',
  'Customer Return - Changed Mind',
  'Defective / Damaged Item',
  'Product Quality Issue',
  'Input Error - Wrong Customer',
  'Input Error - Wrong Price',
  'Input Error - Wrong Product',
  'Input Error - Duplicate Entry',
  'Input Error - Wrong Quantity',
  'Cancelled by Customer',
  'Other - See Notes',
];

const INVENTORY_DELETE_REASONS=[
  'Stock Out of Date',
  'Mistake Made',
];

async function doLogout(){
  try{
    await firebaseSignOut();
  }catch(_e){}
  setExplicitLogout(true);
  document.getElementById('app').style.display='none';
  document.getElementById('login-overlay').style.display='flex';
  document.getElementById('auth-pin').value='';
  const emailEl=document.getElementById('auth-email');
  const passEl=document.getElementById('auth-password');
  if(emailEl) emailEl.value='';
  if(passEl) passEl.value='';
  setLoginMode('full');
}

let toastTimer=null;
function toast(msg,type=''){
  const el=document.getElementById('toast');
  el.textContent=msg;
  el.className='show'+(type?' toast-'+type:'');
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{el.className='';},3500);
}

function showPanel(id){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  const panel=document.getElementById('panel-'+id);
  if(panel) panel.classList.add('active');
  const tabs=document.querySelectorAll('.nav-tab');
  const map={dashboard:0,sales:1,payment:2,records:3,inventory:4,audit:5};
  if(map[id]!==undefined)tabs[map[id]].classList.add('active');
  if(id==='dashboard')renderDashboard();
  if(id==='records')renderRecords();
  if(id==='payment')renderOutstanding();
  if(id==='inventory')renderInventory();
  if(id==='audit')renderAudit();
  if(id==='profile') renderOwnerProfile();
  if(id==='update') renderUpdatePanel();
}

function uid(){
  const currentYear = new Date().getFullYear().toString().slice(-2);
  const ids=[...DB.getSales(), ...DB.getAudit()].map(item=>item.id);
  let maxSerial=0;
  const matchRegex=new RegExp(`^INV-${currentYear}-(\\d{4})$`);
  for(const id of ids){
    const match=id?.match(matchRegex);
    if(match){
      const value=parseInt(match[1],10);
      if(value>maxSerial) maxSerial=value;
    }
  }
  const nextSerial=String(maxSerial+1).padStart(4,'0');
  return `INV-${currentYear}-${nextSerial}`;
}
function iuid(){
  // Use the same invoice numbering system as sales
  return uid();
}
function fmt(n){return 'NLe '+(+n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});}
function round2(n){return Math.round((+n||0)*100)/100;}
function getRecordedProfit(s){
  if(s == null) return 0;
  if(typeof s.realizedProfit === 'number') return round2(s.realizedProfit);
  return round2(s.profit || 0);
}
function today(){return new Date().toISOString().slice(0,10);}
function yesterday(){const d=new Date();d.setDate(d.getDate()-1);return d.toISOString().slice(0,10);}
function thisMonth(){return new Date().toISOString().slice(0,7);}
function thisYear(){return new Date().getFullYear().toString();}
function timeStr(){return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});}
function dateStr(iso){return new Date(iso+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});}
function fmtDateTime(dateIso,timeStr){
  return `<span class="datetime-badge">${dateStr(dateIso)}</span> <span class="datetime-badge">${timeStr||'-'}</span>`;
}
function saleSyncBadge(sale){
  return '';
}
function resolveOwnerPhotoSrc(src){
  if(!src)return '';
  if(src.startsWith('data:')||src.startsWith('http://')||src.startsWith('https://')||src.startsWith('file:'))return src;
  if(electronAvailable&&window.electronAPI?.resolveAssetUrl){
    const url=window.electronAPI.resolveAssetUrl(src);
    if(url)return url;
  }
  try{
    return new URL(src,window.location.href).href;
  }catch(_e){
    return src;
  }
}

function firstBundledOwnerPhotoPath(){
  if(!electronAvailable||!window.electronAPI?.resolveAssetUrl)return DEFAULT_OWNER_PHOTO;
  for(const rel of BUNDLED_OWNER_PHOTO_CANDIDATES){
    if(window.electronAPI.resolveAssetUrl(rel))return rel;
  }
  return DEFAULT_OWNER_PHOTO;
}

function uploadOwnerPhoto(){
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = function(e){
    const file = e.target.files[0];
    if(file){
      const reader = new FileReader();
      reader.onload = function(event){
        const imageData = event.target.result;
        // Save to local storage
        DB.set('owner_photo', imageData);
        // Sync to backend
        const ownerData = { type: 'owner_photo', imageData, uploadedAt: new Date().toISOString() };
        queueSync('update_owner_photo', ownerData);
        // Update login ring
        const img = document.getElementById('owner-login-img');
        if(img){ img.src = imageData; img.style.display = 'block'; }
        // Hide placeholder text/icon
        const ring = img?.closest('.owner-photo-login-ring');
        if(ring){
          const texts = ring.querySelectorAll('.photo-placeholder-text, span[style*="font-size:2rem"], .owner-photo-login-badge');
          texts.forEach(el => el.style.display = 'none');
        }
        toast('Owner photo uploaded successfully.', 'success');
      };
      reader.readAsDataURL(file);
    }
  };
  input.click();
}

function loadOwnerPhoto(){
  const stored=DB.get('owner_photo');
  const raw=stored||firstBundledOwnerPhotoPath();
  if(!raw)return;
  const ownerPhoto=resolveOwnerPhotoSrc(raw);
  const img=document.getElementById('owner-login-img');
  if(!img)return;
  img.onerror=function(){
    img.style.display='none';
    const ring=img.closest('.owner-photo-login-ring');
    if(ring){
      const ph=ring.querySelector('.photo-placeholder-icon');
      const tx=ring.querySelector('.photo-placeholder-text');
      if(ph)ph.style.display='';
      if(tx){tx.style.display='';tx.innerHTML='Photo not found.<br>Put image in <code style="font-size:.7rem;">src/assets/login-photo.png</code> and rebuild, or click to upload.';}
    }
  };
  img.onload=function(){
    img.style.display='block';
    const ring=img.closest('.owner-photo-login-ring');
    if(ring){
      const placeholder=ring.querySelector('.photo-placeholder-text');
      const icon=ring.querySelector('.photo-placeholder-icon');
      if(placeholder)placeholder.style.display='none';
      if(icon)icon.style.display='none';
      const badge=ring.querySelector('.owner-photo-login-badge');
      if(badge)badge.style.display='none';
    }
  };
  img.src=ownerPhoto;
}

// Initialize owner photo and hide loader on page load
document.addEventListener('DOMContentLoaded', function(){
  loadOwnerPhoto();
  initLoginScreen();
  renderOwnerProfile();
  hideAppLoader();
});

function openModal(id){
  const el=document.getElementById(id);
  if(!el)return;
  el.classList.add('open');
  document.body.style.overflow='hidden';
}
function closeModal(id){
  const el=document.getElementById(id);
  if(!el)return;
  el.classList.remove('open');
  document.body.style.overflow='';
}
// Close modal when clicking overlay background
document.addEventListener('click',function(e){
  if(e.target.classList.contains('modal-overlay')){
    closeModal(e.target.id);
  }
});

function setDeleteReasonOptions(type){
  const sel=document.getElementById('delete-reason');
  const reasons=type==='product'?INVENTORY_DELETE_REASONS:SALE_DELETE_REASONS;
  sel.innerHTML='<option value="">Select Reason</option>'+reasons.map(r=>`<option value="${r}">${r}</option>`).join('');
}

function checkNet(){
  const online=navigator.onLine;
  document.getElementById('net-dot').className='sync-dot'+(online?' online':'');
  document.getElementById('net-label').textContent=online?'Online':'Offline';
  return online;
}
window.addEventListener('online',()=>{checkNet();syncToCloud(true);});
window.addEventListener('offline',checkNet);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&navigator.onLine){
    syncToCloud(true);
  }
});

// INVENTORY
function addInventory(){
  const name=titleCase(document.getElementById('inv-name').value.trim());
  const cost=parseFloat(document.getElementById('inv-cost').value);
  if(!name||isNaN(cost)||cost<0){toast('Please fill product name and cost.','danger');return;}
  const inv=DB.getInventory();
  const item={id:pid(),name,cost};
  inv.push(item);
  DB.setInventory(inv);
  queueSync('upsert_inventory',item);
  document.getElementById('inv-name').value='';
  document.getElementById('inv-cost').value='';
  renderInventory();populateProductDropdown();
  toast('Product added successfully.','success');
}
function renderInventory(){
  const inv=DB.getInventory();
  const el=document.getElementById('inv-list');
  if(!inv.length){el.innerHTML='<div style="color:var(--text-dim);font-size:.88rem;padding:1rem 0;">No products yet.</div>';return;}
  el.innerHTML=inv.map((p,index)=>`
    <div class="inv-item">
      <div class="inv-name">${p.name}</div>
      <div class="inv-cost">Cost: ${fmt(p.cost)}</div>
      <div style="display:flex;gap:.5rem;">
        <button class="btn btn-secondary btn-sm" onclick="editInventory(${index})">EDIT</button>
        <button class="btn btn-danger btn-sm" onclick="promptRemoveProduct(${index})">REMOVE</button>
      </div>
    </div>`).join('');
}
function editInventory(index){
  const inv=DB.getInventory();const p=inv[index];if(!p)return;
  document.getElementById('edit-inv-id').value=index;
  document.getElementById('edit-inv-name').value=p.name;
  document.getElementById('edit-inv-cost').value=p.cost;
  openModal('modal-edit-inv');
}
function saveEditInventory(){
  const index=parseInt(document.getElementById('edit-inv-id').value);
  const name=titleCase(document.getElementById('edit-inv-name').value.trim());
  const cost=parseFloat(document.getElementById('edit-inv-cost').value);
  if(!name||isNaN(cost)){toast('Please fill all fields.','danger');return;}
  const inv=DB.getInventory();if(index<0||index>=inv.length)return;
  inv[index].name=name;inv[index].cost=cost;
  DB.setInventory(inv);
  queueSync('upsert_inventory',inv[index]);
  closeModal('modal-edit-inv');
  renderInventory();populateProductDropdown();
  toast('Product updated.','success');
}
function populateProductDropdown(){
  const inv=DB.getInventory();
  const sel=document.getElementById('s-product');const cur=sel.value;
  sel.innerHTML='<option value="">- Select Product -</option>'+inv.map((p)=>`<option value="${p.id}">${p.name}</option>`).join('');
  sel.value=cur;
}

// SALES
let payType='full';
function setPayType(t){
  payType=t;
  document.getElementById('tog-full').classList.toggle('active',t==='full');
  document.getElementById('tog-part').classList.toggle('active',t==='part');
  document.getElementById('part-amount-section').style.display=t==='part'?'block':'none';
  calcSale();
}
function fillCost(){
  const productId=document.getElementById('s-product').value;
  const costRow=document.getElementById('s-unit-cost-row');
  if(productId!==''){const cost=getProductCost(productId);document.getElementById('s-cost-disp').textContent=fmt(cost)+' per unit';costRow.style.display='block';}
  else{costRow.style.display='none';}
  calcSale();
}
function getProductCost(productId){
  const inv=DB.getInventory();
  const p=inv.find(item=>item.id===productId);
  return p?p.cost:0;
}
function calcSale(){
  const productId=document.getElementById('s-product').value;
  const price=parseFloat(document.getElementById('s-price').value)||0;
  const qty=parseInt(document.getElementById('s-qty').value)||1;
  const cost=getProductCost(productId);
  const totalPrice=price*qty;const totalCost=cost*qty;
  const profit=price>0?totalPrice-totalCost:0;
  document.getElementById('s-profit-disp').textContent=price>0?fmt(profit):'NLe 0.00';
  document.getElementById('s-profit-disp').style.color=profit>=0?'var(--success)':'var(--danger)';
  if(payType==='part'){
    const paid=parseFloat(document.getElementById('s-paid').value)||0;
    document.getElementById('s-balance-disp').textContent=fmt(Math.max(0,totalPrice-paid));
  }
}
function saveSale(){
  let customer=titleCase(document.getElementById('s-customer').value);
  const productId=document.getElementById('s-product').value;
  const price=parseFloat(document.getElementById('s-price').value);
  const qty=parseInt(document.getElementById('s-qty').value)||1;
  if(!customer){toast('Enter customer name.','danger');return;}
  if(productId===''){toast('Select a product.','danger');return;}
  if(!price||price<=0){toast('Enter a valid selling price.','danger');return;}
  const inv=DB.getInventory();const prod=inv.find(item=>item.id===productId);
  const cost=prod?prod.cost:0;
  const totalPrice=price*qty;const totalCost=cost*qty;const profit=totalPrice-totalCost;
  let paid;
  if(payType==='full'){paid=totalPrice;}
  else{
    paid=parseFloat(document.getElementById('s-paid').value)||0;
    if(paid>totalPrice){toast('Paid amount cannot exceed selling price.','danger');return;}
    if(paid===totalPrice){payType='full';}
  }
  const balance=totalPrice-paid;
  const realizedProfit = totalPrice ? round2(profit * (paid / totalPrice)) : 0;
  const now=new Date();
  const sale={
    id:uid(),
    date:today(),
    time:now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
    datetime:now.toISOString(),
    customer,
    productId:prod?prod.id:'',
    productName:prod?prod.name:'Unknown',
    sellingPrice:price,qty,totalPrice,unitCost:cost,totalCost,profit,realizedProfit,paid,balance,
    paymentType:payType,
    status:balance<=0?'COMPLETED':'INCOMPLETE',
    synced:false,
    createdAt:now.toISOString(),
  };
  const sales=DB.getSales();sales.push(sale);DB.setSales(sales);
  queueSync('upsert_sale',sale);
  toast(`Sale saved! ID: ${sale.id}`,'success');
  clearSaleForm();renderSessionTable();
}
function clearSaleForm(){
  document.getElementById('s-customer').value='';
  document.getElementById('s-product').value='';
  document.getElementById('s-price').value='';
  document.getElementById('s-qty').value='1';
  document.getElementById('s-paid').value='';
  document.getElementById('s-unit-cost-row').style.display='none';
  document.getElementById('s-cost-disp').textContent='-';
  document.getElementById('s-profit-disp').textContent='NLe 0.00';
  document.getElementById('s-balance-disp').textContent='NLe 0.00';
  setPayType('full');calcSale();
}
function renderSessionTable(){
  const sales=DB.getSales().filter(s=>s.date===today());
  const tb=document.getElementById('session-table');
  if(!sales.length){tb.innerHTML='<tr><td colspan="10" style="color:var(--text-dim);text-align:center;padding:1.5rem;">No sales recorded today.</td></tr>';return;}
  tb.innerHTML=sales.slice().reverse().map(s=>{
    const profitValue=getRecordedProfit(s);
    return `
    <tr>
      <td><span class="sale-id-badge">${s.id}</span></td>
      <td><span class="datetime-badge">${dateStr(s.date)}</span></td>
      <td><span class="datetime-badge">${s.time||'-'}</span></td>
      <td>${s.customer}</td>
      <td>${s.productName}</td>
      <td>${fmt(s.totalPrice)}</td>
      <td style="color:${profitValue>=0?'var(--success)':'var(--danger)'};">${fmt(profitValue)}</td>
      <td><span class="badge ${s.paymentType==='part'?'badge-warning':'badge-info'}">${s.paymentType==='part'?'PART':'FULL'}</span></td>
      <td>${s.paymentType === 'part' ? `<span class="badge ${s.status==='COMPLETED'?'badge-success':'badge-warning'}">${s.status}</span>` : '<span class="badge badge-info">FULL</span>'}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="openEditSale('${s.id}')">EDIT</button></td>
    </tr>`;
  }).join('');
}

function openEditSale(id){
  const sale = DB.getSales().find(x=>x.id===id);
  if(!sale){toast('Sale not found.','danger');return;}
  if(sale.date !== today()){
    toast('Only today\'s sales can be edited from the Today session.', 'warning');
    return;
  }
  const sel = document.getElementById('edit-sale-product');
  const inv = DB.getInventory();
  sel.innerHTML = '<option value="">- Select Product -</option>' + inv.map(p=>`<option value="${p.id}" ${p.id===sale.productId?'selected':''}>${p.name}</option>`).join('');
  document.getElementById('edit-sale-id').value = sale.id;
  document.getElementById('edit-sale-customer').value = sale.customer;
  document.getElementById('edit-sale-price').value = sale.sellingPrice;
  document.getElementById('edit-sale-qty').value = sale.qty;
  document.getElementById('edit-sale-paid').value = sale.paid;
  document.getElementById('edit-sale-balance').textContent = fmt(sale.balance);
  openModal('modal-edit-sale');
}

function saveEditSale(){
  const saleId = document.getElementById('edit-sale-id').value;
  const customer = titleCase(document.getElementById('edit-sale-customer').value);
  const productId = document.getElementById('edit-sale-product').value;
  const price = parseFloat(document.getElementById('edit-sale-price').value);
  const qty = parseInt(document.getElementById('edit-sale-qty').value)||1;
  const paid = parseFloat(document.getElementById('edit-sale-paid').value)||0;
  if(!customer){toast('Enter customer name.','danger');return;}
  if(!productId){toast('Select a product.','danger');return;}
  if(isNaN(price) || price <= 0){toast('Enter a valid selling price.','danger');return;}
  if(qty < 1){toast('Quantity must be at least 1.','danger');return;}
  const inv = DB.getInventory();
  const prod = inv.find(item=>item.id===productId);
  if(!prod){toast('Selected product not found.','danger');return;}
  const totalPrice = round2(price * qty);
  const totalCost = round2(prod.cost * qty);
  const profit = round2(totalPrice - totalCost);
  if(paid > totalPrice){toast('Paid amount cannot exceed total price.','danger');return;}
  const balance = round2(totalPrice - paid);
  const realizedProfit = totalPrice ? round2(profit * (paid / totalPrice)) : 0;
  const sales = DB.getSales();
  const index = sales.findIndex(x=>x.id===saleId);
  if(index < 0){toast('Sale record not found.','danger');return;}
  sales[index] = {
    ...sales[index],
    customer,
    productId: prod.id,
    productName: prod.name,
    sellingPrice: price,
    qty,
    totalPrice,
    unitCost: prod.cost,
    totalCost,
    profit,
    paid,
    balance,
    realizedProfit: balance <= 0 ? profit : realizedProfit,
    paymentType: balance <= 0 ? 'full' : 'part',
    status: balance <= 0 ? 'COMPLETED' : 'INCOMPLETE',
    synced: false,
    updatedAt: new Date().toISOString(),
  };
  DB.setSales(sales);
  queueSync('upsert_sale', sales[index]);
  closeModal('modal-edit-sale');
  renderSessionTable();
  renderRecords();
  renderDashboard();
  renderOutstanding();
  toast('Sale updated successfully.','success');
}

// PAYMENT DESK
let selectedPaySaleId=null;
function lookupById(){
  const q=document.getElementById('pay-id-input').value.trim().toUpperCase();
  const resultEl=document.getElementById('id-lookup-result');
  if(!q){resultEl.className='found-record-preview';return;}
  const s=DB.getSales().find(x=>x.id.toUpperCase()===q||x.id.toUpperCase().includes(q));
  if(!s){resultEl.className='found-record-preview visible';resultEl.innerHTML=`<span style="color:var(--danger);font-size:.85rem;">No record found for that ID.</span>`;return;}
  resultEl.className='found-record-preview visible';
  resultEl.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;">
      <div>
        <div style="font-size:.95rem;margin-bottom:.3rem;"><strong>${s.customer}</strong> - ${s.productName}</div>
        <div style="font-size:.8rem;color:var(--text-secondary);">${fmtDateTime(s.date,s.time)} - ${s.paymentType==='part'?'Part Payment':'Full Payment'}</div>
      </div>
      <div style="text-align:right;">
        <div style="color:var(--warning);font-family:'DM Mono',monospace;">${fmt(s.balance)} balance</div>
        ${s.balance>0?`<button class="btn btn-primary btn-sm" style="margin-top:.4rem;" onclick="selectPaySale('${s.id}')">PAY NOW</button>`:`<span class="badge badge-success">COMPLETED</span>`}
      </div>
    </div>`;
}
function searchPayment(){
  const q=document.getElementById('pay-search').value.trim().toLowerCase();
  const el=document.getElementById('pay-results');
  if(!q){el.innerHTML='';document.getElementById('pay-detail-card').style.display='none';return;}
  const sales=DB.getSales().filter(s=>s.balance>0&&s.customer.toLowerCase().includes(q));
  if(!sales.length){el.innerHTML='<div style="color:var(--text-dim);font-size:.88rem;padding:.5rem 0;">No outstanding records found.</div>';return;}
  el.innerHTML=sales.map(s=>`
    <div class="payment-found" style="margin-bottom:.5rem;cursor:pointer;" onclick="selectPaySale('${s.id}')">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem;">
        <div>
          <div><strong>${s.customer}</strong> - ${s.productName}</div>
          <div style="margin-top:.3rem;">${fmtDateTime(s.date,s.time)}</div>
          <div style="margin-top:.25rem;"><span class="sale-id-badge">${s.id}</span></div>
        </div>
        <div style="text-align:right;">
          <div style="color:var(--warning);font-family:'DM Mono',monospace;">${fmt(s.balance)} remaining</div>
        </div>
      </div>
    </div>`).join('');
}
function selectPaySale(id){
  selectedPaySaleId=id;
  const s=DB.getSales().find(x=>x.id===id);if(!s)return;
  const realizedProfit = round2(s.realizedProfit || 0);
  const remainingProfit = round2((s.profit || 0) - realizedProfit);
  document.getElementById('pay-info').innerHTML=`
    <div style="display:flex;flex-wrap:wrap;gap:1.5rem;">
      <div><div class="stat-label">Sale ID</div><span class="sale-id-badge">${s.id}</span></div>
      <div><div class="stat-label">Date & Time</div>${fmtDateTime(s.date,s.time)}</div>
      <div><div class="stat-label">Customer</div><strong>${s.customer}</strong></div>
      <div><div class="stat-label">Product</div>${s.productName}</div>
      <div><div class="stat-label">Total Price</div>${fmt(s.totalPrice)}</div>
      <div><div class="stat-label">Total Paid So Far</div>${fmt(s.paid)}</div>
      <div><div class="stat-label">Balance Owed</div><span style="color:var(--warning);font-weight:600;">${fmt(s.balance)}</span></div>
      <div><div class="stat-label">Profit Recognized</div>${fmt(realizedProfit)}</div>
      <div><div class="stat-label">Remaining Profit</div>${fmt(remainingProfit)}</div>
    </div>`;
  document.getElementById('pay-amount').value='';
  document.getElementById('pay-preview-balance').textContent='-';
  document.getElementById('pay-detail-card').style.display='block';
  document.getElementById('pay-detail-card').scrollIntoView({behavior:'smooth',block:'start'});
}
function previewPayment(){
  if(!selectedPaySaleId)return;
  const s=DB.getSales().find(x=>x.id===selectedPaySaleId);if(!s)return;
  const amt=parseFloat(document.getElementById('pay-amount').value)||0;
  document.getElementById('pay-preview-balance').textContent=fmt(Math.max(0,s.balance-amt));
}
function recordPayment(){
  if(!selectedPaySaleId){toast('No record selected.','danger');return;}
  const amt=parseFloat(document.getElementById('pay-amount').value);
  if(!amt||amt<=0){toast('Enter a valid payment amount.','danger');return;}
  const sales=DB.getSales();const i=sales.findIndex(x=>x.id===selectedPaySaleId);if(i<0)return;
  const s=sales[i];
  if(amt>s.balance){toast('Payment exceeds outstanding balance.','danger');return;}
  s.paid+=amt;
  s.balance=Math.max(0,s.totalPrice-s.paid);
  const previousRealized = round2(s.realizedProfit || 0);
  const remainingProfit = Math.max(0, (s.profit || 0) - previousRealized);
  const profitForPayment = s.totalPrice ? round2(Math.min(remainingProfit, (s.profit || 0) * (amt / s.totalPrice))) : 0;
  s.realizedProfit = round2(previousRealized + profitForPayment);
  if(s.balance<=0){
    s.realizedProfit = round2(s.profit || 0);
  }
  s.status=s.balance<=0?'COMPLETED':'INCOMPLETE';
  s.synced=false;
  DB.setSales(sales);selectedPaySaleId=null;
  queueSync('upsert_sale',s);
  document.getElementById('pay-detail-card').style.display='none';
  document.getElementById('pay-search').value='';
  document.getElementById('pay-id-input').value='';
  document.getElementById('pay-results').innerHTML='';
  document.getElementById('id-lookup-result').className='found-record-preview';
  renderOutstanding();toast('Payment recorded!','success');
}
function renderOutstanding(){
  const sales=DB.getSales().filter(s=>s.balance>0);
  const tb=document.getElementById('outstanding-table');
  if(!sales.length){tb.innerHTML='<tr><td colspan="7" style="color:var(--text-dim);text-align:center;padding:1.5rem;">No outstanding balances.</td></tr>';return;}
  tb.innerHTML=sales.map(s=>`
    <tr>
      <td><span class="sale-id-badge">${s.id}</span></td>
      <td>${fmtDateTime(s.date,s.time)}</td>
      <td>${s.customer}</td>
      <td>${s.productName}</td>
      <td>${fmt(s.totalPrice)}</td>
      <td>${fmt(s.paid)}</td>
      <td style="color:var(--warning);font-weight:600;">${fmt(s.balance)}</td>
      <td style="display:flex;gap:.5rem;flex-wrap:wrap;"><button class="btn btn-secondary btn-sm" onclick="quickPaySelect('${s.id}')">PAY</button></td>
    </tr>`).join('');
}
function quickPaySelect(id){showPanel('payment');setTimeout(()=>selectPaySale(id),50);}

// VIEW RECORDS
let recView='daily';
function setRecView(v,btn){
  recView=v;
  document.querySelectorAll('#panel-records .view-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');renderRecords();
}
function filterSalesByView(sales){
  if(recView==='daily')return sales.filter(s=>s.date===today());
  if(recView==='yesterday')return sales.filter(s=>s.date===yesterday());
  if(recView==='monthly')return sales.filter(s=>s.date.startsWith(thisMonth()));
  if(recView==='yearly')return sales.filter(s=>s.date.startsWith(thisYear()));
  if(recView==='all')return sales;
  return sales;
}
function renderRecords(){
  const allSales=DB.getSales();
  const filtered=filterSalesByView(allSales);
  const q=(document.getElementById('rec-search')?.value||'').toLowerCase();
  const st=document.getElementById('rec-status')?.value||'';
  const shown=filtered.filter(s=>{
    const matchQ=!q||(s.customer.toLowerCase().includes(q)||s.productName.toLowerCase().includes(q)||s.id.toLowerCase().includes(q));
    return matchQ&&(!st||s.status===st);
  });
  const revenue=shown.reduce((a,s)=>a+s.paid,0);
  const profit=shown.reduce((a,s)=>a+getRecordedProfit(s),0);
  const qty=shown.reduce((a,s)=>a+s.qty,0);
  const totalAllQty=allSales.reduce((a,s)=>a+s.qty,0);
  document.getElementById('rec-stats').innerHTML=`
    <div class="stat-card success"><div class="stat-label">Revenue</div><div class="stat-value">${fmt(revenue)}</div></div>
    <div class="stat-card success"><div class="stat-label">Profit</div><div class="stat-value">${fmt(profit)}</div></div>
    <div class="stat-card"><div class="stat-label">Qty This View</div><div class="stat-value">${qty}</div></div>
    <div class="stat-card"><div class="stat-label">All-Time Qty</div><div class="stat-value">${totalAllQty}</div><div class="stat-sub">Includes all periods</div></div>`;
  const tb=document.getElementById('records-table');
  if(!shown.length){tb.innerHTML='<tr><td colspan="10" style="color:var(--text-dim);text-align:center;padding:1.5rem;">No records for this period.</td></tr>';return;}
  tb.innerHTML=shown.slice().reverse().map(s=>`
    <tr>
      <td><span class="sale-id-badge">${s.id}</span></td>
      <td><span class="datetime-badge">${dateStr(s.date)}</span></td>
      <td>${s.customer}</td>
      <td>${s.productName}</td>
      <td>${fmt(s.totalPrice)}</td>
      <td>${fmt(s.paid)}</td>
      <td style="color:${s.balance>0?'var(--warning)':'var(--success)'};">${fmt(s.balance)}</td>
      <td style="color:${(s.realizedProfit||0)>=0?'var(--success)':'var(--danger)'};">${fmt(s.realizedProfit||0)}</td>
      <td>${s.paymentType === 'part' ? `<span class="badge ${s.status==='COMPLETED'?'badge-success':'badge-warning'}">${s.status}</span>` : '<span class="badge badge-info">FULL</span>'}</td>
      <td style="display:flex;gap:.5rem;flex-wrap:wrap;">
        <button class="btn btn-danger btn-sm" onclick="promptDelete('${s.id}')">REMOVE</button>
      </td>
    </tr>`).join('');
}

function renderDeleteDesk(){
  const tb=document.getElementById('delete-table');
  if(!tb)return;
  const q=(document.getElementById('del-search')?.value||'').trim().toLowerCase();
  const st=document.getElementById('del-status')?.value||'';
  const sales=DB.getSales().filter(s=>{
    const matchQ=!q||(
      s.id.toLowerCase().includes(q)||
      s.customer.toLowerCase().includes(q)||
      s.productName.toLowerCase().includes(q)
    );
    return matchQ&&(!st||s.status===st);
  });
  if(!sales.length){
    tb.innerHTML='<tr><td colspan="8" style="color:var(--text-dim);text-align:center;padding:1.5rem;">No records found for deletion.</td></tr>';
    return;
  }
  tb.innerHTML=sales.slice().reverse().map(s=>`
    <tr>
      <td><span class="sale-id-badge">${s.id}</span></td>
      <td>${fmtDateTime(s.date,s.time)}</td>
      <td>${s.customer}</td>
      <td>${s.productName}</td>
      <td>${s.qty}</td>
      <td>${fmt(s.totalPrice)}</td>
      <td><span class="badge ${s.status==='COMPLETED'?'badge-success':'badge-warning'}">${s.status}</span></td>
      <td><button class="btn btn-danger btn-sm" onclick="promptDelete('${s.id}')">REMOVE</button></td>
    </tr>`).join('');
}

// DASHBOARD
let dashView='daily';
function setDashView(v,btn){
  dashView=v;
  document.querySelectorAll('#panel-dashboard .view-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');renderDashboard();
}
function renderDashboard(){
  const allSales=DB.getSales();
  let filtered;
  if(dashView==='daily')filtered=allSales.filter(s=>s.date===today());
  else if(dashView==='monthly')filtered=allSales.filter(s=>s.date.startsWith(thisMonth()));
  else filtered=allSales.filter(s=>s.date.startsWith(thisYear()));
  const revenue=filtered.reduce((a,s)=>a+s.paid,0);
  const profit=filtered.reduce((a,s)=>a+getRecordedProfit(s),0);
  const outstanding=allSales.reduce((a,s)=>a+s.balance,0);
  const qty=filtered.reduce((a,s)=>a+s.qty,0);
  const totalQty=allSales.reduce((a,s)=>a+s.qty,0);
  const label=dashView==='daily'?'today':dashView==='monthly'?'this month':'this year';
  document.getElementById('stat-revenue').textContent=fmt(revenue);
  document.getElementById('stat-revenue-sub').textContent=`Cash collected ${label}`;
  document.getElementById('stat-profit').textContent=fmt(profit);
  document.getElementById('stat-profit-sub').textContent=`Net earnings ${label}`;
  document.getElementById('stat-outstanding').textContent=fmt(outstanding);
  document.getElementById('stat-qty').textContent=qty;
  document.getElementById('stat-qty-sub').textContent=`Units sold ${label}`;
  document.getElementById('stat-total-qty').textContent=totalQty;
  const recent=allSales.slice().reverse().slice(0,8);
  const tb=document.getElementById('dash-recent');
  if(!recent.length){tb.innerHTML='<tr><td colspan="7" style="color:var(--text-dim);text-align:center;padding:1.5rem;">No transactions yet.</td></tr>';return;}
  tb.innerHTML=recent.map(s=>{
    const profitValue=getRecordedProfit(s);
    return `
    <tr>
      <td><span class="sale-id-badge">${s.id}</span></td>
      <td>${fmtDateTime(s.date,s.time)}</td>
      <td>${s.customer}</td>
      <td>${s.productName}</td>
      <td>${fmt(s.totalPrice)}</td>
      <td style="color:${profitValue>=0?'var(--success)':'var(--danger)'};">${fmt(profitValue)}</td>
      <td>${s.paymentType === 'part' ? `<span class="badge ${s.status==='COMPLETED'?'badge-success':'badge-warning'}">${s.status}</span>` : '<span class="badge badge-info">FULL</span>'}</td>
    </tr>`;
  }).join('');
}

// DELETE / ARCHIVE
function promptDelete(id){
  const s=DB.getSales().find(x=>x.id===id);if(!s)return;
  document.getElementById('delete-sale-id').value=id;
  document.getElementById('delete-type').value='sale';
  setDeleteReasonOptions('sale');
  document.getElementById('delete-modal-title').textContent='Remove Sale Record to Audit Log';
  document.getElementById('delete-reason').value='';
  document.getElementById('delete-notes').value='';
  const prev=document.getElementById('delete-preview');
  document.getElementById('delete-preview-content').innerHTML=`
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:.5rem;">
      <div>
        <div style="margin-bottom:.3rem;"><span class="sale-id-badge">${s.id}</span> <strong style="margin-left:.4rem;">${s.customer}</strong></div>
        <div style="color:var(--text-secondary);">${s.productName} - Qty: ${s.qty}</div>
        <div style="margin-top:.3rem;">${fmtDateTime(s.date,s.time)}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-family:'DM Mono',monospace;color:var(--gold);">${fmt(s.totalPrice)}</div>
        <span class="badge ${s.status==='COMPLETED'?'badge-success':'badge-warning'}">${s.status}</span>
      </div>
    </div>`;
  prev.style.display='block';
  openModal('modal-delete');
}
function promptRemoveProduct(index){
  const inv=DB.getInventory();const p=inv[index];if(!p)return;
  document.getElementById('delete-sale-id').value=index;
  document.getElementById('delete-type').value='product';
  setDeleteReasonOptions('product');
  document.getElementById('delete-modal-title').textContent=`Remove Product from Inventory: ${p.name}`;
  document.getElementById('delete-reason').value='';
  document.getElementById('delete-notes').value='';
  document.getElementById('delete-preview').style.display='none';
  openModal('modal-delete');
}
function confirmDelete(){
  const id=document.getElementById('delete-sale-id').value;
  const type=document.getElementById('delete-type').value;
  const reason=document.getElementById('delete-reason').value;
  const notes=document.getElementById('delete-notes').value.trim();
  if(!reason){toast('Please select a reason for removal.','danger');return;}
  const audit=DB.getAudit();
  const archivedAt=new Date().toISOString();
  const archivedAtDisplay=new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});

  if(type==='product'){
    const index=parseInt(id);
    const inv=DB.getInventory();if(index<0||index>=inv.length)return;
    const prod=inv[index];
    const sales=DB.getSales();let affectedCount=0;
    for(const s of sales){
      const sameProductById=s.productId&&s.productId===prod.id;
      const sameProductLegacy=typeof s.productIndex==='number'&&s.productIndex===index&&s.productName===prod.name;
      if(sameProductById||sameProductLegacy){
        const auditEntry={...s,auditId:makeAuditId(),auditType:'product-removal',auditEntityType:'sale',auditReason:`Inventory Product Removed - ${reason}`,auditNotes:notes,auditDate:archivedAt,auditDateDisplay:archivedAtDisplay,removedProductIndex:index,removedProductName:prod.name};
        audit.push(auditEntry);
        queueSync('append_audit',auditEntry);
        queueSync('delete_sale',{id:s.id});
        affectedCount++;
      }
    }
    DB.setSales(sales.filter(s=>!(s.productId===prod.id||(typeof s.productIndex==='number'&&s.productIndex===index&&s.productName===prod.name))));
    const productAudit={auditId:makeAuditId(),auditType:'product-deleted',auditEntityType:'product',productIndex:index,productId:prod.id,productName:prod.name,unitCost:prod.cost,auditReason:reason,auditNotes:notes,auditDate:archivedAt,auditDateDisplay:archivedAtDisplay};
    audit.push(productAudit);
    queueSync('append_audit',productAudit);
    queueSync('delete_inventory',{id:prod.id});
    DB.setAudit(audit);inv.splice(index,1);DB.setInventory(inv);
    closeModal('modal-delete');renderInventory();populateProductDropdown();renderDashboard();renderRecords();renderSessionTable();
    toast(`Product removed. ${affectedCount} related sale(s) archived.`,'success');
  } else {
    const sales=DB.getSales();const i=sales.findIndex(s=>s.id===id);if(i<0)return;
    const sale=sales[i];
    const saleAudit={...sale,auditId:makeAuditId(),auditType:'sale-removed',auditEntityType:'sale',auditReason:reason,auditNotes:notes,auditDate:archivedAt,auditDateDisplay:archivedAtDisplay};
    audit.push(saleAudit);
    queueSync('append_audit',saleAudit);
    queueSync('delete_sale',{id:sale.id});
    DB.setAudit(audit);sales.splice(i,1);DB.setSales(sales);
    closeModal('modal-delete');renderRecords();renderDashboard();renderSessionTable();
    toast('Record archived to Audit Log.','success');
  }
}

// AUDIT LOG
function renderAudit(){
  const audit=DB.getAudit();
  const q=(document.getElementById('audit-search')?.value||'').toLowerCase();
  const rf=document.getElementById('audit-reason-filter')?.value||'';

  let shown=audit.filter(entry=>{
    const matchQ=!q||(
      (entry.customer||'').toLowerCase().includes(q)||
      (entry.productName||entry.removedProductName||'').toLowerCase().includes(q)||
      (entry.auditReason||'').toLowerCase().includes(q)||
      (entry.id||'').toLowerCase().includes(q)
    );
    const matchR=!rf||(entry.auditReason||'').includes(rf);
    return matchQ&&matchR;
  });

  // Update stats
  document.getElementById('audit-count').textContent=audit.length;
  // Top reason
  const reasons={};
  for(const e of audit){if(e.auditReason)reasons[e.auditReason]=(reasons[e.auditReason]||0)+1;}
  const top=Object.entries(reasons).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById('audit-top-reason').textContent=top?top[0].split('-')[0].trim():'-';

  const el=document.getElementById('audit-list');
  if(!shown.length){el.innerHTML='<div style="color:var(--text-dim);font-size:.88rem;padding:1rem 0;">No archived records match the current filter.</div>';return;}

  el.innerHTML=shown.slice().reverse().map(entry=>{
    if(entry.auditType==='product-deleted'){
      return `
        <div class="audit-item" style="border-left:3px solid var(--danger);padding-left:1rem;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:.5rem;">
            <div>
              <span class="badge badge-danger" style="margin-bottom:.35rem;">PRODUCT REMOVED</span>
              <div><strong>${entry.productName}</strong> <span class="inv-pid">${entry.productId||'-'}</span></div>
              <div class="audit-reason">* ${entry.auditReason}${entry.auditNotes?' - "'+entry.auditNotes+'"':''}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:.78rem;color:var(--text-dim);">Unit Cost was: ${fmt(entry.unitCost)}</div>
              <div class="audit-meta">ARCHIVED: ${entry.auditDateDisplay||new Date(entry.auditDate).toLocaleString('en-GB')}</div>
            </div>
          </div>
        </div>`;
    }
    const isProductPull=entry.auditType==='product-removal';
    const reasonCategory=getReasonCategory(entry.auditReason||'');
    return `
      <div class="audit-item" style="${isProductPull?'border-left:3px solid var(--warning);padding-left:1rem;opacity:.85;':'border-left:3px solid var(--danger);padding-left:1rem;'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:.5rem;">
          <div>
            ${isProductPull?`<span class="badge badge-warning" style="margin-bottom:.35rem;">VOIDED - PRODUCT REMOVED</span><br>`:
              `<span class="badge ${reasonCategory.badge}" style="margin-bottom:.35rem;">${reasonCategory.label}</span><br>`}
            <span class="sale-id-badge">${entry.id||'-'}</span>
            <strong style="margin-left:.5rem;">${entry.customer||'-'}</strong> - ${entry.productName||entry.removedProductName||'-'}
            <div style="margin-top:.3rem;">${entry.date?fmtDateTime(entry.date,entry.time):'-'}</div>
            <div class="audit-reason">* ${entry.auditReason||'No reason recorded'}${entry.auditNotes?' - "'+entry.auditNotes+'"':''}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-family:'DM Mono',monospace;font-size:.85rem;">${entry.totalPrice!=null?fmt(entry.totalPrice):'-'}</div>
            <div class="audit-meta">ARCHIVED: ${entry.auditDateDisplay||new Date(entry.auditDate).toLocaleString('en-GB')}</div>
          </div>
        </div>
      </div>`;
  }).join('');
}
function getReasonCategory(reason){
  if(reason.includes('Customer Return'))return{badge:'badge-info',label:'CUSTOMER RETURN'};
  if(reason.includes('Defective')||reason.includes('Quality')||reason.includes('Expired'))return{badge:'badge-danger',label:'PRODUCT ISSUE'};
  if(reason.includes('Input Error'))return{badge:'badge-warning',label:'INPUT ERROR'};
  if(reason.includes('Cancelled'))return{badge:'badge-warning',label:'CANCELLED'};
  if(reason.includes('Product Removed'))return{badge:'badge-danger',label:'PRODUCT REMOVED'};
  return{badge:'badge-danger',label:'REMOVED'};
}

async function syncToCloud(silent=false){
  if(syncInProgress)return false;
  if(!navigator.onLine)return false;
  const syncUrl=getSyncUrl();
  const user=getCurrentUser();
  const canSaveFirestore=!!user && !!firebaseStore;
  if(!syncUrl && !canSaveFirestore){
    if(!silent)toast('Backup URL not set and no authenticated cloud user.','warning');
    return false;
  }
  const queue=DB.getSyncQueue();
  const payload={
    deviceId:getDeviceId(),
    sentAt:new Date().toISOString(),
    queue,
    snapshot:{
      sales:DB.getSales(),
      inventory:DB.getInventory(),
      audit:DB.getAudit(),
    },
  };
  syncInProgress=true;
  try{
    if(syncUrl){
      const res=await fetch(syncUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if(!res.ok)throw new Error('Sync failed');
      const sales=DB.getSales().map(s=>({...s,synced:true}));
      DB.setSales(sales);
      DB.setSyncQueue([]);
      DB.setSyncState({lastSyncedAt:new Date().toISOString(),lastStatus:'success'});
      if(!silent)toast('Backup synced to Google Sheet successfully.','success');
    }
    if(canSaveFirestore){
      await saveUserDataToFirestore();
      if(!syncUrl && !silent) toast('Backup saved to user cloud storage.','success');
    }
    refreshSyncBadge();
    renderDashboard();renderSessionTable();renderRecords();
    return true;
  }catch(e){
    DB.setSyncState({lastSyncedAt:new Date().toISOString(),lastStatus:'failed',lastError:String(e)});
    refreshSyncBadge();
    if(!silent)toast('Backup failed. Data is safe locally and will sync when connection works.','danger');
    return false;
  }finally{
    syncInProgress=false;
  }
}

// BACKUP
async function backupToCloud(){
  if(!checkNet()){toast('No internet connection. Changes stay local until online.','warning');return;}
  if(!getSyncUrl()){
    const entered=(window.prompt('Paste your deployed Google Apps Script Web App URL to enable backup:')||'').trim();
    if(!entered){toast('Backup URL not provided.','warning');return;}
    DB.set(SYNC_URL_KEY,entered);
  }
  await syncToCloud(false);
}

function openUpdatePanel(){
  showPanel('update');
  renderUpdatePanel();
}

function setUpdatePanelStatus(message,type=''){
  const statusEl=document.getElementById('update-status-message');
  if(statusEl) statusEl.textContent=message;
  if(statusEl){
    if(type==='success') statusEl.style.color='var(--success)';
    else if(type==='danger') statusEl.style.color='var(--danger)';
    else statusEl.style.color='var(--text-secondary)';
  }
}

function renderUpdatePanel(){
  const versionEl=document.getElementById('current-app-version');
  const downloadBtn=document.getElementById('download-update-btn');
  if(versionEl){
    if(window.electronAPI?.getAppVersion){
      window.electronAPI.getAppVersion().then(v=>{ versionEl.textContent=v||'Unknown'; }).catch(()=>{ versionEl.textContent='Unknown'; });
    } else {
      versionEl.textContent='Unknown';
    }
  }
  if(downloadBtn){
    downloadBtn.style.display='none';
    downloadBtn.disabled=false;
    downloadBtn.textContent='DOWNLOAD UPDATE';
    downloadBtn.onclick=async ()=>{
      downloadBtn.disabled=true;
      downloadBtn.textContent='Downloading...';
      const res=await window.electronAPI.downloadAppUpdate();
      if(res?.ok){
        setUpdatePanelStatus('Update download started. You will be prompted when it finishes.', 'success');
      } else {
        setUpdatePanelStatus(res?.message||'Download failed. Try again later.', 'danger');
      }
      downloadBtn.disabled=false;
      downloadBtn.textContent='DOWNLOAD UPDATE';
    };
  }
  setUpdatePanelStatus('Click CHECK FOR UPDATE to see whether a newer version is available.');
}

async function checkAppUpdate(){
  if(!electronAvailable||!window.electronAPI?.checkForAppUpdates){
    setUpdatePanelStatus('App updates are available only in desktop app package.','danger');
    return;
  }
  try{
    const cfg=await window.electronAPI.getUpdateConfig();
    let feedUrl=(cfg?.feedUrl||'').trim();
    if(!feedUrl){
      const entered=(window.prompt(`Paste your app update feed URL.\n${UPDATE_URL_HELP}`)||'').trim();
      if(!entered){setUpdatePanelStatus('Update URL not provided.','warning');return;}
      const setRes=await window.electronAPI.setUpdateFeedUrl(entered);
      if(!setRes?.ok){setUpdatePanelStatus(setRes?.message||'Failed to save update URL.','danger');return;}
      feedUrl=entered;
      setUpdatePanelStatus('Update URL saved. You can now check updates anytime.','success');
    }
    setUpdatePanelStatus('Checking for app updates...');
    const res=await window.electronAPI.checkForAppUpdates();
    if(!res){
      setUpdatePanelStatus('No response from update service.','danger');
      return;
    }
    if(!res.ok){
      setUpdatePanelStatus(res.message||'Unable to check for updates.','danger');
      return;
    }
    if(res.updateAvailable){
      setUpdatePanelStatus(`Update available: version ${res.version}. Click download to install.`,`success`);
      const downloadBtn=document.getElementById('download-update-btn');
      if(downloadBtn) downloadBtn.style.display='inline-flex';
    } else {
      setUpdatePanelStatus(res.message||'Your app is up to date.','success');
      const downloadBtn=document.getElementById('download-update-btn');
      if(downloadBtn) downloadBtn.style.display='none';
    }
  }catch(e){
    setUpdatePanelStatus('Update check failed. Try again later.','danger');
  }
}

function hideAppLoader(){
  const loader=document.getElementById('app-loader');
  if(loader){loader.style.display='none';}
}

function startAutoSyncLoop(){
  if(syncIntervalTimer)clearInterval(syncIntervalTimer);
  syncIntervalTimer=setInterval(()=>{
    if(!navigator.onLine)return;
    const hasPending=DB.getSyncQueue().length>0||DB.getSales().some(s=>!s.synced);
    if(hasPending)syncToCloud(true);
  },AUTO_SYNC_INTERVAL_MS);
}

function initApp(){
  normalizeAuditEntries();
  normalizeInventoryEntries();
  normalizeSalesEntries();
  const sales=DB.getSales();
  let changed=false;
  for(const s of sales){
    if(typeof s.synced!=='boolean'){s.synced=false;changed=true;}
  }
  if(changed)DB.setSales(sales);
  checkNet();populateProductDropdown();
  setDeleteReasonOptions('sale');
  refreshSyncBadge();
  renderDashboard();renderSessionTable();renderOutstanding();renderInventory();renderRecords();renderAudit();
  if(navigator.onLine&&DB.getSyncQueue().length)syncToCloud(true);
  if(navigator.onLine){
    // Do not auto-check updates on login. App update checks are manual only.
  }
  startAutoSyncLoop();
  hideAppLoader();
}
