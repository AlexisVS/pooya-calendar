// Copy this file to "config.js" (same folder) and fill in the values: see README.md, section 2.
window.CALENDAR_CONFIG = {
  // OAuth client of type "Web application" (Google Cloud Console > Google Auth Platform > Clients).
  clientId: 'XXXXXXXXXXXX-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxxxxxx',

  // 'primary' = main calendar of the account that signs in.
  // Otherwise the calendar ID (Google Calendar > Settings and sharing > Integrate calendar > Calendar ID).
  calendarId: 'primary',

  // How often to sync with Google, in minutes.
  refreshMinutes: 5,
};
