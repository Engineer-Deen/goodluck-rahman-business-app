const fs = require('fs');
const path = require('path');

function getEnv(name){
  return process.env[name] || '';
}

const config = {
  apiKey: getEnv('FIREBASE_API_KEY'),
  authDomain: getEnv('FIREBASE_AUTH_DOMAIN'),
  projectId: getEnv('FIREBASE_PROJECT_ID'),
  storageBucket: getEnv('FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getEnv('FIREBASE_MESSAGING_SENDER_ID'),
  appId: getEnv('FIREBASE_APP_ID'),
  databaseURL: getEnv('FIREBASE_DATABASE_URL'),
};

const outDir = path.join(__dirname, '..', 'public');
const outFile = path.join(outDir, 'firebase-config.json');
try{
  if(!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(config, null, 2), { encoding: 'utf8' });
  console.log('Wrote', outFile);
} catch(err){
  console.error('Failed to write firebase config:', err);
  process.exitCode = 1;
}
