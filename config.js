module.exports = {
  // Laisse vide au début, le bot va te dire l'ID dans les logs
  GROUP_ID: "",
  // Ton numéro admin pour les alertes privées (format international sans +)
  // Ex: 33762651731 pour 07 62 65 17 31 -> le bot t'enverra un message privé
  ADMIN_NUMBER: "33762651731@s.whatsapp.net",

  HORAIRES: {
    // Lundi à Samedi
    semaine: { debut: 7, finVocal: 20, finTotal: 21 },
    // Dimanche - extinction à 20h comme tu voulais
    dimanche: { debut: 7, finVocal: 19, finTotal: 20 }
  },

  BLACKLIST: [], // Ex: ["33612345678@s.whatsapp.net"]

  LIMITES: {
    avertissementsAvantBan: 2,
    dureeBanMinutes: 60
  },

  INSULTES: ["fdp","ntm","tg","connard","connasse","pute","salope","encule"]
}
