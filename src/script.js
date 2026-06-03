const electronAvailable = typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.storeGetSync === 'function';
const CURRENT_ACCOUNT_KEY='glr_current_account';
/** Persists last business account email so recovery flows work after logout (scoped data keys use email). */
const LAST_PROFILE_EMAIL_KEY='glr_last_profile_email';

function normalizeAccountId(value){
  return (value||'').toString().toLowerCase().trim();
}
function getCurrentAccount(){
  return normalizeAccountId(DB.get(CURRENT_ACCOUNT_KEY) || '');
}
function setCurrentAccount(email){
  const normalized = normalizeAccountId(email);
  if(normalized){
    DB.set(CURRENT_ACCOUNT_KEY, normalized);
  } else {
    DB.delete(CURRENT_ACCOUNT_KEY);
  }
  return normalized;
}
function getScopedStorageKey(key, accountEmail){
  const account = normalizeAccountId(accountEmail || getCurrentAccount());
  return account ? `${key}::${account}` : key;
}

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
  getScoped(k, accountEmail){return this.get(getScopedStorageKey(k, accountEmail));},
  setScoped(k,v, accountEmail){this.set(getScopedStorageKey(k, accountEmail),v);},
  deleteScoped(k, accountEmail){this.delete(getScopedStorageKey(k, accountEmail));},
  getSales(accountEmail){return this.getScoped('glr_sales', accountEmail)||[];},
  setSales(v, accountEmail){this.setScoped('glr_sales',v, accountEmail);},
  getAudit(accountEmail){return this.getScoped('glr_audit', accountEmail)||[];},
  setAudit(v, accountEmail){this.setScoped('glr_audit',v, accountEmail);},
  getInventory(accountEmail){
    const globalInventory = this.get('glr_inventory');
    if(Array.isArray(globalInventory)) return globalInventory;
    return this.getScoped('glr_inventory', accountEmail)||[];
  },
  setInventory(v, accountEmail){
    this.set('glr_inventory', sortInventoryByName(v));
  },
  getSyncQueue(accountEmail){return this.getScoped('glr_sync_queue', accountEmail)||[];},
  setSyncQueue(v, accountEmail){this.setScoped('glr_sync_queue',v, accountEmail);},
  getSyncState(accountEmail){return this.getScoped('glr_sync_state', accountEmail)||{};},
  setSyncState(v, accountEmail){this.setScoped('glr_sync_state',v, accountEmail);},
};

function sortInventoryByName(items){
  if(!Array.isArray(items)) return items;
  return [...items].sort((a,b)=>{
    const na=String(a?.name||'').trim().toLowerCase();
    const nb=String(b?.name||'').trim().toLowerCase();
    if(na<nb) return -1;
    if(na>nb) return 1;
    return 0;
  });
}

const GOOGLE_SCRIPT_WEB_APP_URL=''; // Optional fallback. Preferred: set inside app when prompted.
const GLR_ENV = (typeof process !== 'undefined' && process.env) ? process.env : {};
const FIREBASE_CONFIG={
  apiKey:GLR_ENV.FIREBASE_API_KEY||'',
  authDomain:GLR_ENV.FIREBASE_AUTH_DOMAIN||'',
  projectId:GLR_ENV.FIREBASE_PROJECT_ID||'',
  storageBucket:GLR_ENV.FIREBASE_STORAGE_BUCKET||'',
  messagingSenderId:GLR_ENV.FIREBASE_MESSAGING_SENDER_ID||'',
  appId:GLR_ENV.FIREBASE_APP_ID||'',
};
/**
 * Wholesales email verification: register users in WHOLESALE_REGISTERED_USERS and/or Firestore meta/appConfig.wholesaleAllowedUsers.
 * Each entry needs phone (E.164) and email.
 * Email delivery (free, no payment): EmailJS (https://www.emailjs.com � 200 emails/month, no card) or
 * Firebase Extension "Trigger Email" (Firestore `mail` collection + Gmail SMTP). Dev toast if neither is set.
 * Optional Firestore: meta/appConfig.wholesaleEmailDelivery � same shape as WHOLESALE_EMAIL_DELIVERY below.
 */
const OWNER_EMAIL=''; // Optional: lock login to one owner email if set.
const FIRESTORE_CONFIG_COLLECTION='meta';
const FIRESTORE_CONFIG_DOC='appConfig';
const DEFAULT_OWNER_PHOTO='assets/login-photo.png';
const USER_PASSWORD_KEY='glr_user_password';
/** Persists successful Wholesales email gate until logout. */
const WHOLESALE_ACCESS_KEY='glr_wholesale_email_access';
/**
 * Developer-registered wholesales users (phone + email + access configuration code).
 * Optional Firestore: meta/appConfig field `wholesaleAllowedUsers` � array of { phone, email }.
 */
/**
 * Built-in fallback (works offline). Also add users in Profile ? Wholesales authorized users.
 * Phone must be E.164 e.g. +23274132162
 */
const WHOLESALE_REGISTERED_USERS=[
  { phone:'+23274132162', email:'abduldeenkamara06@gmail.com' },
];
const WHOLESALE_USERS_CACHE_KEY='glr_wholesale_allowed_users_cache';
const WHOLESALE_REGISTRY_FETCH_MS=2500;
const WHOLESALE_REGISTRY_TTL_MS=60*1000;
const WHOLESALE_EMAIL_FETCH_MS=8000;
const MSG_WHOLESALE_NOT_REGISTERED='This phone number or email address is not registered yet. contact your administrator';
/**
 * Email delivery for wholesales OTP (all free tiers, no credit card).
 * mode: 'auto' | 'emailjs' | 'firebase' | 'dev'
 *
 * EmailJS (easiest): https://www.emailjs.com ? sign up ? Email Services (Gmail) ? Email Templates.
 * Template To field: {{email}} (or {{to_email}}). Subject: {{subject}}. Body: {{passcode}} and/or {{message}}.
 * Account ? API keys ? Public Key. Paste publicKey, serviceId, templateId below (or in Firestore wholesaleEmailDelivery).
 *
 * Firebase: Console ? Extensions ? "Trigger Email" ? SMTP (Gmail app password works). Collection name: mail.
 */
const WHOLESALE_EMAIL_DELIVERY={
  mode:'auto',
  brandName:'Good Luck Rahman Enterprise',
  websiteLink:'', // Optional: shown in EmailJS template as {{website_link}}
  /** Set true only after installing Firebase Extension "Trigger Email" (otherwise use EmailJS). */
  firebaseEnabled:false,
  firebaseMailCollection:'mail',
  emailjs:{
    enabled:true,
    publicKey:'UCXgLqGeMlxHl_pEh',
    serviceId:'service_xm7b98n',
    templateId:'template_3aa2wd6',
  },
};
const PASSWORD_RESET_EMAIL_DELIVERY={
  enabled:true,
  mode:'firebase',
  brandName:'Good Luck Rahman Enterprise',
  websiteLink:'',
  logoUrl:'',
  continueUrl:'',
  emailjs:{
    enabled:true,
    publicKey:'UCXgLqGeMlxHl_pEh',
    serviceId:'service_ra3qu89',
    templateId:'template_a6eh4z6',
  },
};
const WHOLESALE_OTP_TTL_MS=10*60*1000;
const WHOLESALE_OTP_RESEND_MS=60*1000;
/** Country prefix for the wholesale phone field when users enter local digits only (Sierra Leone). */
const WHOLESALE_DEFAULT_DIAL_CODE='+232';
const MSG_WHOLESALE_NOT_ACTIVATED='No wholesales users are set up yet. Log in to the main app ? Profile ? Wholesales authorized users ? add phone and email.';
const MSG_WHOLESALE_UNAUTHORIZED='You are not authorized to use this service. If you need access, please contact your administrator.';
/** Try these bundled names if login-photo.png is missing (same folder: src/assets/). */
const BUNDLED_OWNER_PHOTO_CANDIDATES=[
  'assets/login-photo.png',
  'assets/login-photo.jpg',
  'assets/login-photo.jpeg',
  'assets/login-photo.webp',
];
const DEVICE_ID_KEY='glr_device_id';
const OWNER_PIN_KEY='glr_owner_pin';
const OWNER_PHONE_KEY='glr_owner_phone';
const EXPLICIT_LOGOUT_KEY='glr_explicit_logout';
const OWNER_PROFILE_KEY='glr_owner_profile';
const ACCOUNT_INDEX_KEY='glr_account_index';
const SYNC_URL_KEY='glr_sync_url';
const UPDATE_URL_HELP='Use only for a custom generic feed URL; GitHub Releases works automatically when the app is built with GitHub publish config.';
let syncDebounceTimer=null;
let syncInProgress=false;
let sessionRecoveryRequired=false; // When true, pauses all sync and forces re-auth
let syncIntervalTimer=null;
let offlineSyncRetryTimer=null;  // Retry timer for when connection restores
let logFlushTimer = null;
let justLoggedIn=false;
let lastNetworkOnline=null;
let pendingRegistrationPhoto=null;
let profileAccessUnlocked=false;
let currentPanelId='welcome';
/** True when user opened wholesale from the login welcome CTA (show nav tab before full auth). */
let wholesaleBrowseWithoutLogin=false;
let wholesaleRegisteredUsers=[];
let wholesaleAdminUsersCache=[];
let wholesalePendingOtpSession=null;
let wholesaleEmailSendInFlight=false;
let lastLoginOverlayMode='welcome';

