# Ghid de dezvoltare

[Documentație](README.md)

## Configurarea mediului

Folosește Node.js minimum 22.13, recomandat 24, PostgreSQL 17 și dependențele din `package-lock.json`. În Windows, comenzile de mai jos folosesc `npm.cmd`; în Linux/macOS se poate folosi `npm`. Instalarea și pornirea inițială sunt descrise în [ghidul Windows](installation-windows.md).

```powershell
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run api
```

În alt terminal:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Folosește `APP_ORIGIN=http://localhost:5173` și `VITE_API_ENABLED=true`. Backendul citește `.env` prin opțiunile Node din scripturi; nu publica fișierul. Pentru testul real de model, pornește Ollama și instalează modelul configurat. Testele automate nu cer acces la căsuțe email reale.

## Comenzile repository-ului

| Script                     | Scop                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm.cmd ci`               | Instalează exact versiunile din lockfile                                                                  |
| `npm.cmd run dev`          | Vite pentru dezvoltare; scriptul de bază ascultă pe toate interfețele, restrânge hostul când este necesar |
| `npm.cmd run api`          | API, migrări lipsă și workere                                                                             |
| `npm.cmd run db:migrate`   | Migrări SQL, fără bootstrap                                                                               |
| `npm.cmd run db:bootstrap` | Organizație și administrator noi; nu se repetă la actualizare                                             |
| `npm.cmd run build`        | Compilează UI în dist; folosește setarea VITE_API_ENABLED disponibilă                                     |
| `npm.cmd run preview`      | Previzualizează buildul Vite; nu înlocuiește backendul și nu este profil corporativ                       |
| `npm.cmd run start:local`  | Servește dist și API împreună, fără compilare automată                                                    |
| `npm.cmd run build:https`  | Build cu API activ și validarea profilului HTTPS privat                                                   |
| `npm.cmd run check:https`  | Verifică profilul și configurația Caddy/certificat                                                        |
| `npm.cmd run start:https`  | Backendul profilului HTTPS, pe loopback                                                                   |
| `npm.cmd run proxy:https`  | Caddy cu configurația livrată                                                                             |
| `npm.cmd run test:api`     | Teste Node seriale, inclusiv integrare PostgreSQL                                                         |
| `npm.cmd run test:https`   | Test opțional cu Caddy real, OpenSSL și CA temporară                                                      |

## Configurație

| Variabilă                                                | Semnificație / regulă                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                           | Conexiunea SQL; parola din URL trebuie codificată corect                                    |
| `POSTGRES_PASSWORD`                                      | Inițializarea serviciului Docker din compose; nu schimbă automat parola unui volum existent |
| `APP_ORIGIN`                                             | Originea exactă principală, cu schemă/nume/port, fără slash final                           |
| `APP_ORIGINS`                                            | Origini suplimentare exacte, separate prin virgulă; nu configurează DNS                     |
| `HOST`, `PORT`                                           | Interfața și portul backendului; în profil HTTPS HOST este 127.0.0.1                        |
| `VITE_API_ENABLED`                                       | true pentru aplicația conectată; este setare de build/UI, nu secret                         |
| `ORGANIZATION_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`     | Numai la bootstrap; elimină parola din fișier după succes                                   |
| `OLLAMA_URL`                                             | Origine HTTP loopback, implicit 127.0.0.1:11434                                             |
| `OLLAMA_MODEL`                                           | Implicit qwen3:8b; adaptorul presupune răspunsul JSON validat                               |
| `OLLAMA_TIMEOUT_MS`                                      | Implicit 300000; interval acceptat 1000–600000                                              |
| `RELAY_DATA_DIR`                                         | Director privat pentru cheie și folder ITL; implicit .relay                                 |
| `API_PROXY_TARGET`                                       | Ținta API pentru Vite, implicit http://127.0.0.1:3001                                       |
| `TEST_DATABASE_URL`                                      | Bază dedicată dezvoltării, cu drept de CREATE SCHEMA; nu folosi baza operațională           |
| `NODE_ENV`                                               | production pentru profilul securizat                                                        |
| `TRUST_PROXY_HOPS`                                       | Implicit 0; profilul livrat Caddy pe aceeași gazdă cere exact 1                             |
| `RELAY_TLS_CERT_FILE`, `RELAY_TLS_KEY_FILE`, `CADDY_EXE` | Materialul TLS și executabilul aprobate; în fișierul HTTPS privat                           |
| `CADDY_TEST_EXE`                                         | Executabilul Caddy pentru testul HTTPS opțional                                             |

Datele sensibile nu se pun în variabile VITE_*: acestea pot ajunge în bundle-ul browserului. NODE_EXTRA_CA_CERTS, dacă este necesar, se configurează înainte de pornire cu certificatul CA aprobat, conform [ghidului corporativ](corporate-https.md).

## Testare

Configurează TEST_DATABASE_URL într-o bază de dezvoltare. Testele creează scheme aleatoare proprii și le elimină; contul are nevoie de CREATE SCHEMA. Rularea serială reduce interferența cu lockurile de inferență din aceeași bază.

```powershell
npm.cmd run test:api
npm.cmd run build
```

Pentru verificarea HTTPS, sunt necesare Caddy 2, OpenSSL și un build cu API activ. Testul creează o CA temporară, fără instalarea ei în trust store, și verifică TLS cu CA explicită. Nu folosește `rejectUnauthorized=false` și nu schimbă politica de securitate a calculatorului.

```powershell
npm.cmd run test:https
```

Separă în raport: teste automate cu furnizori/model simulate, verificare TLS reală de laborator și validare pe conturile/documentele companiei. Un test simulat nu certifică accesul Microsoft sau calitatea clasificării Qwen.

## Structura repository-ului

| Cale                 | Conținut                                                  |
| -------------------- | --------------------------------------------------------- |
| `src/`               | React, componente, client API și stiluri                  |
| `server/`            | API, autentificare, conectori, workere și reguli          |
| `server/migrations/` | Schema SQL versionată                                     |
| `server/test/`       | Teste Node și integrare                                   |
| `scripts/`           | Clientul robotului și utilitare HTTPS                     |
| `deploy/`            | Caddyfile și șablonul profilului privat                   |
| `docs/`              | Documentație funcțională, tehnică și operațională         |
| `.env.example`       | Șablon fără secrete pentru configurarea locală            |
| `compose.yaml`       | PostgreSQL de dezvoltare, port publicat numai pe loopback |

## Integrare externă

Un robot existent poate trimite rezultatul prin `/api/ingest`, cu o cheie a organizației. Folosește [referința API](api.md) și [clientul Python](../scripts/relay_client.py). Identificatorul extern trebuie să rămână stabil la reîncercări. API-ul nu acceptă alegerea arbitrară a agentului prin payloadul robotului.

Importul de exemple/skilluri din Excel este o integrare separată; funcția EMMA importă taskuri din rapoarte, nu migrează automat foile unui robot vechi în configurația modelului.

## Modificări și livrare

La o schimbare de comportament, actualizează documentele relevante și adaugă o migrare nouă dacă schema se schimbă. Nu modifica retrospectiv o migrare deja aplicată ca substitut pentru una nouă. Păstrează tranzacțiile, verificările de organizație și prioritatea deciziilor umane.

Înainte de publicare, verifică diferențele, absența secretelor, testele relevante și contractele API. Descrie problema, comportamentul final și dovezile. Un pachet ZIP nu instalează serviciile, modelul sau baza și nu constituie release operațional aprobat.
