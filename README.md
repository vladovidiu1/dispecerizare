# Relay — interfață de dispecerizare

Prototip React pentru gestionarea mesajelor și a echipei, independent de domeniul de activitate.

## Dezvoltare

Necesită Node.js 22+ și npm.

```sh
npm ci --cache /tmp/relay-npm-cache
npm run dev
```

```sh
npm run build
npm run preview
```

Interfața include vizualizări Administrator / Agent, căutare și filtrare mesaje, detaliu conversație, schimbarea responsabilului și stării, răspunsuri demonstrative și adăugarea agenților cu competențe. Rolul se schimbă din meniul profilului sau din Setări.

Datele se păstrează doar în memoria sesiunii și se resetează la reîncărcare. Nu există încă autentificare, conectare email, trimitere reală de mesaje sau distribuire automată. Indicatorii de performanță sunt ilustrativi; această etapă validează interfața.