function getOwnerPin(accountEmail){
  const acct=normalizeAccountId(accountEmail||getCurrentAccount()||getPrimaryAccountEmail());
  return DB.getScoped(OWNER_PIN_KEY, acct) || '1234';
}
function setOwnerPin(pin, accountEmail){
  if(!pin) return;
  const acct=normalizeAccountId(accountEmail||getCurrentAccount()||getPrimaryAccountEmail());
  DB.setScoped(OWNER_PIN_KEY, pin.trim(), acct);
}
function simpleHashPassword(password){
  let hash=0;
  if(!password||password.length===0) return hash.toString();
  for(let i=0;i<password.length;i++){
    const char=password.charCodeAt(i);
    hash=((hash<<5)-hash)+char;
    hash=hash&hash;
  }
  return Math.abs(hash).toString();
}
function isPasswordHash(value){
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
async function hashPasswordForStorage(password){
  if(!password) return '';
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function getUserPassword(accountEmail){
  return DB.getScoped(USER_PASSWORD_KEY, accountEmail) || '';
}
function setUserPassword(password, accountEmail){
  if(!password) return;
  DB.setScoped(USER_PASSWORD_KEY, password, accountEmail);
}
function isExplicitLogout(){
  return DB.get(EXPLICIT_LOGOUT_KEY)===true;
}
function setExplicitLogout(value){
  DB.set(EXPLICIT_LOGOUT_KEY, !!value);
}
function getOwnerProfileData(accountEmail){
  return DB.getScoped(OWNER_PROFILE_KEY, accountEmail) || { name:'User', email:'', contact:'', photo:'', authProvider:'local', createdAt:'-', updatedAt:'-' };
}
function saveOwnerProfile(email, fullName, contact, photo, provider='local'){
  const normalized=(email||'').toLowerCase().trim();
  const profile = getOwnerProfileData(normalized);
  const oldEmail = profile.email ? normalizeAccountId(profile.email) : '';
  const defaultName = 'User';
  let name = defaultName;
  if(fullName?.trim()){
    name = fullName.trim().split(/\s+/).map(word=>word[0]?.toUpperCase()+word.slice(1).toLowerCase()).join(' ');
  } else if(normalized){
    const rawName = normalized.split('@')[0] || defaultName;
    name = rawName.split(/[^a-zA-Z0-9]+/).filter(Boolean).map(word=>word[0]?.toUpperCase()+word.slice(1).toLowerCase()).join(' ') || defaultName;
  }
  const saved = {
    ...profile,
    name,
    email: normalized || profile.email,
    contact: contact?.trim() || profile.contact || '',
    photo: photo !== undefined ? photo : profile.photo || DB.getScoped('owner_photo', normalized) || '',
    authProvider: provider || profile.authProvider || 'local',
    updatedAt: new Date().toISOString(),
    createdAt: profile.createdAt==='-' ? new Date().toISOString() : profile.createdAt,
  };
  setCurrentAccount(normalized);
  if(normalized) DB.set(LAST_PROFILE_EMAIL_KEY, normalized);
  DB.setScoped(OWNER_PROFILE_KEY, saved, normalized);
  if(saved.photo){
    DB.setScoped('owner_photo', saved.photo, normalized);
  } else {
    DB.deleteScoped('owner_photo', normalized);
  }
  if(normalized && oldEmail && oldEmail !== normalized){
    updateRegisteredAccountIndex(oldEmail, false);
  }
  updateRegisteredAccountIndex(normalized, true);
  if(document.getElementById('admin-registered-users-list')){
    renderRegisteredUsersList();
  }
  return saved;
}

function maybeRefreshAdminUserView(){
  if(document.getElementById('admin-registered-users-list')){
    renderRegisteredUsersList();
  }
}

async function deleteFirebaseUserDataByEmail(email){
  if(!firebaseStore || !email) return false;
  try{
    const normalized = normalizeAccountId(email);
    const querySnapshot = await firebaseStore.collection('users').where('email','==',normalized).get();
    if(querySnapshot.empty) return false;
    const deletes = [];
    querySnapshot.forEach(doc => deletes.push(doc.ref.delete()));
    await Promise.all(deletes);
    return true;
  }catch(err){
    console.warn('deleteFirebaseUserDataByEmail failed:', err);
    return false;
  }
}

function titleCase(value){
  if(!value) return '';
  return value.toString().trim().split(/\s+/).map(word=>word.charAt(0).toUpperCase()+word.slice(1).toLowerCase()).join(' ');
}
function removeMainAppUser(email){
  const normalized = normalizeAccountId(email);
  if(!normalized) return false;
  const profile = getOwnerProfileData(normalized);
  if(!profile || !profile.email) return false;
  if(getCurrentAccount() === normalized){
    setCurrentAccount('');
  }
  DB.deleteScoped(OWNER_PROFILE_KEY, normalized);
  DB.deleteScoped(USER_PASSWORD_KEY, normalized);
  DB.deleteScoped(OWNER_PIN_KEY, normalized);
  DB.deleteScoped(OWNER_PHONE_KEY, normalized);
  DB.deleteScoped('owner_photo', normalized);
  DB.deleteScoped('glr_sales', normalized);
  DB.deleteScoped('glr_audit', normalized);
  DB.deleteScoped('glr_sync_queue', normalized);
  DB.deleteScoped('glr_sync_state', normalized);
  updateRegisteredAccountIndex(normalized, false);
  if(document.getElementById('admin-registered-users-list')){
    renderRegisteredUsersList();
  }
  return true;
}
function getRegisteredAccountIndex(){
  const index=DB.get(ACCOUNT_INDEX_KEY);
  if(Array.isArray(index)){
    return index.map(normalizeAccountId).filter(Boolean);
  }
  return [];
}
function saveRegisteredAccountIndex(accounts){
  const normalized=(Array.isArray(accounts)?accounts:[]).map(normalizeAccountId).filter(Boolean);
  if(normalized.length){
    DB.set(ACCOUNT_INDEX_KEY,[...new Set(normalized)]);
  } else {
    DB.delete(ACCOUNT_INDEX_KEY);
  }
  return getRegisteredAccountIndex();
}
function updateRegisteredAccountIndex(email, shouldAdd=true){
  const normalized=normalizeAccountId(email);
  if(!normalized) return;
  const accounts=getRegisteredAccountIndex();
  const exists=accounts.includes(normalized);
  if(shouldAdd && !exists){
    accounts.push(normalized);
    saveRegisteredAccountIndex(accounts);
  }
  if(!shouldAdd && exists){
    saveRegisteredAccountIndex(accounts.filter(a=>a!==normalized));
  }
}
function scanLocalRegisteredAccounts(){
  const accounts=[];
  if(typeof localStorage === 'undefined') return accounts;
  try{
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);
      if(!key || typeof key !== 'string') continue;
      if(key.startsWith(`${OWNER_PROFILE_KEY}::`)){
        const email=normalizeAccountId(key.split('::')[1] || '');
        if(email && !accounts.includes(email)) accounts.push(email);
      }
    }
  }catch(_e){}
  return accounts;
}
function getRegisteredAppUsers(){
  const indexed=getRegisteredAccountIndex();
  const scanned=scanLocalRegisteredAccounts();
  return [...new Set([...indexed, ...scanned])].sort();
}
function renderRegisteredUsersList(){
  const listEl=document.getElementById('admin-registered-users-list');
  const countEl=document.getElementById('admin-registered-user-count');
  const statusEl=document.getElementById('admin-registered-users-status');
  if(!listEl || !countEl) return;
  const users=getRegisteredAppUsers();
  countEl.textContent = users.length;
  if(!users.length){
    listEl.innerHTML = '<li class="wholesale-admin-user-item"><span class="wholesale-admin-user-meta">No registered users found. Create or sync at least one account first.</span></li>';
    if(statusEl) statusEl.textContent = 'Registered user list is built from stored owner profiles and may require browser storage access.';
    return;
  }
  listEl.innerHTML = users.map(email => `<li class="wholesale-admin-user-item"><span class="wholesale-admin-user-meta">${email}</span></li>`).join('');
  if(statusEl) statusEl.textContent = 'Registered user accounts loaded successfully.';
}
async function deleteMainAppUser(){
  const emailEl=document.getElementById('admin-delete-user-email');
  const statusEl=document.getElementById('admin-delete-user-status');
  if(statusEl){ statusEl.textContent=''; statusEl.style.color=''; }
  const email = normalizeEmail((emailEl||{}).value);
  if(!email){
    if(statusEl){ statusEl.textContent='Enter the email address of the user to delete.'; statusEl.style.color='var(--danger)'; }
    return;
  }
  const profile = getOwnerProfileData(email);
  if(!profile || !profile.email){
    if(statusEl){ statusEl.textContent='This user does not exist.'; statusEl.style.color='var(--danger)'; }
    return;
  }
  const confirmed = window.confirm(`Delete user ${email}? This will remove their account and all attached records.`);
  if(!confirmed){
    if(statusEl){ statusEl.textContent='User deletion cancelled.'; statusEl.style.color='var(--text-secondary)'; }
    return;
  }
  const deleted = removeMainAppUser(email);
  let remoteDeleted = false;
  if(deleted && firebaseStore){
    try{
      remoteDeleted = await deleteFirebaseUserDataByEmail(email);
    }catch(err){
      console.error('Remote user deletion failed:', err);
    }
  }
  if(deleted){
    if(statusEl){
      statusEl.textContent = 'User deleted successfully.' + (remoteDeleted ? ' Remote record also removed.' : '');
      statusEl.style.color='var(--success)';
    }
    if(emailEl) emailEl.value='';
    renderRegisteredUsersList();
    const normalizedCurrent = normalizeAccountId(getCurrentAccount() || getCurrentUser()?.email);
    if(normalizedCurrent && normalizedCurrent === email){
      toast('Deleted user has been signed out.', 'info');
      await doLogout(true);
    }
  } else {
    if(statusEl){ statusEl.textContent='Unable to delete this user.'; statusEl.style.color='var(--danger)'; }
  }
}
function renderOwnerProfile(){
  const profile=getOwnerProfileData();
  const img=document.getElementById('profile-owner-img');
  const placeholder=document.querySelector('#profile-owner-photo .owner-photo-placeholder');
  const raw=profile.photo || DB.getScoped('owner_photo');
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
  const nameInput=document.getElementById('profile-owner-fullname');
  const contactInput=document.getElementById('profile-owner-contact');
  const emailInput=document.getElementById('profile-owner-email-input');
  const createdEl=document.getElementById('profile-owner-created');
  if(nameInput) nameInput.value=profile.name||'';
  if(contactInput) contactInput.value=profile.contact||'';
  if(emailInput) emailInput.value=profile.email||'';
  if(createdEl) createdEl.textContent = profile.createdAt && profile.createdAt !== '-' ? new Date(profile.createdAt).toLocaleString() : 'Not set';
}
function renderProfileSection(){
  const lockCard=document.getElementById('profile-lock-card');
  const detailsCard=document.getElementById('profile-details-card');
  const securityCard=document.getElementById('profile-security-card');
  const creditCard=document.getElementById('profile-credit-card');
  if(lockCard) lockCard.style.display = profileAccessUnlocked ? 'none' : '';
  if(detailsCard) detailsCard.style.display = profileAccessUnlocked ? '' : 'none';
  if(securityCard) securityCard.style.display = profileAccessUnlocked ? '' : 'none';
  if(creditCard) creditCard.style.display = profileAccessUnlocked ? '' : 'none';
  if(profileAccessUnlocked){
    document.getElementById('profile-unlock-password').value='';
    document.getElementById('profile-unlock-error').textContent='';
  }
  renderOwnerProfile();
}
async function loadAdminPanel(){
  const appVersion=document.getElementById('admin-app-version');
  const wholesaleCount=document.getElementById('admin-wholesale-count');
  const lastSync=document.getElementById('admin-last-sync');
  
  if(appVersion){
    if(window.electronAPI?.getAppVersion){
      try{
        const version = await window.electronAPI.getAppVersion();
        appVersion.textContent = version || '2.0.0';
      }catch(_){
        appVersion.textContent = '2.0.0';
      }
    } else {
      appVersion.textContent='2.0.0';
    }
  }
  
  await refreshWholesaleRegisteredUsers();
  if(wholesaleCount) wholesaleCount.textContent=(wholesaleRegisteredUsers||[]).length;
  renderRegisteredUsersList();
  
  const lastSyncTime=DB.get('glr_last_sync_time');
  if(lastSync){
    if(lastSyncTime){
      try{
        lastSync.textContent=new Date(lastSyncTime).toLocaleString();
      }catch(_e){
        lastSync.textContent='Recently';
      }
    } else {
      lastSync.textContent='Never';
    }
  }
  
  await loadWholesaleAdminUsers();
}
async function validateProfilePassword(password){
  const profile=getOwnerProfileData();
  if(!profile.email) return false;
  const storedPassword=getUserPassword();
  if(storedPassword){
    if(isPasswordHash(storedPassword)){
      return await hashPasswordForStorage(password)===storedPassword;
    }
    return password === storedPassword;
  }
  if(firebaseAuth && getCurrentUser() && getCurrentUser().email===profile.email){
    try{
      const credential=firebase.auth.EmailAuthProvider.credential(profile.email,password);
      await getCurrentUser().reauthenticateWithCredential(credential);
      return true;
    }catch(_e){
      return false;
    }
  }
  return false;
}
async function unlockProfileSection(){
  const password=(document.getElementById('profile-unlock-password')||{}).value?.trim();
  if(!password){
    document.getElementById('profile-unlock-error').textContent='Enter your password to unlock profile.';
    return;
  }
  const valid=await validateProfilePassword(password);
  if(!valid){
    document.getElementById('profile-unlock-error').textContent='Password is incorrect. Please try again.';
    return;
  }
  profileAccessUnlocked=true;
  renderProfileSection();
}
function lockProfileSection(){
  profileAccessUnlocked=false;
  renderProfileSection();
}
function saveProfileChanges(){
  const fullName=(document.getElementById('profile-owner-fullname')||{}).value.trim();
  const contact=(document.getElementById('profile-owner-contact')||{}).value.trim();
  const email=(document.getElementById('profile-owner-email-input')||{}).value.trim();
  if(!fullName||!email){
    toast('Enter your name and email to save profile.','danger');
    return;
  }
  const profile=getOwnerProfileData();
  const updatedProfile=saveOwnerProfile(email, fullName, contact, profile.photo, profile.authProvider);
  queueSync('update_profile', updatedProfile);
  toast('Profile details saved.','success');
  renderOwnerProfile();
}
function selectRegistrationPhoto(){
  document.getElementById('auth-photo-input')?.click();
}
function handleRegistrationPhotoSelected(event){
  const file=event.target.files?.[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=function(e){
    pendingRegistrationPhoto=e.target.result;
    const img=document.getElementById('register-photo-preview');
    const placeholder=document.querySelector('#register-photo-preview-wrapper .photo-placeholder');
    if(img){img.src=pendingRegistrationPhoto;img.style.display='block';}
    if(placeholder) placeholder.style.display='none';
  };
  reader.readAsDataURL(file);
}
function selectProfilePhoto(){
  document.getElementById('profile-photo-input')?.click();
}

function queueOwnerPhotoUpdate(imageData, syncImmediately=true){
  const profile = getOwnerProfileData();
  const accountEmail = getCurrentAccount() || getPrimaryAccountEmail() || profile.email || '';
  const normalizedEmail = normalizeAccountId(accountEmail);
  const profileEmail = normalizedEmail || profile.email || '';
  const updatedProfile = saveOwnerProfile(profileEmail, profile.name, profile.contact, imageData, profile.authProvider || 'local');
  if(!normalizedEmail){
    DB.set('owner_photo', imageData);
  }
  queueSync('update_owner_photo', {
    type: 'owner_photo',
    imageData,
    uploadedAt: new Date().toISOString(),
  });
  if(syncImmediately && navigator.onLine){
    syncToCloud(true).catch(()=>{});
  }
  refreshSyncBadge();
  return updatedProfile;
}

function handleProfilePhotoSelected(event){
  const file=event.target.files?.[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=function(e){
    const photoData=e.target.result;
    queueOwnerPhotoUpdate(photoData);
    renderOwnerProfile();
    toast('Profile photo updated.','success');
  };
  reader.readAsDataURL(file);
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
  const newEmail=(document.getElementById('profile-owner-email-input')||{}).value?.trim();
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
  const profile=getOwnerProfileData();
  const newEmailValue=newEmail || profile.email;
  if(firebaseAuth && getCurrentUser()){
    try{
      const credential=firebase.auth.EmailAuthProvider.credential(profile.email, currentPassword);
      await getCurrentUser().reauthenticateWithCredential(credential);
      if(newEmailValue && newEmailValue !== profile.email){
        if(!await canRegisterWithEmail(newEmailValue)){
          toast('This email is not available for this account.','danger');
          return;
        }
        await getCurrentUser().updateEmail(newEmailValue);
        await updateOwnerEmailConfig(newEmailValue);
        const oldPassword = DB.getScoped(USER_PASSWORD_KEY, profile.email);
        if(oldPassword){
          DB.setScoped(USER_PASSWORD_KEY, oldPassword, normalizeAccountId(newEmailValue));
          DB.deleteScoped(USER_PASSWORD_KEY, profile.email);
        }
      }
      if(newPassword){
        await getCurrentUser().updatePassword(newPassword);
        await setUserPassword(newPassword, normalizeAccountId(newEmailValue));
        await saveUserDataToFirestore();
      }
      saveOwnerProfile(newEmailValue, profile.name, profile.contact, profile.photo, profile.authProvider);
      document.getElementById('profile-current-password').value='';
      document.getElementById('profile-new-password').value='';
      document.getElementById('profile-confirm-password').value='';
      renderOwnerProfile();
      toast('Account settings updated successfully.', 'success');
    }catch(err){
      console.error(err);
      // Additional diagnostic: check sign-in methods for this email to help explain mismatches
      if(firebaseAuth && email){
        try{
          const methods = await firebaseAuth.fetchSignInMethodsForEmail(email);
          console.info('Firebase sign-in methods for', email, methods);
          if(Array.isArray(methods) && methods.length && !methods.includes('password')){
            // Account exists but doesn't use password sign-in
            el.textContent = 'This email is registered using a different sign-in method (social login or SSO). Try that provider or reset your password.';
            if(loginButton){ loginButton.disabled=false; loginButton.textContent=originalText; }
            return;
          }
        }catch(_e){
          // ignore diagnostic failure
        }
      }
      const message = err?.message || 'Unable to update account settings. Please check your password and try again.';
      toast(message, 'danger');
    }
  } else {
    if(currentPassword !== getUserPassword()){
      toast('Current password is incorrect.', 'danger');
      return;
    }
    if(newEmailValue && newEmailValue !== profile.email){
      const oldPassword = DB.getScoped(USER_PASSWORD_KEY, profile.email);
      if(oldPassword){
        DB.setScoped(USER_PASSWORD_KEY, oldPassword, normalizeAccountId(newEmailValue));
        DB.deleteScoped(USER_PASSWORD_KEY, profile.email);
      }
      saveOwnerProfile(newEmailValue, profile.name, profile.contact, profile.photo, profile.authProvider);
    }
    if(newPassword){
      await setUserPassword(newPassword);
    }
    document.getElementById('profile-current-password').value='';
    document.getElementById('profile-new-password').value='';
    document.getElementById('profile-confirm-password').value='';
    renderOwnerProfile();
    toast('Account settings updated successfully.', 'success');
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
async function updateAppPin(){
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
  if(getCurrentUser()){
    try{
      await saveUserDataToFirestore();
    }catch(_e){
      // Local PIN is updated; cloud sync will retry later when possible.
    }
  }
  document.getElementById('profile-current-pin').value='';
  document.getElementById('profile-new-pin').value='';
  toast('Unlock PIN changed successfully.', 'success');
}
function onLoginBackClick(){
  switchLoginMode('welcome');
}
function normalizeEmail(value){
  return String(value||'').trim().toLowerCase();
}
function setWholesaleCodeSectionVisible(visible){
  const codeSec=document.getElementById('wholesale-code-section');
  if(!codeSec) return;
  codeSec.style.display=visible?'block':'none';
  codeSec.setAttribute('aria-hidden',visible?'false':'true');
}
function resetWholesaleLoginForm(){
  const phoneEl=document.getElementById('wholesale-login-phone-local');
  const emailEl=document.getElementById('wholesale-login-email');
  const otpEl=document.getElementById('wholesale-login-otp');
  const errEl=document.getElementById('wholesale-login-error');
  const sendBtn=document.getElementById('wholesale-send-email-btn');
  const verifyBtn=document.getElementById('wholesale-verify-btn');
  if(phoneEl) phoneEl.value='';
  if(emailEl) emailEl.value='';
  if(otpEl) otpEl.value='';
  if(errEl) errEl.textContent='';
  setWholesaleCodeSectionVisible(false);
  clearWholesaleOtpDigits();
  if(sendBtn){ sendBtn.disabled=false; sendBtn.textContent='SEND CODE'; }
  if(verifyBtn){ verifyBtn.disabled=false; verifyBtn.textContent='LOG IN'; }
  wholesalePendingOtpSession=null;
}
function composeWholesaleE164FromNationalDigits(rawInput){
  const d=String(rawInput||'').replace(/\D/g,'');
  if(!d) return '';
  const def=(WHOLESALE_DEFAULT_DIAL_CODE||'').trim();
  if(!def.startsWith('+')) return '';
  const cc=def.replace(/\D/g,'');
  if(d.startsWith(cc) && d.length>cc.length) return normalizePhone('+'+d);
  const national=d.replace(/^0+/,'');
  if(!national) return '';
  if(national.startsWith(cc)) return normalizePhone('+'+national);
  return normalizePhone('+'+cc+national);
}
function getWholesalePhoneE164FromForm(){
  const localEl=document.getElementById('wholesale-login-phone-local');
  const raw=(localEl&&localEl.value!==undefined)?localEl.value:'';
  const trimmed=String(raw).trim();
  if(!trimmed) return '';
  const asFull=normalizePhone(trimmed);
  if(asFull.startsWith('+')) return asFull;
  return composeWholesaleE164FromNationalDigits(trimmed);
}
function getWholesaleLoginCredentials(){
  const email=normalizeEmail((document.getElementById('wholesale-login-email')||{}).value);
  const phone=getWholesalePhoneE164FromForm();
  return { phone, email };
}
function normalizeWholesaleRegistryEntry(entry){
  const phone=normalizePhone(String(entry?.phone||''));
  const email=normalizeEmail(entry?.email);
  if(!phone||!phone.startsWith('+')||!email) return null;
  return { phone, email };
}
function applyWholesaleEmailDeliveryConfig(remote){
  if(!remote||typeof remote!=='object') return;
  if(remote.mode) WHOLESALE_EMAIL_DELIVERY.mode=String(remote.mode);
  if(remote.brandName) WHOLESALE_EMAIL_DELIVERY.brandName=String(remote.brandName);
  if(remote.firebaseMailCollection) WHOLESALE_EMAIL_DELIVERY.firebaseMailCollection=String(remote.firebaseMailCollection);
  if(remote.firebaseEnabled===true||remote.firebaseEnabled===false) WHOLESALE_EMAIL_DELIVERY.firebaseEnabled=!!remote.firebaseEnabled;
  const ej=remote.emailjs;
  if(ej&&typeof ej==='object'){
    const local=WHOLESALE_EMAIL_DELIVERY.emailjs;
    if(ej.publicKey) local.publicKey=String(ej.publicKey).trim();
    if(ej.serviceId) local.serviceId=String(ej.serviceId).trim();
    if(ej.templateId) local.templateId=String(ej.templateId).trim();
    if(ej.enabled===true||ej.enabled===false) local.enabled=!!ej.enabled;
  }
  if(isWholesaleEmailJsReady()) WHOLESALE_EMAIL_DELIVERY.emailjs.enabled=true;
}
async function refreshWholesaleEmailDeliveryFromFirestore(){
  if(!firebaseStore) return;
  try{
    const doc=await firebaseStore.collection(FIRESTORE_CONFIG_COLLECTION).doc(FIRESTORE_CONFIG_DOC).get();
    if(doc.exists) applyWholesaleEmailDeliveryConfig(doc.data()?.wholesaleEmailDelivery);
  }catch(_e){}
}
function isWholesaleEmailJsReady(){
  const cfg=WHOLESALE_EMAIL_DELIVERY.emailjs||{};
  if(cfg.enabled===false) return false;
  return !!(cfg.publicKey&&cfg.serviceId&&cfg.templateId);
}
let wholesaleRegistryLastFetch=0;
let wholesaleRegistryRefreshPromise=null;
function buildWholesaleRegisteredUsersList(extraUsers){
  const merged=[];
  const seen=new Set();
  const addEntry=(entry)=>{
    const norm=normalizeWholesaleRegistryEntry(entry);
    if(!norm) return;
    const key=norm.phone+'|'+norm.email;
    if(seen.has(key)) return;
    seen.add(key);
    merged.push(norm);
  };
  for(const u of WHOLESALE_REGISTERED_USERS||[]) addEntry(u);
  const cached=DB.get(WHOLESALE_USERS_CACHE_KEY);
  if(Array.isArray(cached)){
    for(const u of cached) addEntry(u);
  }
  if(Array.isArray(extraUsers)){
    for(const u of extraUsers) addEntry(u);
  }
  return merged;
}
/** Instant load from built-in list + local cache (offline-safe). */
function loadWholesaleRegisteredUsersSync(){
  wholesaleRegisteredUsers=buildWholesaleRegisteredUsersList();
  return wholesaleRegisteredUsers;
}
/** Background refresh from Firestore when online (never blocks UI if cache exists). */
async function refreshWholesaleRegisteredUsers(options={}){
  const force=!!options.force;
  const useNetwork=options.network!==false;
  loadWholesaleRegisteredUsersSync();
  if(!useNetwork||!firebaseStore) return wholesaleRegisteredUsers;
  const now=Date.now();
  if(!force&&now-wholesaleRegistryLastFetch<WHOLESALE_REGISTRY_TTL_MS){
    return wholesaleRegisteredUsers;
  }
  if(wholesaleRegistryRefreshPromise&&!force){
    return wholesaleRegistryRefreshPromise;
  }
  wholesaleRegistryRefreshPromise=(async()=>{
    try{
      const doc=await Promise.race([
        firebaseStore.collection(FIRESTORE_CONFIG_COLLECTION).doc(FIRESTORE_CONFIG_DOC).get(),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('wholesale-registry-timeout')),WHOLESALE_REGISTRY_FETCH_MS)),
      ]);
      if(doc.exists){
        const data=doc.data()||{};
        const users=data.wholesaleAllowedUsers;
        if(Array.isArray(users)&&users.length){
          wholesaleRegisteredUsers=buildWholesaleRegisteredUsersList(users);
          DB.set(WHOLESALE_USERS_CACHE_KEY,wholesaleRegisteredUsers);
        }
        applyWholesaleEmailDeliveryConfig(data.wholesaleEmailDelivery);
      }
      wholesaleRegistryLastFetch=Date.now();
    }catch(_e){}
    finally{
      wholesaleRegistryRefreshPromise=null;
    }
    return wholesaleRegisteredUsers;
  })();
  return wholesaleRegistryRefreshPromise;
}
function wholesalePhonesMatch(phoneA,phoneB){
  const a=normalizePhone(phoneA||'').replace(/\D/g,'');
  const b=normalizePhone(phoneB||'').replace(/\D/g,'');
  if(!a||!b) return false;
  if(a===b) return true;
  const tail=8;
  if(a.length>=tail&&b.length>=tail&&a.slice(-tail)===b.slice(-tail)) return true;
  return false;
}
function setWholesaleAdminStatus(message,isError){
  const el=document.getElementById('wholesale-admin-status');
  if(!el) return;
  el.textContent=message||'';
  el.style.color=isError?'var(--danger)':'var(--text-secondary)';
}
function getWholesaleAdminPhoneE164(){
  const raw=String((document.getElementById('wholesale-admin-phone')||{}).value||'').trim();
  if(!raw) return '';
  const asFull=normalizePhone(raw);
  if(asFull.startsWith('+')) return asFull;
  return composeWholesaleE164FromNationalDigits(raw);
}
function renderWholesaleAdminUserList(){
  const listEl=document.getElementById('wholesale-admin-user-list');
  if(!listEl) return;
  const users=wholesaleAdminUsersCache||[];
  if(!users.length){
    listEl.innerHTML='<li class="wholesale-admin-user-item"><span class="wholesale-admin-user-meta">No authorized users yet. Add phone and email above.</span></li>';
    return;
  }
  listEl.innerHTML=users.map((u,idx)=>`
    <li class="wholesale-admin-user-item">
      <span class="wholesale-admin-user-meta"><strong>${u.phone}</strong><br>${u.email}</span>
      <button type="button" class="btn btn-secondary btn-sm" data-wholesale-remove="${idx}">Remove</button>
    </li>
  `).join('');
  listEl.querySelectorAll('[data-wholesale-remove]').forEach(btn=>{
    btn.addEventListener('click',()=>void removeWholesaleAdminUser(Number(btn.getAttribute('data-wholesale-remove'))));
  });
}
async function loadWholesaleAdminUsers(){
  await refreshWholesaleRegisteredUsers();
  wholesaleAdminUsersCache=(wholesaleRegisteredUsers||[]).slice();
  renderWholesaleAdminUserList();
  const countEl=document.getElementById('admin-wholesale-user-count');
  if(countEl) countEl.textContent = wholesaleAdminUsersCache.length;
  if(!firebaseStore){
    setWholesaleAdminStatus('Cloud database offline � users added here will not sync until Firebase is available.',true);
  }else{
    setWholesaleAdminStatus(`${wholesaleAdminUsersCache.length} authorized user(s) loaded.`,false);
  }
}
async function saveWholesaleAdminUsersToFirestore(users){
  if(!firebaseStore) throw new Error('Firebase is not connected. Sign in with your owner account first.');
  const normalized=(users||[]).map(normalizeWholesaleRegistryEntry).filter(Boolean);
  await firebaseStore.collection(FIRESTORE_CONFIG_COLLECTION).doc(FIRESTORE_CONFIG_DOC).set({
    wholesaleAllowedUsers:normalized,
    wholesaleAllowedUsersUpdatedAt:firebase.firestore.FieldValue.serverTimestamp(),
  },{ merge:true });
  wholesaleRegisteredUsers=normalized;
  wholesaleAdminUsersCache=normalized.slice();
  DB.set(WHOLESALE_USERS_CACHE_KEY,normalized);
  return normalized;
}
async function addWholesaleAdminUser(){
  const email=normalizeEmail((document.getElementById('wholesale-admin-email')||{}).value);
  const phone=getWholesaleAdminPhoneE164();
  if(!phone){
    setWholesaleAdminStatus('Enter a valid mobile number.',true);
    return;
  }
  if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    setWholesaleAdminStatus('Enter a valid email address.',true);
    return;
  }
  const entry=normalizeWholesaleRegistryEntry({ phone, email });
  if(!entry){
    setWholesaleAdminStatus('Could not save this user. Check phone and email format.',true);
    return;
  }
  await refreshWholesaleRegisteredUsers();
  const merged=(wholesaleRegisteredUsers||[]).slice();
  if(merged.some(u=>u.phone===entry.phone&&u.email===entry.email)){
    setWholesaleAdminStatus('This phone and email pair is already authorized.',true);
    return;
  }
  merged.push(entry);
  try{
    await saveWholesaleAdminUsersToFirestore(merged);
    renderWholesaleAdminUserList();
    const phoneEl=document.getElementById('wholesale-admin-phone');
    const emailEl=document.getElementById('wholesale-admin-email');
    if(phoneEl) phoneEl.value='';
    if(emailEl) emailEl.value='';
    setWholesaleAdminStatus('User added. They can use Wholesales login immediately.',false);
    toast('Wholesales user authorized.','success');
  }catch(err){
    console.error(err);
    setWholesaleAdminStatus(err.message||'Could not save to cloud.',true);
  }
}
async function removeWholesaleAdminUser(index){
  await refreshWholesaleRegisteredUsers();
  const merged=(wholesaleRegisteredUsers||[]).slice();
  if(index<0||index>=merged.length) return;
  merged.splice(index,1);
  try{
    await saveWholesaleAdminUsersToFirestore(merged);
    renderWholesaleAdminUserList();
    setWholesaleAdminStatus('User removed.',false);
    toast('Wholesales user removed.','success');
  }catch(err){
    console.error(err);
    setWholesaleAdminStatus(err.message||'Could not update cloud.',true);
  }
}
function getWholesaleOtpDigitInputs(){
  return Array.from(document.querySelectorAll('.wholesale-otp-digit'));
}
function syncWholesaleOtpHiddenValue(){
  const hidden=document.getElementById('wholesale-login-otp');
  if(!hidden) return;
  hidden.value=getWholesaleOtpDigitInputs().map(el=>String(el.value||'').replace(/\D/g,'')).join('');
}
function clearWholesaleOtpDigits(){
  getWholesaleOtpDigitInputs().forEach(el=>{ el.value=''; });
  syncWholesaleOtpHiddenValue();
}
function getWholesaleOtpCodeFromInputs(){
  syncWholesaleOtpHiddenValue();
  return String((document.getElementById('wholesale-login-otp')||{}).value||'').trim();
}
function focusWholesaleOtpDigit(index){
  const inputs=getWholesaleOtpDigitInputs();
  const el=inputs[Math.max(0,Math.min(index,inputs.length-1))];
  if(el){ el.focus(); el.select(); }
}
function initWholesaleOtpDigitInputs(){
  const inputs=getWholesaleOtpDigitInputs();
  inputs.forEach((input,idx)=>{
    if(input.dataset.otpBound==='1') return;
    input.dataset.otpBound='1';
    input.addEventListener('input',()=>{
      const v=String(input.value||'').replace(/\D/g,'');
      input.value=v.slice(-1);
      syncWholesaleOtpHiddenValue();
      if(v&&idx<inputs.length-1) focusWholesaleOtpDigit(idx+1);
      const code=getWholesaleOtpCodeFromInputs();
      if(code.length===inputs.length){
        void completeWholesaleEmailVerification();
      }
    });
    input.addEventListener('keydown',e=>{
      if(e.key==='Backspace'&&!input.value&&idx>0){
        focusWholesaleOtpDigit(idx-1);
      }
      if(e.key==='Enter'){
        e.preventDefault();
        void completeWholesaleEmailVerification();
      }
    });
    input.addEventListener('paste',e=>{
      e.preventDefault();
      const pasted=String((e.clipboardData||window.clipboardData)?.getData('text')||'').replace(/\D/g,'').slice(0,6);
      if(!pasted) return;
      for(let i=0;i<inputs.length;i++) inputs[i].value=pasted[i]||'';
      syncWholesaleOtpHiddenValue();
      focusWholesaleOtpDigit(Math.min(pasted.length,inputs.length-1));
      const code=getWholesaleOtpCodeFromInputs();
      if(code.length===inputs.length){
        void completeWholesaleEmailVerification();
      }
    });
  });
}
function hasWholesaleRegistryConfigured(){
  return (wholesaleRegisteredUsers||[]).length>0;
}
function findWholesaleRegisteredUser(phone,email){
  const e=normalizeEmail(email);
  const p=normalizePhone(String(phone||''));
  if(!e || !p) return null;
  const hasEmail = (wholesaleRegisteredUsers||[]).some(u=>u.email===e);
  const hasPhone = (wholesaleRegisteredUsers||[]).some(u=>wholesalePhonesMatch(u.phone,p));
  return hasEmail && hasPhone ? { phone:p, email:e } : null;
}
function generateWholesaleOtpCode(){
  return String(Math.floor(100000+Math.random()*900000));
}
function buildWholesaleVerificationEmailHtml(code){
  const brand=WHOLESALE_EMAIL_DELIVERY.brandName||'Good Luck Rahman Enterprise';
  const safeCode=String(code).replace(/[^\d]/g,'');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:#0f1419;font-family:Segoe UI,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#1a2332;border-radius:12px;border:1px solid rgba(245,200,66,0.35);">
<tr><td style="padding:28px 32px 12px;text-align:center;">
<div style="font-size:11px;letter-spacing:0.25em;color:#f5c842;text-transform:uppercase;">Wholesales Access</div>
<h1 style="margin:8px 0 0;font-size:22px;color:#ffffff;font-weight:600;">${brand}</h1>
</td></tr>
<tr><td style="padding:8px 32px 20px;text-align:center;color:#adb5bd;font-size:14px;line-height:1.5;">
Use this one-time verification code to open the Wholesales section. It expires in <strong style="color:#fff;">10 minutes</strong>.
</td></tr>
<tr><td style="padding:0 32px 28px;text-align:center;">
<div style="display:inline-block;padding:16px 28px;background:#0f1419;border-radius:10px;border:1px solid rgba(116,192,252,0.4);">
<span style="font-size:32px;font-weight:700;letter-spacing:10px;color:#74c0fc;font-family:Consolas,monospace;">${safeCode}</span>
</div>
</td></tr>
<tr><td style="padding:0 32px 28px;text-align:center;color:#868e96;font-size:12px;line-height:1.5;">
If you did not request this code, you can ignore this email. Only registered phone numbers and email addresses can sign in.
</td></tr>
<tr><td style="padding:16px 32px 24px;text-align:center;border-top:1px solid rgba(255,255,255,0.08);color:#495057;font-size:11px;">
&copy; ${new Date().getFullYear()} ${brand}
</td></tr>
</table></body></html>`;
}
function formatWholesaleOtpExpiryTime(expiresAtMs){
  try{
    return new Date(expiresAtMs).toLocaleString(undefined,{ dateStyle:'medium', timeStyle:'short' });
  }catch(_e){
    return new Date(expiresAtMs).toLocaleString();
  }
}
function getWholesaleOtpEmailContent(code){
  const brand=WHOLESALE_EMAIL_DELIVERY.brandName||'Good Luck Rahman Enterprise';
  const expiresAt=Date.now()+WHOLESALE_OTP_TTL_MS;
  const expiryLabel=formatWholesaleOtpExpiryTime(expiresAt);
  return {
    subject:`${brand} � Wholesales login code`,
    text:`Your Wholesales login code is ${code}. It expires at ${expiryLabel}. If you did not request this, ignore this email.`,
    html:buildWholesaleVerificationEmailHtml(code),
    expiresAt,
    expiryLabel,
  };
}
function buildEmailJsTemplateParams(toEmail,values){
  return {
    email: toEmail,
    to_email: toEmail,
    user_email: toEmail,
    subject: values.subject,
    passcode: values.code,
    time: values.expiryLabel,
    company_name: values.brand,
    website_link: values.websiteLink || '#',
    link: typeof values.link !== 'undefined' ? values.link : values.websiteLink || '#',
    logo_url: values.logoUrl || values.websiteLink || '',
    message: values.text || '',
    html_message: values.html || ''
  };
}
function requireWholesaleRegisteredUser(phone,email,errEl){
  if(!findWholesaleRegisteredUser(phone,email)){
    if(errEl) errEl.textContent=MSG_WHOLESALE_NOT_REGISTERED;
    return false;
  }
  return true;
}
function getWholesaleEmailJsTemplateParams(toEmail,code){
  const brand=WHOLESALE_EMAIL_DELIVERY.brandName||'Good Luck Rahman Enterprise';
  const { subject, text, html, expiryLabel }=getWholesaleOtpEmailContent(code);
  const websiteLink=String(WHOLESALE_EMAIL_DELIVERY.websiteLink||'').trim();
  return buildEmailJsTemplateParams(toEmail,{subject,code,expiryLabel,brand,websiteLink,text,html});
}
async function sendWholesaleOtpViaFirebaseTriggerEmail(toEmail,code){
  if(!firebaseStore) throw new Error('Firebase Firestore is not available.');
  const col=WHOLESALE_EMAIL_DELIVERY.firebaseMailCollection||'mail';
  const { subject, text, html }=getWholesaleOtpEmailContent(code);
  await firebaseStore.collection(col).add({
    to:[toEmail],
    message:{ subject, text, html },
  });
}
async function sendEmailJs(templateParams,cfg){
  const controller=typeof AbortController!=='undefined'?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),WHOLESALE_EMAIL_FETCH_MS):null;
  let res;
  try{
    res=await fetch('https://api.emailjs.com/api/v1.0/email/send',{
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      signal:controller?.signal,
      body:JSON.stringify({
        service_id:cfg.serviceId,
        template_id:cfg.templateId,
        user_id:cfg.publicKey,
        template_params:templateParams,
      }),
    });
  }finally{
    if(timer) clearTimeout(timer);
  }
  if(!res.ok){
    const detail=await res.text().catch(()=>'');
    throw new Error(detail||'EmailJS delivery failed');
  }
}
async function sendWholesaleOtpViaEmailJS(toEmail,code){
  if(!isWholesaleEmailJsReady()){
    throw new Error('EmailJS is not configured.');
  }
  const cfg=WHOLESALE_EMAIL_DELIVERY.emailjs||{};
  await sendEmailJs(getWholesaleEmailJsTemplateParams(toEmail,code),cfg);
}
function getPasswordResetEmailContent(code){
  const brand=PASSWORD_RESET_EMAIL_DELIVERY.brandName||'Good Luck Rahman Enterprise';
  const expiresAt=Date.now()+10*60*1000;
  const expiryLabel=formatWholesaleOtpExpiryTime(expiresAt);
  const safeCode=String(code).replace(/[^\d]/g,'');
  return {
    subject:`${brand} � Password reset code`,
    text:`Your ${brand} password reset code is ${safeCode}. It expires at ${expiryLabel}. If you did not request this, ignore this email.`,
    html:`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f7f8fb;font-family:Segoe UI,Arial,sans-serif;color:#333;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;padding:24px;">
<tr><td style="background:#ffffff;border-radius:16px;border:1px solid rgba(0,0,0,0.06);padding:28px;">
  <div style="font-size:13px;letter-spacing:0.16em;text-transform:uppercase;color:#6c757d;margin-bottom:12px;">Password Reset</div>
  <h1 style="margin:0 0 16px;font-size:24px;color:#111;font-weight:700;">${brand}</h1>
  <p style="margin:0 0 18px;line-height:1.6;color:#4d5761;">Use the code below to reset your account password in the app. It expires at <strong>${expiryLabel}</strong>.</p>
  <div style="display:inline-flex;padding:18px 26px;border-radius:14px;background:#f1f4ff;border:1px solid rgba(75,104,255,0.16);margin-bottom:24px;">
    <span style="font-size:34px;letter-spacing:10px;font-weight:700;color:#3341a1;font-family:Consolas,monospace;">${safeCode}</span>
  </div>
  <p style="margin:0;color:#6c757d;line-height:1.6;">If you did not request this code, you can ignore this email. Do not share the code with anyone.</p>
  <div style="margin-top:26px;font-size:12px;color:#9aa0b1;line-height:1.5;">&copy; ${new Date().getFullYear()} ${brand}</div>
</td></tr>
</table></body></html>`,
    expiryLabel,
  };
}
function getPasswordResetEmailJsTemplateParams(toEmail,code){
  const brand=PASSWORD_RESET_EMAIL_DELIVERY.brandName||'Good Luck Rahman Enterprise';
  const { subject, text, html, expiryLabel } = getPasswordResetEmailContent(code);
  const websiteLink=String(PASSWORD_RESET_EMAIL_DELIVERY.websiteLink||'').trim();
  const logoUrl=String(PASSWORD_RESET_EMAIL_DELIVERY.logoUrl||'').trim() || websiteLink;
  return buildEmailJsTemplateParams(toEmail,{subject,code,expiryLabel,brand,websiteLink,link:websiteLink,logoUrl,text,html});
}
function isPasswordResetEmailJsReady(){
  const root=PASSWORD_RESET_EMAIL_DELIVERY||{};
  if(root.enabled===false) return false;
  const cfg=root.emailjs||{};
  if(cfg.enabled===false) return false;
  return !!(cfg.publicKey&&cfg.serviceId&&cfg.templateId);
}
async function sendPasswordResetEmailViaEmailJS(toEmail,code){
  if(!isPasswordResetEmailJsReady()){
    throw new Error('EmailJS is not configured for password reset.');
  }
  const cfg=(PASSWORD_RESET_EMAIL_DELIVERY.emailjs||{});
  await sendEmailJs(getPasswordResetEmailJsTemplateParams(toEmail,code),cfg);
}
async function sendPasswordResetEmailViaFirebase(toEmail){
  if(!firebaseAuth || !isFirebaseConfigured()){
    throw new Error('Firebase is not configured for password reset.');
  }
  const actionCodeSettings={};
  const continueUrl=String(PASSWORD_RESET_EMAIL_DELIVERY.continueUrl||'').trim();
  if(continueUrl){
    actionCodeSettings.url=continueUrl;
    actionCodeSettings.handleCodeInApp=false;
  }
  return continueUrl
    ? firebaseAuth.sendPasswordResetEmail(toEmail, actionCodeSettings)
    : firebaseAuth.sendPasswordResetEmail(toEmail);
}
async function sendWholesaleOtpEmail(toEmail,code){
  const mode=WHOLESALE_EMAIL_DELIVERY.mode||'auto';
  const tryFirebase=mode==='auto'||mode==='firebase';
  const tryEmailJs=mode==='auto'||mode==='emailjs';
  const failures=[];
  if(tryEmailJs&&isWholesaleEmailJsReady()){
    try{
      await sendWholesaleOtpViaEmailJS(toEmail,code);
      return 'emailjs';
    }catch(err){
      console.warn('EmailJS failed',err);
      failures.push(err);
    }
  }
  const firebaseAllowed=mode==='firebase'||WHOLESALE_EMAIL_DELIVERY.firebaseEnabled===true;
  if(tryFirebase&&firebaseAllowed&&isFirebaseConfigured()&&firebaseStore){
    try{
      await sendWholesaleOtpViaFirebaseTriggerEmail(toEmail,code);
      return 'firebase';
    }catch(err){
      console.warn('Firebase Trigger Email failed',err);
      failures.push(err);
    }
  }
  if(mode==='dev'||mode==='auto'){
    console.info('[Wholesale dev OTP]',toEmail,code);
    toast('Development mode: your verification code is '+code,'warning');
    return 'dev';
  }
  throw failures[0]||new Error('No email provider configured.');
}
async function beginWholesaleEmailVerification(){
  const errEl=document.getElementById('wholesale-login-error');
  const sendBtn=document.getElementById('wholesale-send-email-btn');
  if(errEl) errEl.textContent='';
  loadWholesaleRegisteredUsersSync();
  void refreshWholesaleRegisteredUsers({ network:navigator.onLine!==false });
  if(!hasWholesaleRegistryConfigured()){
    if(errEl) errEl.textContent=MSG_WHOLESALE_NOT_ACTIVATED;
    console.warn('Wholesale registry: add users in Profile ? Wholesales authorized users.');
    return;
  }
  const { phone, email }=getWholesaleLoginCredentials();
  if(!phone){
    if(errEl) errEl.textContent='Enter your registered mobile number.';
    return;
  }
  if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    if(errEl) errEl.textContent='Enter your registered email address.';
    return;
  }
  if(!requireWholesaleRegisteredUser(phone,email,errEl)) return;
  if(wholesaleEmailSendInFlight) return;
  const now=Date.now();
  if(wholesalePendingOtpSession
    &&wholesalePendingOtpSession.phone===phone
    &&wholesalePendingOtpSession.email===email
    &&now-wholesalePendingOtpSession.sentAt<WHOLESALE_OTP_RESEND_MS){
    if(errEl) errEl.textContent='Please wait a moment before requesting another code.';
    return;
  }
  wholesaleEmailSendInFlight=true;
  if(sendBtn){
    sendBtn.disabled=true;
    sendBtn.textContent='Sending�';
  }
  try{
    const code=generateWholesaleOtpCode();
    const provider=await sendWholesaleOtpEmail(email,code);
    wholesalePendingOtpSession={
      phone,
      email,
      code,
      sentAt:Date.now(),
      expiresAt:Date.now()+WHOLESALE_OTP_TTL_MS,
    };
    setWholesaleCodeSectionVisible(true);
    clearWholesaleOtpDigits();
    focusWholesaleOtpDigit(0);
    const sentMsg=provider==='dev'
      ? (navigator.onLine===false
        ? 'Offline: your code is in the yellow toast above.'
        : 'Email could not be sent � your code is in the yellow toast above.')
      : 'Verification code sent to your registered email.';
    toast(sentMsg,provider==='dev'?'warning':'success');
  }catch(err){
    console.error(err);
    if(errEl) errEl.textContent='We could not send the email. Set up free EmailJS (emailjs.com) or Firebase Trigger Email � see WHOLESALE_EMAIL_DELIVERY in script.js.';
  }finally{
    wholesaleEmailSendInFlight=false;
    if(sendBtn){
      sendBtn.disabled=false;
      sendBtn.textContent=wholesalePendingOtpSession?'RESEND CODE':'SEND CODE';
    }
  }
}
async function completeWholesaleEmailVerification(){
  const errEl=document.getElementById('wholesale-login-error');
  const verifyBtn=document.getElementById('wholesale-verify-btn');
  if(errEl) errEl.textContent='';
  loadWholesaleRegisteredUsersSync();
  const session=wholesalePendingOtpSession;
  if(!session){
    if(errEl) errEl.textContent='Request a verification code first.';
    return;
  }
  const code=getWholesaleOtpCodeFromInputs();
  if(!/^\d{6}$/.test(code)){
    if(errEl) errEl.textContent='Enter the 6-digit code from your email.';
    return;
  }
  const { phone, email }=getWholesaleLoginCredentials();
  if(phone!==session.phone||email!==session.email){
    if(errEl) errEl.textContent=MSG_WHOLESALE_NOT_REGISTERED;
    return;
  }
  if(!requireWholesaleRegisteredUser(phone,email,errEl)) return;
  if(Date.now()>session.expiresAt){
    wholesalePendingOtpSession=null;
    if(errEl) errEl.textContent='Code expired. Request a new verification code.';
    return;
  }
  if(code!==session.code){
    if(errEl) errEl.textContent='Incorrect verification code.';
    return;
  }
  if(verifyBtn){
    verifyBtn.disabled=true;
    verifyBtn.textContent='Logging in�';
  }
  try{
    DB.set(WHOLESALE_ACCESS_KEY,{ phone, email, verifiedAt:new Date().toISOString() });
    setOwnerPhone(phone);
    wholesalePendingOtpSession=null;
    document.getElementById('login-error').textContent='';
    openWholesaleFromWelcome();
    toast('Wholesales access verified.','success');
  }finally{
    if(verifyBtn){
      verifyBtn.disabled=false;
      verifyBtn.textContent='LOG IN';
    }
  }
}
function shouldUsePinMode(){
  if(isExplicitLogout()) return false;
  const p=getPrimaryAccountEmail();
  if(!p) return false;
  return !!(DB.getScoped(OWNER_PROFILE_KEY, p) && DB.getScoped(OWNER_PIN_KEY, p));
}
function setLoginMode(mode){
  if(lastLoginOverlayMode==='wholesalePhone' && mode!=='wholesalePhone'){
    wholesalePendingOtpSession=null;
  }
  lastLoginOverlayMode=mode;
  const welcome=document.getElementById('login-welcome-mode');
  const login=document.getElementById('login-mode');
  const adminLogin=document.getElementById('login-admin-mode');
  const register=document.getElementById('register-mode');
  const pin=document.getElementById('pin-login-mode');
  const forgotPassword=document.getElementById('forgot-password-mode');
  const forgotPin=document.getElementById('forgot-pin-mode');
  const wholesalePhoneMode=document.getElementById('login-wholesale-phone-mode');
  const backButton=document.getElementById('login-back-button');
  if(welcome) welcome.style.display = mode === 'welcome' ? 'block' : 'none';
  if(login) login.style.display = mode === 'login' ? 'block' : 'none';
  if(adminLogin) adminLogin.style.display = mode === 'adminLogin' ? 'block' : 'none';
  if(register) register.style.display = mode === 'register' ? 'block' : 'none';
  if(pin) pin.style.display = mode === 'pin' ? 'block' : 'none';
  if(forgotPassword) forgotPassword.style.display = mode === 'forgotPassword' ? 'block' : 'none';
  if(forgotPin) forgotPin.style.display = mode === 'forgotPin' ? 'block' : 'none';
  if(wholesalePhoneMode) wholesalePhoneMode.style.display = mode === 'wholesalePhone' ? 'block' : 'none';
  if(backButton) backButton.style.display = mode === 'login' || mode === 'register' || mode === 'adminLogin' ? 'inline-flex' : 'none';
  if(mode !== 'welcome') hideAdminSecretButton();
  const otpSection=document.getElementById('login-otp-section');
  if(otpSection) otpSection.style.display = 'none';
  const codeHint=document.getElementById('login-code-hint');
  if(codeHint) codeHint.style.display='none';
  const errorEl=document.getElementById('login-error');
  if(errorEl) errorEl.textContent='';
  const adminErrorEl=document.getElementById('admin-login-error');
  if(adminErrorEl) { adminErrorEl.textContent=''; adminErrorEl.style.display='none'; }
  const authEmailInput=document.getElementById('auth-email');
  const authPasswordInput=document.getElementById('auth-password');
  if(authEmailInput) authEmailInput.value='';
  if(authPasswordInput) authPasswordInput.value='';
  const adminEmailInput=document.getElementById('admin-auth-email');
  const adminPasswordInput=document.getElementById('admin-auth-password');
  if(adminEmailInput) adminEmailInput.value='';
  if(adminPasswordInput) adminPasswordInput.value='';
  resetAuthButtons();
  if(mode !== 'forgotPassword'){
    resetForgotPasswordForm();
  }
  if(mode==='wholesalePhone'){
    resetWholesaleLoginForm();
    loadWholesaleRegisteredUsersSync();
    void refreshWholesaleRegisteredUsers({ network:navigator.onLine!==false });
  }
}
function resetAuthButtons(){
  const loginButton=document.getElementById('login-submit-btn');
  const registerButton=document.getElementById('register-submit-btn');
  const adminLoginButton=document.getElementById('admin-login-submit-btn');
  if(loginButton){ loginButton.disabled=false; loginButton.textContent='?? LOGIN'; }
  if(registerButton){ registerButton.disabled=false; registerButton.textContent='?? CREATE ACCOUNT'; }
  if(adminLoginButton){ adminLoginButton.disabled=false; adminLoginButton.textContent='?? ADMIN LOGIN'; }
}
function initLoginScreen(){
  resetAuthButtons();
  
  // Initialize connection monitoring on login screen
  updateConnectionStatusUI(lastNetworkOnline !== false);
  
  // Check connection status every 3 seconds while on login screen
  const connectionCheckInterval = setInterval(() => {
    const overlayVisible = document.getElementById('login-overlay')?.style.display !== 'none';
    if(!overlayVisible){
      clearInterval(connectionCheckInterval);
      // Clean up the status bar if we leave login screen
      const statusBar = document.getElementById('connection-status-bar');
      if(statusBar) statusBar.remove();
    } else {
      checkAndUpdateConnectionStatus();
    }
  }, 3000);
  
  // Also listen for online/offline events for instant feedback
  window.addEventListener('online', () => {
    updateConnectionStatusUI(true);
    toast('? Internet connection restored', 'success');
  });
  
  window.addEventListener('offline', () => {
    updateConnectionStatusUI(false);
    toast('? Internet connection lost', 'warning');
  });
  
  if(shouldUsePinMode()){
    setLoginMode('pin');
  } else {
    setLoginMode('welcome');
  }
}
async function showAppAndInit(nextPanel='dashboard'){
  // Clean up connection status bar before showing main app
  const statusBar = document.getElementById('connection-status-bar');
  if(statusBar) statusBar.remove();
  
  document.getElementById('login-overlay').style.display='none';
  document.getElementById('app').style.display='flex';
  await new Promise(requestAnimationFrame);
  if(navigator.onLine){
    await firebaseReadyPromise;
    await ensureCloudAccountForLocalUser();
    attachRemoteFirestoreListener(getCurrentUser());
  }
  initApp();
  if(nextPanel){
    showPanel(nextPanel);
  }
}
function switchLoginMode(mode){
  resetAuthButtons();
  setExplicitLogout(true);
  if(mode === 'login' || mode === 'register'){
    firebaseSignOut().catch(()=>{});
    setCurrentAccount('');
  }
  if(mode === 'register'){
    pendingRegistrationPhoto = null;
    ['auth-register-ownername','auth-register-phone'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.value='';
    });
    const registerPreview=document.getElementById('register-photo-preview');
    const registerPlaceholder=document.querySelector('#register-photo-preview-wrapper .photo-placeholder');
    if(registerPreview){ registerPreview.src=''; registerPreview.style.display='none'; }
    if(registerPlaceholder){ registerPlaceholder.style.display='block'; }
    const codeHint=document.getElementById('login-code-hint');
    if(codeHint) codeHint.style.display='none';
  }
  setLoginMode(mode);
}
function isFirebaseConfigured(){
  return !!(firebaseAuth && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.authDomain && FIREBASE_CONFIG.projectId);
}
function getPrimaryAccountEmail(){
  const session=normalizeAccountId(getCurrentAccount());
  if(session) return session;
  return normalizeAccountId((DB.get(LAST_PROFILE_EMAIL_KEY)||'').toString());
}
function getRegisteredEmail(){
  const primary=getPrimaryAccountEmail();
  const profile=primary?getOwnerProfileData(primary):getOwnerProfileData();
  return ((profile.email||primary||'').toString()).toLowerCase().trim();
}
function showForgotPasswordRequestForm(){
  const requestForm=document.getElementById('forgot-password-request-form');
  const sentPanel=document.getElementById('forgot-password-sent');
  const codeRow=document.getElementById('forgot-password-code-row');
  const continueButton=document.getElementById('forgot-password-continue-btn');
  const note=document.getElementById('forgot-password-note');
  if(requestForm) requestForm.style.display='block';
  if(sentPanel) sentPanel.style.display='none';
  if(codeRow) codeRow.style.display='none';
  if(continueButton) continueButton.style.display='none';
  if(note) note.textContent='Enter your registered email address to receive reset instructions.';
}
function showForgotPasswordSentState(message, allowContinue, localCode){
  const requestForm=document.getElementById('forgot-password-request-form');
  const sentPanel=document.getElementById('forgot-password-sent');
  const sentMessage=document.querySelector('#forgot-password-sent .sent-message');
  const sentCode=document.getElementById('forgot-password-sent-code');
  const continueButton=document.getElementById('forgot-password-continue-btn');
  const codeRow=document.getElementById('forgot-password-code-row');
  const note=document.getElementById('forgot-password-note');
  if(requestForm) requestForm.style.display='none';
  if(sentPanel) sentPanel.style.display='block';
  if(sentMessage) sentMessage.textContent = message || 'Reset code has been sent to your email.';
  if(sentCode){
    if(localCode){
      sentCode.style.display='block';
      sentCode.textContent = 'Local recovery code: ' + localCode + ' (use this code in the next step).';
    } else {
      sentCode.style.display='none';
      sentCode.textContent = '';
    }
  }
  if(continueButton) continueButton.style.display = allowContinue ? 'inline-flex' : 'none';
  if(codeRow) codeRow.style.display='none';
  if(note) note.textContent = '';
}
function showForgotPasswordCodeEntry(){
  const sentPanel=document.getElementById('forgot-password-sent');
  const codeRow=document.getElementById('forgot-password-code-row');
  if(sentPanel) sentPanel.style.display='none';
  if(codeRow) codeRow.style.display='block';
}
function resetForgotPasswordForm(){
  showForgotPasswordRequestForm();
  const fields=['forgot-email','forgot-password-code','forgot-password-new'];
  fields.forEach(id=>{const el=document.getElementById(id); if(el) el.value='';});
}
async function doPasswordResetRequest(){
  const email=(document.getElementById('forgot-email')||{}).value?.trim();
  const errorEl=document.getElementById('login-error');
  if(!email){
    if(errorEl) errorEl.textContent='Enter your registered email to reset your password.';
    return;
  }
  if(email.toLowerCase() !== getRegisteredEmail()){
    if(errorEl) errorEl.textContent='This email does not match the registered account.';
    return;
  }
  if(errorEl) errorEl.textContent='';
  if(isFirebaseConfigured() && firebaseAuth){
    try{
      await sendPasswordResetEmailViaFirebase(email);
      showForgotPasswordSentState('A Firebase password reset email has been sent. Follow the instructions in your inbox to update your Firebase password.', false);
      return;
    }catch(err){
      console.error('Firebase password reset failed:', err);
      if(errorEl) errorEl.textContent='Unable to send Firebase password reset email. Please try again later.';
      return;
    }
  }
  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  DB.set('glr_password_reset_code', resetCode);
  DB.set('glr_password_reset_email', email.toLowerCase());
  try{
    await sendPasswordResetEmailViaEmailJS(email, resetCode);
    showForgotPasswordSentState('A password reset code has been sent to your registered email. Continue to reset your password.', true);
  }catch(err){
    console.error('Password reset email delivery failed:', err);
    showForgotPasswordSentState('Password reset code generated. Email delivery failed; use the code below to reset your password.', true, resetCode);
  }
}
async function doCompletePasswordReset(){
  const email=(document.getElementById('forgot-email')||{}).value?.trim();
  const code=(document.getElementById('forgot-password-code')||{}).value?.trim();
  const newPassword=(document.getElementById('forgot-password-new')||{}).value?.trim();
  const errorEl=document.getElementById('login-error');
  if(!email||!code||!newPassword){
    if(errorEl) errorEl.textContent='Please enter email, recovery code and a new password.';
    return;
  }
  const storedEmail=(DB.get('glr_password_reset_email')||'').toLowerCase().trim();
  const storedCode=(DB.get('glr_password_reset_code')||'').toString();
  if(email.toLowerCase() !== storedEmail){
    if(errorEl) errorEl.textContent='Email does not match the recovery request.';
    return;
  }
  if(code !== storedCode){
    if(errorEl) errorEl.textContent='Recovery code is incorrect.';
    return;
  }
  if(newPassword.length < 6){
    if(errorEl) errorEl.textContent='Password must be at least 6 characters.';
    return;
  }
  await setUserPassword(newPassword, email.toLowerCase());
  if(isFirebaseConfigured() && firebaseAuth && firebaseAuth.currentUser && firebaseAuth.currentUser.email.toLowerCase() === email.toLowerCase()){
    try{
      await firebaseAuth.currentUser.updatePassword(newPassword);
      toast('Password updated in Firebase and locally. You can now log in.','success');
    }catch(err){
      console.warn('Firebase password update failed during code reset:', err);
      toast('Password reset locally. Please follow the Firebase reset email link to update the password in Firebase.','warning');
    }
  } else if(isFirebaseConfigured()){
    toast('Password reset locally. If Firebase manages this account, use the reset email link sent to your inbox to update the Firebase password.','info');
  } else {
    toast('Password reset successfully. You can now log in.', 'success');
  }
  DB.delete('glr_password_reset_code');
  DB.delete('glr_password_reset_email');
  if(errorEl) errorEl.textContent='';
  switchLoginMode('login');
}
async function doResetPin(){
  const email=(document.getElementById('forgot-pin-email')||{}).value?.trim();
  const password=(document.getElementById('forgot-pin-password')||{}).value?.trim();
  const newPin=(document.getElementById('forgot-pin-new')||{}).value?.trim();
  const errorEl=document.getElementById('login-error');
  if(!email||!password||!newPin){
    if(errorEl) errorEl.textContent='Enter email, password and a new PIN.';
    return;
  }
  if(email.toLowerCase() !== getRegisteredEmail()){
    if(errorEl) errorEl.textContent='Email does not match the registered account.';
    return;
  }
  if(newPin.length < 4){
    if(errorEl) errorEl.textContent='PIN must be at least 4 digits.';
    return;
  }
  if(isFirebaseConfigured()){
    try{
      justLoggedIn=true;
      await firebaseSignIn(email,password);
      setOwnerPin(newPin);
      toast('PIN reset successfully. You are now signed in.', 'success');
      return;
    }catch(err){
      let message = 'Unable to verify password. Please try again.';
      const code = err?.code || '';
      if(code === 'auth/wrong-password'){
        message = 'Password is incorrect. Please try again.';
      } else if(code === 'auth/invalid-email'){
        message = 'Please enter a valid email address.';
      } else if(code === 'auth/user-not-found'){
        message = 'No account found with that email. Please register first.';
      } else if(code === 'auth/network-request-failed' || /network|offline|timeout/i.test(err?.message||'')){
        message = 'Unable to verify password because of a network issue. Check your connection and try again.';
      }
      if(errorEl) errorEl.textContent = message;
      return;
    }
  }
  if(!await localAuthenticate(email,password)){
    if(errorEl) errorEl.textContent='Email or password is incorrect.';
    return;
  }
  setOwnerPin(newPin);
  if(errorEl) errorEl.textContent='';
  toast('PIN has been reset successfully. Use your new PIN to unlock.', 'success');
  setLoginMode('pin');
}
async function doUnlock(){
  const pin=(document.getElementById('auth-pin')||{}).value?.trim();
  const errorEl=document.getElementById('login-error');
  if(!pin){
    if(errorEl) errorEl.textContent='Enter your PIN to unlock.';
    return;
  }
  if(pin === getOwnerPin()){
    if(errorEl) errorEl.textContent='';
    const primary=getPrimaryAccountEmail();
    if(primary) setCurrentAccount(primary);
    setExplicitLogout(false);
    await showAppAndInit();
    return;
  }
  if(errorEl) errorEl.textContent='Incorrect PIN. Please try again.';
}

let firebaseApp=null;
let firebaseAuth=null;
let firebaseStore=null;
let firebaseStorage=null;
let authUser=null;
let ownerEmailConfig=null;
let adminLoginVerified=false;
let adminSecretClickCount=0;
let adminSecretTimer=null;
const ADMIN_EMAIL='abduldeenkamara06@gmail.com';
const ADMIN_PASSWORD='10737';
const AUTO_SYNC_INTERVAL_MS=800;
let syncRetryCountOnline=0;  // Track retry attempts
let remoteDataUnsubscribe=null;
let lastRemoteSnapshotHash='';
let lastLocalFirestoreWriteAt=0;
let remoteListenerInitialSnapshot=true;
let firebaseReadyPromise = Promise.resolve();

async function initFirebase(){
  if(firebaseApp||!window.firebase||!firebase.initializeApp) return;
  if(!FIREBASE_CONFIG.apiKey||!FIREBASE_CONFIG.authDomain||!FIREBASE_CONFIG.projectId) return;
  firebaseApp=firebase.initializeApp(FIREBASE_CONFIG);
  firebaseAuth=firebase.auth();
  try{
    firebaseAuth.useDeviceLanguage();
    void firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});
  }catch(_e){}
  firebaseStore=firebase.firestore();
  firebaseStorage=firebase.storage();
  if(firebaseStore && typeof firebaseStore.enablePersistence === 'function'){
    firebaseStore.enablePersistence({ synchronizeTabs:true }).catch((err)=>{
      console.warn('Firestore persistence not enabled:', err);
    });
  }
  loadWholesaleRegisteredUsersSync();
  void refreshWholesaleEmailDeliveryFromFirestore();
  void refreshWholesaleRegisteredUsers({ network:true });
  firebaseAuth.onAuthStateChanged(async (user)=>{
    authUser=user;
    if(user){
      await handleUserSignedIn(user);
    } else {
      // If auth state disappeared unexpectedly (not an explicit logout), require recovery
      if(getCurrentAccount() && !isExplicitLogout()){
        handleAuthFailure(new Error('Authentication state lost'));
      }
    }
  });
  // Validate stored session at startup
  void startupAuthValidation();
  if(navigator.onLine){
    await ensureCloudAccountForLocalUser();
    attachRemoteFirestoreListener(getCurrentUser());
    if(getCurrentUser()){
      await loadUserDataFromFirestore();
    }
  }
}

function showAdminSecretButton(){
  const btn=document.getElementById('admin-secret-button');
  if(btn) btn.style.display='inline-flex';
}
function hideAdminSecretButton(){
  const btn=document.getElementById('admin-secret-button');
  if(btn) btn.style.display='none';
}
function setupAdminSecretAccess(){
  const banner=document.querySelector('.login-banner');
  if(banner){
    banner.addEventListener('click',()=>{
      adminSecretClickCount++;
      if(adminSecretTimer) clearTimeout(adminSecretTimer);
      adminSecretTimer=setTimeout(()=>{ adminSecretClickCount=0; }, 5000);
      if(adminSecretClickCount >= 5){
        showAdminSecretButton();
        toast('Admin access unlocked. Click ADMIN to open the admin login.', 'success');
        adminSecretClickCount = 0;
      }
    });
  }
  window.addEventListener('keydown', e=>{
    if(e.ctrlKey && e.altKey && e.shiftKey && e.key.toLowerCase() === 'a'){
      showAdminSecretButton();
      toast('Admin access revealed. Click ADMIN to open the admin login.', 'success');
    }
  });
}

function updateAuthActions(){
  const ownerNote=document.getElementById('owner-note');
  if(ownerNote){
    ownerNote.textContent = 'Enter your email and password to continue.';
  }
}

function isAuthError(err){
  if(!err) return false;
  // Prefer explicit Firebase error codes when available
  const code = String(err.code || '').toLowerCase();
  const msg = String(err.message || err.toString() || '').toLowerCase();
  // Known Firebase auth error codes
  const authCodes = [
    'auth/invalid-user-token',
    'auth/user-token-expired',
    'auth/id-token-expired',
    'auth/session-cookie-expired',
    'auth/argument-error',
    'auth/internal-error',
    'auth/too-many-requests',
    'auth/network-request-failed',
    'auth/requires-recent-login',
    'auth/user-disabled',
    'auth/user-not-found',
    'permission-denied'
  ];
  if(code && authCodes.some(c=>code.indexOf(c)!==-1 || code===c)) return true;
  // Fallback: check message keywords
  if(msg.includes('auto-login') || msg.includes('auto login') || msg.includes('too many failed') || msg.includes('expired') || msg.includes('invalid token') || msg.includes('invalid auth') || msg.includes('permission denied')) return true;
  // Also treat generic 'auth' or 'unauth' tokens as auth issues
  if(code.startsWith('auth/') || msg.includes('auth') || msg.includes('unauth')) return true;
  return false;
}

function showSessionExpiredModal(){
  try{
    if(document.getElementById('session-expired-modal')) return;
    // Create overlay
    const overlay=document.createElement('div');
    overlay.id='session-expired-modal';
    overlay.className='session-expired-overlay';
    overlay.setAttribute('role','presentation');

    // Modal container
    const modal=document.createElement('div');
    modal.className='session-expired-modal';
    modal.setAttribute('role','alertdialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-labelledby','session-expired-title');
    modal.setAttribute('aria-describedby','session-expired-desc');

    const header=document.createElement('div'); header.className='session-expired-header';
    const title=document.createElement('div'); title.className='session-expired-title'; title.id='session-expired-title';
    title.textContent='Session Expired';
    header.appendChild(title);

    const body=document.createElement('div'); body.className='session-expired-body'; body.id='session-expired-desc';
    body.textContent = 'Your authentication session is no longer valid.\n\nTo continue using the system and resume synchronization, please sign in again.';

    const actions=document.createElement('div'); actions.className='session-expired-actions';
    const okBtn=document.createElement('button');
    okBtn.className='btn-primary';
    okBtn.type='button';
    okBtn.textContent='OK';
    okBtn.setAttribute('aria-label','Acknowledge session expired and sign in');
    okBtn.addEventListener('click', async (e)=>{
      e.preventDefault();
      try{ await enforceSignOutAndRedirect(); }catch(_e){}
    });

    actions.appendChild(okBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(actions);
    overlay.appendChild(modal);

    // Prevent clicks on overlay from closing modal and stop propagation
    overlay.addEventListener('click',(e)=>{ e.stopPropagation(); });

    // Focus management & keyboard intercept
    const keyHandler=(e)=>{
      // Prevent ESC from closing
      if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); }
      // Trap focus inside modal
      if(e.key === 'Tab'){
        const focusables = modal.querySelectorAll('button,a,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if(!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length-1];
        if(e.shiftKey){ if(document.activeElement === first){ e.preventDefault(); last.focus(); } }
        else { if(document.activeElement === last){ e.preventDefault(); first.focus(); } }
      }
    };
    overlay._keyHandler = keyHandler;
    window.addEventListener('keydown', keyHandler, true);

    document.body.appendChild(overlay);
    // trigger CSS animation
    requestAnimationFrame(()=> modal.classList.add('show'));
    // move focus to OK button
    setTimeout(()=>{ okBtn.focus(); }, 120);
  }catch(e){ console.warn('Failed to show session modal', e); }
}

function removeSessionExpiredModal(){
  const overlay=document.getElementById('session-expired-modal');
  if(!overlay) return;
  try{
    if(overlay._keyHandler) window.removeEventListener('keydown', overlay._keyHandler, true);
    const modal = overlay.querySelector('.session-expired-modal');
    if(modal){ modal.classList.remove('show'); }
    // let animation play then remove
    setTimeout(()=>{ try{ overlay.remove(); }catch(_e){} }, 200);
  }catch(e){ try{ overlay.remove(); }catch(_e){} }
}

// Production logger: stores events locally and optionally posts to a remote endpoint.
function prodLogEvent(eventName, payload){
  try{
    const logsKey='glr_event_logs';
    const queueKey='glr_event_logs_queue';
    const logs = DB.get(logsKey) || [];
    const entry = { id:'L-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6), ts: new Date().toISOString(), event: eventName, payload };
    logs.push(entry);
    // keep last 1000 entries
    if(logs.length>1000) logs.splice(0, logs.length-1000);
    DB.set(logsKey, logs);
    // console for immediate visibility
    console.log('[EVENT]', eventName, payload);

    // enqueue for remote posting
    try{
      const q = DB.get(queueKey) || [];
      q.push({ ...entry, attempts:0, nextAttemptAt: Date.now() });
      DB.set(queueKey, q);
      scheduleLogFlush();
      if(navigator.onLine) flushEventLogs().catch(()=>{});
    }catch(_e){ /* non-fatal */ }
  }catch(e){ console.warn('prodLogEvent failed', e); }
}

function getRemoteLogUrl(){
  return (window.GLr && window.GLr.LOG_SERVER_URL) || (DB.get('glr_log_server_url')||'').trim();
}

async function flushEventLogs(){
  const remote = getRemoteLogUrl();
  if(!remote || !navigator.onLine) return;
  const queueKey='glr_event_logs_queue';
  const q = DB.get(queueKey) || [];
  if(!Array.isArray(q) || q.length===0) return;
  const now = Date.now();
  // pick up to 10 entries that are due
  const due = q.filter(item=> (item.nextAttemptAt||0) <= now).slice(0,10);
  if(due.length===0) return;
  for(const item of due){
    try{
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(()=>controller.abort(), 10000) : null;
      const res = await fetch(remote, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(item), signal:controller?.signal });
      if(timeoutId) clearTimeout(timeoutId);
      if(res && res.ok){
        // remove from queue
        const cur = DB.get(queueKey) || [];
        const remaining = cur.filter(x=>x.id !== item.id);
        DB.set(queueKey, remaining);
        // mark sent time in logs (optional)
        const logsKey='glr_event_logs';
        const logs = DB.get(logsKey) || [];
        const l = logs.find(lo=>lo.id===item.id);
        if(l) l.sentAt = new Date().toISOString();
        DB.set(logsKey, logs);
        prodLogEvent('__internal_log_sent', { id: item.id });
      } else {
        throw new Error('HTTP '+(res?res.status:'unknown'));
      }
    }catch(e){
      // update attempt count and schedule next attempt with exponential backoff
      const cur = DB.get(queueKey) || [];
      const idx = cur.findIndex(x=>x.id===item.id);
      if(idx===-1) continue;
      const attempts = (cur[idx].attempts||0) + 1;
      const backoff = Math.min(60*1000 * Math.pow(2, attempts), 24*60*60*1000); // cap 24h
      cur[idx].attempts = attempts;
      cur[idx].nextAttemptAt = Date.now() + backoff;
      DB.set(queueKey, cur);
    }
    // small delay between posts
    await new Promise(r=>setTimeout(r, 120));
  }
}

function scheduleLogFlush(){
  if(logFlushTimer) return;
  logFlushTimer = setInterval(()=>{
    if(!navigator.onLine) return;
    flushEventLogs().catch(()=>{});
  }, 10000);
}

function stopLogFlush(){
  if(logFlushTimer){ clearInterval(logFlushTimer); logFlushTimer=null; }
}

function handleAuthFailure(err){
  console.error('Authentication failure detected', err);
  console.log('Authentication failure detected');
  sessionRecoveryRequired=true;
  prodLogEvent('auth_failure_detected', { error: String(err?.code||err?.message||err) });
  showSessionExpiredModal();
}

async function enforceSignOutAndRedirect(){
  try{
    console.log('Session invalidated');
    prodLogEvent('session_invalidated', { reason: 'user_ok_or_auto' });
    // Pause sync
    sessionRecoveryRequired=true;
    syncInProgress=false;
    if(syncDebounceTimer) { clearTimeout(syncDebounceTimer); syncDebounceTimer=null; }
    stopOfflineSyncRetry();
    if(syncIntervalTimer){ clearInterval(syncIntervalTimer); syncIntervalTimer=null; }
    // detach listeners
    try{ detachRemoteFirestoreListener(); }catch(_e){}
    // sign out from firebase
    try{ await firebaseSignOut(); }catch(_e){ console.warn('Firebase signOut error',_e); }
    // clear cached local password to force full login
    const normalized = normalizeAccountId(getCurrentUser()?.email || getCurrentAccount());
    if(normalized){ DB.deleteScoped(USER_PASSWORD_KEY, normalized); }
    setExplicitLogout(true);
    // Clear any auth-related local flags
    try{ DB.delete('glr_auth_token'); }catch(_e){}
    // Remove modal
    removeSessionExpiredModal();
    prodLogEvent('user_logged_out_automatic', { account: getCurrentAccount() });
    console.log('User logged out automatically');
    // Redirect to login overlay (skip PIN)
    const overlay=document.getElementById('login-overlay');
    if(overlay) overlay.style.display='flex';
    setLoginMode('login');
    // Hide main app
    const appEl=document.getElementById('app'); if(appEl) appEl.style.display='none';
    prodLogEvent('redirected_to_login', { account: getCurrentAccount() });
    console.log('Redirected to Login Page');
  }catch(e){ console.error('Error during enforced sign out', e); }
}

function clearSessionRecovery(){
  sessionRecoveryRequired=false;
  removeSessionExpiredModal();
  // resume auto sync loop
  startAutoSyncLoop();
}

// Expose a demo helper to simulate auth failures for testing
function simulateAuthFailure(code, message){
  const err = new Error(message || 'Simulated auth failure');
  if(code) err.code = code;
  handleAuthFailure(err);
}
window.simulateAuthFailure = simulateAuthFailure;
window.prodLogEvent = prodLogEvent;

async function startupAuthValidation(){
  try{
    if(!firebaseAuth) return;
    const user = firebaseAuth.currentUser;
    if(!user){
      // If local account data exists but no firebase user, force login
      if(getCurrentAccount()){
        handleAuthFailure(new Error('No authenticated user at startup'));
      }
      return;
    }
    // If online, try to refresh token to validate session
    if(navigator.onLine){
      try{
        await user.getIdToken(true);
        // token ok
      }catch(e){
        if(isAuthError(e)) handleAuthFailure(e);
      }
    } else {
      // offline: try to get cached token; if that fails, require re-auth
      try{
        await user.getIdToken();
      }catch(e){
        handleAuthFailure(e);
      }
    }
  }catch(e){ console.warn('startupAuthValidation failed', e); }
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
  return true;
}

async function canSignInWithEmail(email){
  return true;
}

function getCurrentUser(){
  if(firebaseAuth) return firebaseAuth.currentUser;
  return authUser;
}

async function handleUserSignedIn(user){
  // Clear any session-recovery state when a valid user signs in
  try{ clearSessionRecovery(); }catch(_e){}
  
  const runFirestoreRestore=async()=>{
    try{
      await loadUserDataFromFirestore();
      attachRemoteFirestoreListener(user);
    }catch(e){
      console.error('Firestore load failed',e);
      const overlay=document.getElementById('login-overlay');
      const el=document.getElementById('login-error');
      if(el && overlay && overlay.style.display!=='none'){
        el.textContent=e.message||'Unable to restore cloud data.';
      }
      toast('Signed in, but cloud restore failed.','warning');
    }
  };
  try{
    console.log('Authentication restored after login');
    const normalized=user?.email?.toLowerCase().trim();
    if(normalized){
      const profile=getOwnerProfileData(normalized);
      const fullName=user.displayName || profile.name || '';
      const photo=user.photoURL || profile.photo || '';
      saveOwnerProfile(normalized, fullName, profile.contact, photo, 'email');
      if(photo) DB.setScoped('owner_photo', photo, normalized);
      if(!DB.getScoped(OWNER_PIN_KEY, normalized)) setOwnerPin('9252', normalized);
    }
    setExplicitLogout(false);
    document.getElementById('login-error').textContent='';
    if(lastLoginOverlayMode === 'adminLogin' && !adminLoginVerified){
      // Prevent automatic auth state restoration from interrupting an admin login attempt.
      return;
    }
    if(!justLoggedIn && shouldUsePinMode()){
      justLoggedIn=false;
      setLoginMode('pin');
      document.getElementById('login-overlay').style.display='flex';
      document.getElementById('app').style.display='none';
      void runFirestoreRestore();
      return;
    }
    justLoggedIn=false;
    document.getElementById('login-overlay').style.display='none';
    document.getElementById('app').style.display='flex';
    await new Promise(requestAnimationFrame);
    initApp();
    showPanel('dashboard');
    void runFirestoreRestore();
  }catch(e){
    console.error(e);
    const el=document.getElementById('login-error');
    if(el) el.textContent=e.message||'Unable to complete sign-in.';
    toast('Sign-in failed.','warning');
  }
}

async function saveUserDataToFirestore(){
  if(sessionRecoveryRequired){
    console.warn('Blocked Firestore write: sessionRecoveryRequired');
    throw new Error('Session invalid - write blocked');
  }
  const user=getCurrentUser();
  if(!user||!firebaseStore) return;
  const normalized=normalizeAccountId(user.email);
  const profile=getOwnerProfileData(normalized);
  const existingPin = DB.getScoped(OWNER_PIN_KEY, normalized);
  if(existingPin){
    profile.pin = existingPin;
  }
  const existingPassword = DB.getScoped(USER_PASSWORD_KEY, normalized);
  if(existingPassword){
    profile.passwordHash = isPasswordHash(existingPassword)
      ? existingPassword
      : await hashPasswordForStorage(existingPassword);
  }
  const docRef=firebaseStore.collection('users').doc(user.uid);
  await docRef.set({
    email:user.email,
    updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
    sales:DB.getSales(),
    inventory:DB.getInventory(),
    audit:DB.getAudit(),
    profile,
    syncQueue:DB.getSyncQueue(),
    syncState:DB.getSyncState(),
  },{merge:true});
  lastLocalFirestoreWriteAt = Date.now();
}

async function loadUserDataFromFirestore(){
  const user=getCurrentUser();
  if(!user||!firebaseStore) return;
  const normalized=normalizeAccountId(user.email);
  const doc=await firebaseStore.collection('users').doc(user.uid).get();
  if(!doc.exists) return;
  const data=doc.data();
  const queue=DB.getSyncQueue();
  const pendingSaleIds=getPendingIdsForOpTypes(['upsert_sale','delete_sale']);
  const pendingInventoryIds=getPendingIdsForOpTypes(['upsert_inventory','delete_inventory']);
  const pendingAuditIds=getPendingIdsForOpTypes(['append_audit']);
  if(data.sales) DB.setSales(mergeRemoteRecords(DB.getSales(), data.sales, pendingSaleIds, true));
  if(data.inventory){
    DB.setInventory(mergeRemoteRecords(DB.getInventory(), data.inventory, pendingInventoryIds, true));
    renderInventory();
    populateProductDropdown();
  }
  if(data.audit) DB.setAudit(mergeRemoteRecords(DB.getAudit(), data.audit, pendingAuditIds, true));
  if(data.profile && !queue.some(item=>item.op==='update_profile' || item.op==='update_owner_photo')){
    DB.setScoped(OWNER_PROFILE_KEY, data.profile, normalized);
  }
  if(data.profile?.pin){
    setOwnerPin(data.profile.pin, normalized);
  }
  if(data.pin){
    setOwnerPin(data.pin, normalized);
  }
  if(data.profile?.passwordHash){
    DB.setScoped(USER_PASSWORD_KEY, data.profile.passwordHash, normalized);
  }
  if(data.syncState){
    DB.setSyncState(data.syncState, normalized);
  }
  const prunedQueue = pruneRemoteSyncQueue(data);
  if(prunedQueue.length !== queue.length){
    const updatedPendingSaleIds=getPendingIdsForOpTypes(['upsert_sale','delete_sale']);
    const updatedPendingInventoryIds=getPendingIdsForOpTypes(['upsert_inventory','delete_inventory']);
    const updatedPendingAuditIds=getPendingIdsForOpTypes(['append_audit']);
    if(data.sales){
      DB.setSales(mergeRemoteRecords(DB.getSales(), data.sales, updatedPendingSaleIds, true));
    }
    if(data.inventory){
      DB.setInventory(mergeRemoteRecords(DB.getInventory(), data.inventory, updatedPendingInventoryIds, true));
    }
    if(data.audit){
      DB.setAudit(mergeRemoteRecords(DB.getAudit(), data.audit, updatedPendingAuditIds, true));
    }
  }
  refreshSyncBadge();
  renderOwnerProfile();
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
  if(remoteDataUnsubscribe){
    try{ remoteDataUnsubscribe(); }catch(_e){}
    remoteDataUnsubscribe=null;
    lastRemoteSnapshotHash='';
  }
  if(firebaseAuth) return firebaseAuth.signOut();
}

function detachRemoteFirestoreListener(){
  if(typeof remoteDataUnsubscribe === 'function'){
    try{ remoteDataUnsubscribe(); }catch(_e){}
  }
  remoteDataUnsubscribe = null;
  lastRemoteSnapshotHash = '';
}

function attachRemoteFirestoreListener(user){
  if(!firebaseStore || !user || !navigator.onLine || typeof firebaseStore.collection !== 'function') return;
  detachRemoteFirestoreListener();
  remoteListenerInitialSnapshot = true;
  lastRemoteSnapshotHash = '';
  try{
    const docRef = firebaseStore.collection('users').doc(user.uid);
    remoteDataUnsubscribe = docRef.onSnapshot({ includeMetadataChanges: true }, async (snapshot)=>{
      if(!snapshot.exists) return;
      // Process snapshots even if they include pending local writes. mergeRemoteFirestoreSnapshotData
      // will avoid clobbering pending local changes by using the sync queue and pending IDs.
      const data = snapshot.data();
      if(!data) return;
      const hash = JSON.stringify({
        sales:data.sales||[],
        inventory:data.inventory||[],
        audit:data.audit||[],
        profile:data.profile||{},
        syncState:data.syncState||{},
      });
      if(hash === lastRemoteSnapshotHash) return;
      lastRemoteSnapshotHash = hash;
      const isInitial = remoteListenerInitialSnapshot;
      remoteListenerInitialSnapshot = false;
      const isRecentLocalWrite = Date.now() - lastLocalFirestoreWriteAt < 4000;
      await mergeRemoteFirestoreSnapshotData(data, isInitial || isRecentLocalWrite, isRecentLocalWrite);
    }, (err)=>{
      if(isAuthError(err)){
        handleAuthFailure(err);
      } else {
        console.warn('Firestore realtime listener error:', err);
      }
    });
  }catch(err){
    console.warn('Failed to attach Firestore listener:', err);
  }
}

async function mergeRemoteFirestoreSnapshotData(data, isInitialSnapshot=false, suppressNotification=false){
  const user=getCurrentUser();
  const normalized=normalizeAccountId(user?.email || getCurrentAccount());
  const queue=DB.getSyncQueue();
  const pendingSaleIds=getPendingIdsForOpTypes(['upsert_sale','delete_sale']);
  const pendingInventoryIds=getPendingIdsForOpTypes(['upsert_inventory','delete_inventory']);
  const pendingAuditIds=getPendingIdsForOpTypes(['append_audit']);
  let changed=false;
  const currentSales=DB.getSales();
  const currentInventory=DB.getInventory();
  const currentAudit=DB.getAudit();
  if(Array.isArray(data.sales)){
    const merged=mergeRemoteRecords(currentSales, data.sales, pendingSaleIds, true);
    if(JSON.stringify(merged) !== JSON.stringify(currentSales)){
      DB.setSales(merged);
      changed=true;
    }
  }
  if(Array.isArray(data.inventory)){
    const merged=mergeRemoteRecords(currentInventory, data.inventory, pendingInventoryIds, true);
    if(JSON.stringify(merged) !== JSON.stringify(currentInventory)){
      DB.setInventory(merged, normalized);
      changed=true;
      renderInventory();
      populateProductDropdown();
    }
  }
  if(Array.isArray(data.audit)){
    const merged=mergeRemoteRecords(currentAudit, data.audit, pendingAuditIds, true);
    if(JSON.stringify(merged) !== JSON.stringify(currentAudit)){
      DB.setAudit(merged);
      changed=true;
    }
  }
  const hasPendingProfileUpdate = queue.some(item=>item.op==='update_profile' || item.op==='update_owner_photo');
  if(data.profile && !hasPendingProfileUpdate){
    DB.setScoped(OWNER_PROFILE_KEY, data.profile, normalized);
    changed=true;
    renderOwnerProfile();
  }
  if(data.profile?.pin){
    setOwnerPin(data.profile.pin, normalized);
    changed=true;
  }
  if(data.pin){
    setOwnerPin(data.pin, normalized);
    changed=true;
  }
  if(data.syncState){
    DB.setSyncState(data.syncState, normalized);
    changed=true;
  }
  const prunedQueue = pruneRemoteSyncQueue(data);
  if(prunedQueue.length !== queue.length){
    changed=true;
    const updatedPendingSaleIds=getPendingIdsForOpTypes(['upsert_sale','delete_sale']);
    const updatedPendingInventoryIds=getPendingIdsForOpTypes(['upsert_inventory','delete_inventory']);
    const updatedPendingAuditIds=getPendingIdsForOpTypes(['append_audit']);
    if(Array.isArray(data.sales)){
      const merged=mergeRemoteRecords(DB.getSales(), data.sales, updatedPendingSaleIds, true);
      if(JSON.stringify(merged) !== JSON.stringify(DB.getSales())){
        DB.setSales(merged);
      }
    }
    if(Array.isArray(data.inventory)){
      const merged=mergeRemoteRecords(DB.getInventory(), data.inventory, updatedPendingInventoryIds, true);
      if(JSON.stringify(merged) !== JSON.stringify(DB.getInventory())){
        DB.setInventory(merged, normalized);
        renderInventory();
        populateProductDropdown();
      }
    }
    if(Array.isArray(data.audit)){
      const merged=mergeRemoteRecords(DB.getAudit(), data.audit, updatedPendingAuditIds, true);
      if(JSON.stringify(merged) !== JSON.stringify(DB.getAudit())){
        DB.setAudit(merged);
      }
    }
  }
  if(changed){
    refreshSyncBadge();
    renderDashboard();
    renderSessionTable();
    renderRecords();
    if(!isInitialSnapshot && !suppressNotification){
      // Only notify when the remote snapshot was last synced by a different device.
      let remoteDevice = null;
      try{
        remoteDevice = (data && data.syncState && data.syncState.lastSyncedDevice) || data.deviceId || null;
      }catch(_e){ remoteDevice = null; }
      const localDevice = getDeviceId();
      const showNotification = remoteDevice ? (remoteDevice !== localDevice) : true;
      if(showNotification) toast('Cloud updates received from another device.','success');
    }
  }
}

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
    syncDebounceTimer=setTimeout(()=>syncToCloud(true),250);
  }
}

function getPendingIdsForOpTypes(types){
  const ids=new Set();
  const queue=DB.getSyncQueue();
  for(const item of queue){
    if(!types.includes(item.op) || !item.payload) continue;
    const id=item.payload.auditId || item.payload.id;
    if(id) ids.add(id);
  }
  return ids;
}

function pruneRemoteSyncQueue(remoteData){
  const queue=DB.getSyncQueue();
  if(!queue.length) return queue;
  const salesMap=new Map((remoteData.sales||[]).map(item=>[item?.id, item]));
  const inventoryMap=new Map((remoteData.inventory||[]).map(item=>[item?.id, item]));
  const auditMap=new Map((remoteData.audit||[]).map(item=>[item?.id || item?.auditId, item]));
  const profileData = remoteData.profile || {};
  const normalized = normalizeAccountId(getCurrentUser()?.email || getCurrentAccount());

  const cleaned = queue.filter(item=>{
    if(!item || !item.op || !item.payload) return true;
    const payload=item.payload;
    switch(item.op){
      case 'upsert_sale':{
        const remoteSale = salesMap.get(payload.id);
        if(!remoteSale) return true;
        return !areRecordsEqual(payload, remoteSale, ['synced']);
      }
      case 'delete_sale':{
        const remoteSale = salesMap.get(payload.id);
        return !!remoteSale;
      }
      case 'upsert_inventory':{
        const remoteItem = inventoryMap.get(payload.id);
        if(!remoteItem) return true;
        return !areRecordsEqual(payload, remoteItem, ['synced','syncStatus']);
      }
      case 'delete_inventory':{
        const remoteItem = inventoryMap.get(payload.id);
        return !!remoteItem;
      }
      case 'append_audit':{
        const remoteAudit = auditMap.get(payload.auditId || payload.id);
        return !remoteAudit;
      }
      case 'update_profile':{
        const localPhoto = payload.imageData || payload.photo || '';
        const comparablePayload = {
          ...payload,
          photo: localPhoto,
        };
        return !areRecordsEqual(comparablePayload, profileData, [
          'synced',
          'syncStatus',
          'updatedAt',
          'createdAt',
          'authProvider',
          'passwordHash',
          'pin',
        ]);
      }
      case 'update_owner_photo':{
        const localPhoto = payload.imageData || payload.photo || '';
        return (profileData.photo || '') !== localPhoto;
      }
      default:
        return true;
    }
  });
  if(cleaned.length !== queue.length){
    DB.setSyncQueue(cleaned);
  }
  return cleaned;
}

function areRecordsEqual(a,b,ignoreKeys=[]){
  if(a===b) return true;
  if(typeof a !== 'object' || typeof b !== 'object' || a===null || b===null) return a===b;
  const keys=new Set([...Object.keys(a||{}), ...Object.keys(b||{})]);
  for(const key of keys){
    if(ignoreKeys.includes(key)) continue;
    const va=a[key];
    const vb=b[key];
    if(typeof va === 'object' && typeof vb === 'object'){
      if(!areRecordsEqual(va,vb,ignoreKeys)) return false;
    } else if(va !== vb) {
      return false;
    }
  }
  return true;
}

function getRecordSyncKey(record){
  if(!record || typeof record !== 'object') return undefined;
  return record.id || record.auditId;
}

function mergeRemoteRecords(localRecords, remoteRecords, pendingIds, markRemoteSynced=false){
  const merged=[];
  const remoteMap=new Map((remoteRecords||[]).map(item=>[getRecordSyncKey(item), item]));
  for(const record of localRecords||[]){
    const key = getRecordSyncKey(record);
    if(key && pendingIds.has(key)){
      merged.push(record);
      remoteMap.delete(key);
    }
  }
  for(const record of remoteRecords||[]){
    const key = getRecordSyncKey(record);
    if(!key) continue;
    if(pendingIds.has(key)) continue;
    if(markRemoteSynced && typeof record === 'object'){
      merged.push({ ...record, synced: true, syncStatus: 'synced' });
    } else {
      merged.push(record);
    }
  }
  return merged;
}

function computePendingSyncCount(){
  const pendingIds = new Set();
  const queue = DB.getSyncQueue();
  for(const item of queue||[]){
    if(!item || !item.op || !item.payload) continue;
    const payload = item.payload;
    switch(item.op){
      case 'upsert_sale':
      case 'delete_sale':
      case 'upsert_inventory':
      case 'delete_inventory':
        if(payload.id) pendingIds.add(`${item.op}:${payload.id}`);
        break;
      case 'append_audit':
        if(payload.auditId) pendingIds.add(`audit:${payload.auditId}`);
        else if(payload.id) pendingIds.add(`audit:${payload.id}`);
        break;
      case 'update_profile':
        pendingIds.add('update_profile');
        break;
      case 'update_owner_photo':
        pendingIds.add('update_owner_photo');
        break;
      default:
        if(payload.id) pendingIds.add(`${item.op}:${payload.id}`);
    }
  }
  for(const sale of DB.getSales().filter(s=>!s.synced||s.syncStatus==='pending')){
    if(sale && sale.id) pendingIds.add(`upsert_sale:${sale.id}`);
  }
  for(const item of DB.getInventory().filter(i=>!i.synced||i.syncStatus==='pending')){
    if(item && item.id) pendingIds.add(`upsert_inventory:${item.id}`);
  }
  for(const audit of DB.getAudit().filter(a=>!a.synced||a.syncStatus==='pending')){
    if(audit && audit.auditId) pendingIds.add(`audit:${audit.auditId}`);
    else if(audit && audit.id) pendingIds.add(`audit:${audit.id}`);
  }
  return pendingIds.size;
}

function debugPendingSyncState(){
  const queue = DB.getSyncQueue();
  const unsyncedSales = DB.getSales().filter(s=>!s.synced||s.syncStatus==='pending');
  const unsyncedInventory = DB.getInventory().filter(i=>!i.synced||i.syncStatus==='pending');
  const unsyncedAudit = DB.getAudit().filter(a=>!a.synced||a.syncStatus==='pending');
  const result = {
    pendingCount: computePendingSyncCount(),
    queueLength: queue.length,
    queue: queue.map(item=>({ id:item?.id, op:item?.op, payload:item?.payload, at:item?.at })),
    unsyncedSalesCount: unsyncedSales.length,
    unsyncedInventoryCount: unsyncedInventory.length,
    unsyncedAuditCount: unsyncedAudit.length,
    unsyncedSales: unsyncedSales.slice(0,20),
    unsyncedInventory: unsyncedInventory.slice(0,20),
    unsyncedAudit: unsyncedAudit.slice(0,20),
    syncState: DB.getSyncState(),
  };
  console.group('Debug Pending Sync State');
  console.log(result);
  console.groupEnd();
  return result;
}

window.debugPendingSyncState = debugPendingSyncState;

function refreshSyncBadge(){
  const badge=document.getElementById('pending-sync-badge');
  if(!badge)return;
  if(syncInProgress){
    badge.textContent='Syncing...';
    badge.className='badge badge-pending';
    return;
  }
  const pending = computePendingSyncCount();
  if(pending){
    badge.textContent=`${pending} pending`;
    badge.className='badge badge-pending';
  } else {
    badge.textContent='Synced';
    badge.className='badge badge-synced';
  }
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

async function completeLocalAuthentication(email){
  justLoggedIn=true;
  setCurrentAccount(email);
  setExplicitLogout(false);
  await showAppAndInit();
}

/**
 * Test actual internet connectivity by attempting a lightweight connection.
 * More reliable than navigator.onLine which can be misleading.
 * @returns {Promise<boolean>} true if internet is available
 */
async function testInternetConnectivity(){
  try {
    // Try a simple HEAD request to a reliable CDN endpoint
    // Using a no-cache query parameter to prevent cached responses
    const response = await Promise.race([
      fetch('https://www.gstatic.com/generate_204', { 
        method: 'HEAD', 
        cache: 'no-store',
        mode: 'no-cors' 
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 5000)
      )
    ]);
    return true;
  } catch(err){
    return false;
  }
}

/**
 * Show connection status indicator on the login screen.
 * @param {boolean} isOnline - whether device has internet connection
 */
function updateConnectionStatusUI(isOnline){
  const overlay = document.getElementById('login-overlay');
  if(!overlay) return;
  
  let statusEl = document.getElementById('connection-status-bar');
  
  if(isOnline){
    if(statusEl){
      statusEl.remove();
    }
    lastNetworkOnline = true;
  } else {
    if(!statusEl){
      statusEl = document.createElement('div');
      statusEl.id = 'connection-status-bar';
      statusEl.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(90deg, #ff6b6b 0%, #ff4757 100%);
        color: white;
        padding: 0.75rem 1rem;
        text-align: center;
        font-weight: 600;
        font-size: 0.95rem;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      `;
      statusEl.innerHTML = `
        <span style="font-size:1rem;">??</span>
        <span>Offline mode � email login is unavailable. Use PIN unlock.</span>
      `;
      document.body.insertBefore(statusEl, document.body.firstChild);
    }
    lastNetworkOnline = false;
  }
}

