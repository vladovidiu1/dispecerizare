# Operare, backup și recuperare

[Documentație](README.md) · [Instalare](installation-windows.md) · [Depanare](troubleshooting.md)

## 1. Inventarul unei instalări

Operatorul păstrează privat gazda, versiunea codului și schemei, locația proiectului, identitatea serviciului, URL-ul aprobat, versiunile componentelor, directorul de date, destinația backupului și responsabilii. Referințele la secrete se înregistrează în managerul aprobat, nu în această documentație publicabilă.

Setul recuperabil include:

| Element                                              | Necesitate                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| Backup PostgreSQL                                    | Taskuri, conversații, fișiere, conturi, configurații și checkpointuri |
| `.relay/credential.key` sau cheia din RELAY_DATA_DIR | Decriptarea credențialelor email păstrate în SQL                      |
| `.env` și `.relay/https.env`                         | Configurarea proceselor și a bazei; se păstrează criptat/securizat    |
| Certificate / chei TLS                               | Conform procedurii IT; în afara directoarelor web                     |
| PDF-uri originale din folder                         | Necesare dacă trebuie reindexate sau păstrate independent de SQL      |
| Versiunea aplicației și modelului                    | Reproducerea comportamentului și compatibilitatea restaurării         |

Fișierele din `dist` pot fi reconstruite din cod. Un ZIP GitHub nu conține baza de date sau configurația privată. Un snapshot al mediului nu garantează backupul volumului PostgreSQL.

## 2. Pornire și oprire controlată

| Profil                           | Procese                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Dezvoltare locală                | PostgreSQL, Ollama, `npm.cmd run api`, `npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort`    |
| Interfață compilată HTTP de test | PostgreSQL, Ollama, `npm.cmd run build`, apoi `npm.cmd run start:local` cu originea și gazda configurate |
| HTTPS corporativ                 | PostgreSQL, Ollama, `npm.cmd run start:https`, `npm.cmd run proxy:https` după validarea profilului       |

Nu porni simultan profilele pe același port. `start:local` nu compilează automat interfața. Profilul HTTPS folosește [configurația dedicată](corporate-https.md), nu Vite pentru agenți.

La oprire planificată, anunță utilizatorii, oprește intrarea prin proxy și închide backendul controlat cu Ctrl+C. Backendul încearcă să încheie operațiile active; nu închide forțat imediat terminalul dacă încă procesează. Apoi pot fi oprite componentele conform procedurii operatorului. Nu există un buton general de mentenanță în aplicație.

La restart, pornește SQL și Ollama, apoi backendul și proxy-ul. Conexiunile email activate își reiau monitorizarea de la checkpoint; nu se cere loginul administratorului pentru pornirea workerelor. Un job abandonat poate aștepta expirarea lease-ului de 15 minute. O întrerupere brutală nu dovedește că toate tranzacțiile externe s-au încheiat.

## 3. Verificări operaționale

- Verifică serviciile/procesele și accesul la pagina aplicației.
- `/api/health` confirmă SQL, nu sănătatea modelului, conectorului sau distribuirii.
- În Căsuțe email, verifică ultima sincronizare, erorile și coada.
- În Test AI local, verifică modelul fără a crea repetat taskuri de test inutile.
- Controlează taskurile nealocate, rapoartele EMMA eșuate, capacitatea, spațiul pe disc și expirarea certificatului.
- Verifică execuția backupului și testează periodic restaurarea conform politicii organizației.

Nu sunt livrate alerte automate, dashboard infrastructură sau integrare SIEM. Definește responsabilul și canalul de escaladare în fișa instalării.

## 4. Backup PostgreSQL

Pentru primul pilot, pgAdmin oferă o cale accesibilă:

1. Click dreapta pe baza `relay` → Backup.
2. Format **Custom**, cale într-o locație privată aprobată.
3. Rulează și verifică finalizarea fără erori; înregistrează data, versiunea PostgreSQL și aplicația.
4. Păstrează separat setul de configurație/chei și documentele originale, cu acces controlat.

Alternativ, pentru operatorul care are utilitarele PostgreSQL în PATH:

```powershell
pg_dump -h 127.0.0.1 -p 5432 -U relay -d relay -F c -f "D:\Relay-backup\relay.backup"
```

Directorul trebuie să existe și să fie aprobat. Comanda solicită parola când este necesar; nu o pune în comandă, screenshot sau repository. Pentru automatizare, operatorul folosește mecanismul securizat acceptat pentru credențiale și ACL. Verifică rezultatul procesului, nu doar existența unui fișier.

Un dump logic este consistent la nivelul bazei; pentru o copie de migrare coerentă cu fișierele/cheile și pentru un checkpoint operațional clar, oprește mai întâi scrierile aplicației. Nu copia direct fișierele unui cluster PostgreSQL în funcțiune ca substitut pentru backup.

Frecvența, retenția, criptarea, locația secundară și obiectivele RPO/RTO se stabilesc cu compania. Nu există valori garantate în produs.

## 5. Restaurare de probă, fără conectare la căsuța reală

