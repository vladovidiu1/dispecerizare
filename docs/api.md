# Referință API — Relay 0.2.0

[Documentație](README.md) · [Arhitectură](architecture.md) · [Securitate](security.md)

Toate rutele sunt sub `/api`. JSON UTF-8, identificatori UUID. Cookie-urile utilizatorilor și cheile robotului sunt mecanisme separate. Niciun endpoint nu acceptă `organizationId` ca override după autentificare: firma este extrasă din sesiune/cheie.

## Administrator și utilizatori

`POST /auth/login` cu `{ "organizationId": "UUID", "email": "...", "password": "..." }` creează un cookie HttpOnly. `GET /auth/me` returnează utilizatorul; `POST /auth/logout` invalidează sesiunea. Pentru cereri din browser, păstrează aceeași origine și cookie-ul. Browserul nu primește cheia robotului la autentificare.

| Metodă și rută                   | Utilizare                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET /health                      | Verifică și conexiunea la PostgreSQL; fără autentificare                                                |
| GET /skills                      | Competențe `{id,name}`; utilizator sau robot                                                            |
| POST /skills                     | Admin: `{name}`                                                                                         |
| GET /examples                    | Exemple `{id,skillId,subject,body}`, maximum 1000; utilizator sau robot                                 |
| POST /examples                   | Admin: `{skillId,subject,body}`                                                                         |
| GET /agents                      | Utilizator: agenți, competențe, disponibilitate, capacitate, încărcare                                  |
| POST /agents                     | Admin: `{name,email,password,skills:[UUID],capacity:20,emmaCodes:[string]}`; parola ≥12 caractere       |
| PATCH /agents/:id                | Admin: oricare dintre `{available,active,capacity,skills:[UUID],emmaCodes:[string]}`                    |
| GET /mailboxes                   | Admin: adrese sursă `{id,provider,address}`                                                             |
| POST /mailboxes                  | Admin: `{provider:"outlook",address:"shared@example.com"}`; provider este text liber                    |
| POST /keys                       | Admin: `{name:"Robot ingestie"}` → `{id,token}`; tokenul se returnează o singură dată                   |
| DELETE /keys/:id                 | Admin: revocă imediat cheia                                                                             |
| GET /messages?limit=100&offset=0 | `{items,total,limit,offset}`; limit 1–200; agentul vede doar mesajele proprii                           |
| PATCH /messages/:id              | `{status,assignedTo,skillId,priority}`; agentul poate modifica starea sau competența unui mesaj propriu |
| GET /messages/:id/history        | Evenimente în ordine cronologică, cu autor și datele schimbării                                         |
| GET /messages/:id/notes          | Note interne, autor și dată                                                                             |
| POST /messages/:id/notes         | `{body}`; salvează o notă internă, fără trimitere email                                                 |

Statusuri: `Nou`, `În lucru`, `Rezolvat`. Priorități: `Scăzută`, `Medie`, `Ridicată`. `assignedTo:null` dezalocă mesajul; `skillId:null` elimină competența manuală. Repartizarea manuală nu șterge clasificarea originală. Schimbarea efectivă a competenței, fără `assignedTo` explicit, readuce taskul la `Nou`, elimină repartizarea anterioară și selectează automat un utilizator eligibil după competență, disponibilitate și capacitate. Lipsa unui agent eligibil lasă taskul nealocat cu eveniment `review_required`. Schimbarea către aceeași competență nu reia distribuirea. Agentul trebuie să aleagă o competență validă, nenulă, din aceeași firmă; nu poate schimba prioritatea; predarea explicită folosește ruta transfer. Trimite corecția competenței separat de actualizarea stării. Administratorul poate trimite `skillId` și `assignedTo` împreună pentru o corecție și repartizare explicită, fără restricții de competență/disponibilitate/capacitate; ținta trebuie să fie activă și din aceeași firmă. Istoricul păstrează autorul corecției, vechiul/noul tag, starea și responsabilul. Taskurile nealocate etichetate prin regulă sau confirmate de om pot fi distribuite în fundal când apare capacitate. Cele fără regulă sau cu conflict rămân pentru verificare.

Administrează cheile dintr-un client API autentificat cu cookie sau din consola browserului autentificat folosind `fetch('/api/keys', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Robot'})})`. Păstrează tokenul doar în configurarea securizată a robotului. Nu îl include în repository, URL, loguri sau în variabile `VITE_*`. Baza de date păstrează numai hashul tokenului.

