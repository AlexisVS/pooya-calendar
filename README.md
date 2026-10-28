# Calendrier de Pooya

Calendrier mensuel plein écran, synchronisé avec Google Agenda, pensé pour un écran **non tactile** au format A4 en paysage. Thème inspiré de Google Agenda.

Les cases sont blanches, et jaune soleil dès qu'elles contiennent un rendez-vous. Les autres repères :

| Jour | Affichage |
| --- | --- |
| Avec rendez-vous (passé ou futur) | fond jaune soleil |
| Aujourd'hui avec rendez-vous | fond violet (la case violette suit le jour courant, elle avance chaque nuit) |
| Aujourd'hui | bordure verte épaisse, numéro dans une pastille verte ; rendez-vous en rouge (point, heure et titre) |
| Futur | rendez-vous avec un point violet (barre violette pour une journée entière) |
| Passé | numéro et rendez-vous en vert |

Le calendrier occupe tout l'écran. Chaque cellule montre jusqu'à trois événements (point, heure, titre tronqué) puis « +N autres ». Les données se rafraîchissent toutes les 5 minutes.

Maquette de référence, faite dans Claude Design (accès sur invitation) : <https://claude.ai/artifact/Atn2ArQ9TPa3oBQn8vXtMT>. Ses fichiers sources sont versionnés dans [`design/`](design/) :

| Fichier | Écran |
| --- | --- |
| `design/Main.dc.html` | écran principal, vu le 28 octobre 2026 |
| `design/Ecran-29-octobre.dc.html` | même écran, vu le lendemain (29 octobre), pour vérifier le passage d'un jour à l'autre |
| `design/Connexion.dc.html` | écran de première connexion |
| `design/canvas.json` | disposition des écrans sur le canevas |

---

## Architecture

**Aucun serveur à faire tourner.** L'application n'est qu'un ensemble de fichiers statiques (HTML, CSS, JS sans dépendance ni build), déposés sur un hébergement gratuit. Tout se passe dans le navigateur de l'écran.

```
 Écran (navigateur)                                   Google
┌───────────────────────────────┐   1 fois    ┌─────────────────────────┐
│ index.html + js/              │ ──────────▶ │ accounts.google.com     │
│  auth.js         OAuth + PKCE │  connexion  │ (consentement)          │
│  google-calendar.js  API v3   │             ├─────────────────────────┤
│  calendar.js   logique pure   │ ◀─────────▶ │ oauth2.googleapis.com   │
│  app.js        affichage      │ toutes les  │ (renouvellement jeton)  │
│ localStorage : refresh token  │   5 min     ├─────────────────────────┤
│               + cache         │ ◀─────────▶ │ Calendar API v3         │
└───────────────────────────────┘             └─────────────────────────┘
```

- **Pourquoi un refresh token ?** Un écran sans tactile ne peut pas cliquer sur « Se connecter » toutes les heures. L'application utilise le flux OAuth « authorization code + PKCE » : après une seule connexion, elle reçoit un *refresh token* et renouvelle ensuite seule ses jetons d'accès, sans interaction.
- **Lecture seule** : portée `calendar.events.readonly`. L'application ne peut rien modifier.
- **Hors ligne** : le dernier état est gardé en cache. L'écran reste lisible et indique « Hors ligne, données de HH:MM ».
- **Kiosque** : passage à minuit automatique, écran maintenu allumé (Wake Lock), curseur masqué, rechargement nocturne vers 3 h pour prendre les mises à jour.

```
index.html            structure des deux écrans (calendrier, connexion)
styles.css            thème et mise en page (1400 × 990 px de référence, mise à l'échelle auto)
config.example.js     modèle de configuration → à copier en config.js
js/app.js             rendu, synchronisation, horloge, clavier
js/auth.js            OAuth 2.0 + PKCE, renouvellement des jetons
js/google-calendar.js appels à l'API Google Calendar
js/calendar.js        calculs de dates (grille, couleurs, regroupements), sans DOM
js/demo.js            données fictives du mode démo
tests/                tests de la logique (node --test)
```

---

## 1. Essayer tout de suite (mode démo)

Sans compte Google, avec des événements fictifs :