/**
 * Check connection status and update UI.
 * Call this periodically to monitor connectivity changes.
 */
async function checkAndUpdateConnectionStatus(){
  const isOnline = await testInternetConnectivity();
  if(isOnline !== lastNetworkOnline){
    updateConnectionStatusUI(isOnline);
    
    // Show toast notification of status change
    if(isOnline){
      toast('? Internet connection restored', 'success');
    } else {
      toast('? Internet connection lost', 'warning');
    }
  }
}

async function doLogin(){
  const email=(document.getElementById('auth-email')||{}).value?.trim();
  const password=(document.getElementById('auth-password')||{}).value?.trim();
  const el=document.getElementById('login-error');
  const loginButton=document.getElementById('login-submit-btn');
  const originalText = loginButton?.textContent || 'LOG IN';
  
  if(!email||!password){
    el.textContent='Please enter email and password.';
    return;
  }
  
  if(loginButton){
    loginButton.disabled=true;
    loginButton.textContent='Logging in...';
  }
  
  await new Promise(requestAnimationFrame);
  const profile=getOwnerProfileData();
  const isRegisteredEmail = profile.email.toLowerCase()===email.toLowerCase();
  // Enforce online Firebase authentication for email/password logins.
  // When offline, email logins are disabled � use PIN unlock instead.
  if(!navigator.onLine || !firebaseAuth || !isFirebaseConfigured()){
    el.innerHTML = `
      <div style="display:flex; align-items:center; gap:0.5rem;">
        <span style="font-size:1.2rem;">??</span>
        <div>
          <strong>Offline</strong>
          <br>
          <small>Email/password login requires an internet connection. Use PIN unlock to access the app while offline.</small>
        </div>
      </div>
    `;
    if(loginButton){ loginButton.disabled=false; loginButton.textContent=originalText; }
    return;
  }

  try{
    justLoggedIn=true;
    await firebaseSignIn(email,password);
    setCurrentAccount(email);
    await setUserPassword(password, email);
    await saveUserDataToFirestore();
    return;
  }catch(err){
      console.error(err);
      // Do not fall back to local authentication for email logins.
      let message = 'Login failed. Please check your email and password.';
      if(err?.code === 'auth/wrong-password'){
        message = 'Incorrect password. Please try again.';
      } else if(err?.code === 'auth/invalid-email'){
        message = 'Please enter a valid email address.';
      } else if(err?.code === 'auth/user-not-found' || err?.code === 'auth/invalid-login-credentials'){
        message = isRegisteredEmail ? 'Account deleted or incorrect password. Please register a new account or verify your credentials.' : 'No account found with that email. Please register or check your email.';
      } else if(err?.code === 'auth/network-request-failed' || /network|offline|timeout/i.test(err?.message||'')){
        // Double-check: if we get a network error, inform user to check connection
        const recheck = await testInternetConnectivity();
        if(!recheck){
          message = '?? Internet connection lost. Unable to verify your credentials. Please check your connection and try again.';
        } else {
          message = 'Unable to reach the authentication server. This may be a temporary issue. Please try again.';
        }
      }
      el.textContent = message;
      if(loginButton){ loginButton.disabled=false; loginButton.textContent=originalText; }
      return;
    }
  
  if(localAuth){
    // Local password-based logins are no longer accepted.
    el.textContent = 'Email/password login is not available offline. Use PIN unlock.';
    if(loginButton){ loginButton.disabled=false; loginButton.textContent=originalText; }
    return;
  }
  
  el.textContent = isRegisteredEmail ? 'Incorrect password. Please try again.' : 'Incorrect email or password. Please try again.';
  if(loginButton){ loginButton.disabled=false; loginButton.textContent=originalText; }
}