## Robot: POST /ingest

Trimite `Authorization: Bearer <token>` și `Content-Type: application/json` prin HTTPS. Această rută este independentă de furnizor; conectorii integrați Microsoft Graph și IMAP sunt disponibili separat prin configurarea căsuțelor.

```json
{
  "mailboxId": "UUID primit la crearea adresei sursă",
  "externalId": "identificator-stabil-din-furnizor",
  "threadId": "identificator-conversatie-optional",
  "senderName": "Nume client",
  "senderEmail": "client@example.com",
  "subject": "Clarificare factură",
  "body": "Textul simplu al mesajului, fără HTML",
  "receivedAt": "2026-10-18T10:00:00Z",
  "priority": "Medie"
}
```

Câmpul `classification` nu mai este acceptat: schema strictă îl respinge cu 400. Emailul nou eligibil este salvat și pus în dispatch_jobs pentru evaluarea regulilor. Backendul alege agentul; ingestia nu acceptă assignedTo sau skillId arbitrar.

Răspuns: `201 {id,duplicate:false,updated}` la prima inserare sau actualizare de conversație; `200 {id,duplicate:true,updated}` la retrimiterea aceluiași `(mailboxId,externalId)`. Retrimiterea nu reclasifică și nu suprascrie mesajul existent. Normalizează și păstrează ID-ul stabil (de exemplu ID imuabil Outlook, ID Gmail sau UID + UIDVALIDITY IMAP). Nu folosi subiectul sau ora de procesare drept ID. Același ID în două adrese sursă diferite reprezintă două mesaje distincte. Un email nou cu referințe valide poate actualiza același task (`updated:true`), păstrând intrarea proprie în conversație.

Robotul confirmă emailul drept procesat doar după 200/201. La timeout poate retrimite exact același identificator. La 401 verifică/revocă cheia; la 400 corectează payloadul sau trimite în coada de verificare; la 429/5xx aplică reîncercări cu întârziere progresivă și checkpoint persistent. Această logică rămâne în robot în versiunea curentă.

Client Python fără dependențe externe: `scripts/relay_client.py`, cu `RELAY_API_URL` și `RELAY_API_KEY` în mediu. Funcția `send_email(payload)` trimite rezultatul robotului, configurația pentru exemple rămâne păstrată în SQL pentru viitor, fără consum în runtime.

## Erori și limite

Erori JSON `{error,issues?}`: 400 validare, 401 autentificare, 403 drepturi/origine, 404 resursă inexistentă sau inaccesibilă, 409 conflict de configurare/stare sau resursă ocupată, 413 payload prea mare, 429 limită de cereri, 500 eroare internă. API-ul limitează cererile la 300/minut/IP și autentificările la 20/15 minute/IP; schimbarea parolei are maximum 10 cereri/15 minute/utilizator. Corpul JSON are maximum 300 KB (rutele de încărcare binară au limite separate); text mesaj maxim 200.000 caractere. Interogările sunt parametrizate; HTML-ul nu este randat în interfață.

Istoricul este append-only prin API, nu un jurnal criptografic sau protejat împotriva unui administrator al bazei de date.

## Reguli administrative

- `GET /dispatch-rules`: regulile organizației.
- `POST /dispatch-rules`: `{name,priority:100,enabled:false,matchMode:"all",skillId:UUID,conditions:[{field:"subject",operator:"contains",value:"factura"}]}` → 201 `{id}`.
- `PUT /dispatch-rules/:id`: aceeași schemă completă, actualizare scoped; 404 în afara organizației.
- `DELETE /dispatch-rules/:id`: elimină regula; păstrează snapshotul din deciziile anterioare.
- `POST /dispatch-rules/preview`: `{senderEmail,subject,body,attachmentNames?:[string]}` → `{outcome,skillId,ruleId,matchedRules}`; nu creează task. outcome: matched/no_match/ambiguous.
- `POST /dispatch-rules/test-message`: `{requestId:UUID,senderEmail,subject,body}` → 201 `{id,duplicate,updated,entryId}`; test persistent, aplică regulile imediat. Repetarea requestId returnează 200, fără reevaluare. Nu trimite email.

