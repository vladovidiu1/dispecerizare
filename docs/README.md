# Relay — Centrul de documentație

[Repository și prezentare](../README.md)

## Identificarea documentației

| Câmp                  | Valoare                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Ediție documentație   | `1.0`                                                                                     |
| Aplicație documentată | Relay `0.1.0`, stadiu pilot                                                               |
| Data reviziei         | 18 octombrie 2026, Europe/Bucharest                                                       |
| Referință tehnică     | Codul funcțional până la commitul `d529303`; schema SQL `003`                             |
| Limba                 | Română; identificatorii tehnici păstrează forma din cod                                   |
| Statut                | Descriere a implementării și proceduri pentru pilot; fără aprobare de producție implicită |

Documentația distinge funcțiile implementate de configurările care depind de infrastructura companiei. Exemplele de domenii, conturi și căi sunt fictive. Pentru fiecare instalare, administratorul completează separat inventarul operațional cu valorile reale, în spațiul privat aprobat al organizației.

## Parcursuri recomandate

### Agent

Citește [manualul agentului](agent-guide.md). Primește de la administrator linkul, ID-ul organizației și propriul cont. Nu instalează PostgreSQL sau Ollama.

### Administrator de departament

Începe cu [prezentarea produsului](product-overview.md), apoi [manualul administratorului](administrator-guide.md). Pentru prima instalare folosește [ghidul Windows](installation-windows.md), iar pentru pilot [planul de acceptanță](pilot-acceptance.md).

### IT și Cyber Security

Consultă [arhitectura](architecture.md), [dosarul de securitate](security.md), [HTTPS și conectivitatea corporativă](corporate-https.md), [modelul de date](data-model.md) și [operarea/recuperarea](operations.md). Stabilește infrastructura, identitățile și controalele necesare înainte de aprobarea utilizării cu date reale.

### Dezvoltator sau integrator

Consultă [ghidul de dezvoltare](development.md), [referința API](api.md), [arhitectura](architecture.md) și [istoricul modificărilor](CHANGELOG.md). Contractele efective sunt definite de validările backendului și migrările SQL.

## Catalogul documentelor

| Document                                                | Scop                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| [Prezentare funcțională](product-overview.md)           | Obiective, capabilități, reguli, termeni și limite              |
| [Instalare Windows / Cloud PC](installation-windows.md) | Instalare nouă, configurare și prima verificare                 |
| [Manual administrator](administrator-guide.md)          | Echipă, exemple, căsuțe, controlul distribuirii și conturi      |
| [Manual agent](agent-guide.md)                          | Autentificare, taskuri, note, taguri, atașamente și ITL         |
| [Conectarea emailului](email-setup.md)                  | Outlook/Microsoft 365, shared mailbox, Gmail, Yahoo             |
| [Workflow-uri locale](local-workflows.md)               | Conversații, distribuire, ITL, EMMA, limite și dashboarduri     |
| [HTTPS corporativ](corporate-https.md)                  | DNS stabil, IP dinamic, Caddy, certificate și Zscaler           |
| [Dosar de securitate](security.md)                      | Controale, granițe de încredere, responsabilități și riscuri    |
| [Arhitectură](architecture.md)                          | Componente, fluxuri și comportament la întreruperi              |
| [Model de date](data-model.md)                          | Entități SQL, relații, identificatori și migrare                |
| [Operare și recuperare](operations.md)                  | Pornire, backup, restore, actualizare și incidente              |
| [Depanare](troubleshooting.md)                          | Diagnostic după simptom, fără expunerea secretelor              |
| [Referință API](api.md)                                 | Autentificare, rute și integrarea unui robot extern             |
| [Dezvoltare](development.md)                            | Configurare, comenzi, cod, teste și contribuții                 |
| [Plan de acceptanță](pilot-acceptance.md)               | Scenarii și evidențe necesare pentru evaluarea pilotului        |
| [Istoric](CHANGELOG.md)                                 | Modificări implementate, fără a presupune release-uri publicate |

## Convenții și mentenanță

- **Implementat** înseamnă că există cod pentru funcție; nu garantează compatibilitatea cu fiecare infrastructură sau document real.
- **Necesită IT** indică o dependență externă: DNS, certificat, rutare, permisiuni, servicii sau politică de securitate.
- **Planificat / neimplementat** nu reprezintă un angajament de livrare sau o funcție disponibilă.
- Comenzile Windows folosesc PowerShell și `npm.cmd`; căile sunt exemple care trebuie adaptate.
- Nu se includ în documentație parole, tokenuri, chei private, mesaje reale sau detalii de infrastructură confidențiale.

La schimbarea comportamentului, se actualizează ghidul rolului afectat, API-ul dacă este cazul și istoricul. Rezultatele unui test se înregistrează cu versiunea codului și mediul folosit; documentația nu constituie singură dovadă de executare a procedurilor într-o instalare a clientului.
