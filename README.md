# Verity - Bot WhatsApp H24 Gratuit

## Horaires que tu voulais:
- Lundi a Samedi: 7h-20h tout, 20h-21h pas de vocal, 21h-7h EXTINCTION
- Dimanche: 7h-19h tout, 19h-20h pas de vocal, 20h-7h EXTINCTION

## Comment le mettre H24 gratuit sur Render.com:
1. Va sur render.com et cree un compte
2. New + > Web Service > Connecte ton repo GitHub avec ces fichiers
3. Build Command: npm install
   Start Command: npm start
   Plan: Free
4. Deploy > va sur ton-url.onrender.com/qr > scanne le QR avec le tel Verity
5. Mets Verity ADMIN de ton groupe WhatsApp
6. Envoie un message dans le groupe > va sur /logs > copie l'ID du groupe (1203...@g.us) > mets le dans config.js GROUP_ID > redeploy

Ca tournera meme quand ton ordi est eteint.

## Fichiers:
- index.js = le bot
- config.js = les horaires et blacklist
- package.json = dependances
