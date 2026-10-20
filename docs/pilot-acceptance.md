# Plan de testare și acceptanță a pilotului

[Documentație](README.md) · [Administrator](administrator-guide.md) · [Securitate](security.md)

## 1. Obiectiv

Validarea urmărește dacă Relay este adecvat procesului departamentului, pe infrastructura și datele aprobate. Pilotul nu are aprobarea implicită de producție. Numărul testelor tehnice automate nu înlocuiește verificarea funcțională, a modelului și a operațiunilor reale.

## 2. Fișa de execuție

Completează privat pentru fiecare rundă:

| Câmp                                          | Valoare de completat |
| --------------------------------------------- | -------------------- |
| Versiune / commit aplicație                   | —                    |
| Data și intervalul, Europe/Bucharest          | —                    |
| Mediu și responsabil tehnic                   | —                    |
| Model / versiune și resurse gazdă             | —                    |
| Furnizor, tip căsuță și mod de start          | —                    |
| Set de exemple și ITL aprobate                | —                    |
| Responsabil operațional / IT / Cyber Security | —                    |
| Rezultat și probleme deschise                 | —                    |

Nu pune în fișa distribuită parole, tokenuri, chei sau conținutul neanonimizat al mesajelor.

## 3. Pregătire

- [ ] Infrastructura, accesul și datele sunt aprobate pentru pilot.
- [ ] Conturile sunt individuale; rolurile și competențele au fost verificate.
- [ ] Există backup și o restaurare de probă planificată/verificată.
- [ ] Căsuța de test și checkpointul sunt alese explicit.
- [ ] Există un set de solicitări etichetate de oameni, separat de exemplele oferite modelului.
- [ ] Pragurile de acceptare și procesul manual de rezervă sunt stabilite înainte de test.
- [ ] Pentru colegi, certificatul și accesul HTTPS sunt verificate de pe PC-urile reale.

## 4. Scenarii funcționale

| ID  | Probă                                                                          | Rezultat așteptat                                                                            |
| --- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| F01 | Login admin și agent cu propriile date                                         | Rolul corect; agentul vede taskurile proprii                                                 |
| F02 | Agent încearcă un task/atașament nealocat lui                                  | Acces refuzat de backend                                                                     |
| F03 | Două organizații cu date de test                                               | Nicio citire/modificare în afara organizației autentificate                                  |
| F04 | Start doar de acum, Inbox cu emailuri vechi                                    | Mesajele existente nu sunt importate; cel trimis după confirmare este preluat                |
| F05 | Pauză și reluare de la checkpoint                                              | Mesajele din pauză sunt importate, fără duplicate                                            |
| F06 | Retrimiterea aceluiași identificator de email                                  | Nu apare al doilea task/intrare pentru același email                                         |
| F07 | 20 solicitări, doi agenți cu același skill, liberi și cu capacitate suficientă | Distribuție 10/10 în condițiile testului, fără alte sarcini concurente                       |
| F08 | Agent plin sau indisponibil                                                    | Nu primește automat task nou; cele eligibile așteaptă și pot fi repartizate când apare loc   |
| F09 | Tag greșit corectat de agent                                                   | Confirmare umană, stare Nou și redistribuire după skill și încărcare                         |
| F10 | Admin alocă în afara skillului/capacității                                     | Override permis către cont activ; intervenția apare în istoric                               |
| F11 | Reply la emailul cunoscut, inclusiv task rezolvat                              | Conversație completată; taskul poate fi redeschis, păstrând agentul/tagul                    |
| F12 | Email nou cu același subiect, fără referințe                                   | Nu este unit doar pe baza subiectului                                                        |
| F13 | Atașament permis și unul peste limită                                          | Primul se descarcă autorizat; pentru cel indisponibil apare avertisment                      |
| F14 | PDF cu text și PDF scanat                                                      | Primul este indexat; cel fără text suficient este respins cu indicație OCR                   |
| F15 | ITL potrivit / nepotrivit                                                      | Surse și citate verificabile când există suport; fără soluție forțată când suportul lipsește |
| F16 | Excel EMMA cu coduri eligibile și străine                                      | Un task pe rând eligibil; codurile neconfigurate sunt ignorate și rezultatul verificat       |
| F17 | Reaplicarea aceluiași atașament EMMA                                           | Fără taskuri duplicate                                                                       |
| F18 | Excel greșit, coloană lipsă sau reguli suprapuse                               | Verificare/eroare vizibilă; nu se alege arbitrar o regulă                                    |
| F19 | Schimbarea parolei cu două sesiuni active                                      | Ambele sesiuni sunt invalidate; noua parolă permite login                                    |
| F20 | Dezactivare/reactivare agent                                                   | Login blocat și sesiuni închise; taskurile rămân pentru redistribuire controlată             |

