# Migrare la reguli și colaborare — Relay 0.2.0

[Documentație](README.md) · [Administrator](administrator-guide.md) · [Agent](agent-guide.md)

## Actualizare pe Cloud PC

1. Oprește monitorizarea din aplicație și verifică eventualele răspunsuri în coadă înainte de oprire. În versiunea anterioară nu exista outbox.
2. Fă backup PostgreSQL și directorului privat `.relay`/RELAY_DATA_DIR, inclusiv cheia credential.key. Păstrează `.env`, configurația HTTPS și certificatele.
3. Oprește procesele Relay. Copiază noul cod peste instalare, păstrând fișierele private. PostgreSQL rămâne pornit.
4. În PowerShell, din folderul proiectului:

```powershell
cd C:\Relay\dispecerizare
npm.cmd ci
npm.cmd run db:migrate
```

5. Pentru profilul HTTPS existent: `npm.cmd run build:https`, apoi pornește `npm.cmd run start:https` și `npm.cmd run proxy:https` în terminalele folosite la pilot. Pentru dezvoltare locală: `npm.cmd run api` și separat `npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort`.
6. Nu rerula bootstrapul; organizația și conturile rămân aceleași. Configurează regulile, testează mesaje sintetice și reia monitorizarea de la checkpointul existent. Alegerea „doar de acum” ignoră backlogul neimportat din pauză.

Nu trebuie pornit Ollama. Fișierele modelelor deja descărcate nu sunt șterse sau mutate. Variabilele OLLAMA_* existente sunt ignorate. Codul AI este în `archive/ai`, fără import în runtime sau opțiune de reactivare. Orice integrare viitoare necesită modificare explicită de cod și evaluare separată.

Migrarea 004 adaugă reguli, decizii, rezolvări, conturi personale de expediere și outbox. Păstrează classification_examples, classifications, etichetele/corecțiile umane, processing_jobs și istoricul. Joburile AI pending/retry/running eligibile sunt copiate în dispatch_jobs pentru evaluarea prin reguli; cele vechi rămân ca arhivă și nu sunt executate. Taskurile alocate și cele confirmate de om nu sunt reclasificate automat. Fără regulă, taskul rămâne pentru verificare.

## Microsoft 365: contul personal al agentului

Înregistrarea din Microsoft Entra trebuie să permită autentificare delegată device code/public client, dacă politica companiei o admite. Sunt necesare **User.Read**, **Mail.Send** și **offline_access**, nu Mail.Send.Shared pentru acest flux personal. IT poate cere admin consent sau poate bloca device code prin Conditional Access. Aplicația nu ocolește aceste politici.

Fiecare agent intră în **Setări → Adresa mea de expediere**, alege Microsoft 365, completează adresa proprie, Client ID și Tenant ID și salvează. Apasă **Autorizează Microsoft**, deschide pagina afișată și folosește codul temporar în Microsoft. Nu introduce parola Microsoft în Relay. Verifică adresa și apasă **Verifică expedierea**; această verificare nu trimite un email.

Contul autentificat trebuie să corespundă adresei configurate. Trimiterea folosește Graph `/me/sendMail` cu mesaj MIME și antete RFC. Nu permite uzurparea unei adrese shared, Send As sau expediere din contul altui coleg. Tokenurile sunt criptate separat de conexiunea de citire; pagina returnează numai starea, niciodată refresh tokenul.

Autorizarea căsuței shared pentru monitorizare rămâne separată: Mail.Read/Mail.Read.Shared și acces delegat la Inbox. Acea conexiune nu trimite emailuri. Reply-To indică respectiva căsuță pentru ca răspunsul clientului să poată reveni în Inbox-ul monitorizat.

Pentru Gmail/Yahoo există alternativă cu parola de aplicație SMTP, TLS verificat, host fix smtp.gmail.com sau smtp.mail.yahoo.com și port 465. Contul și politica furnizorului trebuie să permită SMTP. Salvarea verifică autentificarea, fără email de test. Copia din Sent depinde de comportamentul furnizorului; istoricul trimiterii rămâne în SQL.

## Comportament și recuperare

Cererea de trimitere este salvată în SQL înaintea apelului către furnizor. requestId previne dublurile la repetarea aceleiași cereri; interfața păstrează cheia în cazul unei erori de rețea. Nu există garanție de exact-once între SQL și un furnizor extern.

Un timeout după acceptarea mesajului sau un restart în timpul trimiterii poate produce starea unknown. Nu există retry automat în acel caz. Agentul/administratorul cu acces la task verifică rezultatul în sistemul de email și îl consemnează cu o notă. Confirmarea ca trimis creează intrarea în conversație; confirmarea ca netrimis permite o nouă cerere explicită. Confirmarea este o declarație auditată a operatorului, nu o verificare automată a Sent.

Predarea anulează emailurile queued și joburile de reguli ale taskului. Un email sending blochează schimbarea responsabilului sau a tagului până la finalizare. Dezactivarea utilizatorului sau schimbarea contului de expediere este reverificată înainte de apelul extern; nu poate retrage un email deja acceptat de furnizor.

O copie restaurată a bazei include mesaje queued. Testează restaurarea într-o rețea fără acces la furnizori sau cu conturi/transporturi de test, pentru a evita trimiterea accidentală.

## Acceptanță

Validează reguli normale, conflicte, fără regulă, capacitate și tag uman. Salvează o rezolvare partajată și una privată, apoi verifică sugestiile. Transferă un task parțial și verifică accesul vechiului/noului agent. Cu conturi aprobate, trimite un reply de test, răspunde din client și verifică același task. Testele automate folosesc PostgreSQL real și transporturi de email simulate; nu înlocuiesc acest test pe tenantul companiei.
