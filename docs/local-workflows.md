# Testarea locală: rețea, conversații, atașamente, ITL și EMMA

[Documentație](README.md) · [Manual administrator](administrator-guide.md) · [Depanare](troubleshooting.md)

## Actualizarea unei instalări Windows existente

Oprește terminalele cu Ctrl+C. În pgAdmin fă un backup al bazei `relay` (Backup → Custom). Păstrează `.env` și `.relay`, inclusiv cheia credențialelor. Copiază fișierele noului ZIP peste proiect și rulează în folder:

```powershell
npm.cmd ci
npm.cmd run db:migrate
```

Migrarea 003 păstrează taskurile și adaugă conversațiile, atașamentele, ITL, EMMA și data rezolvării. Nu rerula bootstrapul. Datele istorice de rezolvare sunt aproximative pentru taskurile anterioare migrării. Pornește `npm.cmd run api` și, în alt terminal, `npm.cmd run dev`. Ollama rămâne pornit pe PC-ul serverului. Colegii au nevoie doar de browser și propriul cont creat de administrator.

## Acces de la colegi, fără domeniu cumpărat

`localhost` înseamnă calculatorul pe care se află browserul. Un coleg nu folosește localhost-ul tău. Pentru test pe aceeași rețea poate folosi IP-ul PC-ului care găzduiește aplicația sau numele Windows al acelui PC, dacă rețeaua îl poate rezolva. Pe Cloud PC, adresa afișată poate fi într-o rețea virtuală inaccesibilă colegilor; IT trebuie să confirme accesul/rutarea. Aplicația nu creează o rețea între calculatoare.

Varianta simplă servește interfața compilată și API-ul dintr-un singur proces. În `.env` setează, înlocuind exemplele cu adresele reale:

```dotenv
VITE_API_ENABLED=true
HOST=0.0.0.0
PORT=3001
APP_ORIGIN=http://NUMELE-PC-ULUI:3001
APP_ORIGINS=http://localhost:3001,http://192.168.1.50:3001
```

Numele poate fi văzut în Windows → Settings → System → About → Device name. IP-ul IPv4 poate fi văzut cu `ipconfig`. `APP_ORIGIN` și `APP_ORIGINS` sunt originile exacte acceptate din browser, inclusiv portul, fără slash final; nu adăuga wildcarduri. Numele este cel real al PC-ului sau un alias care rezolvă către el. Setările se aplică după restart.

Apoi:

```powershell
npm.cmd run build
npm.cmd run start:local
```

Pentru această variantă nu mai porni `api`/`dev` separat pe aceleași porturi. Pe server și la colegi deschide adresa configurată, de exemplu `http://NUMELE-PC-ULUI:3001`. În Windows Firewall permite portul TCP 3001 numai din rețeaua privată/internă necesară. Nu configura port forwarding pe router și nu expune PostgreSQL/5432 sau Ollama/11434. Păstrează API-ul pe loopback dacă folosești în schimb Vite pe 5173; adaugă originile cu portul 5173 la APP_ORIGINS. Numele configurate sunt acceptate explicit de Vite.

Un nume precum `relay` poate fi gratuit: o înregistrare în DNS-ul intern, făcută de IT, sau o intrare în fișierul hosts al fiecărui PC (`192.168.1.50 relay`, cu drepturi de administrator). Folosește IP rezervat DHCP/static aprobat de IT, altfel numele poate indica ulterior alt calculator. Nu trebuie cumpărat un domeniu public.

HTTP este pentru pilot într-o rețea de test de încredere: nu criptează traficul între browser și server. Pentru echipă în companie, folosește HTTPS prin infrastructura/certificatul intern al IT; un domeniu public plătit nu este necesar. În producție aplicația cere APP_ORIGIN HTTPS și cookie-uri Secure. Zscaler, VPN, Windows Firewall și politicile Cloud PC pot necesita configurare IT; nu sunt ocolite.

Mesajele, atașamentele și documentele sunt stocate în PostgreSQL local; PDF-urile din folder rămân și pe disc. Qwen este apelat numai pe loopback. Microsoft/Google/Yahoo rămân furnizori externi: aplicația comunică cu ei pentru citirea emailurilor. Descărcarea inițială a modelului/dependențelor necesită Internet; inferența și prelucrarea documentelor nu folosesc un API AI extern.