```bash
python3 -m http.server 8765        # ou : npx serve -l 8765
```

Ouvrez <http://localhost:8765/?demo>.

> Ouvrir `index.html` directement (adresse `file://`) ne marche pas : les modules JS et Google exigent une adresse `http(s)://`.

Tests de la logique de dates (Node ≥ 20) : `npm test`.

---

## 2. Configurer l'API Google Calendar

À faire une fois, idéalement avec le compte Google de Pooya, dans la [Google Cloud Console](https://console.cloud.google.com/).

1. **Créer un projet** : menu des projets → *Nouveau projet* → « Calendrier Pooya ».
2. **Activer l'API** : *API et services → Bibliothèque* → « Google Calendar API » → *Activer*.
3. **Écran de consentement** : *Google Auth Platform* (anciennement « Écran de consentement OAuth ») → *Commencer*.
   - *Branding* : nom « Calendrier de Pooya », e-mail d'assistance.
   - *Audience* : **Externe** (compte Gmail) ou **Interne** (Google Workspace, recommandé si disponible).
   - *Accès aux données* → *Ajouter des champs d'application* → `https://www.googleapis.com/auth/calendar.events.readonly`.
   - **Important, en Externe** : dans *Audience*, cliquez sur **Publier l'application** (statut « En production »). En mode « Test », Google invalide le refresh token **au bout de 7 jours** et l'écran se déconnecterait chaque semaine. Aucune validation Google n'est nécessaire pour un usage personnel. Pendant la connexion, Google affichera seulement « Google n'a pas validé cette application » : cliquez sur *Paramètres avancés → Accéder à Calendrier de Pooya*.
4. **Créer le client OAuth** : *Clients → Créer un client* → type **Application Web**.
   - *Origines JavaScript autorisées* : l'adresse du site, par ex. `https://calendrier-pooya.netlify.app` (et `http://localhost:8765` pour tester en local).
   - *URI de redirection autorisées* : la même adresse **avec la barre finale**, par ex. `https://calendrier-pooya.netlify.app/` (et `http://localhost:8765/`).
   - Notez l'**ID client** et le **code secret du client**.
5. **Remplir la configuration** : copiez `config.example.js` en `config.js` et renseignez :

   ```js
   window.CALENDAR_CONFIG = {
     clientId: '1234…apps.googleusercontent.com',
     clientSecret: 'GOCSPX-…',
     calendarId: 'primary',   // ou l'ID d'un autre agenda
     refreshMinutes: 5,
   };
   ```

   `primary` désigne l'agenda principal du compte qui se connecte. Pour un autre agenda, prenez son identifiant dans Google Agenda : *Paramètres de l'agenda → Intégrer l'agenda → ID de l'agenda*. Le compte qui se connecte doit y avoir accès.

---

## 3. Mettre en ligne et lancer l'application

N'importe quel hébergement de fichiers statiques en HTTPS convient. Le plus simple :

- **Netlify** : créez un compte gratuit, puis glissez-déposez le dossier (avec `config.js`) sur <https://app.netlify.com/drop>. Sans compte, le site est supprimé au bout d'une heure. Renommez le site dans *Site configuration* pour avoir une adresse stable.
- **Cloudflare Pages** fonctionne de la même façon (*Workers & Pages → Créer → Pages → Importer des fichiers*).
- **GitHub Pages** convient aussi, mais `config.js` serait visible dans le dépôt s'il est public (voir *Sécurité*).

Reportez ensuite l'adresse exacte du site dans le client OAuth (étape 2.4), puis ouvrez-la.

### Première connexion sur l'écran

1. Branchez temporairement un clavier et une souris (USB ou Bluetooth).
2. Ouvrez l'adresse du site : l'écran « Calendrier de Pooya » s'affiche. Appuyez sur Entrée ou cliquez sur *Se connecter avec Google*.
3. Choisissez le compte, acceptez l'accès en lecture aux événements.
4. Le calendrier s'affiche. Débranchez le clavier et la souris.

Par sécurité, vous pouvez ensuite vous déconnecter de Google dans ce navigateur : le calendrier continue de fonctionner, car il n'utilise que son propre jeton en lecture seule.

---

## 4. Afficher en plein écran sur la tablette

Dans tous les cas : désactivez la mise en veille de l'écran dans les réglages de l'appareil, et laissez-le branché.

**Android** (recommandé : [Fully Kiosk Browser](https://www.fully-kiosk.com/))
1. Installez Fully Kiosk Browser, mettez l'adresse du site en *Start URL*.
2. Activez *Keep Screen On*, *Launch on Boot* et *Hide Status Bar*.
3. Faites la première connexion Google **dans** Fully Kiosk (chaque navigateur a son propre stockage).

Sans application tierce : Chrome → menu ⋮ → *Ajouter à l'écran d'accueil* / *Installer l'application*. Elle s'ouvre alors en plein écran et en paysage, grâce au manifeste. Activez aussi *Options pour les développeurs → Rester activé* (écran allumé pendant la charge).

**iPad**
1. Safari → *Partager → Sur l'écran d'accueil*, puis ouvrez l'icône : l'application s'affiche sans barre d'adresse.
2. Faites la connexion Google **depuis cette icône** : son stockage est séparé de celui de Safari.
3. *Réglages → Luminosité et affichage → Verrouillage automatique : Jamais*. Pour verrouiller l'écran sur l'application : *Réglages → Accessibilité → Accès guidé*.

**Écran branché sur un PC, un mini-PC ou un Raspberry Pi**
```bash
chromium --kiosk --noerrdialogs --disable-session-crashed-bubble https://calendrier-pooya.netlify.app/
# Windows : "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk https://…
```
Ajoutez la commande au démarrage de la session, et désactivez la veille du système.

---

## Utilisation

Aucune interaction n'est nécessaire : l'écran affiche le mois en cours et se met à jour seul.

Pour parcourir l'année, l'en-tête reprend la navigation de Google Agenda : les flèches ‹ › passent au mois précédent ou suivant, et « Aujourd'hui » revient au mois en cours. Ces boutons marchent à la souris, et aussi au clavier :

| Touche | Action |
| --- | --- |
| ← / → (ou Page préc. / suiv.) | mois précédent / suivant |
| Origine, Échap ou T | retour au mois en cours |

Après 2 minutes sur un autre mois, l'écran revient seul au mois en cours. Un mois déjà consulté s'affiche immédiatement, sans attendre Google, puis se rafraîchit.

Paramètres d'adresse : `?demo` (données fictives), `?month=2026-12` (afficher un mois fixe), `?deconnexion` (révoque le jeton et revient à l'écran de connexion).

---

## Sécurité

- **Le code secret du client est lisible dans `config.js`.** Google l'exige pour un client « Application Web », même avec PKCE. À lui seul, il ne donne accès à aucune donnée : il faut aussi le refresh token, qui n'existe que dans le navigateur de l'écran. Ne publiez pas `config.js` dans un dépôt public (il est dans `.gitignore`).
- Le refresh token ne donne qu'une lecture des événements. Il est révocable à tout moment depuis <https://myaccount.google.com/permissions> ou avec `?deconnexion`.

---

## Dépannage

| Symptôme | Cause et solution |
| --- | --- |
| `redirect_uri_mismatch` chez Google | L'URI de redirection du client doit être exactement l'adresse ouverte, barre finale comprise (`https://…/`). |
| « La connexion à Google a expiré » chaque semaine | Application restée en mode « Test » : publiez-la (étape 2.3), puis reconnectez l'écran. |
| « L'API Google Calendar n'est pas activée… » | Étape 2.2 oubliée, ou activée dans un autre projet que celui du client OAuth. |
| « Agenda introuvable… » | `calendarId` incorrect, ou le compte connecté n'a pas accès à cet agenda. |
| « Google exige une adresse sécurisée » | Le site est ouvert en `http://` sur une adresse réseau : utilisez l'adresse `https://` de l'hébergement. |
| Heures décalées | Vérifiez le fuseau horaire réglé sur l'appareil : l'affichage suit celui de l'écran. |
| L'écran se met en veille | Réglez la veille de l'appareil. Le maintien automatique (Wake Lock) ne fonctionne qu'en HTTPS. |
