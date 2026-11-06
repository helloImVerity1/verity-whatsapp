const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const fs = require('fs');
const config = require('./config.js');
const pino = require('pino');

const app = express();
let lastQr = null;

app.get('/', (req,res) => {
  res.send(`<h1>Verity H24 glitch 💛 - Conseil 5eme</h1>
  <p><a href="/qr">QR Code</a> | <a href="/logs">Logs / IDs groupes</a> | <a href="/stats">Stats privees</a></p>
  <p>Groupes: 5eme + Conseil + Prive admin</p>`);
});
app.get('/qr', async (req,res) => {
  if(!lastQr) return res.send('<h1>Pas de QR - actualise dans 5s</h1><script>setTimeout(()=>location.reload(),3000)</script>');
  const img = await qrcode.toDataURL(lastQr);
  res.send(`<h1>Scan Verity</h1><img src="${img}" width="300"><script>setTimeout(()=>location.reload(),15000)</script>`);
});
app.get('/logs', (req,res) => {
  const log = fs.existsSync('./groupes.log') ? fs.readFileSync('./groupes.log','utf8') : 'Aucun message';
  res.send(`<pre>${log}</pre><p>Copie les IDs 1203...@g.us</p>`);
});
app.get('/stats', (req,res) => {
  const warns = fs.existsSync('./warns.json') ? JSON.parse(fs.readFileSync('./warns.json','utf8')) : {};
  const white = fs.existsSync('./whitelist.json') ? JSON.parse(fs.readFileSync('./whitelist.json','utf8')) : config.WHITELIST;
  const black = fs.existsSync('./blacklist.json') ? JSON.parse(fs.readFileSync('./blacklist.json','utf8')) : config.BLACKLIST;
  res.send(`<pre>Warns: ${JSON.stringify(warns,null,2)}\n\nWhitelist: ${JSON.stringify(white,null,2)}\n\nBlacklist: ${JSON.stringify(black,null,2)}</pre>`);
});

const PORT = process.env.PORT || 10000;
app.get('/health', (req,res)=> res.status(200).send('ok'));
app.listen(PORT, '0.0.0.0', () => { console.log('Serveur OK '+PORT); setTimeout(()=>{ startBot().catch(e=>console.error(e)); },1500); });

// Persistance
let warns = fs.existsSync('./warns.json') ? JSON.parse(fs.readFileSync('./warns.json','utf8')) : {};
let whitelist = fs.existsSync('./whitelist.json') ? JSON.parse(fs.readFileSync('./whitelist.json','utf8')) : (config.WHITELIST||[]);
let blacklist = fs.existsSync('./blacklist.json') ? JSON.parse(fs.readFileSync('./blacklist.json','utf8')) : (config.BLACKLIST||[]);
const saveWarns = () => fs.writeFileSync('./warns.json', JSON.stringify(warns));
const saveWhite = () => fs.writeFileSync('./whitelist.json', JSON.stringify(whitelist));
const saveBlack = () => fs.writeFileSync('./blacklist.json', JSON.stringify(blacklist));

function getStatut(){
  const now = new Date();
  const paris = new Date(now.toLocaleString('en-US', {timeZone: 'Europe/Paris'}));
  const h = paris.getHours() + paris.getMinutes()/60;
  const jour = paris.getDay();
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
      await sock.updateProfilePicture(sock.user.id, fs.readFileSync(file));
      console.log('Humeur: '+newMood);
    }
  }catch(e){}
}
function detectMood(text, low){
  if(!text) return 'neutral';
  if(low.includes('merci')||low.includes('bravo')||low.includes('mdr')||low.includes('genial')) return 'happy';
  if(low.includes('triste')||low.includes('pleure')||low.includes('seul')) return 'sad';
  if(low.includes('?')||low.includes('comment')||low.includes('pourquoi')||low.includes('aide')) return 'thinking';
  if(config.INSULTES.some(w=>low.includes(w))) return 'angry';
  return 'neutral';
}

function isAdmin(senderId, chatId){
  const admin = config.ADMIN_NUMBER;
  if(!admin) return false;
  return senderId===admin || chatId===admin || chatId.includes(admin.split('@')[0]);
}