## Distribuire echilibrată

Dintre utilizatorii activi/disponibili cu competența cerută și capacitate liberă, se alege cel cu cele mai puține taskuri deschise (Nou sau În lucru). La egalitate, cel mai demult repartizat, apoi ID-ul. Pentru 20 taskuri noi și doi agenți inițial liberi, cu același skill și capacitate suficientă, rezultatul este 10/10. Capacități diferite nu schimbă această prioritate, dar rămân limite maxime.

Sunt luate în calcul toate taskurile deschise ale agentului, inclusiv alte competențe și EMMA. Nu mutăm automat taskuri deja alocate. Taskurile clasificate cu încredere suficientă sau confirmate de om, rămase fără agent, sunt verificate de worker și alocate când apare capacitate. Cele cu încredere redusă rămân pentru verificare. Administratorul poate face alocări manuale oricui.

## Actualizări pe același task

Outlook folosește conversationId. Gmail/Yahoo folosesc Message-ID, In-Reply-To și References. Emailul nou este adăugat la conversație, cu atașamentele lui, păstrând agentul și tagul; nu este trimis din nou la Qwen pentru redistribuire. Dacă taskul era Rezolvat, un răspuns nou îl redeschide la Nou. Un mesaj vechi importat explicit nu înlocuiește corpul unui mesaj mai recent. Importul repetat al aceluiași identificator nu dublează conversația.

Testează trimițând un email nou după actualizare, apoi Reply la același email. Un email nou cu același subiect nu este suficient pentru grupare. Referințele ambigue nu unesc taskuri diferite. Metadatele inexistente din versiunile vechi nu pot fi recuperate complet; migrarea păstrează textul și threadId cunoscut, fără a reimporta automat căsuța. Aplicația citește doar Inbox, nu Sent; răspunsurile trimise din afara aplicației nu sunt importate din Sent.

## Atașamente

În task, secțiunea Conversație și atașamente arată fiecare email și fișierele lui. Agentul poate descărca atașamente numai din taskurile la care are acces; administratorul are acces la taskurile firmei. Fișierele sunt servite ca descărcare și nu sunt executate sau încărcate automat în Qwen.

Limite: maximum 20 MB per atașament, 30 MB total per mesaj și 50 atașamente. IMAP nu descarcă sursa MIME dacă mesajul are peste 30 MB: păstrează metadatele și indicația de consultare în căsuța originală. Graph păstrează un avertisment pentru atașamente prea mari/indisponibile, linkuri sau mesaje încorporate. Nu este inclus un antivirus; documentele se deschid prin protecțiile PC-ului companiei. Fișierele importate înainte de această versiune nu au atașamente recuperate retroactiv.

## ITL în PDF

În ITL & EMMA, încarcă un PDF cu text selectabil. Sau copiază documentele în `.relay/itl/ID-ORGANIZATIE/` de pe server și apasă Indexează folderul ITL. Ecranul afișează folderul exact pentru organizația autentificată. Dacă ai RELAY_DATA_DIR configurat, folosește acel director în loc de `.relay`. Nu se citesc subfoldere sau linkuri simbolice. Maximum 100 PDF-uri la o indexare, 20 MB/500 pagini/800.000 caractere fiecare. PDF-urile scanate necesită OCR separat.

Textul este indexat local pe pagini și fragmente; duplicatele identice sunt ignorate. Pentru o versiune revizuită a unui ITL, scoate versiunea veche din index după adăugarea celei noi. Ștergerea din index elimină documentul din SQL; nu șterge PDF-ul original din folder. Nu îl reindexa dacă nu mai trebuie folosit. Toți utilizatorii aceleiași organizații pot descărca ITL-urile, iar administrarea bibliotecii este rezervată adminului.

Într-un task, căutarea lexicală SQL identifică fragmente cu termeni comuni. Dacă există candidați, se activează Cum să rezolv. La apăsare, Qwen generează pași în română numai din fragmentele găsite, cu document, pagină și citat verificat textual pentru fiecare pas. Dacă fragmentele nu sunt suficiente, răspunsul poate fi gol. Nu este căutare semantică și un buton activ nu certifică faptul că documentul rezolvă problema. Agentul verifică procedura și condițiile din PDF. Nu se execută pași automat. Modelul este comun cu clasificarea: dacă procesează deja un mesaj, reîncearcă după terminare.

