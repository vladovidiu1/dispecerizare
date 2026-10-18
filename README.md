# Relay

Interfață React și API Node.js/Express cu PostgreSQL pentru repartizarea emailurilor după competențe. Independent de Outlook/Gmail/Yahoo: robotul existent citește emailul, apelează Ollama și trimite un payload normalizat către API.

## Ce funcționează

- Organizații separate, utilizatori administrator/agent, autentificare cu parole hash scrypt și sesiuni în cookie HttpOnly, expirare după 8 ore, logout.
- Agenți, disponibilitate, capacitate, competențe și exemple de clasificare.
- Mesaje persistente, deduplicare pe adresă sursă + identificator extern, note interne, stare, repartizare și corecție manuală a competenței.
- Clasificare originală (model, versiune prompt, motiv, încredere) și istoric tranzacțional al modificărilor, cu autor și dată.
- Repartizare automată: competență validă + încredere ≥ 0,75 + agent activ/disponibil sub capacitate. Se alege cea mai mică încărcare relativă la capacitate; egalitățile se rezolvă determinist după ID. Procesările din aceeași firmă sunt serializate tranzacțional pentru a respecta capacitatea.
- Mesajele fără clasificare, cu încredere redusă sau fără agent eligibil rămân nealocate. Administratorul le poate repartiza manual, inclusiv peste capacitate (override explicit în istoric).
- Agenții pot citi și actualiza starea/adăuga note doar la mesajele proprii. Administratorii gestionează firma lor. Cheile robotului permit ingestie și citirea competențelor/exemplelor, fără acces la conversațiile din interfață.

## Pornire locală

Necesită Node.js **22.9+** (recomandat 24), npm și Docker cu Compose. Nu crea un worktree: folosește checkout-ul existent.

1. `npm ci --cache /tmp/relay-npm-cache`
2. Copiază `.env.example` în `.env`. Completează o parolă PostgreSQL, `DATABASE_URL` (aceeași parolă, URL-encoded), numele firmei, emailul și o parolă inițială de administrator de minimum 12 caractere. Nu publica `.env`.
3. `docker compose up -d --wait db`
4. `npm run db:migrate`
5. O singură dată per firmă: `npm run db:bootstrap`. Notează `organizationId` afișat pentru autentificare. Comanda refuză să suprascrie un administrator existent. Elimină `ADMIN_PASSWORD` din `.env` după bootstrap.
6. `npm run api` într-un terminal.
7. `npm run dev` în alt terminal. Cu `VITE_API_ENABLED=true`, interfața afișează autentificarea. `APP_ORIGIN` trebuie să coincidă exact cu originea din browser (inclusiv host și port). Vite trimite `/api` către API-ul de pe portul 3001.

Autentificare: ID-ul firmei, emailul și parola create la bootstrap. În Echipă & competențe adaugă taguri, apoi agenți cu tagurile potrivite. Nu există date de autentificare implicite. Administrarea adreselor sursă și a cheilor robotului este disponibilă momentan prin API; vezi [contractul API](docs/api.md).

**Demo original:** fără `VITE_API_ENABLED=true`, `npm run dev` păstrează interfața demonstrativă cu date în memorie. StackBlitz poate afișa acest demo; nu găzduiește automat API-ul și PostgreSQL.

## Verificări

```sh
npm run build
# TEST_DATABASE_URL trebuie să indice o bază de dezvoltare cu permisiune CREATE SCHEMA.
# Testele creează și șterg doar o schemă aleatoare proprie; nu golesc tabelele aplicației.
npm run test:api
```

Testele de integrare folosesc PostgreSQL real: sesiuni, drepturi, izolare firme, rollback, dubluri, repartizare concurentă, capacitate, coadă de verificare, istoric, note și revocarea cheilor. `npm run db:migrate` poate fi repetat și folosește lock tranzacțional.

## Integrarea robotului

Vezi [docs/api.md](docs/api.md) și [scripts/relay_client.py](scripts/relay_client.py). Excelul poate rămâne sursa robotului în prima etapă: tagurile trebuie asociate cu UUID-urile competențelor din API. Pentru folosirea bazei de date drept sursă unică, importul Excel și editarea exemplelor din interfață sunt pași ulteriori; API-ul are deja endpointuri pentru exemple.

Modelul propune competența; backendul stabilește agentul din configurația curentă. Nu trimite parole Outlook/Gmail sau conținutul Excelului în frontend. Încrederea declarată de model nu este o probabilitate calibrată: pragul inițial trebuie evaluat pe exemple reale anonimizate înainte de automatizarea pentru clienți.

## Găzduire

Frontendul și API-ul se pot servi de la aceeași origine: `VITE_API_ENABLED=true npm run build`, apoi `NODE_ENV=production npm run api`. Serverul servește și `dist/`. Setează `APP_ORIGIN` la adresa HTTPS publică și folosește un proxy HTTPS; cookie-urile sunt Secure în producție. `HOST=0.0.0.0` permite accesul din rețeaua containerului unde este necesar. Folosește PostgreSQL administrat, backupuri și conexiune TLS validată conform furnizorului; nu dezactiva verificarea certificatelor. Nu expune portul bazei de date public.

Dacă există un reverse proxy, configurează explicit `TRUST_PROXY_HOPS` la numărul de proxy-uri de încredere (implicit 0); nu folosi o valoare arbitrară. Configurația locală Docker este pentru dezvoltare. Datele sunt în volumul `relay_pgdata`; ștergerea volumului le șterge. Snapshotul unui mediu cloud nu garantează păstrarea volumelor Docker; pentru restaurare folosește backup PostgreSQL sau o bază administrată.

## Limite actuale

Nu sunt implementate conectoare OAuth/IMAP, trimiterea răspunsurilor, atașamente, gruparea conversațiilor după thread, apelarea Ollama de backend, coadă de joburi/reîncercări, import Excel, SSO/MFA, invitații/resetare parole, retenție/ștergere sau monitorizare operațională. Notele sunt interne și **nu trimit emailuri**. Interfața reîncarcă datele la 30 de secunde și paginează câte 100 de mesaje; indicatorii de stare sunt ai paginii curente, iar timpul mediu de răspuns nu este încă calculat. ID-ul organizației delimitează firma, dar nu este un secret.

Acesta este un MVP pentru dezvoltare, nu o instalare de producție completă. Conectarea robotului real și publicarea backendului cu autentificare și backupuri trebuie verificate înainte de introducerea mesajelor reale ale clienților.
