# Depanare

[Documentație](README.md) · [Operare](operations.md) · [Conectare email](email-setup.md)

## Metodă de diagnostic

Înregistrează versiunea codului, profilul de pornire, momentul erorii, ecranul și textul mesajului. Verifică pe rând browserul, proxy-ul, backendul, SQL, modelul și sursa email. Nu șterge baza sau checkpointul ca primă încercare.

Nu publica `.env`, cheia credential.key, tokenuri, parole, chei TLS, mesaje sau capturi cu date reale. Un pachet de suport conține identificatori de task anonimizabili, coduri de eroare și pași de reproducere, prin canalul aprobat.

## Instalare, SQL și pornire

| Simptom                                                  | Verificare / acțiune                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm` nu este recunoscut                                 | Instalează Node aprobat și deschide un PowerShell nou; verifică `node --version`, `npm.cmd --version` |
| PowerShell blochează `npm.ps1`                           | Folosește `npm.cmd`; nu modifica global politica de execuție pentru a ocoli controlul companiei       |
| `package.json` lipsește                                  | Deschide terminalul în folderul proiectului, nu în folderul exterior al ZIP-ului                      |
| `DATABASE_URL is required`                               | Verifică existența `.env`, numele exact și pornirea din folderul proiectului                          |
| `password authentication failed`, cod PostgreSQL `28P01` | Rolul/parola SQL sau codificarea URL nu corespund; verifică în pgAdmin cu operatorul                  |
| `ECONNREFUSED` la SQL                                    | Verifică serviciul, adresa și portul; nu presupune că parola este cauza                               |
| Eroare de drepturi la migrare                            | Verifică proprietarul și permisiunile bazei; nu acorda automat superuser                              |
| `Administrator already exists`                           | Nu rerula bootstrapul; utilizează organizația existentă și procedura de acces/recuperare              |
| `EADDRINUSE`                                             | Alt proces folosește portul; oprește propria instanță duplicată, fără a opri servicii necunoscute     |

## Browser și autentificare

| Simptom                                      | Verificare / acțiune                                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Apar date demonstrative fără login           | VITE_API_ENABLED trebuie true; reconstruiește UI-ul compilat sau repornește Vite                                 |
| `Origine nepermisă`                          | Schema, numele și portul din browser trebuie să coincidă cu originile configurate; fără slash final              |
| Login corect pe server, inaccesibil la coleg | Localhost este PC-ul colegului; verifică DNS, rutarea, firewall-ul și Zscaler cu IT                              |
| Certificat nerecunoscut                      | Verifică numele/SAN, lanțul, expirarea și încrederea clientului cu IT; nu ignora avertismentul                   |
| `HTTPS necesar`                              | Folosește URL-ul proxy-ului și profilul corect, nu portul HTTP direct al backendului                             |
| Agentul nu vede un task                      | Verifică organizația, responsabilul, filtrul și paginarea; un task redistribuit poate ieși din listă             |
| Sesiunea s-a închis                          | Poate fi expirare, schimbare parolă, logout sau dezactivare; autentifică-te cu parola actuală                    |
| `429`                                        | Limita de cereri/login a fost atinsă; așteaptă, evită repetarea și verifică agregarea IP-urilor prin proxy cu IT |

Nu adăuga wildcarduri în origini și nu mări arbitrar TRUST_PROXY_HOPS pentru a rezolva conectivitatea. APP_ORIGINS nu creează un alias DNS și nu emite certificate.

## Conectori email

| Cod / situație                        | Interpretare și acțiune                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `MAIL_AUTH`                           | Acces lipsă, expirat sau refuzat; reautorizează Outlook ori verifică parola de aplicație                             |
| `MAIL_NETWORK`                        | Conectivitate, TLS sau timeout; verifică destinațiile aprobate și CA-ul corporativ                                   |
| `MAIL_ACCOUNT_MISMATCH`               | Contul Microsoft autorizat nu este adresa configurată, în afara modului shared                                       |
| `MAIL_UIDVALIDITY_CHANGED`            | Identitatea Inbox IMAP s-a schimbat; în modul future nu se importă automat istoric; decide explicit noul punct       |
| `MAIL_VAULT`                          | Cheia de decriptare lipsește sau nu corespunde; restaurează cheia, nu genera alta peste ea                           |
| AADSTS16000 în Entra                  | Contul/tenantul nu corespunde accesului cerut; implică IT; nu folosi ID-ul unei aplicații străine                    |
| Gmail/Yahoo refuză codul temporar     | Este necesară parola de aplicație, nu OTP-ul autentificatorului sau parola obișnuită                                 |
| Conexiunea există, dar nu vine taskul | Verifică monitorizarea activă, Inbox, checkpointul, ultima sincronizare și coada; trimite după confirmarea start-now |

O sincronizare reușită nu înseamnă clasificare finalizată. Mesajele mutate de reguli în alt folder pot să nu fie citite deoarece conectorul urmărește Inbox. Revocarea acordului la furnizor este separată de deconectarea locală.

## Clasificare și distribuire

| Simptom                               | Verificare / acțiune                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Ollama nu răspunde                    | Verifică procesul, `ollama list`, modelul și OLLAMA_URL loopback                                             |
| Modelul lipsește                      | Descarcă modelul aprobat cu `ollama pull qwen3:8b`; ecranul de stare nu îl instalează                        |
| Primul răspuns este lent              | Încărcarea modelului și lipsa GPU pot dura; măsoară în mediul real și verifică timeoutul configurat          |
| Model ocupat / `409`                  | Clasificarea și ITL sunt serializate; așteaptă, nu porni instanțe suplimentare pentru a forța paralelismul   |
| `AI_SKILL_CONFIG`                     | Configurează 1–60 competențe pentru fluxul local curent                                                      |
| `OLLAMA_UNCERTAIN` / rezultat invalid | Taskul rămâne pentru verificare; corectează tagul sau exemplele, nu presupune o alocare reușită              |
| Tag bun, task nealocat                | Verifică încrederea, cont activ, skill, disponibilitate și capacitate                                        |
| Task blocat după oprire brutală       | Lease-ul workerului poate dura 15 minute; manualul AI și coada persistentă au recuperări diferite            |
| `403` / `409` la retry                | Taskul poate fi confirmat de om, alocat sau în altă stare; reîncercarea nu ocolește protecția deciziei umane |

Nu modifica în masă alocările în SQL pentru a echilibra echipa. Adminul poate redistribui explicit; automatizarea nu mută lucrările existente doar pentru egalizare.

## Documente și rapoarte

| Simptom                                                         | Verificare / acțiune                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| PDF fără text / OCR necesar                                     | Testează selectarea textului; fă OCR printr-un proces aprobat înainte de import                              |
| Cum să rezolv este dezactivat                                   | Nu există candidați lexicali suficienți sau biblioteca este goală; verifică indexarea și documentele         |
| Pași ITL respinși                                               | Citatele/sursele nu sunt verificabile sau fragmentele insuficiente; consultă documentul, nu forța un răspuns |
| Rezultate ITL vechi                                             | Elimină versiunea veche din index și gestionează originalul din folder înainte de reindexare                 |
| EMMA nu creează taskuri                                         | Verifică regula activă, expeditor/subiect, XLSX, foaia/antetul/coloana și codurile + skillurile agenților    |
| EMMA are potrivire multiplă                                     | Restrânge sau oprește regulile suprapuse; aplicația nu alege arbitrar una                                    |
| Coloană EMMA cu formulă                                         | Formulele nu sunt executate; codul literal trebuie să fie disponibil în formatul acceptat                    |
| Raport săptămânal nou produce taskuri pentru probleme cunoscute | Deduplicarea între rapoarte nu este implementată; definește cheia de business înainte de extindere           |
| Atașament indisponibil                                          | Verifică avertismentul, limitele și emailul original; copiile vechi nu sunt recuperate retroactiv automat    |

## Escaladare

Trimite operatorului profilul și versiunea, ID-ul taskului/conexiunii dacă poate fi transmis, codul erorii și rezultatul verificărilor. Nu trimite exportul întregii baze pentru o eroare individuală. Pentru incident de securitate folosește [procedura de raportare](security.md), nu depanarea prin dezactivarea controalelor.
