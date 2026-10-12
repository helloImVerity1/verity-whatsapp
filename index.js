const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const fs = require('fs');
const config = require('./config.js');
const pino = require('pino');

const app = express();
let lastQr = null;
let sockGlobal = null;

app.get('/', (req,res) => {
  res.send(`<h1>Verity H24 est en ligne</h1>
  <p><a href="/qr">Voir QR Code pour connecter WhatsApp</a></p>
  <p><a href="/logs">Voir ID du groupe</a></p>
  <p>Horaires: Lun-Sam 7h-21h (vocal coupe a 20h) | Dimanche 7h-20h (vocal coupe a 19h)</p>`);
});

app.get('/qr', async (req,res) => {
  if(!lastQr) return res.send('<h1>Pas de QR. Soit deja connectee, soit en cours de demarrage. Actualise dans 5 sec.</h1><script>setTimeout(()=>location.reload(),3000)</script>');
  const img = await qrcode.toDataURL(lastQr);
  res.send(`<h1>Scanne ce QR avec le telephone Verity</h1><p>WhatsApp > Parametres > Appareils lies > Lier un appareil</p><img src="${img}" width="300"><script>setTimeout(()=>location.reload(),5000)</script>`);
});

app.get('/logs', (req,res) => {
  const log = fs.existsSync('./groupes.log') ? fs.readFileSync('./groupes.log','utf8') : 'Aucun message recu encore. Envoie un message dans ton groupe.';
  res.send(`<pre>${log}</pre><p>Copie l'ID qui ressemble a 1203...@g.us et mets le dans config.js GROUP_ID</p>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Serveur web OK sur port ' + PORT));

let warns = fs.existsSync('./warns.json') ? JSON.parse(fs.readFileSync('./warns.json','utf8')) : {};
const saveWarns = () => fs.writeFileSync('./warns.json', JSON.stringify(warns));

function getStatut(){
  const now = new Date();
  const paris = new Date(now.toLocaleString('en-US', {timeZone: 'Europe/Paris'}));
  const h = paris.getHours() + paris.getMinutes()/60;
  const jour = paris.getDay(); // 0=Dimanche
  const regle = (jour===0) ? config.HORAIRES.dimanche : config.HORAIRES.semaine;
  if(h < regle.debut || h >= regle.finTotal) return {status:'EXTINCTION', regle, heure: h, jour};
  if(h >= regle.finVocal) return {status:'SANS_VOCAL', regle, heure: h, jour};
  return {status:'OUVERT', regle, heure: h, jour};
}


const MOOD_PICS = {
  happy: './moods/happy.webp',
  angry: './moods/angry.webp',
  sad: './moods/sad.webp',
  thinking: './moods/thinking.webp',
  neutral: './moods/neutral.webp'
};
let currentMood = 'neutral';

async function setMood(newMood, sock){
  if(newMood===currentMood) return;
  currentMood=newMood;
  try{
    const file = MOOD_PICS[newMood];
    if(fs.existsSync(file)){
      const buffer = fs.readFileSync(file);
      // Baileys update profile pic
      await sock.updateProfilePicture(sock.user.id, buffer);
      console.log(`Verity humeur changee: ${newMood}`);
    }
  }catch(e){ console.log('Impossible changer photo profil (besoin admin?):', e.message); }
}

function detectMood(text, low){
  if(!text) return 'neutral';
  if(low.includes('merci') || low.includes('bravo') || low.includes('mdr') || low.includes('lol') || low.includes('genial')) return 'happy';
  if(low.includes('triste') || low.includes('pleure') || low.includes('deprime') || low.includes('seul')) return 'sad';
  if(low.includes('?') || low.includes('comment') || low.includes('pourquoi') || low.includes('aide') || low.includes('explique')) return 'thinking';
  if(config.INSULTES.some(w=>low.includes(w))) return 'angry';
  return 'neutral';
}

async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({
    auth: state,
    logger: pino({level:'silent'}),
    printQRInTerminal: true
  });
  sockGlobal = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if(qr) {
      lastQr = qr;
      console.log('QR genere, va sur /qr');
    }
    if(connection === 'close'){
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Deconnecte, reconnexion:', shouldReconnect);
      if(shouldReconnect) startBot();
    } else if(connection === 'open'){
      lastQr = null;
      console.log('Verity connectee H24 !');
    }
  });

  sock.ev.on('messages.upsert', async ({messages}) => {
    for(const msg of messages){
      try{
        if(!msg.message || msg.key.fromMe) continue;
        const chatId = msg.key.remoteJid;
        const senderId = msg.key.participant || msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "";
        
        // Log pour trouver GROUP_ID
        fs.appendFileSync('./groupes.log', `${new Date().toLocaleString('fr-FR')} - Groupe: ${chatId} - De: ${senderId} - Texte: ${text.slice(0,80)}\n`);
        console.log(`Message dans ${chatId}: ${text.slice(0,30)}`);

        // Si GROUP_ID configure, on ignore les autres groupes
        if(config.GROUP_ID && chatId !== config.GROUP_ID) continue;

        const statut = getStatut();
        const estVocal = !!msg.message.audioMessage;
        const isPtt = msg.message.audioMessage?.ptt;

        // 1. EXTINCTION DES FEUX
        if(statut.status === 'EXTINCTION'){
          await sock.sendMessage(chatId, { delete: msg.key });
          await sock.sendMessage(chatId, { text: `🌙 *Extinction des feux* - Il est ${Math.floor(statut.heure)}h. Groupe ferme jusqu'a ${statut.regle.debut}h. @${senderId.split('@')[0]} ton message a ete supprime.`, mentions: [senderId] });
          continue;
        }

        // 2. PAS DE VOCAL
        if(statut.status === 'SANS_VOCAL' && estVocal){
          await sock.sendMessage(chatId, { delete: msg.key });
          await sock.sendMessage(chatId, { text: `🔇 Pas de vocal apres ${statut.regle.finVocal}h (19h le dimanche). Passe en texte stp @${senderId.split('@')[0]} 🙏`, mentions: [senderId] });
          continue;
        }

        // 3. FILTRE INSULTES
        const low = text.toLowerCase();
        const newMood = detectMood(text, low);
        if(newMood !== currentMood){ setMood(newMood, sock); }

        const isInsulte = config.INSULTES.some(w => low.includes(w));
        if(isInsulte){
          warns[senderId] = (warns[senderId]||0)+1;
          saveWarns();
          await sock.sendMessage(chatId, { delete: msg.key });
          if(warns[senderId] < config.LIMITES.avertissementsAvantBan){
            await sock.sendMessage(chatId, { text: `⚠️ @${senderId.split('@')[0]} On reste courtois. Avertissement ${warns[senderId]}/${config.LIMITES.avertissementsAvantBan}`, mentions: [senderId] });
          } else {
            await sock.sendMessage(chatId, { text: `🔨 @${senderId.split('@')[0]} retire ${config.LIMITES.dureeBanMinutes}min pour insultes.`, mentions: [senderId] });
            // Note: Baileys ne peut pas kick tout seul sans etre admin, il faut que Verity soit admin
            try{
              await sock.groupParticipantsUpdate(chatId, [senderId], "remove");
              setTimeout(async () => {
                try{ await sock.groupParticipantsUpdate(chatId, [senderId], "add"); warns[senderId]=0; saveWarns(); }catch(e){}
              }, config.LIMITES.dureeBanMinutes*60*1000);
            }catch(e){ console.log('Pas admin pour kick'); }
          }
          continue;
        }

        // 4. ALERTE PRIVEE POUR TOI (admin)
        // Si tu dis "Verity fais gaffe a cette personne en prive" -> elle t'envoie un MP
        if(low.includes('fais gaffe') || low.includes('fais attention') || (low.includes('prive') && low.includes('verity')) || low.includes('en privé') || low.includes('en prive')){
          if(senderId === config.ADMIN_NUMBER || chatId === config.ADMIN_NUMBER || msg.key.participant === config.ADMIN_NUMBER || text.includes('0762')){
            // C'est toi qui demande
            const cible = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || senderId;
            await sock.sendMessage(config.ADMIN_NUMBER, { text: `🔒 Alerte privée Verity:\nTu m'as demandé de faire gaffe à @${cible.split('@')[0]} dans le groupe ${chatId}.\nMessage original: "${text.slice(0,200)}"\nJe le surveille de près.`, mentions: [cible] });
            await sock.sendMessage(chatId, { text: `Compris @${senderId.split('@')[0]}, je te tiens au courant en privé 🔒`, mentions: [senderId] });
            continue;
          }
        }

        // 5. VERITY REPOND SI ON L'APPELLE - aide aux autres
        if(low.includes('verity')){
          if(config.BLACKLIST.includes(senderId)) continue;
          if(low.includes('exercice') || low.includes('reponse') || low.includes('dm') || low.includes('resous')){
            await sock.sendMessage(chatId, { text: `Je te donne pas la reponse directe @${senderId.split('@')[0]} 😉 Dis moi ou tu bloques et on le fait ensemble. C'est quoi l'enonce exact?` , mentions: [senderId] });
            await setMood('thinking', sock);
          } else if(low.includes('merci')){
            await sock.sendMessage(chatId, { text: `Avec plaisir @${senderId.split('@')[0]} ! N'hesite pas si tu as besoin 💛` , mentions: [senderId] });
            await setMood('happy', sock);
          } else {
            await sock.sendMessage(chatId, { text: `Oui je suis la @${senderId.split('@')[0]} ! Je peux t'aider a comprendre ton cours, t'expliquer une notion, ou te guider pas a pas. Je fais pas l'exo a ta place par contre, on apprend ensemble 🤝` , mentions: [senderId] });
          }
        }

      }catch(e){ console.error('Erreur msg:', e); }
    }
  });
}

startBot();
