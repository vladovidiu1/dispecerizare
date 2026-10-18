# Relay

Interfață React și API Node.js/Express cu PostgreSQL pentru repartizarea emailurilor după competențe. Conectează Outlook/Microsoft 365, Gmail sau Yahoo, importă emailurile și le clasifică local cu Ollama. Un robot extern poate trimite în continuare mesaje prin API.

## Ce funcționează

- Organizații separate, utilizatori administrator/agent, autentificare cu parole hash scrypt și sesiuni în cookie HttpOnly, expirare după 8 ore, logout.
- Agenți, disponibilitate, capacitate, competențe și exemple de clasificare.
- Mesaje persistente, deduplicare pe adresă sursă + identificator extern, note interne, stare, repartizare și corecție manuală a competenței.
- Clasificare originală (model, versiune prompt, motiv, încredere) și istoric tranzacțional al modificărilor, cu autor și dată.
- Repartizare automată: competență validă + încredere ≥ 0,75 + agent activ/disponibil sub capacitate. Se alege cea mai mică încărcare relativă la capacitate; egalitățile se rezolvă determinist după ID. Procesările din aceeași firmă sunt serializate tranzacțional pentru a respecta capacitatea.
- Mesajele fără clasificare, cu încredere redusă sau fără agent eligibil rămân nealocate. Administratorul le poate repartiza manual oricărui utilizator activ din aceeași firmă, indiferent de competențe, disponibilitate sau capacitate (override explicit în istoric).
- Agenții pot citi, actualiza starea, adăuga note și corecta competența doar la mesajele proprii. Corectarea competenței reia distribuirea automată fără Ollama și readuce taskul la Nou; fără agent eligibil rămâne nealocat. Administratorii gestionează firma lor. Cheile robotului permit ingestie și citirea competențelor/exemplelor, fără acces la conversațiile din interfață.

## Pornire locală

Necesită Node.js **22.9+** (recomandat 24), npm și PostgreSQL 17 (instalat nativ sau în Docker). Nu crea un worktree: folosește checkout-ul existent.

1. `npm ci --cache /tmp/relay-npm-cache`
2. Copiază `.env.example` în `.env`. Completează o parolă PostgreSQL, `DATABASE_URL` (aceeași parolă, URL-encoded), numele firmei, emailul și o parolă inițială de administrator de minimum 12 caractere. Nu publica `.env`.
3. Pornește PostgreSQL nativ sau `docker compose up -d --wait db`. Pentru o instalare nativă Windows, configurează utilizatorul `postgres` și baza `relay` deja create; nu înlocui `.env` existent.
4. `npm run db:migrate`
5. O singură dată per firmă: `npm run db:bootstrap`. Notează `organizationId` afișat pentru autentificare. Comanda refuză să suprascrie un administrator existent. Elimină `ADMIN_PASSWORD` din `.env` după bootstrap.
6. `npm run api` într-un terminal.
7. `npm run dev` în alt terminal. Cu `VITE_API_ENABLED=true`, interfața afișează autentificarea. `APP_ORIGIN` trebuie să coincidă exact cu originea din browser (inclusiv host și port). Vite trimite `/api` către API-ul de pe portul 3001.

Autentificare: ID-ul firmei, emailul și parola create la bootstrap. În Echipă & competențe adaugă taguri, apoi agenți cu tagurile potrivite. Nu există date de autentificare implicite. Căsuțele se configurează în meniul **Căsuțe email**; cheile pentru roboți externi rămân disponibile prin API. Vezi [ghidul email](docs/email-setup.md) și [contractul API](docs/api.md).

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

Vezi [docs/api.md](docs/api.md) și [scripts/relay_client.py](scripts/relay_client.py). Excelul poate rămâne sursa robotului în prima etapă: tagurile trebuie asociate cu UUID-urile competențelor din API. Pentru folosirea bazei de date drept sursă unică, importul Excel și editarea/ștergerea exemplelor existente sunt pași ulteriori. Exemple noi pot fi adăugate în ecranul Test AI local.

Modelul propune competența; backendul stabilește agentul din configurația curentă. Nu trimite parole Outlook/Gmail sau conținutul Excelului în frontend. Încrederea declarată de model nu este o probabilitate calibrată: pragul inițial trebuie evaluat pe exemple reale anonimizate înainte de automatizarea pentru clienți.

