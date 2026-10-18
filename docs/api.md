# Contract API — prima versiune

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
| POST /agents                     | Admin: `{name,email,password,skills:[UUID],capacity:20}`; parola ≥12 caractere                          |
| PATCH /agents/:id                | Admin: oricare dintre `{available,capacity,skills:[UUID]}`                                              |
| GET /mailboxes                   | Admin: adrese sursă `{id,provider,address}`                                                             |
| POST /mailboxes                  | Admin: `{provider:"outlook",address:"shared@example.com"}`; provider este text liber                    |
| POST /keys                       | Admin: `{name:"Robot Ollama"}` → `{id,token}`; tokenul se returnează o singură dată                     |
| DELETE /keys/:id                 | Admin: revocă imediat cheia                                                                             |
| GET /messages?limit=100&offset=0 | `{items,total,limit,offset}`; limit 1–200; agentul vede doar mesajele proprii                           |
| PATCH /messages/:id              | `{status,assignedTo,skillId,priority}`; agentul poate modifica starea sau competența unui mesaj propriu |
| GET /messages/:id/history        | Evenimente în ordine cronologică, cu autor și datele schimbării                                         |
| GET /messages/:id/notes          | Note interne, autor și dată                                                                             |
| POST /messages/:id/notes         | `{body}`; salvează o notă internă, fără trimitere email                                                 |

Statusuri: `Nou`, `În lucru`, `Rezolvat`. Priorități: `Scăzută`, `Medie`, `Ridicată`. `assignedTo:null` dezalocă mesajul; `skillId:null` elimină competența manuală. Repartizarea manuală nu șterge clasificarea originală. Schimbarea efectivă a competenței, fără `assignedTo` explicit, readuce taskul la `Nou`, elimină repartizarea anterioară și selectează automat un utilizator eligibil după competență, disponibilitate și capacitate, fără un apel AI. Lipsa unui agent eligibil lasă taskul nealocat cu eveniment `review_required`. Schimbarea către aceeași competență nu reia distribuirea. Agentul trebuie să aleagă o competență validă, nenulă, din aceeași firmă; nu poate schimba prioritatea sau alege responsabilul. Trimite corecția competenței separat de actualizarea stării. Administratorul poate trimite `skillId` și `assignedTo` împreună pentru o corecție și repartizare explicită, fără restricții de competență/disponibilitate/capacitate; ținta trebuie să fie activă și din aceeași firmă. Istoricul păstrează autorul corecției, vechiul/noul tag, starea și responsabilul. Mesajele rămase nealocate nu sunt redistribuite ulterior în fundal în această versiune.

Administrează cheile dintr-un client API autentificat cu cookie sau din consola browserului autentificat folosind `fetch('/api/keys', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Robot'})})`. Păstrează tokenul doar în configurarea securizată a robotului. Nu îl include în repository, URL, loguri sau în variabile `VITE_*`. Baza de date păstrează numai hashul tokenului.

## Robot: POST /ingest

Trimite `Authorization: Bearer <token>` și `Content-Type: application/json` prin HTTPS. Nu există apeluri specifice Microsoft/Google/Yahoo în backend.

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
  "priority": "Medie",
  "classification": {
    "skillId": "UUID competență din GET /skills",
    "confidence": 0.92,
    "model": "qwen:8b",
    "promptVersion": "dispatch-v1",
    "reason": "Solicitare despre factură"
  }
}
```

`classification` poate lipsi: mesajul ajunge nealocat, pentru verificare. Competența necunoscută este respinsă cu 400, fără inserare parțială; robotul poate retrimite fără clasificare pentru verificare manuală. Backendul alege agentul, nu acceptă un agent arbitrar din payloadul de ingestie.

Răspuns: `201 {id,duplicate:false}` la prima inserare; `200 {id,duplicate:true}` la retrimiterea aceluiași `(mailboxId,externalId)`. Retrimiterea nu reclasifică și nu suprascrie mesajul existent. Normalizează și păstrează ID-ul stabil (de exemplu ID imuabil Outlook, ID Gmail sau UID + UIDVALIDITY IMAP). Nu folosi subiectul sau ora de procesare drept ID. Același ID în două adrese sursă diferite reprezintă două mesaje distincte în această versiune.

Robotul confirmă emailul drept procesat doar după 200/201. La timeout poate retrimite exact același identificator. La 401 verifică/revocă cheia; la 400 corectează payloadul sau trimite în coada de verificare; la 429/5xx aplică reîncercări cu întârziere progresivă și checkpoint persistent. Această logică rămâne în robot în versiunea curentă.

Client Python fără dependențe externe: `scripts/relay_client.py`, cu `RELAY_API_URL` și `RELAY_API_KEY` în mediu. Funcția `send_email(payload)` trimite rezultatul robotului, iar `get_classification_config()` citește tagurile și exemplele pentru construirea promptului. Conversia din Excel se face explicit pe numele tagurilor, apoi se trimit UUID-urile corespunzătoare.

## Erori și limite

Erori JSON `{error,issues?}`: 400 validare, 401 autentificare, 403 drepturi/origine, 404 resursă inexistentă sau inaccesibilă, 409 dublură configurare, 413 payload prea mare, 429 limită de cereri, 500 eroare internă. API-ul limitează cererile la 300/minut/IP și autentificările la 20/15 minute/IP. Payload maxim 300 KB; text mesaj maxim 200.000 caractere. Interogările sunt parametrizate; HTML-ul nu este randat în interfață.

Istoricul este append-only prin API, nu un jurnal criptografic sau protejat împotriva unui administrator al bazei de date.

## Test AI local (administrator)

`GET /ai/status` → `{reachable,installed,model}`. Verifică `/api/tags` al Ollama local; nu descarcă și nu pornește modelul.

`POST /ai/test` cu `{requestId:UUID,senderName,senderEmail,subject,body}` creează un task și apelează modelul local. `body` are maximum 6000 caractere. Prima cerere răspunde cu 201 și `{id,duplicate:false,message,classification,warning}`. Clasificarea validată conține competența, încrederea, motivul, modelul și versiunea promptului. Un eșec de inferență păstrează taskul nealocat și returnează `classification:null` și `warning`, cu eveniment `classification_failed`. Repetarea aceluiași `requestId` în aceeași firmă răspunde 200 `{id,duplicate:true,classification:null,notice}` fără reluarea inferenței. În lipsa competențelor, 400; dacă există alt test în lucru în același proces, 409 înainte de salvare. Datele provin numai din firma administratorului autentificat. Cheile robotului și agenții nu pot apela aceste rute.

Sursa mesajelor de test este o adresă internă fictivă cu provider `manual-test`; nu reprezintă o căsuță de email conectată. Notele și taskurile de test sunt date persistente, vizibile în lista de mesaje.