async function doAdminLogin(){
  const email=(document.getElementById('admin-auth-email')||{}).value?.trim();
  const password=(document.getElementById('admin-auth-password')||{}).value?.trim();
  const errorEl=document.getElementById('admin-login-error');
  const loginButton=document.getElementById('admin-login-submit-btn');
  const originalText = loginButton?.textContent || '?? ADMIN LOGIN';
  if(!email||!password){
    if(errorEl){ errorEl.textContent='Enter admin email and password.'; errorEl.style.display='block'; }
    return;
  }
  if(loginButton){ loginButton.disabled=true; loginButton.textContent='Verifying...'; }
  await new Promise(requestAnimationFrame);
  if(email.toLowerCase() === ADMIN_EMAIL.toLowerCase() && password === ADMIN_PASSWORD){
    adminLoginVerified=true;
    if(errorEl){ errorEl.textContent=''; errorEl.style.display='none'; }
    await showAppAndInit('admin');
    return;
  }
  if(errorEl){ errorEl.textContent='Invalid admin login credentials.'; errorEl.style.display='block'; }
  if(loginButton){ loginButton.disabled=false; loginButton.textContent=originalText; }
}
async function localAuthenticate(email,password){
  const profile=getOwnerProfileData(email);
  if(profile.email.toLowerCase()!==email.toLowerCase()) return false;
  const storedPassword=getUserPassword(email);
  if(isPasswordHash(storedPassword)){
    return await hashPasswordForStorage(password)===storedPassword;
  }
  return password===storedPassword;
}