Toate aceste rute cer admin. Câmpuri: senderEmail, senderDomain, subject, body, text, attachmentName. Operatori: contains, equals, starts_with, not_contains. Numele fișierului este testat individual; not_contains cere să nu existe niciun atașament cu termenul exclus. 1–20 condiții, valori 1–250 caractere, prioritate 1–10000, all/any. Compararea ignoră majuscule, diacritice și diferențe de spații consecutive. Prioritatea minimă câștigă; skilluri diferite la aceeași prioritate produc ambiguous. Detaliile matchedRules sunt snapshotul regulilor potrivite, inclusiv cele cu prioritate inferioară neaplicată.

`POST /messages/:id/redispatch` (admin) → 202 `{queued:true}`, numai pentru Nou, nealocat, neconfirmat de om. Joburile active sunt în dispatch_jobs; lease 2 minute, maximum 3 încercări la erori. `POST /messages/:id/confirm-tag` păstrează tagul ca decizie umană, fără altă repartizare. `tagSource` poate fi rule/human/ai/null, ai fiind numai istoric.

Rutele `/ai/*` și `POST /messages/:id/itl` răspund 410 și nu apelează modele. Exemplele și istoricul AI rămân în SQL. Nu există flag care să reactiveze inferența.

## Rezolvări și predare

- `GET /messages/:id/resolutions`: `{id,summary,steps,shareable,createdAt,authorName}[]`.
- `POST /messages/:id/resolutions`: `{summary,steps,shareable:true,resolveTask:false}` → 201 `{id}`; rezumat 5–300, pași 10–20000 caractere. Opțional marchează Rezolvat. Înregistrare append-only prin API.
- `GET /messages/:id/suggestions`: maximum 5 rezolvări partajate, de pe alte taskuri rezolvate, cu același skill când taskul are skill și termeni comuni; fără corpul emailului sau ID-ul taskului sursă. Căutare lexicală SQL, fără AI.
- `POST /messages/:id/transfer`: `{assignedTo:UUID,reason:string}` → 204; motiv 5–4000 caractere. Cere acces la task, destinatar activ în organizație, diferit de responsabilul curent. Păstrează tagul și datele, resetează la Nou, auditează predarea, anulează dispatch_jobs și emailurile queued. Nu restrânge manual skillul/capacitatea. Un email sending produce 409.

Agenții au acces numai la taskurile proprii, administratorul la cele ale organizației. Un fost responsabil agent pierde accesul după transfer.

## Identitate personală de expediere

- `GET /sender-account`: null sau metadate `{id,provider,address,authorized,lastError}`, fără credențiale.
- `PUT /sender-account`: Outlook `{provider:"outlook",address,clientId:UUID,tenant:"organizations"}`; tenant poate fi UUID, organizations, common sau consumers. Gmail/Yahoo `{provider,address,appPassword}`. Configurație strictă, host fix. Returnează `{ok:true}`, nu trimite email. Schimbarea incrementează revision și invalidează flow-urile vechi.
- `POST /sender-account/authorize`: Microsoft `{flowId,userCode,verificationUri,interval}`; niciodată device_code/token privat.
- `POST /sender-account/authorization/:id`: `{pending,interval}` sau `{pending:false,ok:true}`; flow-ul este legat de utilizator și organizație.
- `POST /sender-account/check`: verifică autorizarea, fără email de test.
- `DELETE /sender-account`: elimină credențialele și anulează queued, păstrând istoricul.

Toate cer utilizator autentificat și operează numai identitatea lui. Microsoft folosește Mail.Send, User.Read, offline_access și `/me/sendMail`, nu Send As/shared. Contul autorizat trebuie să corespundă adresei configurate. SMTP Gmail/Yahoo folosește TLS verificat, port 465, parola de aplicație. Credențialele sunt criptate cu cheia locală.

## Reply și outbox

`POST /messages/:id/reply` cu `{requestId:UUID,body}` → 202 `{id,state,duplicate}`. Text simplu 1–20000 caractere. Expeditorul este contul autorizat al actorului, destinatarul expeditorul primului email inbound al taskului (pentru EMMA, al părintelui), Reply-To este căsuța monitorizată. In-Reply-To și References indică Message-ID inițial; un email fără ID valid este refuzat cu 400. Nu există destinatari arbitrari, CC/BCC sau atașamente din request.

Repetă același requestId și același text/task după o eroare de rețea; alt conținut cu aceeași cheie produce 409. Alt răspuns queued/sending/unknown pe același task produce 409. Workerul verifică din nou utilizatorul, responsabilul și revision-ul contului înainte de apel; schimbările pot anula coada.