## Excel EMMA

1. În Echipă & competențe, creează competența potrivită (ex. Tarifare EMMA), atribuie-o agenților și completează Coduri EMMA acceptate, separate prin virgulă, apoi ieși din câmp ca să se salveze. Codurile sunt normalizate la majuscule; nu sunt aproximative.
2. În ITL & EMMA → Verifică structura unui Excel, alege un XLSX de test. Previzualizarea arată numele foilor și primele 10 rânduri, fără a crea taskuri sau a salva fișierul.
3. Creează o regulă: expeditor exact, opțional text în subiect, numele exact al foii, numărul rândului cu antete, numele exact al coloanei codului și competența. Activeaz-o. Dacă există mai multe reguli potrivite unui email, importul se oprește pentru verificare; restrânge regulile.
4. Trimite un email nou cu XLSX-ul către căsuța monitorizată. Pentru un raport deja importat, adminul poate apăsa Aplică regulile EMMA acestui email în task.
5. Verifică jurnalul importurilor și taskurile create. Fiecare rând eligibil devine un task cu cod, numărul rândului, numele Excelului și datele coloanelor. Dintre agenții cu skill și cod, primește taskul cel cu încărcare minimă și capacitate liberă. Dacă momentan sunt indisponibili/plini, taskul așteaptă; codurile fără niciun agent activ cu skill sunt ignorate și numărate.

Un rând înseamnă un task; nu grupăm mai multe rânduri într-un singur task. Excelul original rămâne la taskul raportului, vizibil adminului cât timp acesta este nealocat. Agenții văd datele rândurilor alocate lor, fără să primească automat întregul raport cu erorile altor agenți. Raportul părinte este marcat Rezolvat după un import reușit dacă nu era alocat; la eroare rămâne pentru verificare. Interpretarea EMMA este deterministă, fără Qwen. O regulă de expeditor nu verifică autenticitatea expeditorului; drepturile ulterioare de lucru rămân cele ale sistemelor companiei.

Sunt acceptate numai XLSX (nu XLS/XLSM/CSV), maximum 10 MB comprimat/40 MB decomprimat, 100 coloane și 10.000 rânduri pe foaie, maximum 1.000 erori eligibile per fișier. Formulele din celule nu sunt executate; o formulă în coloana codului este ignorată. Foaia/coloana absentă și fișierul invalid apar ca erori în jurnal. Corectează regula și reaplic-o explicit din task. Reaplicarea aceluiași atașament procesat nu dublează taskurile. Un fișier retrimis într-un email nou este un raport nou: deduplicarea erorilor între săptămâni necesită o cheie de business (de exemplu cod + contract + perioadă), care trebuie stabilită pe formatul real al raportului.

## Dashboarduri

Privirea de ansamblu folosește agregări SQL pentru toate taskurile accesibile utilizatorului: total, noi, rezolvate, timp mediu de rezolvare de la crearea taskului, flux create/rezolvate pe 7 zile, încărcare/capacitate și categorii. Administratorul vede firma, agentul numai taskurile sale curente. Un rând EMMA este un task și este numărat separat de raportul părinte. Nu este măsurat timpul de muncă efectiv sau timpul până la primul răspuns email.

Datele se reîncarcă la 30 secunde și la revenirea în ecran. Graficul rezolvărilor folosește data ultimei rezolvări a taskului; redeschiderea șterge rezolvarea curentă, iar istoricul evenimentelor rămâne în audit. Nu este un raport SLA sau o arhivă a fiecărui ciclu de rezolvare.

## Verificare și backup

Testele automate folosesc PostgreSQL real, documente/Excel de test și furnizori/model simulați. Nu demonstrează acuratețea ITL pe documentele companiei, accesul colegilor prin Zscaler sau compatibilitatea unui Excel EMMA încă nefurnizat. Acestea se verifică în pilot. Backupul PostgreSQL include acum atașamentele și PDF-urile încărcate; păstrează și `.relay` și orice RELAY_DATA_DIR privat. Nu copia aceste fișiere în dist sau GitHub.