function buildSmsMessage(code){
  return `Your Good Luck Rahman Enterprise business code is ${code}. It expires in 10 minutes.`;
}

async function saveLocalRegistration(email, ownerName, contact, password, pin, photo){
  setCurrentAccount(email);
  saveOwnerProfile(email, ownerName, contact, photo, 'local');
  await setUserPassword(password, email);
  if(pin) setOwnerPin(pin, email);
  DB.setSales([], email);
  DB.setAudit([], email);
  if(!DB.getInventory().length){
    setDefaultInventory();
  }
  setExplicitLogout(false);
  await showAppAndInit('dashboard');
  try{
    await saveUserDataToFirestore();
    toast('Account created and synced to Firebase.','success');
  }catch(err){
    console.error('Failed to sync account to Firebase:', err);
    toast('Account created locally. It will sync to Firebase when internet returns.','warning');
  }
}

function isFirebaseNetworkError(err){
  if(!err) return false;
  return !navigator.onLine || err?.code === 'auth/network-request-failed' || /network|offline/i.test(err?.message||'');
}

async function doRegister(){
  const firstName=(document.getElementById('auth-register-firstname')||{}).value?.trim();
  const lastName=(document.getElementById('auth-register-lastname')||{}).value?.trim();
  const email=(document.getElementById('auth-register-email')||{}).value?.trim();
  const password=(document.getElementById('auth-register-password')||{}).value?.trim();
  const pin=(document.getElementById('auth-register-pin')||{}).value?.trim();
  const contact=(document.getElementById('auth-register-contact')||{}).value?.trim();
  const ownerName=[firstName,lastName].filter(Boolean).join(' ');
  const el=document.getElementById('login-error');
  const registerButton=document.getElementById('register-submit-btn');
  const originalText = registerButton?.textContent || 'CREATE ACCOUNT';
  if(!firstName||!lastName||!contact||!email||!password||!pin){
    el.textContent='Please complete all registration fields.';
    return;
  }
  if(password.length < 6){
    el.textContent='Password must be at least 6 characters.';
    return;
  }
  if(!/^[0-9]{4}$/.test(pin)){
    el.textContent='PIN must be exactly 4 digits.';
    return;
  }
  if(registerButton){
    registerButton.disabled=true;
    registerButton.textContent='Creating account...';
  }
  await new Promise(requestAnimationFrame);
  const photo=pendingRegistrationPhoto || '';
  const existing=DB.getScoped(OWNER_PROFILE_KEY, email);
  if(existing && existing.email){
    el.textContent='A user is already registered. Please log in.';
    if(registerButton){ registerButton.disabled=false; registerButton.textContent=originalText; }
    return;
  }

  // Enforce online Firebase registration. Do not create local-only accounts.
  if(!firebaseAuth || !navigator.onLine || !isFirebaseConfigured()){
    el.textContent = 'Registration requires an active internet connection. Please connect and try again.';
    if(registerButton){ registerButton.disabled=false; registerButton.textContent=originalText; }
    return;
  }

  try{
    justLoggedIn=true;
    const userCredential = await firebaseSignUp(email, password);
    const user = userCredential.user;
    if(user){
      // Persist locally after successful cloud registration
      await saveLocalRegistration(email, ownerName, contact, password, pin, photo);
      await saveUserDataToFirestore();
      toast('Account created and synced successfully.', 'success');
    }
  }catch(err){
    console.error('Remote registration failed:', err);
    if(err?.code === 'auth/email-already-in-use'){
      el.textContent = 'An account already exists with this email. Please log in instead.';
    } else if(err?.code === 'auth/invalid-email'){
      el.textContent = 'Invalid email address. Please correct and try again.';
    } else if(err?.code === 'auth/weak-password'){
      el.textContent = 'Password is too weak. Choose a stronger password.';
    } else if(isFirebaseNetworkError(err)){
      el.textContent = 'Network error during registration. Please check your connection and try again.';
    } else {
      el.textContent = 'Registration failed. See console for details.';
    }
    if(registerButton){ registerButton.disabled=false; registerButton.textContent=originalText; }
    return;
  }
  if(registerButton){ registerButton.disabled=false; registerButton.textContent=originalText; }
}


