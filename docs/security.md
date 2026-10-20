# Dosar de securitate pentru evaluarea pilotului

[Documentație](README.md) · [Arhitectură](architecture.md) · [HTTPS corporativ](corporate-https.md)

## 1. Statut și domeniu

Acest document descrie controalele implementate și riscurile cunoscute ale Relay 0.2.0. Nu este un raport de pentest, o certificare sau o aprobare de producție. Funcționarea locală reduce unele transferuri către servicii externe, dar nu elimină riscurile de acces, fișiere malițioase, compromiterea gazdei sau reguli operaționale greșite.

Domeniul include browserul, proxy-ul, backendul, SQL, sursele email, documentele și operatorii. Controalele Windows, infrastructura Cloud PC, Zscaler și tenantul Microsoft se configurează de echipele autorizate.

## 2. Matrice de acces

| Operație                                  | Agent                     | Administrator                                         | Cheie robot  |
| ----------------------------------------- | ------------------------- | ----------------------------------------------------- | ------------ |
| Citire / stare / note task                | Numai taskuri proprii     | Taskurile organizației                                | Nu           |
| Corectare / confirmare tag                | Numai taskuri proprii     | Taskurile organizației                                | Nu           |
| Alegere manuală responsabil               | Da, predare cu explicație | Da, utilizator activ din organizație                  | Nu           |
| Dashboard                                 | Taskuri proprii           | Organizație                                           | Nu           |
| Administrare agenți / căsuțe / ITL / EMMA | Nu                        | Da                                                    | Nu           |
| Citire document ITL                       | Documentele organizației  | Documentele organizației                              | Nu           |
| Citire skilluri / exemple                 | Da, prin API              | Da                                                    | Da, prin API |
| Citire echipă activă                      | Prin API                  | Da                                                    | Nu           |
| Ingestie externă                          | Nu                        | Nu prin sesiune; folosește cheie robot                | Da           |
| Schimbare parolă proprie                  | Da                        | Da                                                    | Nu           |
| Dezactivare cont                          | Nu                        | Da, cu protecții pentru propriul cont / ultimul admin | Nu           |

Meniurile ascunse în UI nu sunt considerate controlul de securitate; verificările relevante sunt în backend. Separarea pe organizații este aplicativă și prin unele constrângeri SQL, nu RLS sau izolare față de administratorul bazei.

## 3. Controale implementate

| Domeniu          | Control                                                           | Limită                                                                          |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Parole           | Hash scrypt cu salt; comparație constant-time                     | Fără MFA, verificare parole compromise sau politică de complexitate corporativă |
| Sesiuni          | Token aleator, hash în SQL, expirare la 8 ore, logout             | Fără inventar de dispozitive sau management avansat al sesiunilor               |
| Schimbare parolă | Verifică parola curentă și invalidează toate sesiunile            | Nu recuperează o parolă uitată; schimbarea inițială nu este forțată             |
| Dezactivare      | Blochează loginul și șterge sesiunile                             | Nu mută taskurile și nu revocă cheile API ale organizației                      |
| Cereri           | Validare Zod, interogări parametrizate, limite de corp și rată    | Nu înlocuiește protecția de rețea sau testarea de penetrare                     |
| Browser          | Cookie HttpOnly/SameSite=Strict, Secure în producție; CSP/HSTS    | HTTP de test nu criptează traficul între calculatoare                           |
| HTTPS            | Profil cu backend loopback și un proxy local; verificare origini  | Necesită certificat, DNS și rutare aprobate; nu configurează Zscaler            |
| Secrete email    | AES-256-GCM; cheie separată de SQL                                | Accesul la gazdă și la cheie permite decriptarea                                |
| Chei robot       | Hash, returnare o singură dată, revocare prin API                 | Chei de organizație, fără expirare/rotație automată                             |
| Fișiere          | Limite, download autorizat, text afișat ca text                   | Fără antivirus/CDR integrat; parsarea rămâne suprafață de atac                  |
| Reguli           | Condiții explicite, conflicte pentru verificare, prioritate umană | Expeditorul/textul nu sunt dovezi de autenticitate                              |
| ITL și rezolvări | Căutare lexicală SQL, surse și opțiune de partajare               | Biblioteca și rezolvările partajate au audiență organizațională                 |

Limitele de rată sunt 300 cereri/minut/IP pentru API, 20 autentificări/15 minute/IP și 10 schimbări de parolă/15 minute/utilizator. O infrastructură cu IP comun prin NAT/proxy poate agrega utilizatorii; politica se evaluează cu IT. Nu crește arbitrar numărul de proxy-uri de încredere pentru a recupera IP-ul clientului.

## 4. Fluxuri de date și stocare