## Găzduire

Frontendul și API-ul se pot servi de la aceeași origine: `VITE_API_ENABLED=true npm run build`, apoi `NODE_ENV=production npm run api`. Serverul servește și `dist/`. Setează `APP_ORIGIN` la adresa HTTPS publică și folosește un proxy HTTPS; cookie-urile sunt Secure în producție. `HOST=0.0.0.0` permite accesul din rețeaua containerului unde este necesar. Folosește PostgreSQL administrat, backupuri și conexiune TLS validată conform furnizorului; nu dezactiva verificarea certificatelor. Nu expune portul bazei de date public.

Dacă există un reverse proxy, configurează explicit `TRUST_PROXY_HOPS` la numărul de proxy-uri de încredere (implicit 0); nu folosi o valoare arbitrară. Configurația locală Docker este pentru dezvoltare. Datele sunt în volumul `relay_pgdata`; ștergerea volumului le șterge. Snapshotul unui mediu cloud nu garantează păstrarea volumelor Docker; pentru restaurare folosește backup PostgreSQL sau o bază administrată.

## Limite actuale

Nu sunt implementate trimiterea răspunsurilor, atașamente, gruparea conversațiilor după thread, import Excel, SSO/MFA, invitații/resetare parole, retenție/ștergere sau monitorizare operațională. Notele sunt interne și **nu trimit emailuri**. Interfața reîncarcă datele la 30 de secunde și paginează câte 100 de mesaje; indicatorii de stare sunt ai paginii curente, iar timpul mediu de răspuns nu este încă calculat. ID-ul organizației delimitează firma, dar nu este un secret.

Acesta este un MVP pentru dezvoltare, nu o instalare de producție completă. Conectarea robotului real și publicarea backendului cu autentificare și backupuri trebuie verificate înainte de introducerea mesajelor reale ale clienților.

## Testare cu Ollama local pe Windows

Cu aplicația și PostgreSQL deja configurate, instalează Ollama și rulează `ollama pull qwen3:8b`. Păstrează Ollama pornit. Backendul apelează implicit `http://127.0.0.1:11434`, modelul `qwen3:8b`; poți configura `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS` în `.env`. Endpointul de inferență acceptă numai adrese loopback HTTP, fără redirecționări. Modelul rulează pe aceeași mașină ca backendul. Nu expune Ollama în rețea.

Repornește `npm run api` și `npm run dev`. Autentifică-te ca administrator și deschide **Test AI local**. Adaugă exemple reprezentative asociate competențelor, apoi introdu subiectul și textul unui email și apasă **Clasifică și creează task**. Tagurile și exemplele sunt citite din PostgreSQL; nu sunt hardcodate în prompt. Primul apel poate dura câteva minute pe un laptop cu 16 GB RAM și 4 GB VRAM. Timeoutul implicit este 300 secunde. Procesul API admite un singur test AI simultan; monitorizarea rulează în fundal cât timp backendul este pornit. Pentru 24/7, calculatorul trebuie să rămână pornit fără sleep și procesul să fie administrat ca serviciu; installerul/serviciul Windows nu sunt încă împachetate.

Mesajul este salvat înainte de inferență. Rezultatul JSON trebuie să conțină un UUID de competență existent în firma curentă; tagurile inventate, răspunsurile invalide sau incertitudinea păstrează mesajul nealocat. Erorile apar în istoric. Un `requestId` stabil previne crearea unui al doilea task la retrimitere; un test nou din interfață generează un alt ID. Reluarea aceluiași ID nu repetă inferența. Repornirea API-ului în timpul clasificării lasă mesajul salvat pentru verificare, fără recuperare automată.

Pentru a limita memoria/contextul, testul acceptă maximum 60 de competențe și 6000 de caractere de email. Contextul este selectat prin căutare lexicală SQL în exemplele inițiale și emailurile confirmate de oameni: până la șase exemple, maximum două pe competență, cu subiect de maximum 150 de caractere și corp de maximum 400. Nu sunt incluse automat etichetele AI neconfirmate. Corecțiile umane înlocuiesc eticheta de referință a mesajului; duplicatelor exacte li se preferă cea mai recentă confirmare umană față de un exemplu inițial contradictoriu. Nu este fine-tuning sau căutare semantică prin embeddings. Dacă promptul depășește bugetul de caractere, exemplele cel mai slab clasate sunt eliminate treptat; dacă și configurația fără exemple este prea mare, mesajul rămâne pentru verificare. Estimarea de încredere a modelului nu este calibrată.