document.getElementById('auth-password')?.addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    const registerMode=document.getElementById('register-mode');
    if(registerMode && registerMode.style.display==='block'){
      doRegister();
    } else {
      doLogin();
    }
  }
});
document.getElementById('auth-register-password')?.addEventListener('keydown',e=>{if(e.key==='Enter')doRegister();});
document.getElementById('auth-register-pin')?.addEventListener('keydown',e=>{if(e.key==='Enter')doRegister();});
document.getElementById('auth-pin')?.addEventListener('keydown',e=>{if(e.key==='Enter')doUnlock();});
function invalidateWholesaleOtpIfCredentialsChanged(){
  if(!wholesalePendingOtpSession) return;
  wholesalePendingOtpSession=null;
  setWholesaleCodeSectionVisible(false);
  clearWholesaleOtpDigits();
  const sendBtn=document.getElementById('wholesale-send-email-btn');
  if(sendBtn && !wholesaleEmailSendInFlight) sendBtn.textContent='SEND CODE';
}
['wholesale-login-phone-local','wholesale-login-email'].forEach(id=>{
  const el=document.getElementById(id);
  el?.addEventListener('input',invalidateWholesaleOtpIfCredentialsChanged);
  el?.addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      e.preventDefault();
      void beginWholesaleEmailVerification();
    }
  });
});
initWholesaleOtpDigitInputs();

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

async function doLogout(force=false){
  try{
    await firebaseSignOut();
  }catch(_e){}
  setCurrentAccount('');
  wholesaleBrowseWithoutLogin=false;
  adminLoginVerified=false;
  DB.delete(WHOLESALE_ACCESS_KEY);
  if(!force) setExplicitLogout(true);
  profileAccessUnlocked=false;
  document.getElementById('app').style.display='none';
  document.getElementById('login-overlay').style.display='flex';
  document.getElementById('auth-pin').value='';
  const emailEl=document.getElementById('auth-email');
  const passEl=document.getElementById('auth-password');
  if(emailEl) emailEl.value='';
  if(passEl) passEl.value='';
  setLoginMode('welcome');
  initLoginScreen();
}

let toastTimer=null;
function togglePasswordVisibility(inputId, button){
  const input = document.getElementById(inputId);
  if(!input) return;
  if(input.type === 'password'){
    input.type = 'text';
    button.textContent = 'Hide';
  } else {
    input.type = 'password';
    button.textContent = 'Show';
  }
}

function toast(msg,type='',options={}){
  const scope = options.scope || 'main';
  if(currentPanelId === 'admin' && scope !== 'admin' && !options.allowInAdmin){
    return;
  }
  const el=document.getElementById('toast');
  if(!el) return;
  el.textContent=msg;
  el.className='show'+(type?' toast-'+type:'');
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{el.className='';},3500);
}

function showPanel(id){
  currentPanelId = String(id || '').trim() || currentPanelId;
  document.querySelectorAll('.panel').forEach(p=>{
    p.classList.remove('active');
    p.style.display='none';
  });
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  const panel=document.getElementById('panel-'+id);
  if(panel){
    panel.style.display='block';
    panel.classList.add('active');
  }
  // Hide or show nav bars and main-app status depending on section
  const mainNav=document.getElementById('main-nav');
  const wholesaleNav=document.getElementById('wholesale-nav');
  const profileAvatar=document.querySelector('.owner-header-avatar');
  const updateButton=document.querySelector('.btn-header');
  const syncStatus=document.querySelector('.sync-status');
  const hideHeaderExtras = id === 'wholesale' || id === 'admin';
  if(mainNav) mainNav.style.display = hideHeaderExtras ? 'none' : 'flex';
  if(wholesaleNav) wholesaleNav.style.display = id === 'wholesale' ? 'flex' : 'none';
  if(profileAvatar) profileAvatar.style.display = hideHeaderExtras ? 'none' : '';
  if(updateButton) updateButton.style.display = hideHeaderExtras ? 'none' : '';
  if(syncStatus) syncStatus.style.display = hideHeaderExtras ? 'none' : 'flex';
  if(id==='admin' && !adminLoginVerified){
    setLoginMode('adminLogin');
    return;
  }
  if(id==='admin' && !adminLoginVerified){
    setLoginMode('adminLogin');
    return;
  }
  if(id==='dashboard')renderDashboard();
  if(id==='records')renderRecords();
  if(id==='payment')renderOutstanding();
  if(id==='inventory')renderInventory();
  if(id==='audit')renderAudit();
  if(id==='profile') renderProfileSection();
  if(id==='wholesale') showWholesaleSection();
  if(id==='admin') loadAdminPanel();
}

function openWholesaleFromWelcome(){
  wholesaleBrowseWithoutLogin=true;
  updateWholesaleVisibility();
  hideAppLoader();
  const overlay=document.getElementById('login-overlay');
  const appEl=document.getElementById('app');
  if(overlay) overlay.style.display='none';
  if(appEl) appEl.style.display='flex';
  initApp();
  showWholesaleContent();
  showPanel('wholesale');
}

function updateWholesaleVisibility(){
  const wholesaleNav=document.getElementById('wholesale-nav');
  if(!wholesaleNav) return;
  const showNav=wholesaleBrowseWithoutLogin||!!getCurrentUser()||!!getRegisteredEmail();
  wholesaleNav.style.display=showNav?'flex':'none';
}

// Wholesales Panel Management
function showWholesaleSection(){
  const mainNav=document.getElementById('main-nav');
  const wholesaleNav=document.getElementById('wholesale-nav');
  if(mainNav) mainNav.style.display='none';
  if(wholesaleNav) wholesaleNav.style.display='flex';
  showWholesalePanel('dashboard');
}

function showWholesalePanel(panelName){
  // Hide all wholesale sub-panels
  document.querySelectorAll('.wholesale-sub-panel').forEach(p=>p.style.display='none');
  document.querySelectorAll('#wholesale-nav .nav-tab').forEach(t=>t.classList.remove('active'));
  
  // Show the selected panel
  const panelId=`wholesale-panel-${panelName}`;
  const panel=document.getElementById(panelId);
  if(panel){
    panel.style.display='block';
  }
  
  // Highlight the corresponding nav tab
  const navBtn=Array.from(document.querySelectorAll('#wholesale-nav .nav-tab')).find(btn=>btn.onclick?.toString().includes(`'${panelName}'`));
  if(navBtn) navBtn.classList.add('active');
  
  // Call panel-specific functions
  if(panelName==='dashboard') renderWholesaleDashboard();
}

function renderWholesaleDashboard(){
  // Render wholesale dashboard data
  // This can be extended with real data from Firebase Storage
  populateProductDropdown();
}

// Admin Login Functions
function showAdminLoginModal(){
  const modal=document.getElementById('modal-admin-login');
  if(modal){
    modal.style.display='block';
    document.getElementById('admin-login-email').value='';
    document.getElementById('admin-login-password').value='';
    document.getElementById('admin-login-error').style.display='none';
  }
}

function closeAdminLoginModal(){
  const modal=document.getElementById('modal-admin-login');
  if(modal) modal.style.display='none';
  document.getElementById('admin-login-email').value='';
  document.getElementById('admin-login-password').value='';
  document.getElementById('admin-login-error').style.display='none';
}

function verifyAdminLogin(){
  const email=(document.getElementById('admin-login-email')||{}).value?.trim();
  const password=(document.getElementById('admin-login-password')||{}).value?.trim();
  const errorEl=document.getElementById('admin-login-error');
  
  if(!email || !password){
    errorEl.textContent='Please enter both email and password.';
    errorEl.style.display='block';
    return;
  }
  
  if(email===ADMIN_EMAIL && password===ADMIN_PASSWORD){
    adminLoginVerified=true;
    closeAdminLoginModal();
    document.getElementById('login-overlay').style.display='none';
    document.getElementById('app').style.display='flex';
    currentPanelId = 'admin';
    initApp();
    showPanel('admin');
    toast('Admin access granted.','success',{scope:'admin'});
  } else {
    errorEl.textContent='Invalid admin credentials. Please check your email and password.';
    errorEl.style.display='block';
  }
}

// Firebase Storage Functions for Wholesales Data
async function uploadWholesaleData(dataType, data){
  if(!firebaseStorage || !firebaseAuth?.currentUser) return false;
  try{
    const timestamp=new Date().toISOString();
    const path=`wholesales/${getCurrentAccount()}/${dataType}/${timestamp}.json`;
    const ref=firebaseStorage.ref(path);
    const blob=new Blob([JSON.stringify(data)], {type:'application/json'});
    await ref.put(blob);
    return true;
  }catch(err){
    console.error('Error uploading to Firebase Storage:', err);
    return false;
  }
}

async function downloadWholesaleData(dataType){
  if(!firebaseStorage || !firebaseAuth?.currentUser) return null;
  try{
    const path=`wholesales/${getCurrentAccount()}/${dataType}/`;
    const ref=firebaseStorage.ref(path);
    const items=await ref.listAll();
    if(items.items.length===0) return null;
    // Get the most recent file
    const latestFile=items.items[items.items.length-1];
    const url=await latestFile.getDownloadURL();
    const response=await fetch(url);
    return await response.json();
  }catch(err){
    console.error('Error downloading from Firebase Storage:', err);
    return null;
  }
}