async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({ auth: state, logger: pino({level:'silent'}) });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if(qr) lastQr = qr;
    if(connection === 'close'){
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if(shouldReconnect) setTimeout(()=>startBot(), 3000);
    } else if(connection === 'open'){
      lastQr = null;
      console.log('Verity connectee !');
      await setMood('neutral', sock);
    }
  });

  sock.ev.on('messages.upsert', async ({messages}) => {
    for(const msg of messages){
      try{
        if(!msg.message || msg.key.fromMe) continue;
        const chatId = msg.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');
        const senderId = msg.key.participant || msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "";
        const low = text.toLowerCase();
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];

        fs.appendFileSync('./groupes.log', `${new Date().toLocaleString('fr-FR')} - ${isGroup?'GROUPE':'PRIVE'}: ${chatId} - De: ${senderId} - ${text.slice(0,100)}\n`);

        // ================== CHAT PRIVE AVEC TOI (ADMIN) ==================
        if(!isGroup && isAdmin(senderId, chatId)){
          // Commandes liste blanche / noire
          if(low.includes('liste blanche') || low.includes('whitelist')){
            if(low.includes('ajoute') || low.includes('mets') || low.includes('met')){
              const cible = mentioned[0];
              if(cible && !whitelist.includes(cible)){
                whitelist.push(cible);
                saveWhite();
                await sock.sendMessage(chatId, { text: `✅ Ajouté en liste blanche: @${cible.split('@')[0]}. Il ne sera plus jamais banni, juste averti.`, mentions: [cible] });
              } else if(!cible){
                await sock.sendMessage(chatId, { text: `Pour ajouter: "Verity mets @quelqu'un en liste blanche"` });
              }
            } else if(low.includes('enleve') || low.includes('retire')){
              const cible = mentioned[0];
              whitelist = whitelist.filter(x=>x!==cible);
              saveWhite();
              await sock.sendMessage(chatId, { text: `❌ Retiré de la liste blanche: @${cible?.split('@')[0]||'?'}` , mentions: cible?[cible]:[] });
            } else {
              await sock.sendMessage(chatId, { text: `📋 Liste blanche actuelle (${whitelist.length}):\n${whitelist.map(x=>'@'+x.split('@')[0]).join(', ')||'vide'}`, mentions: whitelist });
            }
            continue;
          }
          if(low.includes('liste noire') || low.includes('blacklist')){
            if(low.includes('ajoute') || low.includes('mets') || low.includes('met')){
              const cible = mentioned[0];
              if(cible && !blacklist.includes(cible)){
                blacklist.push(cible);
                saveBlack();
                await sock.sendMessage(chatId, { text: `🚫 Ajouté en liste noire: @${cible.split('@')[0]}. Je l'ignorerai et je te préviendrai s'il parle mal.`, mentions: [cible] });
              }
            } else if(low.includes('enleve') || low.includes('retire')){
              const cible = mentioned[0];
              blacklist = blacklist.filter(x=>x!==cible);
              saveBlack();
              await sock.sendMessage(chatId, { text: `✅ Retiré de la liste noire.` });
            } else {
              await sock.sendMessage(chatId, { text: `📋 Liste noire (${blacklist.length}):\n${blacklist.map(x=>'@'+x.split('@')[0]).join(', ')||'vide'}`, mentions: blacklist });
            }
            continue;
          }
          // Résumé / aide conseil
          if(low.includes('resume') || low.includes('résumé') || low.includes('bilan') || low.includes('stats') || low.includes('conseil')){
            let resume = `📊 *Bilan Verity - Conseil des 5ème*\n\n`;
            const totalWarns = Object.keys(warns).length;
            resume += `Personnes averties: ${totalWarns}\n`;
            for(const [id,count] of Object.entries(warns)){
              resume += `- @${id.split('@')[0]}: ${count} avertissement(s)\n`;
            }
            resume += `\nWhitelist: ${whitelist.length} - Blacklist: ${blacklist.length}\n`;
            resume += `\nTu veux que je te fasse un message prêt à envoyer dans le conseil ? Dis "prépare message conseil"`;
            await sock.sendMessage(chatId, { text: resume, mentions: Object.keys(warns) });
            continue;
          }
          if(low.includes('prepare') && low.includes('conseil')){
            await sock.sendMessage(chatId, { text: `Voici un message que tu peux copier dans le groupe conseil:\n\n"Salut le conseil, petit point comportement:\n${Object.entries(warns).map(([id,c])=>`- ${id.split('@')[0]}: ${c} avert(s)`).join('\n')||'Rien à signaler, groupe calme 👍'}\nOn garde ça entre nous, pas besoin d'en parler dans le groupe officiel."` });
            continue;
          }
          // Discussion normale privée
          await setMood(detectMood(text,low), sock);
          await sock.sendMessage(chatId, { text: `Je t'écoute en privé 🤫 Tu veux:\n- "résumé groupe" pour le bilan\n- "mets @X en liste blanche/noire"\n- "prépare message conseil"\n- Ou juste parler du groupe, je t'aide à formuler sans accuser dans le groupe officiel.` });
          continue;
        }

        // Si privé mais pas admin -> aide normale en privé
        if(!isGroup){
          if(low.includes('verity') || text.length>3){
            await sock.sendMessage(chatId, { text: `Salut ! C'est Verity 💛 Je peux t'aider ici en privé si tu préfères pas parler dans le groupe. Dis-moi ton exo ou ce que tu bloques.` });
          }
          continue;
        }

        // ================== GROUPES ==================
        const isOfficial = config.GROUP_ID && chatId===config.GROUP_ID;
        const isConseil = config.CONSEIL_GROUP_ID && chatId===config.CONSEIL_GROUP_ID;
        const isAllowedGroup = !config.GROUP_ID || isOfficial || isConseil || (!config.CONSEIL_GROUP_ID);

        if(config.GROUP_ID && config.CONSEIL_GROUP_ID){
          if(!isOfficial && !isConseil) continue; // ignore autres groupes
        } else if(config.GROUP_ID && !isOfficial){
          continue;
        }

        const statut = getStatut();
        const estVocal = !!msg.message.audioMessage;
        const newMood = detectMood(text, low);
        if(newMood!==currentMood) setMood(newMood, sock);

        // Extinction & vocal (appliqué aux deux groupes)
        if(statut.status==='EXTINCTION'){
          await sock.sendMessage(chatId, { delete: msg.key });
          await sock.sendMessage(chatId, { text: `🌙 Extinction des feux - ${Math.floor(statut.heure)}h. Fermé jusqu'à ${statut.regle.debut}h.`, mentions: [senderId] });
          continue;
        }
        if(statut.status==='SANS_VOCAL' && estVocal){
          await sock.sendMessage(chatId, { delete: msg.key });
          await sock.sendMessage(chatId, { text: `🔇 Pas de vocal après ${statut.regle.finVocal}h stp @${senderId.split('@')[0]} 🙏`, mentions: [senderId] });
          continue;
        }

        // Filtre insultes - avec whitelist / blacklist
        const isInsulte = config.INSULTES.some(w=>low.includes(w));
        if(isInsulte){
          if(whitelist.includes(senderId)){
            // whitelist = on avertit mais on ban jamais
            await sock.sendMessage(chatId, { delete: msg.key });
            await sock.sendMessage(chatId, { text: `⚠️ @${senderId.split('@')[0]} on reste cool même en whitelist.`, mentions: [senderId] });
            // alerte privée admin
            if(config.ADMIN_NUMBER) await sock.sendMessage(config.ADMIN_NUMBER, { text: `ℹ️ Whitelist a insulté: @${senderId.split('@')[0]} dans ${isConseil?'conseil':'5eme'}: "${text.slice(0,100)}"`, mentions: [senderId] });
            continue;
          }
          if(blacklist.includes(senderId)){
            warns[senderId]=(warns[senderId]||0)+1;
            saveWarns();
            await sock.sendMessage(chatId, { delete: msg.key });
            await sock.sendMessage(chatId, { text: `🚫 @${senderId.split('@')[0]} est en liste noire. Message supprimé.`, mentions: [senderId] });
            if(config.ADMIN_NUMBER) await sock.sendMessage(config.ADMIN_NUMBER, { text: `🚨 Blacklist a parlé: @${senderId.split('@')[0]} dans ${isConseil?'conseil':'5eme'}\n"${text.slice(0,150)}"`, mentions: [senderId] });
            continue;
          }
          warns[senderId]=(warns[senderId]||0)+1;
          saveWarns();
          await sock.sendMessage(chatId, { delete: msg.key });
          if(warns[senderId] < config.LIMITES.avertissementsAvantBan){
            await sock.sendMessage(chatId, { text: `⚠️ @${senderId.split('@')[0]} courtois stp. Avertissement ${warns[senderId]}/${config.LIMITES.avertissementsAvantBan}`, mentions: [senderId] });
          } else {
            await sock.sendMessage(chatId, { text: `🔨 @${senderId.split('@')[0]} retiré ${config.LIMITES.dureeBanMinutes}min`, mentions: [senderId] });
            try{
              await sock.groupParticipantsUpdate(chatId, [senderId], "remove");
              setTimeout(async()=>{ try{ await sock.groupParticipantsUpdate(chatId, [senderId], "add"); warns[senderId]=0; saveWarns(); }catch(e){} }, config.LIMITES.dureeBanMinutes*60*1000);
            }catch(e){}
          }
          // Si c'est dans le groupe officiel, on prévient aussi le conseil en privé toi
          if(isOfficial && config.ADMIN_NUMBER && config.CONSEIL_GROUP_ID){
            await sock.sendMessage(config.ADMIN_NUMBER, { text: `🔔 Incident dans le groupe officiel:\n@${senderId.split('@')[0]} a insulté: "${text.slice(0,100)}"\nAvertissement ${warns[senderId]}\nTu veux que j'en parle dans le conseil ?`, mentions: [senderId] });
          }
          continue;
        }

        // Verity aide
        if(low.includes('verity')){
          if(blacklist.includes(senderId)) continue;
          if(isConseil){
            // Dans le conseil, elle est plus discrète, axée comportement
            await sock.sendMessage(chatId, { text: `Ok noté pour le conseil @${senderId.split('@')[0]}. Je le garde entre nous, je ne le dirai pas dans le groupe officiel. Tu veux que je prépare un résumé pour toi ?` , mentions: [senderId] });
          } else {
            if(low.includes('exercice')||low.includes('reponse')||low.includes('resous')){
              await sock.sendMessage(chatId, { text: `Je donne pas la réponse directe @${senderId.split('@')[0]} 😉 Dis où tu bloques, on fait ensemble. Ou viens en privé si tu préfères.` , mentions: [senderId] });
            } else {
              await sock.sendMessage(chatId, { text: `Oui je suis là @${senderId.split('@')[0]} ! Aide ici ou en privé, comme tu veux 🤝` , mentions: [senderId] });
            }
          }
        }

      }catch(e){ console.error(e); }
    }
  });
}

// startBot dans listen