Restaurarea se validează mai întâi într-o bază separată, de exemplu `relay_restore`, și într-un mediu izolat. Nu restaura peste baza activă pentru a testa procedura.

1. Creează baza goală, cu un proprietar care poate crea obiectele aplicației.
2. Folosește pgAdmin → Restore, sau utilitarul de mai jos, adaptat instalării:

```powershell
pg_restore -h 127.0.0.1 -p 5432 -U relay -d relay_restore --no-owner --no-privileges --exit-on-error "D:\Relay-backup\relay.backup"
```

3. Rezolvă orice eroare de restaurare; un rezultat parțial nu este acceptat ca succes. Politicile de rol/ACL se reaplică explicit dacă se omit owner/privileges.
4. Înainte de pornirea backendului, oprește conexiunile restaurate **în baza de test**, nu în baza operațională:

```sql
UPDATE mailbox_connections SET enabled = false;
```

5. Copiază codul compatibil și configurația privată într-un mediu separat; adaptează DATABASE_URL la baza restaurată. Păstrează rețeaua de test izolată: restaurarea include joburi pending/running și backendul le poate procesa automat. Nu trimite datele restaurate către servicii neaprobate.
6. Restaurează cheia corespunzătoare numai dacă testul include verificarea credențialelor și ai dreptul să o folosești. Nu regenera o cheie peste cea existentă.
7. În mediul restaurat, invalidează sesiunile înainte de redarea accesului:

```sql
DELETE FROM sessions;
```

8. Evaluează și revocările cheilor API: un backup vechi poate readuce o cheie care fusese revocată ulterior. Nu reutiliza automat toate accesările din momentul backupului.
9. Verifică schema, conturile, numărul de taskuri, conversațiile, atașamentele, documentele și istoricul. Rulează probele necesare cu date aprobate.
10. Înregistrează timpul, problemele și rezultatul; obține validarea operatorului înainte de o restaurare reală.

Comenzile SQL din această secțiune sunt pentru baza restaurată și au efecte deliberate asupra accesului/monitorizării. Nu sunt pași de diagnostic de executat pe producție fără o fereastră aprobată.

## 6. Actualizare din ZIP

1. Notează versiunea curentă și pregătește o fereastră de mentenanță.
2. Fă backup SQL și al configurației/cheilor. Verifică recuperabilitatea lor.
3. Oprește proxy-ul/backendul și păstrează `.env`, `.relay`, RELAY_DATA_DIR și materialul TLS.
4. Copiază noul cod fără a șterge aceste directoare private.
5. Rulează `npm.cmd ci`, apoi `npm.cmd run db:migrate`.
6. Compilează și validează profilul: pentru HTTPS, `npm.cmd run build:https` și `npm.cmd run check:https`.
7. Pornește și verifică loginul, datele existente, modelul și un email de test aprobat.
8. Înregistrează versiunea și rezultatul; monitorizează coada după reluare.

Nu rerula bootstrapul la actualizare. Migrările adaugă structuri și sunt repetabile; nu există downgrade SQL automat. Dacă o actualizare trebuie retrasă, compatibilitatea codului vechi cu schema nouă se analizează înainte. O revenire completă poate necesita restaurarea backupului și a codului asociat, cu pierderea modificărilor după acel punct.

## 7. Mutarea aceleiași organizații pe altă gazdă

Aceasta diferă de instalarea unei organizații noi. Păstrează organizația, SQL, cheia și checkpointurile prin backup/restaurare controlată. Nu porni simultan două copii conectate la aceeași căsuță cu baze independente; pot crea două arhive și distribuiri divergente.

După mutare, validează gazda, DNS/TLS, ACL, modelul și accesul la furnizor. Decide explicit dacă reiei de la checkpoint sau alegi un punct nou: **Pornește doar de acum** poate ignora backlogul neimportat, nu este o comandă de recuperare a istoricului.

## 8. Incidente frecvente

| Incident                     | Acțiune controlată                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Ollama oprit                 | Păstrează SQL, verifică serviciul/modelul; reîncearcă numai taskurile eligibile                          |
| Cheie email pierdută         | Restaurează cheia potrivită sau elimină/recreează conexiunea și autorizează din nou; nu șterge taskurile |
| Cont compromis               | Dezactivează contul, păstrează evidențele, evaluează sesiunile și cheile API separat                     |
| Credențiale email compromise | Oprește monitorizarea, revocă accesul la furnizor, reconectează cu acordul IT                            |
| Certificat expirat           | Înlocuiește prin procedura IT, validează și repornește proxy-ul; fără ignorarea TLS                      |
| Disc plin / SQL indisponibil | Oprește extinderea importului, implică operatorul, verifică backupul; nu șterge arbitrar volumul SQL     |
| Raport EMMA greșit           | Oprește regula, inventariază taskurile create și corectează procesul cu responsabilul operațional        |

## 9. Oprire definitivă

Oprește monitorizarea și procesele, revocă acordurile/tokenurile la furnizori și cheile API necesare, retrage accesul DNS/rețea și aplică politica de păstrare/ștergere inclusiv asupra backupurilor. Eliminarea configurației din UI nu revocă automat acordul OAuth extern și nu șterge arhiva.
