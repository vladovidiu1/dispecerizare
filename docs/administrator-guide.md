# Manualul administratorului

[Documentație](README.md) · [Instalare](installation-windows.md) · [Operare](operations.md)

## Responsabilitate și pregătire

Administratorul Relay gestionează configurația organizației și distribuirea operațională. Acest rol nu înlocuiește administratorul Windows, PostgreSQL, Microsoft Entra sau responsabilul Cyber Security.

Înainte de conectarea datelor departamentului, confirmă instalarea, contul administrator, backupul, căsuța aprobată și persoana care urmărește pilotul. Pentru accesul colegilor este necesară conectivitate reală și un link aprobat; vezi [HTTPS corporativ](corporate-https.md).

## 1. Competențe și echipă

În **Echipă & competențe**:

1. Creează competențe clare, distincte, formulate în termenii departamentului.
2. Adaugă agentul cu nume, email, parolă inițială unică și competențe.
3. Ajustează capacitatea și disponibilitatea după modul real de lucru.
4. Comunică agentului linkul, ID-ul organizației și propriul cont prin canalul aprobat.

Capacitatea reprezintă numărul maxim de taskuri deschise pentru distribuirea automată. Disponibilitatea oprește alocările noi, dar nu închide sesiunile și nu mută taskurile existente. **Dezactivarea contului**, disponibilă în Setări, blochează autentificarea și invalidează sesiunile. Nu confunda cele două acțiuni.

Taskurile deja alocate unui utilizator dezactivat rămân la el până la intervenția administratorului. Verifică și redistribuie lucrările înainte sau după offboarding. Cheile API ale organizației se gestionează separat.

## 2. Exemple și calibrare

În **Test AI local**, adaugă exemple reprezentative pentru fiecare competență: un subiect, textul mesajului și tagul corect. Evită exemple identice, excesiv de generale sau contradictorii. Nu introduce date personale neaprobate.

Rulează teste manuale și verifică atât tagul, cât și responsabilul. Testele creează taskuri persistente. Pentru un task corect, confirmă tagul; pentru unul greșit, corectează competența. Referința umană actuală este folosită în contextul cererilor viitoare.

Acest proces nu reantrenează Qwen. Modelul primește un set limitat de exemple selectate prin SQL. Nu presupune că întreaga arhivă este încărcată în prompt sau că repetarea unei corecții garantează clasificarea următoare.

## 3. Căsuțe email

Urmează [procedura furnizorului](email-setup.md). Conexiunea se creează oprită, se autorizează și se verifică înainte de monitorizare. Pentru Outlook shared mailbox, IT trebuie să configureze aplicația și accesul delegat; pentru Gmail/Yahoo sunt necesare parolele de aplicație permise de furnizor.

| Acțiune                             | Efect                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| Pornește doar de acum               | Salvează un checkpoint nou și ignoră mesajele existente                       |
| Pornește cu istoric                 | Importă explicit intervalul configurat pentru o conexiune fără checkpoint     |
| Oprește monitorizarea               | Oprește verificările automate; nu șterge taskuri                              |
| Reia de la ultima verificare        | Păstrează checkpointul și include mesajele sosite în pauză                    |
| Sincronizează acum                  | Cere un lot de la checkpoint; nu înseamnă că modelul a terminat clasificarea  |
| Caută și Importă                    | Consultă mesaje din Inbox și importă numai rezultatele alese                  |
| Deconectează / elimină configurația | Oprește accesul local; taskurile rămân; acordul la furnizor se revocă separat |

Pentru primul test, alege **Pornește doar de acum**, așteaptă confirmarea și abia apoi trimite emailul. Starea citit/necitit nu stabilește ce este importat. Dacă alegi iar pornirea de acum după o pauză, mesajele neimportate din pauză sunt ignorate de noul checkpoint.

Monitorizarea continuă după logoutul administratorului dacă backendul, SQL și calculatorul rămân pornite. Nu este necesar ca pagina web să rămână deschisă.

