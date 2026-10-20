# Relay

**Gestionarea și distribuirea solicitărilor primite prin email, cu reguli configurabile și control uman.**

Relay conectează o căsuță Outlook/Microsoft 365, Gmail sau Yahoo, creează taskuri și le distribuie după competențele, disponibilitatea și încărcarea agenților. Administratorul configurează echipa, iar agenții lucrează într-o interfață web. Categoria este stabilită prin reguli explicite. Rezolvările agenților sunt păstrate și pot fi consultate alături de instrucțiunile ITL, prin căutare SQL. Nu este necesar niciun model AI.

| Informație          | Situație curentă                                                             |
| ------------------- | ---------------------------------------------------------------------------- |
| Versiune aplicație  | `0.2.0`                                                                      |
| Stadiu              | Pilot; evaluarea IT/Cyber Security și acceptanța operațională rămân necesare |
| Interfață / backend | React 19 / Node.js și Express 5                                              |
| Bază de date        | PostgreSQL 17/18; migrări `001`–`004`                                        |
| Dispecerizare       | Reguli stabilite de administrator; fără AI activ                             |
| Găzduire            | Windows 11 / Cloud PC sau server aprobat; acces HTTPS intern prin Caddy      |

## Documentație

**[Deschide centrul de documentație →](docs/README.md)**

| Ai nevoie să…                                  | Ghid                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Evaluezi produsul și limitele lui              | [Prezentare funcțională](docs/product-overview.md)                                         |
| Instalezi de la zero pe Windows / Cloud PC     | [Ghid de instalare](docs/installation-windows.md)                                          |
| Configurezi echipa și procesele                | [Manualul administratorului](docs/administrator-guide.md)                                  |
| Lucrezi ca agent                               | [Manualul agentului](docs/agent-guide.md)                                                  |
| Pregătești DNS, HTTPS și evaluarea IT          | [Ghid corporativ HTTPS](docs/corporate-https.md) · [Dosar de securitate](docs/security.md) |
| Conectezi o căsuță email                       | [Outlook, Gmail și Yahoo](docs/email-setup.md)                                             |
| Configurezi ITL PDF sau rapoarte EMMA          | [Workflow-uri locale](docs/local-workflows.md)                                             |
| Înțelegi implementarea și datele               | [Arhitectură](docs/architecture.md) · [Model de date](docs/data-model.md)                  |
| Faci backup, actualizare sau recuperare        | [Operare și recuperare](docs/operations.md)                                                |
| Investighezi o eroare                          | [Depanare](docs/troubleshooting.md)                                                        |
| Integrezi un robot extern sau contribui la cod | [API](docs/api.md) · [Dezvoltare](docs/development.md)                                     |
| Organizezi pilotul                             | [Plan de testare și acceptanță](docs/pilot-acceptance.md)                                  |

## Funcții disponibile

- Autentificare administrator/agent, separare pe organizații și acces la taskuri verificat în backend.
- Monitorizare Inbox, pornire numai de la momentul activării, reluare după checkpoint și import manual explicit.
- Reguli cu prioritate, condiții pe expeditor, subiect, text sau numele atașamentului; conflictele rămân pentru verificare.
- Repartizare după skill și numărul de taskuri deschise, respectând disponibilitatea și capacitatea; override manual pentru admin.
- Conversații actualizate pe același task, atașamente descărcabile, note interne și istoric.
- ITL PDF cu fragmente și pagini; rezolvări documentate, căutate lexical pentru sugestii viitoare.
- Transfer între colegi cu explicație și istoric; răspunsuri email din contul agentului, în conversația inițială.
- Rapoarte XLSX EMMA: un task pentru fiecare rând eligibil, după codurile configurate la agenți.
- Dashboarduri, schimbarea parolei proprii și dezactivarea/reactivarea conturilor.

## Pornire rapidă pentru o instalare deja configurată

Necesită Node.js 24 recomandat, PostgreSQL pornit și `.env` completat. Pentru prima instalare urmează [ghidul Windows](docs/installation-windows.md), inclusiv crearea bazei și a administratorului.

```powershell
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run api
```

În alt terminal, pentru dezvoltare/pilot local:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Deschide `http://localhost:5173`, cu `APP_ORIGIN=http://localhost:5173` și `VITE_API_ENABLED=true`. Pentru colegi, folosește [profilul HTTPS](docs/corporate-https.md), nu serverul Vite de dezvoltare. Agenții au nevoie numai de browser și cont în aplicație.

## Date, securitate și limite

SQL și documentele rămân pe infrastructura unde instalezi aplicația. Citirea și trimiterea emailurilor necesită conexiuni către furnizorul respectiv. `.env`, `.relay`, cheile TLS și backupurile sunt private și nu se publică în GitHub.

Versiunea curentă nu include SSO/MFA, recuperarea parolelor uitate, OCR, antivirus integrat, retenție automată sau installer/servicii Windows. Notele interne nu trimit emailuri. Un certificat HTTPS și testele automate nu reprezintă aprobarea Cyber Security; vezi [controalele și riscurile cunoscute](docs/security.md).

Fără `VITE_API_ENABLED=true`, interfața poate porni în modul demonstrativ cu date în memorie. Demo-ul nu este o instalare funcțională a backendului.

## Actualizarea unei instalări existente

Urmează [migrarea la reguli și colaborare](docs/rules-and-collaboration.md). Fă backup înainte, păstrează `.env` și `.relay`, rulează `npm.cmd ci` și `npm.cmd run db:migrate`, apoi reconstruiește interfața. Nu rerula bootstrapul. Datele AI din SQL și codul arhivat în `archive/ai` sunt păstrate, fără a fi folosite de aplicația activă.