Testele automate folosesc un server Ollama simulat pentru contractul HTTP și un clasificator injectat pentru integrarea cu PostgreSQL. Nu validează acuratețea Qwen sau viteza pe laptopul clientului; acestea se verifică prin testul local.

Actualizare din ZIP pe Windows: oprește cele două terminale cu Ctrl+C, păstrează o copie privată a `.env`, descarcă arhiva actuală din GitHub și copiază conținutul ei peste folderul existent al aplicației. Păstrează `.env` și directorul privat `.relay` (dacă există); nu șterge baza PostgreSQL și nu rerula bootstrapul. Fă un backup PostgreSQL înainte de actualizare. Rulează `npm.cmd ci`, apoi `npm.cmd run db:migrate`, apoi repornește API-ul și interfața. Migrarea 002 adaugă confirmările umane, configurațiile email și coada persistentă fără să recreeze datele existente.

## Monitorizare și feedback uman

În **Căsuțe email** administratorul poate adăuga și autoriza conturi, verifica accesul, activa/opri monitorizarea, sincroniza manual și căuta în Inbox cu import explicit al rezultatelor. Outlook folosește OAuth device code și Microsoft Graph, Gmail/Yahoo folosesc IMAP TLS cu parole de aplicație. Acestea au cerințe externe distincte; vezi [ghidul de conectare](docs/email-setup.md). Nu se folosesc parole Outlook, nu se dezactivează verificarea TLS și nu se modifică starea citit/necitit a mesajelor.

La pornirea backendului, conexiunile activate își reiau monitorizarea (implicit 60 secunde). Cursorul Graph delta sau UIDVALIDITY/UID IMAP se păstrează în PostgreSQL; importul este deduplicat, iar un mesaj salvat și nereușit la checkpoint poate fi reimportat fără task dublu. O pagină/un lot are maximum 50 mesaje. Importul inițial este limitat la ultimele 1–90 zile, ales la creare. Căutarea citește cel mult 20 rezultate și nu creează taskuri până la Importă.

Joburile de clasificare sunt persistente. Inferența este serializată prin lock PostgreSQL, inclusiv față de testele manuale. O eroare de conectare la Ollama are maximum trei încercări, cu întârziere; un job rămas în lucru după întrerupere poate fi recuperat după expirarea lease-ului de 15 minute. Taskurile rămân în SQL chiar dacă modelul sau emailul sunt indisponibile. Administratorul poate reîncerca manual clasificarea unui task Nou/nealocat/neconfirmat. Mesajele IMAP mai mari de 2 MB păstrează metadatele și o indicație de verificare manuală, fără descărcarea corpului/atașamentelor. Corpul importat este limitat la 200.000 caractere; modelul primește maximum primele 6.000. Atașamentele nu sunt analizate.

Agentul sau administratorul poate apăsa **Confirmă tagul ca fiind corect**. Schimbarea tagului îl confirmă automat ca decizie umană. Un rezultat AI care sosește după o astfel de corecție este ignorat. Confirmarea nu reantrenează modelul și nu garantează acuratețea viitoare: furnizează exemple verificate pentru următoarele prompturi.

Credențialele sunt criptate AES-256-GCM în PostgreSQL, cu cheia în `.relay/credential.key` (sau directorul `RELAY_DATA_DIR`). Cheia și `.env` nu intră în Git sau în răspunsurile API; serverul de dezvoltare blochează accesul HTTP la `.relay`. Fă backup separat al cheii și configurează permisiunile Windows/OS pentru contul serviciului. Pierderea cheii impune restaurarea ei și repornirea backendului sau eliminarea configurației și reconectarea conturilor. Eliminarea/deconectarea unei configurații nu șterge taskurile deja importate și nu revocă automat acordul OAuth din contul furnizorului.

Testele pentru conectori folosesc Microsoft/IMAP simulate, nu conturi reale. Autorizarea tenantului, accesul la shared mailbox, politicile MFA/device-code și parolele de aplicație trebuie verificate la client.
