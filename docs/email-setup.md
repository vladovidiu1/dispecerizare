# Conectarea emailului pentru primul pilot

[Documentație](README.md) · [Manual administrator](administrator-guide.md) · [Depanare](troubleshooting.md)

Aplicația, PostgreSQL și Ollama rulează local. Furnizorul de email rămâne serviciul Microsoft/Google/Yahoo: conexiunea la Internet și autorizarea lui sunt necesare. Installerul executabil și instalarea ca serviciu Windows nu sunt încă livrate; în pilot pornește backendul și interfața din terminale. Monitorizarea continuă după logoutul administratorului, cât timp backendul rămâne pornit și calculatorul nu intră în sleep.

## Actualizare Windows, fără pierderea configurației

1. Oprește cele două terminale cu Ctrl+C. Fă backup PostgreSQL (în pgAdmin: click dreapta baza `relay` → Backup, format Custom, un fișier local privat).
2. Păstrează copii private ale `.env` și, dacă există, ale directorului `.relay`. Nu le încărca pe GitHub și nu le trimite în chat.
3. Descarcă ZIP-ul actual din GitHub și copiază conținutul peste folderul proiectului. Păstrează `.env` și `.relay`.
4. În PowerShell din folderul proiectului: `npm.cmd ci`, apoi `npm.cmd run db:migrate`. Migrarea este repetabilă și adaugă structuri, nu recreează baza. Nu rerula `db:bootstrap`.
5. Pornește `npm.cmd run api`, apoi `npm.cmd run dev` în alt terminal; păstrează Ollama pornit. Autentifică-te ca administrator și deschide **Căsuțe email**.

## Outlook / Microsoft 365 — configurare o singură dată în Entra

Adresa singură nu permite accesul la email. Este necesară o înregistrare de aplicație autorizată de organizație. Nu folosi parola Outlook și nu crea un client secret pentru acest flux.