`GET /messages/:id/conversation` include și outgoing cu stări queued/sending/sent/failed/unknown/cancelled și replyContext `{to,replyTo,canReply}`. sent înseamnă acceptat, nu livrat. Starea unknown după timeout sau restart nu este retrimisă automat.

`POST /outgoing-mail/:id/reconcile` cu `{result:"sent"|"not_sent",note}` (10–2000 caractere) cere acces curent la task și state=unknown; altfel 404/409. Confirmarea sent adaugă intrarea outbound, not_sent marchează failed și permite o cerere nouă explicită. Operatorul trebuie să verifice rezultatul la furnizor înainte de această declarație; aplicația nu caută automat în Sent.

## Conexiuni email (numai administratori)

| Metodă și rută                        | Contract                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET /mail-connections                 | Metadate, autorizare, stare monitorizare, ultima sincronizare, eroare generică și număr joburi în coadă; fără credențiale                                                                         |
| POST /mail-connections                | `{provider,address,initialDays:1,pollSeconds:60}` plus Outlook: `{clientId,tenant:"common",shared:false}` sau Gmail/Yahoo: `{appPassword}`. Provider: `outlook`, `gmail`, `yahoo`. Inițial oprit. |
| PATCH /mail-connections/:id           | `{enabled?,pollSeconds?}`; activarea verifică accesul înainte de salvare                                                                                                                          |
| POST /mail-connections/:id/check      | Verificare acces fără schimbarea stării citit/necitit                                                                                                                                             |
| POST /mail-connections/:id/authorize  | Outlook: returnează `{flowId,userCode,verificationUri,interval,expiresIn}` pentru device login                                                                                                    |
| POST /mail-authorizations/:id/poll    | `{pending,interval}` sau `{pending:false,ok:true,account}`; flow legat de firmă, temporar, cu frecvența impusă de furnizor                                                                        |
| PUT /mail-connections/:id/password    | Gmail/Yahoo: `{appPassword}`; verifică înainte de înlocuire                                                                                                                                       |
| POST /mail-connections/:id/sync       | Un lot de până la 5 mesaje solicitat furnizorului; `{imported,read}`, checkpoint numai după salvarea mesajelor și joburilor                                                                       |
| POST /mail-connections/:id/search     | `{query}` (2–200 caractere); până la 20 rezultate/preview, fără import automat                                                                                                                    |
| POST /mail-connections/:id/import     | `{externalIds:[...]}` (1–20 ID-uri); citește din sursa configurată, importă și pune în coadă fără duplicate                                                                                       |
| POST /mail-connections/:id/disconnect | Oprește monitorizarea și elimină credențialele locale; taskurile rămân                                                                                                                            |
| DELETE /mail-connections/:id          | Elimină configurația și starea conexiunii, păstrând căsuța/taskurile; permite reconfigurare inclusiv dacă cheia locală a fost pierdută                                                            |

Conectorii nu acceptă hostname-uri IMAP arbitrare, redirecționări Graph externe sau verificare TLS dezactivată. Outlook folosește Graph OAuth delegat, inclusiv refresh token criptat, nu parola contului. Gmail/Yahoo folosesc parole de aplicație prin IMAP TLS. Înregistrarea aplicației Microsoft și politicile furnizorilor rămân cerințe externe; vezi [email-setup.md](email-setup.md). API-ul trebuie să rămână pornit pentru monitorizare; acest cod nu instalează încă un serviciu Windows sau executabil.

### Pornire fără istoric

`POST /mail-connections/:id/start-now` (admin, conexiune oprită) verifică accesul, salvează un checkpoint nou și activează monitorizarea. Răspunde `{ok:true,monitorFrom}` și nu importă mesaje. Gmail/Yahoo folosesc `uidValidity` și `UIDNEXT - 1`; Outlook folosește un `since` UTC pentru primul delta. GET /mail-connections expune `startMode` și `monitorFrom`, fără credențiale. Modul și ancora sunt păstrate în `sync_state` la fiecare scanare și la restart.

O conexiune activă răspunde 409 pentru start-now: oprește-o explicit înainte de a elimina backlogul neimportat prin alegerea unui checkpoint nou. O schimbare UIDVALIDITY în modul future nu revine la o căutare istorică, ci răspunde `MAIL_UIDVALIDITY_CHANGED`. Snapshotul necesită UIDNEXT valid; în lipsa lui nu activează monitorizarea.

