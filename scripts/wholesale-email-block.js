function normalizeEmail(value){
  return String(value||'').trim().toLowerCase();
}
function resetWholesaleLoginForm(){
  const phoneEl=document.getElementById('wholesale-login-phone-local');
  const emailEl=document.getElementById('wholesale-login-email');
  const accessEl=document.getElementById('wholesale-login-access-config');
  const otpEl=document.getElementById('wholesale-login-otp');
  const errEl=document.getElementById('wholesale-login-error');
  const codeSec=document.getElementById('wholesale-code-section');
  const sendBtn=document.getElementById('wholesale-send-email-btn');
  const verifyBtn=document.getElementById('wholesale-verify-btn');
  if(phoneEl) phoneEl.value='';
  if(emailEl) emailEl.value='';
  if(accessEl) accessEl.value='';
  if(otpEl) otpEl.value='';
  if(errEl) errEl.textContent='';
  if(codeSec){ codeSec.style.display='none'; codeSec.setAttribute('aria-hidden','true'); }
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
  const accessCode=String((document.getElementById('wholesale-login-access-config')||{}).value||'').trim();
  const phone=getWholesalePhoneE164FromForm();
  return { phone, email, accessCode };
}
function normalizeWholesaleRegistryEntry(entry){
  const phone=normalizePhone(String(entry?.phone||''));
  const email=normalizeEmail(entry?.email);
  const accessCode=String(entry?.accessCode||'').trim();
  if(!phone||!phone.startsWith('+')||!email||!accessCode) return null;
  return { phone, email, accessCode };
}
async function refreshWholesaleRegisteredUsers(){
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
  if(firebaseStore){
    try{
      const doc=await firebaseStore.collection(FIRESTORE_CONFIG_COLLECTION).doc(FIRESTORE_CONFIG_DOC).get();
      if(doc.exists){
        const users=doc.data()?.wholesaleAllowedUsers;
        if(Array.isArray(users)){
          for(const u of users) addEntry(u);
        }
      }
    }catch(_e){}
  }
  wholesaleRegisteredUsers=merged;
}
function hasWholesaleRegistryConfigured(){
  return (wholesaleRegisteredUsers||[]).length>0;
}
function findWholesaleRegisteredUser(phone,email,accessCode){
  const p=normalizePhone(phone||'');
  const e=normalizeEmail(email);
  const c=String(accessCode||'').trim();
  if(!p||!e||!c) return null;
  return (wholesaleRegisteredUsers||[]).find(u=>u.phone===p&&u.email===e&&u.accessCode===c)||null;
}
function generateWholesaleOtpCode(){
  return String(Math.floor(100000+Math.random()*900000));
}
async function sendWholesaleOtpEmail(toEmail,code){
  const cfg=WHOLESALE_EMAILJS_CONFIG||{};
  if(cfg.enabled&&cfg.publicKey&&cfg.serviceId&&cfg.templateId){
    const res=await fetch('https://api.emailjs.com/api/v1.0/email/send',{
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({
        service_id:cfg.serviceId,
        template_id:cfg.templateId,
        user_id:cfg.publicKey,
        template_params:{
          to_email:toEmail,
          user_email:toEmail,
          passcode:code,
          message:`Your Wholesales verification code is ${code}. It expires in 10 minutes.`,
        },
      }),
    });
    if(!res.ok){
      const detail=await res.text().catch(()=>'');
      throw new Error(detail||'Email delivery failed');
    }
    return;
  }
  console.info('[Wholesale dev OTP]',toEmail,code);
  toast('Development mode: your verification code is '+code,'warning');
}
async function beginWholesaleEmailVerification(){
  const errEl=document.getElementById('wholesale-login-error');
  const sendBtn=document.getElementById('wholesale-send-email-btn');
  if(errEl) errEl.textContent='';
  await refreshWholesaleRegisteredUsers();
  if(!hasWholesaleRegistryConfigured()){
    if(errEl) errEl.textContent=MSG_WHOLESALE_NOT_ACTIVATED;
    console.warn('Wholesale registry: set WHOLESALE_REGISTERED_USERS in script.js or Firestore meta/appConfig.wholesaleAllowedUsers (phone, email, accessCode per user).');
    return;
  }
  const { phone, email, accessCode }=getWholesaleLoginCredentials();
  if(!phone){
    if(errEl) errEl.textContent='Enter your registered mobile number.';
    return;
  }
  if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    if(errEl) errEl.textContent='Enter your registered email address.';
    return;
  }
  if(!accessCode){
    if(errEl) errEl.textContent='Enter your access configuration code.';
    return;
  }
  if(!findWholesaleRegisteredUser(phone,email,accessCode)){
    if(errEl) errEl.textContent=MSG_WHOLESALE_UNAUTHORIZED;
    return;
  }
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
    sendBtn.textContent='Sending…';
  }
  try{
    const code=generateWholesaleOtpCode();
    await sendWholesaleOtpEmail(email,code);
    wholesalePendingOtpSession={
      phone,
      email,
      accessCode,
      code,
      sentAt:Date.now(),
      expiresAt:Date.now()+WHOLESALE_OTP_TTL_MS,
    };
    const codeSec=document.getElementById('wholesale-code-section');
    if(codeSec){ codeSec.style.display='block'; codeSec.setAttribute('aria-hidden','false'); }
    toast('Verification code sent to your registered email.','success');
  }catch(err){
    console.error(err);
    if(errEl) errEl.textContent='We could not send the email. Check EmailJS configuration or try again later.';
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
  await refreshWholesaleRegisteredUsers();
  const session=wholesalePendingOtpSession;
  if(!session){
    if(errEl) errEl.textContent='Request a verification code first.';
    return;
  }
  const code=String((document.getElementById('wholesale-login-otp')||{}).value||'').trim();
  if(!/^\d{6}$/.test(code)){
    if(errEl) errEl.textContent='Enter the 6-digit code from your email.';
    return;
  }
  const { phone, email, accessCode }=getWholesaleLoginCredentials();
  if(phone!==session.phone||email!==session.email||accessCode!==session.accessCode){
    if(errEl) errEl.textContent=MSG_WHOLESALE_UNAUTHORIZED;
    return;
  }
  if(!findWholesaleRegisteredUser(phone,email,accessCode)){
    if(errEl) errEl.textContent=MSG_WHOLESALE_UNAUTHORIZED;
    return;
  }
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
    verifyBtn.textContent='Verifying…';
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
      verifyBtn.textContent='VERIFY & OPEN';
    }
  }
}