1. Cu utilizatorul firmei, deschide [Microsoft Entra admin center](https://entra.microsoft.com/).
2. Intră în **Identity → Applications → App registrations → New registration** (denumirile pot varia cu interfața și rolurile). Dacă organizația nu permite înregistrări, cere administratorului IT să facă acest pas.
3. Nume: `Relay local`. Pentru pilot într-o singură firmă, alege conturile din acest director organizațional. Creează înregistrarea. Un produs distribuit mai multor firme va necesita o înregistrare multi-tenant și evaluarea procesului de consimțământ; nu utiliza ID-ul altei aplicații găsit online.
4. Din **Overview**, copiază **Application (client) ID** și **Directory (tenant) ID**. Acestea sunt identificatori, nu parole. Tenant ID din Entra este diferit de `organizationId` din Relay.
5. În **Authentication → Advanced settings**, setează **Allow public client flows = Yes** și salvează. Fluxul device code nu necesită un redirect URI sau client secret. Respectă politica IT: dacă device-code este interzis de Conditional Access, nu îl ocoli; trebuie aprobat sau implementat un flux OAuth alternativ.
6. În **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, adaugă **User.Read** și **Mail.Read**. Pentru shared mailbox adaugă și **Mail.Read.Shared**. Solicitarea de login include `offline_access`, pentru reînnoirea accesului fără login la fiecare pornire. Nu alege Application permissions pentru acest pilot.
7. Dacă tenantul cere acord administrativ, administratorul IT trebuie să acorde consimțământul pentru aceste permisiuni. Nu este necesar acces de scriere/trimitere email.

În Relay:

1. Alege **Outlook / Microsoft 365** și introdu adresa urmărită, Client ID și Tenant ID. Pentru shared mailbox bifează opțiunea și introdu adresa shared, nu adresa utilizatorului care se autentifică.
2. Pentru început păstrează importul la **1 zi** și verificarea la **60 secunde**. Salvează conexiunea; ea este oprită implicit.
3. Apasă **Autorizează Microsoft**. Deschide pagina Microsoft din aplicație, introdu codul temporar și autentifică utilizatorul cu acces la căsuță. Verifică numele aplicației și permisiunile afișate. Pentru shared mailbox folosește un utilizator cu drepturi delegate reale asupra ei; nu încerca login direct cu shared mailbox.
4. Lasă Relay deschis până confirmă autorizarea. După restartul serverului, o autorizare neterminată se începe din nou. Contul personal Microsoft și shared mailbox au cerințe diferite; pilotul firmei folosește tenantul organizației.
5. Apasă **Verifică**, apoi **Pornește doar de acum**. Această acțiune salvează punctul de pornire și activează monitorizarea fără importul emailurilor existente. După mesajul de confirmare trimite un email nou pentru test. Dacă vrei intenționat și mesaje vechi, alege separat **Pornește cu istoric**.

Graph citește Inbox, păstrează ID-uri imuabile și un cursor delta. Nu mută, nu șterge și nu marchează mesajele ca citite. Politicile Microsoft, expirarea/revocarea acordului sau lipsa accesului la shared mailbox pot necesita reautorizare; aplicația afișează eroarea conexiunii.

Referințe oficiale: [Device authorization grant](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), [Access shared Outlook messages](https://learn.microsoft.com/en-us/graph/outlook-share-messages-folders). Interfețele portalului și politicile tenantului pot diferi.

## Gmail

1. Activează verificarea în doi pași în contul Google.
2. Dacă este permis pentru cont, generează o [parolă de aplicație](https://support.google.com/accounts/answer/185833) pentru Relay. Nu folosi parola obișnuită.
3. În Relay alege **Gmail**, introdu adresa și parola de aplicație în formular. Salvează, verifică accesul și apasă **Pornește doar de acum**. Așteaptă confirmarea, apoi trimite un email nou pentru test. Mesajele deja existente, citite sau necitite, sunt ignorate.

Se folosește `imap.gmail.com:993` cu TLS validat. Unele conturi Workspace, Advanced Protection sau politici de autentificare nu permit parole de aplicație/IMAP. În acel caz acest conector nu poate fi folosit fără modificarea aprobată a politicii sau implementarea OAuth Gmail. OAuth Gmail nu este inclus în această versiune.

## Yahoo Mail

Generează o parolă de aplicație din setările de securitate Yahoo, apoi alege **Yahoo Mail** în Relay și completează adresa și parola generată. Se folosește `imap.mail.yahoo.com:993` cu TLS. Disponibilitatea parolelor de aplicație depinde de cont și politicile Yahoo; dacă opțiunea lipsește, aplicația nu o poate crea în locul utilizatorului.

## Căutare și import explicit

Apasă **Caută în căsuță**, introdu minimum două caractere și caută. Sunt afișate până la 20 rezultate din Inbox. **Importă ca task** importă rezultatul selectat și îl pune în coadă; reimportul aceluiași mesaj nu produce un task nou. Importul inițial și căutarea pot include emailuri personale: folosește o căsuță dedicată pilotului sau verifică domeniul de date înainte de activare.

## Contextul modelului și corecțiile

Începe cu exemple pentru fiecare competență. După un email clasificat corect, agentul/adminul poate apăsa **Confirmă tagul ca fiind corect**. Dacă schimbă tagul, eticheta corectată devine automat decizia de referință și taskul se redistribuie fără AI.

Pentru următorul email, SQL caută exemple relevante din firma curentă, folosind etichetele umane actuale. Nu este încărcată întreaga arhivă în prompt și modelul nu este reantrenat. Emailurile etichetate doar de AI nu devin automat exemple verificate. Contextul este limitat pentru laptopul cu 16 GB RAM; îmbunătățirea se măsoară pe un set separat de emailuri etichetate de oameni, nu se presupune.

## Backup și diagnostic

Păstrează PostgreSQL și `.relay/credential.key` în backupuri private. Cheia poate fi mutată prin `RELAY_DATA_DIR`, un director accesibil doar contului serviciului și aflat în afara fișierelor publice. Configurarea drepturilor Windows trebuie făcută la instalare. Dacă restaurezi cheia, repornește API-ul. Nu salva backupuri sau chei în `dist`.

La eroare de conexiune: verifică furnizorul/permisiunile și folosește Verifică sau reautorizează Microsoft. Pentru un Client ID/Tenant ID introdus greșit, poți elimina configurația și o poți crea din nou; taskurile rămân salvate. Pentru un task rămas nealocat după eroare Ollama, verifică modelul și folosește **Reîncearcă clasificarea în fundal** din detaliul taskului. Etichetele confirmate de oameni nu sunt suprascrise de această acțiune.

Testarea automată din proiect folosește furnizori simulați și PostgreSQL real; nu demonstrează accesul la un tenant Microsoft sau un cont Gmail/Yahoo real. Primul import la client este verificarea necesară pentru acel cont.

## Destinații de rețea

Serverul trebuie să poată accesa `login.microsoftonline.com:443` și `graph.microsoft.com:443` pentru Outlook; browserul administratorului deschide paginile Microsoft de autentificare. Gmail necesită `imap.gmail.com:993`, iar Yahoo `imap.mail.yahoo.com:993`. Ollama rămâne pe loopback, implicit portul 11434; PostgreSQL nu se expune public. O rețea corporativă ce permite doar HTTP poate necesita aprobarea accesului IMAP de către IT; acest conector nu instalează VPN și nu dezactivează TLS.

## Test fără import de mesaje vechi

Pentru o conexiune deja salvată și verificată, nu este necesar să o ștergi sau să regenerezi parola. Cât timp monitorizarea este oprită, apasă **Pornește doar de acum**. Aplicația verifică metadatele căsuței, salvează checkpointul și activează monitorizarea, fără să importe mesajele existente. Trimite emailul de test numai după confirmarea pornirii. **Sincronizează acum** este dezactivat pentru o conexiune nouă fără un punct de pornire ales.

Pentru Gmail/Yahoo este folosit UIDNEXT din Inbox, nu starea citit/necitit și nu data scrisă de expeditor în email. Pentru Outlook, prima cerere delta este filtrată după momentul de activare (ceasul serverului trebuie sincronizat). Mesajele noi sunt verificate la intervalul configurat și apoi procesate pe rând de model.

Oprirea și alegerea **Reia de la ultima verificare** importă și mesajele sosite în pauză, de la checkpointul păstrat. Alegerea din nou a **Pornește doar de acum** setează alt checkpoint și ignoră mesajele încă neimportate din acea pauză. Niciuna dintre aceste opțiuni nu șterge taskuri deja existente în SQL, nu anulează joburile deja importate și nu modifică starea citit/necitit a emailurilor. Căutarea și importul manual rămân disponibile pentru mesaje vechi dacă administratorul le selectează explicit.

Nu este necesară o migrare SQL nouă pentru această opțiune; punctul de pornire folosește câmpul JSON de sincronizare existent.