## 5. Continuitate și infrastructură

| ID  | Probă                                           | Rezultat așteptat                                                                   |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| O01 | Restart backend cu date existente               | SQL și checkpoint păstrate; fără bootstrap nou                                      |
| O02 | Model oprit temporar                            | Taskul nu se pierde; eroare și retry conform politicii implementate                 |
| O03 | Oprire în timpul unui job                       | Recuperare după lease sau intervenție controlată, fără suprascrierea deciziei umane |
| O04 | Backup/restaurare într-un mediu izolat          | Date și chei compatibile; monitorizarea reală nu pornește accidental                |
| O05 | HTTPS de pe un PC agent                         | Certificat recunoscut și nume corect, login și descărcare funcționale               |
| O06 | HTTP direct / origine de scriere străină        | Refuz conform profilului securizat                                                  |
| O07 | Test după modificarea IP-ului prin procedura IT | Numele DNS aprobat continuă să indice serviciul, fără schimbarea linkului agenților |
| O08 | Logout administrator                            | Monitorizarea continuă dacă procesele/gazda rămân pornite                           |

## 6. Evaluarea regulilor și ITL

Setul de evaluare trebuie să includă clase apropiate, mesaje ambigue, lipsa unei competențe, citate în email, mesaje lungi și exemple în afara domeniului. Etichetele corecte sunt stabilite de oameni înainte de rulare. Separă rezultatele pe skill, nu doar media generală.

Înregistrează: tag corect/greșit, alocat/nealocat, corecție necesară, cazuri trimise automat greșit, latență de import/evaluare a regulilor și explicațiile erorilor. Pentru ITL, verifică documentul/pagina/citatul, aplicabilitatea pașilor și condițiile omise. Sugestiile sunt documentate de oameni și găsite lexical; nu sunt generate de model.

Nu sunt impuse aici procente de acceptare inventate. Departamentul și Cyber Security stabilesc pragurile înainte de test. Încrederea modelului nu este o probabilitate calibrată și nu se folosește singură ca dovadă de calitate.

## 7. Decizie și evidențe

Înregistrează pentru fiecare scenariu: Executat / Neexecutat, Trecut / Eșuat / Blocat, evidența anonimizată, problema asociată și responsabilul. Elementele neexecutate nu se marchează drept trecute.

Extinderea pilotului necesită rezolvarea blocajelor critice, procedură manuală de rezervă, responsabil de operare și acordurile cerute de organizație. Trecerea în producție este o decizie separată, documentată de persoanele autorizate. Faptul că acest plan există nu reprezintă acceptanță semnată.

## 8. Scenarii suplimentare 0.2.0

Validează conflict de reguli cu skilluri diferite, absența potrivirii, modificare/oprire regulă, distribuire echilibrată și prioritatea tagului uman. Verifică păstrarea exemplelor și clasificărilor vechi după migrarea 004 și funcționarea fără Ollama pornit.

Cu doi agenți, salvează rezolvări publicate/private și verifică sugestiile numai pentru cele partajate, pe taskuri rezolvate. Predă un task parțial și verifică motivul, accesul noului responsabil și pierderea accesului vechiului agent.

Cu conturi de test aprobate, autorizează adresa personală Microsoft 365, trimite reply, verifică In-Reply-To/References, destinatarul inițial, Reply-To shared și revenirea clientului în același task. Testează refuzul de autorizare, timeoutul și reconcilierea unknown fără retry automat. Nu simula incidente pe conturi de producție fără procedura IT.
