# Integrare AI arhivată

Aceste surse sunt păstrate pentru o eventuală integrare viitoare. Nu sunt importate de serverul activ sau de bundle-ul interfeței. Nu există opțiune de configurare care să reactiveze inferența în versiunea curentă.

Tabelele `classification_examples`, `classifications`, `processing_jobs` și istoricul etichetelor `ai` rămân în SQL. Coada activă folosește `dispatch_jobs` și reguli deterministe. Modelele GGUF instalate pe calculatorul clientului nu sunt șterse de actualizare, dar aplicația nu le accesează.

Testele/arhiva ilustrează contractul adaptorului istoric și nu constituie o funcție disponibilă în aplicație. Orice reactivare necesită dezvoltare și evaluare separată, nu schimbarea unui flag.