async function saveWholesaleSale(){
  const customer=(document.getElementById('ws-customer')||{}).value?.trim();
  const product=(document.getElementById('ws-product')||{}).value?.trim();
  const price=parseFloat((document.getElementById('ws-price')||{}).value||0);
  const qty=parseInt((document.getElementById('ws-qty')||{}).value||1);
  
  if(!customer || !product || !price || !qty){
    toast('Please fill in all fields for wholesale sale.','warning');
    return;
  }
  
  const saleData={
    id:uid(),
    type:'wholesale',
    customer,
    product,
    price,
    qty,
    total:price*qty,
    timestamp:new Date().toISOString(),
    account:getCurrentAccount(),
  };
  
  // Save to local DB
  const sales=DB.getSales();
  sales.push(saleData);
  DB.setSales(sales);
  
  // Upload to Firebase Storage
  if(firebaseAuth?.currentUser){
    await uploadWholesaleData('sales', saleData);
  }
  
  clearWholesaleSaleForm();
  toast('Wholesale sale saved and synced to Firebase Storage.','success');
}

function clearWholesaleSaleForm(){
  document.getElementById('ws-customer').value='';
  document.getElementById('ws-product').value='';
  document.getElementById('ws-price').value='';
  document.getElementById('ws-qty').value='1';
}

