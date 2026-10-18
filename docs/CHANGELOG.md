# Istoricul modificărilor

[Documentație](README.md)

Acest istoric grupează funcțiile implementate. Numărul `0.1.0` provine din package.json; intrările de mai jos nu presupun existența unor release-uri GitHub, taguri sau instalatoare distribuite.

## Ediția documentației 1.0 — 18 octombrie 2026

- Centru de documentație cu parcursuri pentru agent, administrator, IT și dezvoltator.
- Manuale, instalare Windows/Cloud PC, arhitectură, model de date, securitate, operare, depanare și plan de acceptanță.
- Reorganizarea README-ului și corectarea descrierilor API depășite.
- Fără schimbarea funcțiilor aplicației sau a schemei SQL.

## Relay 0.1.0 — bază funcțională pentru pilot

| Referință commit | Schimbare                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `d529303`        | Profil HTTPS intern cu Caddy, verificări de pornire, parole proprii și dezactivare/reactivare conturi |
| `9fede78`        | Distribuire echilibrată, conversații, atașamente, ITL PDF, rapoarte EMMA și dashboarduri              |
| `19b3700`        | Monitorizare numai pentru emailurile sosite după activare                                             |
| `00a2bef`        | Conectori email, coadă persistentă și context cu confirmări umane                                     |
| `17db42a`        | Corectarea tagului de către agent și redistribuirea auditată fără model                               |

Platforma include interfață React, API Express, PostgreSQL, conturi, competențe, istoric și integrare locală Ollama. Migrările existente sunt 001–003. Pentru detaliile exacte și modificările anterioare, consultă istoricul Git al repository-ului.

## Verificări tehnice de referință

Pentru codul funcțional documentat la `d529303` au fost executate 52 de teste automate, buildul UI, verificări de browser pentru conturi și un test HTTPS cu Caddy real și CA temporară. Furnizorii email și răspunsurile AI din testele automate sunt simulate; TLS a fost verificat în laborator. Aceste rezultate nu demonstrează compatibilitatea tenantului, rețelei sau documentelor unei companii și nu reprezintă pentest.

Schimbarea exclusiv documentară se validează prin verificarea legăturilor, a comenzilor și a corespondenței cu implementarea. Rezultatele pilotului clientului se înregistrează separat, conform [planului de acceptanță](pilot-acceptance.md).