| Date                                  | Locație / destinație                                        |
| ------------------------------------- | ----------------------------------------------------------- |
| Email, taskuri, note, atașamente, ITL | PostgreSQL al instalării                                    |
| PDF-uri din folder                    | Directorul privat al serverului, plus copia indexată în SQL |
| Rezolvări / outbox                    | PostgreSQL al instalării                                    |
| Parole aplicație / refresh token      | Criptate în SQL; cheia în director privat                   |
| Configurație SQL / pornire            | `.env`, `.relay/https.env`, mediul procesului               |
| Cheie TLS                             | Fișier privat al proxy-ului, în afara directoarelor web     |
| Citire și trimitere email / OAuth     | Microsoft, Google sau Yahoo, după conector                  |

Emailurile și documentele nu sunt criptate de aplicație câmp cu câmp. Sunt necesare protecții la nivel de disc, SQL, identitate și backup. Biblioteca ITL are audiență la nivelul întregii organizații, nu ACL distinct pe document.

Nu există model AI în runtime. Instalarea pachetelor și conectorii email necesită acces extern la destinațiile aprobate. Absența AI nu înseamnă absența traficului de email sau a riscurilor gazdei.

## 5. Riscuri și tratament necesar

| Risc                                    | Tratament pentru pilot / producție                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Furt sesiune sau credențiale pe HTTP    | HTTPS cu CA recunoscută; fără distribuirea linkului HTTP în companie                                                 |
| Compromiterea serverului sau backupului | EDR, patching, ACL, conturi de serviciu, criptare disc/backup și test de restaurare                                  |
| Document sau atașament malițios         | Surse aprobate, limite, scanare prin infrastructura companiei și evaluarea parserelor                                |
| Regulă sau procedură greșită            | Teste reprezentative, verificare umană și surse aprobate                                                             |
| Expeditor EMMA falsificat               | Regula de expeditor nu este dovadă de autenticitate; validează procesele și protecțiile mail înainte de automatizare |
| Acces excesiv prin chei robot           | Emitere minimă, stocare securizată, inventar privat și revocare separată la offboarding                              |
| Date sensibile în exemple / capturi     | Minimizare, anonimizare și canale aprobate                                                                           |
| Indisponibilitate / resurse epuizate    | Dimensionare, controlul volumului, monitorizare și procedură manuală de continuitate                                 |
| Lipsa retenției și a jurnalului SIEM    | Definirea politicii de date și proiectarea integrării înainte de utilizarea largă                                    |

## 6. Responsabilități înainte de producție

Echipa IT stabilește gazda, identitatea serviciului, certificatul, DNS-ul și rețeaua. Cyber Security evaluează arhitectura, expunerea, identitățile, documentele și dependențele. Responsabilul operațional validează clasificarea, codurile EMMA și procesele de excepție. Responsabilul datelor stabilește ce mesaje/documente pot fi prelucrate și cât timp sunt păstrate.

SSO/MFA, resetarea parolelor uitate, antivirusul integrat, retenția, jurnalizarea centralizată și serviciile Windows nu sunt implementate. HTTPS nu transformă automat aplicația într-o instalare aprobată de companie.

## 7. Raportarea unui incident

Oprește extinderea pilotului și notifică echipa autorizată. Păstrează evidențele conform politicii; nu șterge loguri sau date pentru a ascunde incidentul. Nu publica în GitHub vulnerabilități cu secrete, payloaduri care conțin date reale, tokenuri sau chei private. Folosește canalul privat aprobat și include versiunea codului, impactul și pașii de reproducere anonimizabili.

Pentru pierderea cheii, acces neautorizat, restaurare sau compromitere a unei căsuțe, consultă [operarea și recuperarea](operations.md). Rotația/revocarea la furnizor și în infrastructură este separată de oprirea aplicației.

## 8. Conturi de expediere și rezolvări

Un agent poate expedia numai pentru taskurile proprii; administratorul pentru taskurile organizației, folosind identitatea sa personală autorizată. Destinatarul este fixat din primul email inbound, nu din corpul cererii. Sunt păstrate referințe RFC și Reply-To către Inbox monitorizat. Scope-ul Microsoft delegat Mail.Send permite expediere reală; acordul și Conditional Access sunt responsabilitatea IT. Nu se acordă Send As automat.

Credențialele de expediere sunt criptate, nu expuse prin API. Hosturile SMTP sunt fixe, TLS verificat, port 465. Outboxul blochează trimiteri concurente pentru același task; starea unknown cere verificare, fără retry automat. Un operator care confirmă greșit netrimiterea poate produce duplicat printr-o nouă trimitere explicită. Acceptarea nu este garanție de livrare. Nu există DLP sau aprobare de conținut înainte de expediere.

Rezolvările partajate sunt vizibile prin sugestii colegilor, după rezolvarea taskului, fără corpul original al emailului. Utilizatorul trebuie să elimine date personale/secrete din procedură. Nu există redactare automată. Un task în lucru rămâne accesibil numai responsabilului și adminului; transferul schimbă responsabilul și accesul. Istoricul nu este criptografic imuabil în fața unui administrator SQL.

La backup/restaurare, protejează și outboxul; o copie de test cu acces extern poate trimite mesaje queued. Folosește mediu izolat și transporturi simulate pentru teste automate.
