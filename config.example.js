// Copiez ce fichier en « config.js » (même dossier) puis remplissez les valeurs : voir README.md.
window.CALENDAR_CONFIG = {
  // Client OAuth de type « Application Web » (Google Cloud Console > Google Auth Platform > Clients).
  clientId: 'XXXXXXXXXXXX-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxxxxxx',

  // 'primary' = agenda principal du compte qui se connecte.
  // Sinon, l'ID de l'agenda (Google Agenda > Paramètres de l'agenda > Intégrer l'agenda > ID de l'agenda).
  calendarId: 'primary',

  // Fréquence de synchronisation avec Google, en minutes.
  refreshMinutes: 5,
};