PATCH `{enabled:true}` păstrează comportamentul anterior: reia checkpointul existent sau, în lipsa lui, importă istoricul configurat. Interfața prezintă aceste acțiuni separat. Mesajele deja importate și joburile lor nu sunt șterse/anulate de reinițializarea checkpointului.

## Conversații, atașamente, ITL, EMMA și indicatori

Migrarea 004 este necesară. Vezi [workflow-uri locale](local-workflows.md) pentru limite și semantica importului.

- `GET /messages/:id/conversation`: utilizator cu acces la task; `{entries:[{id,senderName,senderEmail,subject,body,receivedAt,attachments:[{id,filename,size,contentType,unavailableReason}]}]}`.
- `GET /attachments/:id/download`: acces verificat din nou la task, răspuns binar ca descărcare; fără conținut HTML executat în aplicație.
- Ingestia acceptă opțional `internetMessageId,inReplyTo,references:[string]`; răspunde și `updated`. `threadId` este identificator de conversație al furnizorului. Gruparea are domeniu mailbox și nu folosește subiectul.
- `GET /knowledge`: admin; `{items,folder}`. `POST /knowledge/pdf`: admin, corp binar `application/pdf`, header `X-Filename` URL-encoded, maximum 20 MB. `POST /knowledge/scan`: admin, indexare director privat `itl/<organization UUID>`. `DELETE /knowledge/:id`: admin, eliminare din SQL. `GET /knowledge/:id/pdf`: utilizator al organizației.
- `GET /messages/:id/itl`: utilizator cu acces la task, candidați `{sources:[{id,documentId,title,page,body}]}`. `POST` pe aceeași rută răspunde 410; nu există generare AI.

- `GET /emma/rules`: admin. `POST`: `{senderEmail,subjectContains,sheetName,headerRow,codeColumn,skillId,enabled}`. `PATCH /emma/rules/:id`: `{enabled}`. `DELETE` pe aceeași rută elimină regula.
- `POST /emma/preview`: admin, corp XLSX `application/octet-stream`, maximum 10 MB; `{sheets:[{name,rows,preview:[{row,cells:[{column,text}]}]}]}`. Nu persistă fișierul și nu creează taskuri.
- `GET /emma/imports`: admin, ultimele 50 rezultate cu fișier, task părinte, număr creat/ignorat și eroare. `POST /messages/:id/emma`: admin, aplică regulile active pe atașamentele deja importate ale taskului; reaplicarea importurilor încheiate nu dublează taskuri.
- `POST /agents` și `PATCH /agents/:id`: `emmaCodes:[string]`, maximum 200 coduri, fiecare maximum 100 caractere; majuscule și duplicate eliminate. GET /agents le expune drept emmaCodes.
- `GET /dashboard`: utilizator, scope admin=firmă/agent=taskuri proprii; `{summary,daily,categories,agents}`; agregări din toate taskurile, independent de paginare.

Fișierele se păstrează în PostgreSQL, pe server. Limitele raw upload sunt specifice rutelor, nu măresc limita JSON a întregului API. Cheile roboților nu pot descărca documente/atașamente sau accesa aceste ecrane. Originile de browser sunt validate față de APP_ORIGIN și lista exactă APP_ORIGINS, fără wildcarduri.

## Conturi și profil HTTPS

- `POST /auth/password`: utilizator autentificat, `{currentPassword,newPassword}`; parola nouă diferită, 12–200 caractere. Verifică parola curentă, actualizează hashul și invalidează toate sesiunile, apoi răspunde 204 și șterge cookie-ul curent. Nu este resetare de parolă uitată.
- `GET /security/users`: admin, utilizatorii firmei inclusiv dezactivați, `{id,name,email,role,active}` fără hashuri/sesiuni.
- `PATCH /agents/:id`: admin, acceptă și `{active:boolean}`. Dezactivarea șterge sesiunile; taskurile nu sunt mutate automat. Propriul cont și ultimul admin activ sunt protejate.

În producție, toate originile configurate trebuie să fie HTTPS, iar cererile fără transport HTTPS recunoscut sunt refuzate, exceptând health-ul local. Profilul `start:https` impune HOST=127.0.0.1 și un singur proxy local; vezi [configurarea HTTPS](corporate-https.md). Antetele forwarded dintr-o cerere externă sunt înlocuite de proxy înainte de backend. Nu expune backendul direct și nu seta un număr arbitrar de proxy-uri de încredere.