function uid(){
  const currentYear = new Date().getFullYear().toString().slice(-2);
  const ids = [...DB.getSales(), ...DB.getAudit()].map(item => item.id);
  let maxSerial = 0;
  let maxSerialLen = 4; // Always at least 4 digits
  // Match any INV-YY-serial, serial can be any length
  const matchRegex = new RegExp(`^INV-${currentYear}-(\\d+)$`);
  for(const id of ids){
    const match = id?.match(matchRegex);
    if(match){
      const value = parseInt(match[1], 10);
      if(value > maxSerial) maxSerial = value;
      if(match[1].length > maxSerialLen) maxSerialLen = match[1].length;
    }
  }
  // If next serial will be longer, increase padding
  const nextSerialNum = maxSerial + 1;
  const nextSerialLen = Math.max(maxSerialLen, String(nextSerialNum).length, 4);
  const nextSerial = String(nextSerialNum).padStart(nextSerialLen, '0');
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
function sortSalesByIdAscending(sales){
  return (sales||[]).slice().sort((a,b)=>{
    if(!a?.id||!b?.id) return 0;
    return a.id.localeCompare(b.id, undefined, {numeric:true, sensitivity:'base'});
  });
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
        // Determine the current account to scope the photo
        const primaryEmail = getCurrentAccount() || getPrimaryAccountEmail();
        const normalizedEmail = normalizeAccountId(primaryEmail || '');
        if(normalizedEmail){
          // Persist photo into the scoped owner profile so saveUserDataToFirestore includes it
          const profile = getOwnerProfileData(normalizedEmail);
          const fullName = profile?.name || '';
          const contact = profile?.contact || '';
          const provider = profile?.authProvider || 'local';
          // Save profile with photo (this writes to scoped storage)
          saveOwnerProfile(normalizedEmail, fullName, contact, imageData, provider);
          // Also keep a scoped owner_photo fallback key
          DB.setScoped('owner_photo', imageData, normalizedEmail);
        } else {
          // No account available: store globally as fallback
          DB.set('owner_photo', imageData);
        }
        // Sync to backend (queued op); the profile.photo above will be uploaded during sync
        queueOwnerPhotoUpdate(imageData, false);

        // If online, attempt immediate cloud sync so photo is available across devices without manual steps
        if(navigator.onLine){
          if(typeof firebaseAuth !== 'undefined' && getCurrentUser()){
            saveUserDataToFirestore().then(()=>{
              refreshSyncBadge();
              toast('Photo uploaded and synced to cloud.','success');
            }).catch(err=>{
              console.warn('Immediate profile upload failed, will retry:', err);
              scheduleOfflineSyncRetry();
              toast('Photo saved locally. Will sync automatically when network stabilizes.','warning');
            });
          } else {
            syncToCloud(false).then(()=>{
              toast('Photo uploaded and synced to cloud.','success');
            }).catch((err)=>{
              console.warn('Sync-to-cloud failed after photo upload:', err);
              toast('Photo saved locally. Will sync automatically when online.','warning');
            });
          }
        }
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
  const profile=getOwnerProfileData();
  const stored=DB.getScoped('owner_photo');
  const raw=profile.photo || stored || firstBundledOwnerPhotoPath();
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

function startupInitialize(){
  const firebaseConfigPromise = (window.electronAPI && window.electronAPI.getFirebaseConfig)
    ? window.electronAPI.getFirebaseConfig().then(config=>{
        if(config && typeof config === 'object'){
          if(config.apiKey){
            Object.assign(FIREBASE_CONFIG, config);
          } else {
            console.warn('Firebase config returned from main process is missing apiKey.', config);
          }
        }
      }).catch((err)=>{
        console.warn('Failed to load Firebase config from main process:', err);
      })
    : Promise.resolve();

  // Browser preview fallback: allow manual config injection for non-Electron runs.
  if(!FIREBASE_CONFIG.apiKey && typeof window.FIREBASE_CONFIG === 'object' && window.FIREBASE_CONFIG.apiKey){
    Object.assign(FIREBASE_CONFIG, window.FIREBASE_CONFIG);
  }

  loadOwnerPhoto();
  initLoginScreen();
  renderOwnerProfile();
  setupUpdateEventHandlers();
  setupAdminSecretAccess();
  checkForUpdatesOnStartup();
  const overlay=document.getElementById('login-overlay');
  if(overlay) overlay.style.display='flex';
  hideAppLoader();

  const firebaseScriptPromise = (typeof window.loadFirebaseCdnScripts === 'function')
    ? window.loadFirebaseCdnScripts().catch((err)=>{
        console.warn('Firebase CDN load failed:', err);
        return null;
      })
    : Promise.resolve(null);

  firebaseReadyPromise = Promise.all([firebaseScriptPromise, firebaseConfigPromise]).then(async () => {
    if(!FIREBASE_CONFIG.apiKey){
      console.warn('Firebase config not found on startup. Cloud backup will remain disabled until config is loaded.');
      if(typeof toast === 'function'){
        toast('Firebase config is missing. Run the Electron app with .env.local or add a browser config in window.FIREBASE_CONFIG.','warning');
      }
    }
    await initFirebase();
    updateAuthActions();
    await resolveOwnerEmailConfig().then(updateAuthActions).catch(()=>updateAuthActions());
  }).catch((err)=>{
    console.warn('Firebase initialization sequence failed:', err);
  });
}

if(document.readyState==='interactive' || document.readyState==='complete'){
  startupInitialize();
} else {
  document.addEventListener('DOMContentLoaded', startupInitialize);
}

// Ensure loader hides even if initialization throws earlier errors.
window.addEventListener('load', ()=>{
  try{
    hideAppLoader();
    const overlay=document.getElementById('login-overlay');
    if(overlay && overlay.style.display==='none') overlay.style.display='flex';
  }catch(_e){}
});

// Fallback: force hide app loader after a short timeout so users aren't stuck on a spinner
setTimeout(()=>{
  try{
    const loader=document.getElementById('app-loader');
    if(loader && loader.style.display!== 'none'){
      console.warn('Forcing hideAppLoader fallback');
      hideAppLoader();
      const overlay=document.getElementById('login-overlay');
      if(overlay) overlay.style.display='flex';
    }
  }catch(_e){}
}, 2500);

window.addEventListener('error', function(event){
  hideAppLoader();
  const overlay=document.getElementById('login-overlay');
  if(overlay) overlay.style.display='flex';
  const errEl=document.getElementById('login-error');
  if(errEl) errEl.textContent='App failed to start: '+(event?.message||'Unknown error');
});
window.addEventListener('unhandledrejection', function(event){
  hideAppLoader();
  const overlay=document.getElementById('login-overlay');
  if(overlay) overlay.style.display='flex';
  const errEl=document.getElementById('login-error');
  if(errEl) errEl.textContent='App error: '+(event?.reason?.message||String(event?.reason)||'Unknown promise error');
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

function populateAuditReasonFilter(){
  const sel=document.getElementById('audit-reason-filter');
  if(!sel) return;
  const merged=[...SALE_DELETE_REASONS,...INVENTORY_DELETE_REASONS];
  const unique=[...new Set(merged)];
  sel.innerHTML='<option value="">All Reasons</option>'+unique.map(r=>`<option value="${r.replace(/"/g,'&quot;')}">${r}</option>`).join('');
}

function checkNet(){
  const online=navigator.onLine;
  document.getElementById('net-dot').className='sync-dot'+(online?' online':'');
  document.getElementById('net-label').textContent=online?'Online':'Offline (local only)';
  if(lastNetworkOnline !== null && online !== lastNetworkOnline){
    if(online){
      toast('Back online. Local changes will sync now.','success');
    } else {
      toast('Offline mode active. Data is saved locally and will sync when you reconnect.','warning');
    }
  }
  lastNetworkOnline = online;
  refreshSyncBadge();
  return online;
}
async function ensureCloudAccountForLocalUser(){
  await firebaseReadyPromise;
  if(!navigator.onLine || !firebaseAuth || !isFirebaseConfigured()) return false;
  if(getCurrentUser()) return true;
  const primary=getPrimaryAccountEmail();
  const profile=primary?getOwnerProfileData(primary):getOwnerProfileData();
  if(!profile.email) return false;
  const password=getUserPassword(profile.email);
  if(!password) return false;
  try{
    await firebaseSignIn(profile.email,password);
    attachRemoteFirestoreListener(getCurrentUser());
    return true;
  }catch(err){
    console.error('ensureCloudAccountForLocalUser failed for', profile.email, err);
    // Provide actionable, non-sensitive feedback to the user and logs for debugging
    if(err?.code === 'auth/user-not-found' && profile.authProvider === 'local'){
      try{
        await firebaseSignUp(profile.email,password);
        toast('Local account synced to Firebase successfully.','success');
        attachRemoteFirestoreListener(getCurrentUser());
        return true;
      }catch(signUpErr){
        console.error('Auto sign-up also failed for', profile.email, signUpErr);
        if(signUpErr?.code === 'auth/email-already-in-use'){
          toast('This email already exists in Firebase. Please sign in manually.','warning');
        } else if(isFirebaseNetworkError(signUpErr)){
          toast('Network error while syncing local account. Will retry when online.','warning');
        } else {
          toast('Unable to sync local account to Firebase. See console for details.','warning');
        }
      }
    } else if(err?.code === 'auth/wrong-password'){
      toast('Unable to sync offline data to Firebase because stored password is invalid. Please sign in manually once online.','warning');
    } else if(isFirebaseNetworkError(err)){
      toast('Network error while attempting cloud sign-in. Please check your connection.','warning');
    } else {
      toast('Unable to connect to Firebase. See console for details.','warning');
    }
    return false;
  }
}

window.addEventListener('online',async ()=>{
  checkNet();
  await ensureCloudAccountForLocalUser();
  attachRemoteFirestoreListener(getCurrentUser());
  if(getCurrentUser()){
    await loadUserDataFromFirestore();
  }
  const hasPending=computePendingSyncCount()>0;
  if(hasPending){
    toast('Internet restored! Backing up offline data...','info');
    syncToCloud(false);
  }
});
window.addEventListener('offline',()=>{
  checkNet();
  stopOfflineSyncRetry();
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible' && navigator.onLine){
    const hasPending=computePendingSyncCount()>0;
    if(hasPending){
      syncToCloud(true);
    }
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
  const sel=document.getElementById('s-product');
  const wsSel=document.getElementById('ws-product');
  const searchList=document.getElementById('s-product-list');
  const wsSearchList=document.getElementById('ws-product-list');
  const cur=sel?.value || '';
  const wsCur=wsSel?.value || '';
  const options = '<option value="">- Select Product -</option>' + inv.map((p)=>`<option value="${p.id}">${p.name}</option>`).join('');
  if(sel){ sel.innerHTML = options; if(cur && inv.some(p=>p.id===cur)) sel.value=cur; }
  if(wsSel){ wsSel.innerHTML = options; if(wsCur && inv.some(p=>p.id===wsCur)) wsSel.value=wsCur; }
  if(searchList){ searchList.innerHTML = inv.map((p)=>`<option value="${p.name}">`).join(''); }
  if(wsSearchList){ wsSearchList.innerHTML = inv.map((p)=>`<option value="${p.name}">`).join(''); }
}

function filterProductDropdown(selectId, query){
  const inv=DB.getInventory();
  const sel=document.getElementById(selectId);
  if(!sel) return;
  const normalized=(query||'').trim().toLowerCase();
  const current=sel.value;
  const filtered = inv.filter(p=>!normalized || p.name.toLowerCase().includes(normalized));
  sel.innerHTML = '<option value="">- Select Product -</option>' + filtered.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  if(current && filtered.some(p=>p.id===current)){
    sel.value=current;
  } else if(filtered.length===1){
    sel.value=filtered[0].id;
  }
  if(selectId==='s-product'){
    fillCost();
  }
}

function filterSaleProducts(){
  const query=(document.getElementById('s-product-search')||{}).value || '';
  filterProductDropdown('s-product', query);
}

function filterWholesaleProducts(){
  const query=(document.getElementById('ws-product-search')||{}).value || '';
  filterProductDropdown('ws-product', query);
}

// SALES
function normalizePhone(value){
  return (value||'').toString().replace(/[^0-9+]/g,'').trim();
}
function getOwnerPhone(){
  return normalizePhone(DB.get(OWNER_PHONE_KEY) || '');
}
function setOwnerPhone(phone){
  const normalized = normalizePhone(phone);
  if(normalized){
    DB.set(OWNER_PHONE_KEY, normalized);
  } else {
    DB.delete(OWNER_PHONE_KEY);
  }
  return normalized;
}
function showWholesaleContent(){
  // This function is called when entering wholesale section from login
  // It ensures the navigation and first panel are shown
  showWholesaleSection();
}

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
function renderTableNoData(tb,colspan,message){
  if(!tb) return;
  tb.innerHTML=`<tr><td colspan="${colspan}" style="color:var(--text-dim);text-align:center;padding:1.5rem;">${message}</td></tr>`;
}
function getSaleStatusBadge(s){
  return s.paymentType==='part'
    ? `<span class="badge ${s.status==='COMPLETED'?'badge-success':'badge-warning'}">${s.status}</span>`
    : '<span class="badge badge-info">FULL</span>';
}
function getSalePaymentTypeBadge(s){
  return `<td><span class="badge ${s.paymentType==='part'?'badge-warning':'badge-info'}">${s.paymentType==='part'?'PART':'FULL'}</span></td>`;
}
function buildSaleIdCell(s){
  return `<td><span class="sale-id-badge">${s.id}</span></td>`;
}
function buildSaleDateTimeCell(s){
  return `<td>${fmtDateTime(s.date,s.time)}</td>`;
}
function buildSaleLookupCard(s){
  return `
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
function buildPaymentSearchItem(s){
  return `
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
    </div>`;
}
function buildSaleInfoGrid(s){
  const realizedProfit = round2(s.realizedProfit || 0);
  const remainingProfit = round2((s.profit || 0) - realizedProfit);
  return `
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
}
function renderSessionTable(){
  const sales=DB.getSales().filter(s=>s.date===today());
  const tb=document.getElementById('session-table');
  if(!sales.length){renderTableNoData(tb,10,'No sales recorded today.');return;}
  tb.innerHTML=sortSalesByIdAscending(sales).map(s=>{
    const profitValue=getRecordedProfit(s);
    return `
    <tr>
      ${buildSaleIdCell(s)}
      <td><span class="datetime-badge">${dateStr(s.date)}</span></td>
      <td><span class="datetime-badge">${s.time||'-'}</span></td>
      <td>${s.customer}</td>
      <td>${s.productName}</td>
      <td>${fmt(s.totalPrice)}</td>
      <td style="color:${profitValue>=0?'var(--success)':'var(--danger)'};">${fmt(profitValue)}</td>
      ${getSalePaymentTypeBadge(s)}
      <td>${getSaleStatusBadge(s)}</td>
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
  resultEl.innerHTML=buildSaleLookupCard(s);
}
function searchPayment(){
  const q=document.getElementById('pay-search').value.trim().toLowerCase();
  const el=document.getElementById('pay-results');
  if(!q){el.innerHTML='';document.getElementById('pay-detail-card').style.display='none';return;}
  const sales=DB.getSales().filter(s=>s.balance>0&&s.customer.toLowerCase().includes(q));
  if(!sales.length){el.innerHTML='<div style="color:var(--text-dim);font-size:.88rem;padding:.5rem 0;">No outstanding records found.</div>';return;}
  el.innerHTML=sales.map(buildPaymentSearchItem).join('');
}
function selectPaySale(id){
  selectedPaySaleId=id;
  const s=DB.getSales().find(x=>x.id===id);if(!s)return;
  document.getElementById('pay-info').innerHTML=buildSaleInfoGrid(s);
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
  renderOutstanding();renderDashboard();renderRecords();toast('Payment recorded!','success');
}
function renderOutstanding(){
  const sales=DB.getSales().filter(s=>s.balance>0);
  const tb=document.getElementById('outstanding-table');
  if(!sales.length){renderTableNoData(tb,8,'No outstanding balances.');return;}
  tb.innerHTML=sales.map(s=>`
    <tr>
      ${buildSaleIdCell(s)}
      ${buildSaleDateTimeCell(s)}
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
  btn.classList.add('active');
  document.getElementById('records-card').style.display = v === 'history' ? 'none' : '';
  document.getElementById('history-panel').style.display = v === 'history' ? '' : 'none';
  document.getElementById('rec-filter-bar').style.display = v === 'history' ? 'none' : '';
  if(v === 'history') renderHistory();
  else renderRecords();
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
  if(recView==='history'){ renderHistory(); return; }
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
  if(!shown.length){renderTableNoData(tb,10,'No records for this period.');return;}
  tb.innerHTML=sortSalesByIdAscending(shown).map(s=>`
    <tr>
      ${buildSaleIdCell(s)}
      <td><span class="datetime-badge">${dateStr(s.date)}</span></td>
      <td>${s.customer}</td>
      <td>${s.productName}</td>
      <td>${fmt(s.totalPrice)}</td>
      <td>${fmt(s.paid)}</td>
      <td style="color:${s.balance>0?'var(--warning)':'var(--success)'};">${fmt(s.balance)}</td>
      <td style="color:${(s.realizedProfit||0)>=0?'var(--success)':'var(--danger)'};">${fmt(s.realizedProfit||0)}</td>
      <td>${getSaleStatusBadge(s)}</td>
      <td style="display:flex;gap:.5rem;flex-wrap:wrap;">
        <button class="btn btn-danger btn-sm" onclick="promptDelete('${s.id}')">REMOVE</button>
      </td>
    </tr>`).join('');
}

function getMonthLabel(isoMonth){
  const [year,month]=isoMonth.split('-');
  const date=new Date(`${year}-${month}-01T00:00:00`);
  return date.toLocaleString('en-GB',{month:'long'});
}
function buildHistoryGroups(sales){
  const groups={};
  for(const s of sales){
    const year=s.date.slice(0,4);
    const month=s.date.slice(0,7);
    if(!groups[year]) groups[year]={revenue:0,profit:0,qty:0,months:{}};
    const yearGroup=groups[year];
    const profitValue=getRecordedProfit(s);
    yearGroup.revenue += s.paid;
    yearGroup.profit += profitValue;
    yearGroup.qty += s.qty;
    if(!yearGroup.months[month]){
      yearGroup.months[month] = {month, label:getMonthLabel(month), revenue:0, profit:0, qty:0};
    }
    const monthGroup=yearGroup.months[month];
    monthGroup.revenue += s.paid;
    monthGroup.profit += profitValue;
    monthGroup.qty += s.qty;
  }
  return groups;
}
function renderHistory(){
  const allSales=DB.getSales();
  const groups=buildHistoryGroups(allSales);
  const years=Object.keys(groups).sort((a,b)=>b.localeCompare(a));
  const yearSelect=document.getElementById('history-year-select');
  if(!yearSelect) return;
  const selected=yearSelect.value || years[0] || '';
  yearSelect.innerHTML = years.map(y=>`<option value="${y}"${y===selected?' selected':''}>${y}</option>`).join('');
  const activeYear=selected || years[0] || '';
  const yearGroup=groups[activeYear] || {revenue:0,profit:0,qty:0,months:{}};
  document.getElementById('history-stats').innerHTML = `
    <div class="stat-card success"><div class="stat-label">Year Revenue</div><div class="stat-value">${fmt(yearGroup.revenue)}</div></div>
    <div class="stat-card success"><div class="stat-label">Year Profit</div><div class="stat-value">${fmt(yearGroup.profit)}</div></div>
    <div class="stat-card"><div class="stat-label">Qty Sold</div><div class="stat-value">${yearGroup.qty}</div></div>
    <div class="stat-card"><div class="stat-label">Months Recorded</div><div class="stat-value">${Object.keys(yearGroup.months).length}</div></div>`;
  const months=Object.values(yearGroup.months).sort((a,b)=>a.month.localeCompare(b.month));
  const tb=document.getElementById('history-table');
  if(!months.length){
    tb.innerHTML = '<tr><td colspan="4" style="color:var(--text-dim);text-align:center;padding:1.5rem;">No history records for this year.</td></tr>';
    return;
  }
  tb.innerHTML = months.map(m=>`
    <tr>
      <td>${m.label}</td>
      <td>${fmt(m.revenue)}</td>
      <td style="color:${m.profit>=0?'var(--success)':'var(--danger)'};">${fmt(m.profit)}</td>
      <td>${m.qty}</td>
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
    renderTableNoData(tb,8,'No records found for deletion.');
    return;
  }
  tb.innerHTML=sortSalesByIdAscending(sales).map(s=>`
    <tr>
      ${buildSaleIdCell(s)}
      ${buildSaleDateTimeCell(s)}
      <td>${s.customer}</td>
      <td>${s.productName}</td>
      <td>${s.qty}</td>
      <td>${fmt(s.totalPrice)}</td>
      <td>${getSaleStatusBadge(s)}</td>
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
  if(!recent.length){renderTableNoData(tb,7,'No transactions yet.');return;}
  tb.innerHTML=recent.map(s=>{
    const profitValue=getRecordedProfit(s);
    return `
    <tr>
      ${buildSaleIdCell(s)}
      ${buildSaleDateTimeCell(s)}
      <td>${s.customer}</td>
      <td>${s.productName}</td>
      <td>${fmt(s.totalPrice)}</td>
      <td style="color:${profitValue>=0?'var(--success)':'var(--danger)'};">${fmt(profitValue)}</td>
      <td>${getSaleStatusBadge(s)}</td>
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
    closeModal('modal-delete');renderInventory();populateProductDropdown();renderDashboard();renderRecords();renderSessionTable();renderOutstanding();renderAudit();
    toast(`Product removed. ${affectedCount} related sale(s) archived.`,'success');
  } else {
    const sales=DB.getSales();const i=sales.findIndex(s=>s.id===id);if(i<0)return;
    const sale=sales[i];
    const saleAudit={...sale,auditId:makeAuditId(),auditType:'sale-removed',auditEntityType:'sale',auditReason:reason,auditNotes:notes,auditDate:archivedAt,auditDateDisplay:archivedAtDisplay};
    audit.push(saleAudit);
    queueSync('append_audit',saleAudit);
    queueSync('delete_sale',{id:sale.id});
    DB.setAudit(audit);sales.splice(i,1);DB.setSales(sales);
    closeModal('modal-delete');renderRecords();renderDashboard();renderSessionTable();renderOutstanding();renderAudit();
    toast('Record archived to Audit Log.','success');
  }
}

// AUDIT LOG
function getAuditEntryDate(entry){
  return entry.auditDateDisplay||new Date(entry.auditDate).toLocaleString('en-GB');
}
function buildAuditReasonText(entry){
  return `* ${entry.auditReason||'No reason recorded'}${entry.auditNotes ? ' - "' + entry.auditNotes + '"' : ''}`;
}
function buildAuditProductDeletedEntry(entry){
  return `
    <div class="audit-item" style="border-left:3px solid var(--danger);padding-left:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:.5rem;">
        <div>
          <span class="badge badge-danger" style="margin-bottom:.35rem;">PRODUCT REMOVED</span>
          <div><strong>${entry.productName}</strong> <span class="inv-pid">${entry.productId||'-'}</span></div>
          <div class="audit-reason">${buildAuditReasonText(entry)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:.78rem;color:var(--text-dim);">Unit Cost was: ${fmt(entry.unitCost)}</div>
          <div class="audit-meta">ARCHIVED: ${getAuditEntryDate(entry)}</div>
        </div>
      </div>
    </div>`;
}
function getAuditReasonCategory(reason){
  if(reason.includes('Customer Return')) return {badge:'badge-info',label:'CUSTOMER RETURN'};
  if(reason.includes('Defective')||reason.includes('Quality')||reason.includes('Expired')) return {badge:'badge-danger',label:'PRODUCT ISSUE'};
  if(reason.includes('Input Error')) return {badge:'badge-warning',label:'INPUT ERROR'};
  if(reason.includes('Cancelled')) return {badge:'badge-warning',label:'CANCELLED'};
  if(reason.includes('Product Removed')) return {badge:'badge-danger',label:'PRODUCT REMOVED'};
  return {badge:'badge-danger',label:'REMOVED'};
}
function buildAuditEntryCard(entry){
  const isProductPull = entry.auditType === 'product-removal';
  const reasonCategory = getAuditReasonCategory(entry.auditReason||'');
  return `
    <div class="audit-item" style="${isProductPull ? 'border-left:3px solid var(--warning);padding-left:1rem;opacity:.85;' : 'border-left:3px solid var(--danger);padding-left:1rem;'}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:.5rem;">
        <div>
          ${isProductPull ? `<span class="badge badge-warning" style="margin-bottom:.35rem;">VOIDED - PRODUCT REMOVED</span><br>` : `<span class="badge ${reasonCategory.badge}" style="margin-bottom:.35rem;">${reasonCategory.label}</span><br>`}
          <span class="sale-id-badge">${entry.id||'-'}</span>
          <strong style="margin-left:.5rem;">${entry.customer||'-'}</strong> - ${entry.productName||entry.removedProductName||'-'}
          <div style="margin-top:.3rem;">${entry.date ? fmtDateTime(entry.date,entry.time) : '-'}</div>
          <div class="audit-reason">${buildAuditReasonText(entry)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-family:'DM Mono',monospace;font-size:.85rem;">${entry.totalPrice!=null ? fmt(entry.totalPrice) : '-'}</div>
          <div class="audit-meta">ARCHIVED: ${getAuditEntryDate(entry)}</div>
        </div>
      </div>
    </div>`;
}
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

  document.getElementById('audit-count').textContent=audit.length;
  const reasons={};
  for(const e of audit){if(e.auditReason)reasons[e.auditReason]=(reasons[e.auditReason]||0)+1;}
  const top=Object.entries(reasons).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById('audit-top-reason').textContent=top?top[0].split('-')[0].trim():'-';

  const el=document.getElementById('audit-list');
  if(!shown.length){el.innerHTML='<div style="color:var(--text-dim);font-size:.88rem;padding:1rem 0;">No archived records match the current filter.</div>';return;}

  el.innerHTML=shown.slice().reverse().map(entry=>
    entry.auditType==='product-deleted'
      ? buildAuditProductDeletedEntry(entry)
      : buildAuditEntryCard(entry)
  ).join('');
}
function getReasonCategory(reason){
  return getAuditReasonCategory(reason);
}

async function syncToCloud(silent=false){
  if(syncInProgress)return false;
  if(sessionRecoveryRequired){
    if(!silent) toast('Session expired — sign in again to resume sync.','danger');
    return false;
  }
  if(!navigator.onLine){
    if(!silent)toast('No internet. Data saved locally. Will sync when connected.','warning');
    return false;
  }
  await firebaseReadyPromise;
  await ensureCloudAccountForLocalUser();
  const syncUrl=getSyncUrl();
  const user=getCurrentUser();
  const canSaveFirestore=!!user && !!firebaseStore;
  if(!syncUrl && !canSaveFirestore){
    if(!silent){
      if(isFirebaseConfigured() && !firebaseAuth){
        toast('Cloud backup is not ready yet. Waiting for Firebase and retrying automatically.','info');
      } else {
        toast('Cloud backup is not configured. Please sign in to Firebase or configure backup in Settings.','warning');
      }
    }
    if(isFirebaseConfigured() && !firebaseAuth){
      scheduleOfflineSyncRetry();
    }
    return false;
  }
  const queue=DB.getSyncQueue();
  const pending = computePendingSyncCount();
  if(pending===0){
    refreshSyncBadge();
    return true;
  }
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
  refreshSyncBadge();
  let googleSheetSuccess=false;
  let firestoreSuccess=false;
  let syncErrors=[];
  try{
    if(syncUrl){
      try{
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(()=>controller.abort(), 20000) : null;
        const res = await fetch(syncUrl,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(payload),
          signal:controller?.signal,
        });
        if(timeoutId) clearTimeout(timeoutId);
        if(!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        googleSheetSuccess=true;
      }catch(e){
        console.error('Google Sheets sync failed:',e);
        syncErrors.push('Google Sheets: '+String(e));
      }
    }
    if(canSaveFirestore){
      try{
        await saveUserDataToFirestore();
        firestoreSuccess=true;
      }catch(e){
        console.error('Firestore sync failed:',e);
        if(isAuthError(e)){
          // Trigger session recovery flow for auth errors
          try{ handleAuthFailure(e); }catch(_e){}
        }
        syncErrors.push('Firebase: '+String(e));
      }
    }
    const cloudSyncSuccess = canSaveFirestore ? firestoreSuccess : googleSheetSuccess;
    if(cloudSyncSuccess){
      const priorQueue = DB.getSyncQueue();
      const priorSales = DB.getSales();
      const priorInventory = DB.getInventory();
      const priorAudit = DB.getAudit();
      const priorSyncState = DB.getSyncState();

      const syncedAt = new Date().toISOString();
      DB.setSales(DB.getSales().map(s=>({...s,synced:true,syncStatus:'synced',lastSyncedAt:syncedAt})));
      DB.setInventory(DB.getInventory().map(i=>({...i,synced:true,syncStatus:'synced',lastSyncedAt:syncedAt})));
      DB.setAudit(DB.getAudit().map(a=>({...a,synced:true,syncStatus:'synced',lastSyncedAt:syncedAt})));
      DB.setSyncQueue([]);
      syncRetryCountOnline=0;
      DB.setSyncState({lastSyncedAt:new Date().toISOString(),lastStatus:'success',synced:true,lastSyncedDevice:getDeviceId()});

      if(canSaveFirestore){
        try{
          await saveUserDataToFirestore();
          lastLocalFirestoreWriteAt = Date.now();
        }catch(e){
          console.warn('Firestore save after queue-clear failed:', e);
          DB.setSales(priorSales);
          DB.setInventory(priorInventory);
          DB.setAudit(priorAudit);
          DB.setSyncQueue(priorQueue);
          DB.setSyncState(priorSyncState);
          throw e;
        }
      } else {
        lastLocalFirestoreWriteAt = Date.now();
      }

      if(!silent)toast('? All offline data backed up to cloud successfully!','success');
      refreshSyncBadge();
      renderDashboard();renderSessionTable();renderRecords();
      stopOfflineSyncRetry();
      return true;
    }else if(syncErrors.length>0){
      DB.setSyncState({lastSyncedAt:new Date().toISOString(),lastStatus:'failed',lastError:syncErrors.join(' | ')});
      if(!silent)toast('Sync failed. Will retry automatically: '+syncErrors.join(', '),'danger');
      syncRetryCountOnline++;
      scheduleOfflineSyncRetry();
      return false;
    }
  }catch(e){
    console.error('Unexpected sync error:',e);
    DB.setSyncState({lastSyncedAt:new Date().toISOString(),lastStatus:'failed',lastError:String(e)});
    if(!silent)toast('Unexpected error during sync. Will retry.','danger');
    scheduleOfflineSyncRetry();
    return false;
  }finally{
    syncInProgress=false;
    refreshSyncBadge();
  }
}

function scheduleOfflineSyncRetry(){
  if(sessionRecoveryRequired) return;
  if(offlineSyncRetryTimer)clearInterval(offlineSyncRetryTimer);
  offlineSyncRetryTimer=setInterval(()=>{
    if(sessionRecoveryRequired) return;
    if(navigator.onLine && !syncInProgress){
      const hasPending=computePendingSyncCount()>0;
      if(hasPending){
        syncToCloud(true);
      }else{
        stopOfflineSyncRetry();
      }
    }
  },2000);
}

function stopOfflineSyncRetry(){
  if(offlineSyncRetryTimer){
    clearInterval(offlineSyncRetryTimer);
    offlineSyncRetryTimer=null;
    syncRetryCountOnline=0;
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

function setUpdatePanelStatus(message,type=''){
  const statusEl=document.getElementById('update-modal-status');
  if(statusEl){
    statusEl.textContent = message;
  }
  const prefix = type === 'success' ? '?' : type === 'danger' ? '?' : '??';
  if(type === 'danger'){
    console.error(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

function formatBytes(value){
  if(!value || typeof value !== 'number' || value <= 0) return '0.00';
  return (value / 1024 / 1024).toFixed(2);
}

function getUpdatePackageSize(info){
  if(!info || !Array.isArray(info.files)) return null;
  const total = info.files.reduce((sum,file)=>{
    if(file && typeof file.size === 'number' && file.size > 0) return sum + file.size;
    return sum;
  }, 0);
  return total > 0 ? total : null;
}

function showUpdateProgress(show){
  const wrapper=document.getElementById('update-progress-wrapper');
  const progressBar=document.getElementById('update-progress-bar');
  const details=document.getElementById('update-progress-details');
  const summary=document.getElementById('update-progress-summary');
  if(!wrapper) return;
  wrapper.style.display = show ? 'block' : 'none';
  if(show){
    if(progressBar && progressBar.style.width==='') progressBar.style.width='0%';
    if(details && !details.textContent) details.textContent='Preparing download...';
    if(summary && !summary.textContent) summary.textContent='';
  } else {
    if(progressBar) progressBar.style.width='0%';
    if(details) details.textContent='Waiting to download...';
    if(summary) summary.textContent='';
  }
}

function setupUpdateEventHandlers(){
  if(!electronAvailable || !window.electronAPI) return;
  if(typeof window.electronAPI.onUpdateAvailable === 'function'){
    window.electronAPI.onUpdateAvailable((info)=>{
      const sizeBytes = getUpdatePackageSize(info);
      const sizeLabel = sizeBytes ? ` � ${formatBytes(sizeBytes)} MB` : '';
      const message = `Update available: version ${info?.version || 'new'}${sizeLabel}. Click download to install.`;
      toast(message,'success');
      setUpdatePanelStatus(message,'success');
      const downloadBtn=document.getElementById('download-update-btn');
      if(downloadBtn) downloadBtn.style.display='inline-flex';
    });
  }
  if(typeof window.electronAPI.onUpdateDownloadProgress === 'function'){
    window.electronAPI.onUpdateDownloadProgress((progress)=>{
      showUpdateProgress(true);
      const percent = progress?.percent != null ? Math.min(Math.max(progress.percent,0),100).toFixed(0) : null;
      const transferredBytes = progress?.transferred;
      const totalBytes = progress?.total;
      const transferred = formatBytes(transferredBytes);
      const total = formatBytes(totalBytes);
      const speed = formatBytes(progress?.bytesPerSecond);
      const progressBar=document.getElementById('update-progress-bar');
      if(progressBar && percent !== null){ progressBar.style.width=`${percent}%`; }
      const details=document.getElementById('update-progress-details');
      if(details){
        details.textContent = percent !== null
          ? `Downloading update � ${percent}% complete`
          : `Downloading update...`;
      }
      const summary=document.getElementById('update-progress-summary');
      if(summary){
        summary.textContent = percent !== null
          ? `${transferred} / ${total} MB � ${percent}% � ${speed} MB/s`
          : `Downloading...`;
      }
      if(totalBytes && details){
        setUpdatePanelStatus(`Downloading update (${total} MB)... ${percent !== null ? percent + '%' : ''}`,'success');
      } else {
        setUpdatePanelStatus(`Downloading update... ${percent !== null ? percent + '%' : ''}`,'success');
      }
    });
  }
  if(typeof window.electronAPI.onUpdateDownloaded === 'function'){
    window.electronAPI.onUpdateDownloaded((_info)=>{
      setUpdatePanelStatus('Update downloaded. Restarting now...','success');
      toast('Update downloaded. Restarting to install.', 'success');
    });
  }
}

async function checkForUpdatesOnStartup(){
  if(!electronAvailable || !window.electronAPI || typeof window.electronAPI.isPackagedApp !== 'function') return;
  try{
    const isPackaged = await window.electronAPI.isPackagedApp();
    if(!isPackaged) return;
    const res = await window.electronAPI.checkForAppUpdates();
    if(res?.ok && res.updateAvailable){
      toast(`New update available: version ${res.version}. It will download and install automatically when ready.`, 'success');
      await startUpdateDownload();
    }
  }catch(_){
    // Ignore silent startup update check failures.
  }
}

async function startUpdateDownload(){
  const downloadBtn=document.getElementById('download-update-btn');
  if(downloadBtn){
    downloadBtn.style.display='none';
    downloadBtn.disabled=true;
    downloadBtn.textContent='Downloading...';
  }
  showUpdateProgress(true);
  const details=document.getElementById('update-progress-details');
  if(details) details.textContent='Starting download...';
  setUpdatePanelStatus('Downloading update. Please wait...', 'success');
  try {
    const res = await window.electronAPI.downloadAppUpdate();
    if(!res?.ok){
      setUpdatePanelStatus(res?.message || 'Download failed. Try again later.', 'danger');
      showUpdateProgress(false);
      if(downloadBtn){
        downloadBtn.style.display='inline-flex';
        downloadBtn.disabled=false;
        downloadBtn.textContent='DOWNLOAD UPDATE';
      }
    } else {
      setUpdatePanelStatus('Update download started. Waiting for install...', 'success');
    }
  } catch (err) {
    setUpdatePanelStatus('Download start failed. Try again later.', 'danger');
    console.error('Error starting update download:', err);
    showUpdateProgress(false);
    if(downloadBtn){
      downloadBtn.style.display='inline-flex';
      downloadBtn.disabled=false;
      downloadBtn.textContent='DOWNLOAD UPDATE';
    }
  }
}

function renderUpdatePanel(){
  const versionEl=document.getElementById('current-app-version');
  const downloadBtn=document.getElementById('download-update-btn');
  const checkBtn=document.getElementById('check-update-btn');
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
      showUpdateProgress(true);
      const details=document.getElementById('update-progress-details');
      if(details) details.textContent='Starting download...';
      setUpdatePanelStatus('Starting update download...', 'success');
      const res=await window.electronAPI.downloadAppUpdate();
      if(res?.ok){
        setUpdatePanelStatus('Downloading update. Please wait...', 'success');
      } else {
        setUpdatePanelStatus(res?.message||'Download failed. Try again later.', 'danger');
        showUpdateProgress(false);
        downloadBtn.disabled=false;
        downloadBtn.textContent='DOWNLOAD UPDATE';
      }
    };
  }
  if(checkBtn){
    checkBtn.disabled=false;
    checkBtn.textContent='CHECK FOR UPDATE';
  }
  showUpdateProgress(false);
  setUpdatePanelStatus('Click CHECK FOR UPDATE to see whether a newer version is available.');
}

async function openUpdateModal(){
  const overlay=document.getElementById('update-modal-overlay');
  if(!overlay) return;
  overlay.classList.add('open');
  renderUpdatePanel();
}
function closeUpdateModal(){
  const overlay=document.getElementById('update-modal-overlay');
  if(!overlay) return;
  overlay.classList.remove('open');
}

async function performUpdateCheck(){
  const checkBtn=document.getElementById('check-update-btn');
  const downloadBtn=document.getElementById('download-update-btn');
  if(downloadBtn){
    downloadBtn.style.display='none';
    downloadBtn.disabled=false;
  }
  if(checkBtn){ checkBtn.disabled=true; checkBtn.textContent='Checking...'; }
  setUpdatePanelStatus('Checking for app updates...');
  if(!electronAvailable||!window.electronAPI?.checkForAppUpdates){
    setUpdatePanelStatus('App updates are available only in packaged desktop installs.','danger');
    if(checkBtn){ checkBtn.disabled=false; checkBtn.textContent='CHECK FOR UPDATE'; }
    return;
  }
  try{
    const cfg=await window.electronAPI.getUpdateConfig();
    let feedUrl=(cfg?.feedUrl||'').trim();
    if(!feedUrl){
      setUpdatePanelStatus('Checking app updates using GitHub Releases...','success');
    }

    const currentVersion = typeof window.electronAPI.getAppVersion === 'function'
      ? await window.electronAPI.getAppVersion().catch(()=>'')
      : '';

    const res=await window.electronAPI.checkForAppUpdates();
    if(!res){
      setUpdatePanelStatus('No response from update service.','danger');
    } else if(!res.ok){
      setUpdatePanelStatus(res.message||'Unable to check for updates.','danger');
    } else if(res.updateAvailable && res.version && currentVersion && res.version === currentVersion){
      setUpdatePanelStatus('You are using the latest update.','success');
      if(downloadBtn) downloadBtn.style.display='none';
      showUpdateProgress(false);
    } else if(res.updateAvailable){
      setUpdatePanelStatus(`Update available: version ${res.version}. Downloading now...`,`success`);
      if(downloadBtn) downloadBtn.style.display='none';
      await startUpdateDownload();
    } else {
      setUpdatePanelStatus(res.message||'You are using the latest update.','success');
      if(downloadBtn) downloadBtn.style.display='none';
      showUpdateProgress(false);
    }
  }catch(e){
    setUpdatePanelStatus('Update check failed. Try again later.','danger');
    console.error(e);
  } finally {
    if(checkBtn){ checkBtn.disabled=false; checkBtn.textContent='CHECK FOR UPDATE'; }
  }
}

async function checkAppUpdate(){
  openUpdateModal();
}

function hideAppLoader(){
  const loader=document.getElementById('app-loader');
  if(loader){loader.style.display='none';}
}

function startAutoSyncLoop(){
  if(sessionRecoveryRequired) return;
  if(syncIntervalTimer)clearInterval(syncIntervalTimer);
  syncIntervalTimer=setInterval(()=>{
    if(sessionRecoveryRequired) return;
    if(!navigator.onLine)return;
    if(computePendingSyncCount()>0)syncToCloud(true);
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
  populateAuditReasonFilter();
  refreshSyncBadge();
  updateWholesaleVisibility();
  renderDashboard();renderSessionTable();renderOutstanding();renderInventory();renderRecords();renderAudit();
  if(navigator.onLine){
    if(computePendingSyncCount()>0){
      if(currentPanelId !== 'admin'){
        toast('Resuming backup of offline data...','info');
      }
      syncToCloud(false);
    }
  }
  startAutoSyncLoop();
  hideAppLoader();
  renderOwnerProfile();
}