## 4. Coada și intervențiile

Verifică în lista de mesaje taskurile nealocate, cele Nou rămase mult timp și istoricul erorilor. Un task nealocat poate însemna încredere redusă, lipsa competențelor sau lipsa capacității.

Pentru un task clasificat suficient sau confirmat de om, workerul poate relua distribuirea când există un agent eligibil. Un rezultat cu încredere mică necesită verificare; simpla eliberare a unui agent nu îl transformă în rezultat sigur.

Poți selecta manual orice utilizator activ al organizației. Alocarea manuală nu respectă automat skillul sau capacitatea și este consemnată ca intervenție. Corectarea tagului fără responsabil explicit reia distribuirea. Nu schimba simultan starea și tagul când intenția este redistribuirea automată.

**Reîncearcă clasificarea în fundal** se folosește pentru taskuri Nou, nealocate, neconfirmate, după corectarea cauzei. Nu suprascrie o decizie umană. Un email nou al aceleiași conversații păstrează în mod normal agentul și tagul.

## 5. Biblioteca ITL

În **ITL & EMMA**, încarcă PDF-uri cu text selectabil sau indexează folderul privat afișat de aplicație. Verifică existența textului înainte de import; documentele scanate necesită OCR separat.

Pentru o versiune nouă a unui ITL, încarcă documentul și elimină versiunea depășită din index. Ștergerea din index nu șterge originalul din folder; dacă îl indexezi iar, documentul poate reveni. Toți utilizatorii organizației pot descărca documentele ITL, deci biblioteca trebuie să conțină numai material aprobat pentru acea audiență.

Testează butonul Cum să rezolv pe solicitări cunoscute și verifică pagina/citatul. Căutarea este lexicală, nu semantică. Un buton activ indică fragmente candidate, nu validarea unei soluții.

## 6. Rapoarte EMMA

1. Configurează skillul și codurile acceptate la fiecare agent.
2. Încarcă un XLSX de test în previzualizare, fără creare de taskuri.
3. Identifică foaia, rândul de antet și coloana exactă a codului.
4. Creează regula cu expeditor exact, text opțional în subiect și skillul destinat taskurilor.
5. Activează regula și trimite un raport de test către Inbox-ul monitorizat.
6. Verifică jurnalul importurilor, codurile ignorate și taskurile create/alocate.

Există un task pentru fiecare rând eligibil. Codurile fără agent activ configurat cu skillul sunt ignorate; indisponibilitatea sau capacitatea ocupată lasă taskurile eligibile în așteptare. Nu activa reguli care se suprapun pentru același email: potrivirea multiplă se oprește pentru verificare.

Pentru un raport deja importat, poți aplica regulile din task. Reaplicarea aceluiași atașament procesat nu creează copii. Retrimiterea fișierului într-un email nou este un raport nou; deduplicarea între perioade nu este implementată. Vezi [limitele și structura EMMA](local-workflows.md).

## 7. Indicatori și control zilnic

Dashboardul afișează toate taskurile organizației, inclusiv taskurile EMMA și rapoartele părinte. Graficul urmărește create/rezolvate pe 7 zile; timpul mediu măsoară de la crearea taskului până la rezolvarea curentă, nu timpul de muncă efectiv sau primul răspuns trimis.

La începutul și finalul perioadei de lucru verifică starea căsuței, erorile, coada, capacitatea, conturile inactive și ultimele rapoarte EMMA. Stabilește în departament responsabilul pentru excepții, timpul de escaladare și criteriul de rezolvare. Aplicația nu include încă reguli SLA sau alerte operaționale automate.

## 8. Predarea către IT și acceptanța

Folosește [planul de acceptanță](pilot-acceptance.md) și [dosarul de securitate](security.md). Păstrează într-un spațiu privat evidențele aprobărilor și ale testelor, fără a publica mesaje reale sau secrete în repository. Versiunea pilot nu are implicit aprobarea de utilizare în producție.
