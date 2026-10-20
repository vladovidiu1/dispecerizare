# Manualul agentului

[Documentație](README.md) · [Depanare](troubleshooting.md)

## 1. Acces și autentificare

Primești de la administrator:

- linkul aplicației, preferabil HTTPS intern;
- ID-ul organizației;
- emailul contului Relay;
- parola inițială transmisă prin canalul aprobat.

Deschide linkul în browser și completează cele trei câmpuri de autentificare. Contul Relay nu este automat contul Microsoft al companiei. Nu trebuie să instalezi modele AI sau PostgreSQL pe calculatorul tău.

Dacă browserul afișează un avertisment de certificat, anunță administratorul/IT. ID-ul organizației nu este o parolă; accesul este acordat prin cont și rol. Sesiunea curentă are o durată de 8 ore; expirarea ei necesită autentificare din nou.

## 2. Lista de lucru

În **Mesaje** vezi taskurile alocate contului tău. Poți căuta în lista încărcată și filtra după Nou, În lucru sau Rezolvat. Interfața încarcă pagini de câte 100 de taskuri; verifică paginarea înainte să presupui că o solicitare lipsește. Datele se reîncarcă periodic, la aproximativ 30 de secunde.

**Privire de ansamblu** agregă taskurile accesibile contului, nu doar pagina curentă. Un task nealocat nu apare în lista unui agent; administratorul verifică acea coadă.

## 3. Tratarea unui task

1. Deschide taskul și citește conversația, nu doar subiectul.
2. Verifică competența și atașamentele relevante.
3. Treci în **În lucru** când începi rezolvarea.
4. Adaugă o notă internă dacă trebuie consemnată o verificare sau o decizie.
5. Treci în **Rezolvat** după încheierea tratării, conform regulilor departamentului.

Schimbarea stării nu trimite un răspuns expeditorului. O notă salvată rămâne în aplicație; nu este email. Folosește butonul **Răspunde prin email** pentru a trimite efectiv un răspuns; nota internă rămâne separată.

Un email nou din conversație este adăugat aceluiași task atunci când identificatorii permit asocierea. Dacă taskul era rezolvat, poate reveni la Nou. Agentul și competența se păstrează. Aplicația monitorizează Inbox, nu Sent.

## 4. Verificarea sau corectarea competenței

Dacă tagul este corect, poți apăsa **Confirmă tagul ca fiind corect**. Confirmarea nu mută taskul; păstrează decizia umană în istoric.

Dacă tagul este greșit:

1. Alege competența potrivită din selectorul taskului.
2. Așteaptă confirmarea salvării.
3. Taskul revine la Nou și este redistribuit automat, după competență și încărcare.

Poate dispărea din lista ta deoarece a fost alocat altui agent sau a rămas nealocat pentru verificare. Acesta este comportamentul așteptat, nu pierderea taskului. Selectarea aceleiași competențe confirmă tagul, fără redistribuire.

Pentru predarea parțială, folosește **Transferă unui coleg** și completează ce ai făcut și ce rămâne. Poți alege un coleg activ din organizație, indiferent de skill; verifică încărcarea lui. Tagul se păstrează, starea devine Nou, iar vechiul responsabil pierde accesul dacă este agent. Prioritatea rămâne în controlul administratorului.

## 5. Atașamente

În **Conversație și atașamente**, fiecare email are propriile fișiere. Descarcă numai documentele necesare și deschide-le prin aplicațiile și protecțiile aprobate ale companiei.

Un fișier poate lipsi din cauza limitei de import, a tipului nesuportat sau fiindcă emailul a fost importat înainte de introducerea funcției. Avertismentul din task indică verificarea în căsuța originală. Aplicația nu include un antivirus și nu recuperează automat retroactiv toate atașamentele vechi.

## 6. Asistență din ITL

Butonul **Cum să rezolv** afișează fragmente ITL și rezolvări partajate ale unor taskuri rezolvate, găsite prin căutare lexicală SQL. Nu generează pași și nu folosește AI. Verifică documentul și aplicabilitatea procedurii.

Cu **Cum am rezolvat**, completează rezumatul și pașii efectuați. Poți marca taskul Rezolvat la salvare și alege dacă procedura devine exemplu pentru colegi după rezolvarea taskului. Scrie fără parole, date personale sau informații specifice clientului. O rezolvare nepartajată rămâne doar în task. Consemnările sunt păstrate, fără editare sau ștergere prin interfață.

### Răspuns din contul Microsoft 365

În **Setări → Adresa mea de expediere**, salvează adresa personală, Application/Client ID și Tenant ID aprobate, apoi autorizează contul Microsoft. Permisiunile delegate necesare sunt User.Read și Mail.Send, plus offline_access; IT poate impune acord sau restricții de acces.

În task, apasă **Răspunde prin email**. Verifică expeditorul, destinatarul fix și textul. Răspunsul se trimite către expeditorul emailului inițial, din contul tău autorizat. Reply-To este căsuța monitorizată; antetele In-Reply-To/References păstrează referința inițială. Gruparea vizuală în clientul destinatarului depinde și de furnizor. Nu poți schimba destinatarii, atașa fișiere sau adăuga CC/BCC în această versiune.

**Acceptat de furnizor** nu garantează livrarea. Dacă apare **Rezultat necunoscut**, verifică în contul expeditorului sau cu IT și înregistrează rezultatul și dovada în task. Aplicația nu retrimite automat un email incert. Nu confirma „nu a fost trimis” fără verificare: poate produce un duplicat la retrimiterea explicită. Pentru mesaje vechi fără Message-ID, trimiterea este blocată.

## 7. Taskuri EMMA

Un task EMMA reprezintă un rând eligibil al unui raport, cu codul erorii și datele coloanelor. Responsabilul este ales dintre agenții configurați cu acel cod și skill. Raportul Excel complet rămâne la taskul părinte; nu este distribuit automat fiecărui agent.

Dacă ai nevoie de alt cod sau skill, discută cu administratorul. Corectarea unei informații în task nu modifică fișierul Excel sau sistemul de business sursă.

## 8. Parolă, deconectare și suport

În **Setări**, completează parola curentă și noua parolă, de minimum 12 caractere. După schimbare, toate sesiunile contului sunt închise; te autentifici din nou. Schimbarea parolei inițiale este recomandată, dar nu este impusă automat în versiunea curentă.

Dacă ai uitat parola, contactează administratorul: recuperarea automată nu este implementată. Folosește deconectarea din profil la încheierea utilizării pe un calculator partajat.

Pentru suport comunică ID-ul taskului, momentul aproximativ al erorii, ecranul și textul mesajului. Nu transmite parole, coduri de autentificare, tokenuri sau atașamente/confidențialități în afara canalului aprobat.
