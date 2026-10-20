# Instalare Windows 11 / Cloud PC

[Documentație](README.md) · [HTTPS corporativ](corporate-https.md) · [Operare și backup](operations.md)

## 1. Condiții de instalare

Această procedură creează o instalare nouă. Pentru actualizarea uneia existente, folosește [procedura de actualizare](operations.md). Pentru mutarea aceleiași organizații cu datele ei, folosește procedura de migrare/restaurare, nu bootstrapul unei organizații noi.

| Componentă        | Cerință                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Sistem            | Windows 11 / Cloud PC administrat, cu instalarea aprobată de IT                           |
| Node.js           | Minimum 22.13; recomandat seria 24 LTS, cu npm                                            |
| PostgreSQL        | Seria 17 sau 18, pgAdmin recomandat pentru administrare                                   |
| Rețea             | Acces aprobat la sursa codului/dependențelor și ulterior la furnizorul email              |
| Spațiu și memorie | De dimensionat pentru SQL, documente și backupuri; nu există un prag de producție validat |

Agenții folosesc doar browserul. Dimensionarea depinde de volumul de email, atașamente, documente și backupuri.

Nu copia credențialele sau mesajele personale din instalarea de test într-o instalare nouă a companiei.

## 2. Instalează și verifică programele

Folosește sursele oficiale sau pachetele aprobate de IT:

- [Node.js](https://nodejs.org/)
- [PostgreSQL pentru Windows](https://www.postgresql.org/download/windows/)

După instalare, deschide un PowerShell nou:

```powershell
node --version
npm.cmd --version
```

Dacă instalarea existentă a PostgreSQL este administrată de companie, solicită o bază și un utilizator dedicate. Nu modifica rolurile sau porturile unei instalări folosite de alte aplicații.

## 3. Motorul de dispecerizare

Versiunea curentă folosește reguli SQL configurate de administrator. Nu instala Ollama și nu descărca modele pentru această instalare. Un model existent nu este șters, dar nu mai este folosit. Nu este necesar GPU.

## 4. Obține proiectul

Descarcă ZIP-ul din GitHub → Code → Download ZIP, sau folosește checkout-ul existent dacă lucrezi cu Git. Exemplele de mai jos presupun folderul:

```text
C:\Relay\dispecerizare
```

În acest folder trebuie să existe `package.json`, `server` și `src`. Calea reală și drepturile de acces trebuie aprobate pentru calculatorul companiei. Nu pune secretele sau backupurile în `dist` ori `public`.

## 5. Creează rolul și baza PostgreSQL

În pgAdmin, conectează-te cu rolul de administrare stabilit la instalare:

1. Login/Group Roles → Create → Login/Group Role.
2. Nume: `relay`.
3. Definition → Password: o parolă nouă, generată pentru această instalare.
4. Privileges → Can login: Yes. Nu activa Superuser pentru contul aplicației.
5. Salvează, apoi Databases → Create → Database.
6. Nume bază: `relay`; Owner: `relay`.

Aplicația are nevoie de drepturile de creare/modificare a propriilor tabele pentru migrări. Utilizatorul separat pentru testele automate are nevoie și de CREATE SCHEMA într-o bază de dezvoltare; această cerință nu justifică acces de superuser în producție.

## 6. Instalează dependențele și creează configurația

```powershell
cd C:\Relay\dispecerizare
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Comanda păstrează un `.env` deja existent. Completează sau verifică valorile reale:

```dotenv
DATABASE_URL=postgresql://relay:PAROLA_URL_ENCODED@127.0.0.1:5432/relay
APP_ORIGIN=http://localhost:5173
HOST=127.0.0.1
PORT=3001
VITE_API_ENABLED=true
ORGANIZATION_NAME=Numele organizatiei
ADMIN_EMAIL=admin@example.test
ADMIN_PASSWORD=PAROLA_INITIALA_GENERATA
```

Înlocuiește obligatoriu valorile PAROLA_URL_ENCODED și PAROLA_INITIALA_GENERATA; acestea sunt substituenți, nu parole de păstrat. Parola administratorului trebuie să aibă minimum 12 caractere. Parolele SQL și Relay sunt independente. În URL-ul SQL, caractere precum `@`, `#` sau `%` din parolă trebuie codificate; o parolă lungă, aleatorie, cu litere și cifre simplifică această configurare.

Salvează ca `.env`, nu `.env.txt`, în format text UTF-8. `POSTGRES_PASSWORD` este necesar doar pentru alternativa Docker din `compose.yaml`; nu configurează parola unui server PostgreSQL nativ deja instalat. Lasă TEST_DATABASE_URL necompletat pe instalarea operațională.

## 7. Creează schema și administratorul

```powershell
npm.cmd run db:migrate
npm.cmd run db:bootstrap
```

Notează `organizationId` și asocierea cu organizația creată, într-un inventar privat. Bootstrapul creează organizația și administratorul, nu doar parola. Se execută o singură dată pentru organizația nouă și refuză suprascrierea unui administrator existent cu același email.

După succes, golește `ADMIN_PASSWORD` din `.env`. Parola contului rămâne în baza de date ca hash. Nu schimba parola contului prin editarea ulterioară a acestei variabile; folosește Setări → schimbarea parolei.

## 8. Pornește verificarea locală

Primul terminal:

```powershell
cd C:\Relay\dispecerizare
npm.cmd run api
```

Al doilea terminal:

```powershell
cd C:\Relay\dispecerizare
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Deschide `http://localhost:5173` în browserul Cloud PC-ului. Folosește ID-ul organizației, emailul administratorului și parola creată la bootstrap. HOST limitează API-ul; opțiunea `--host` din comanda Vite limitează separat serverul de dezvoltare. `--strictPort` evită schimbarea automată a portului și nepotrivirea cu APP_ORIGIN.

Verificări de final:

- autentificarea afișează organizația și rolul așteptate;
- poți crea o competență și un agent;
- Reguli de dispecerizare poate evalua și salva un task de test;
- datele rămân după reîncărcarea paginii și restartul backendului;
- înregistrezi versiunea codului, modelul și rezultatul testului.

Testele manuale creează date persistente. Folosește exemple fictive sau aprobate, nu informații personale de test fără legătură cu organizația.

## 9. Configurează procesele departamentului

Urmează [manualul administratorului](administrator-guide.md): competențe, agenți, reguli, căsuță de test, ITL și eventual EMMA. Pentru primul email real, pornește numai de la momentul activării și trimite mesajul după confirmare.

## 10. Pregătește accesul colegilor

Pentru pilotul corporativ, urmează [ghidul HTTPS](corporate-https.md). IT trebuie să confirme găzduirea, DNS-ul stabil, certificatul și ruta de acces. Faptul că aplicația pornește pe Cloud PC nu dovedește că acesta este accesibil de pe PC-urile colegilor.

Nu folosi localhost în linkul trimis agenților. Nu expune PostgreSQL. Nu activa serviciile și firewall-ul prin ocolirea politicilor companiei. Pentru 24/7 sunt necesare procese administrate, recuperare după restart și un calculator care nu intră în sleep; installerul de servicii nu este inclus.

## Înregistrarea instalării

Păstrează privat: gazda și responsabilul, calea proiectului, versiunea codului, versiunea Node/PostgreSQL, ID-ul organizației, numele HTTPS aprobat, directorul de date, modalitatea de pornire, destinația backupului și data ultimei restaurări testate. Referințele la secrete se înregistrează în managerul de secrete aprobat, nu se copiază în fișa de instalare.
