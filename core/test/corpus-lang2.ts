import type { CardBody, Item } from '../src/model.ts';

export const NOW = Date.parse('2026-11-26T09:00:00Z');
const DAY = 86400000;

export type Lang2 = 'es' | 'de' | 'fr' | 'pt' | 'it';
export const LANGS: Lang2[] = ['es', 'de', 'fr', 'pt', 'it'];

export const KEYS: Record<Lang2, string> = {
  es: 'github.com/acme/entregas',
  de: 'github.com/acme/stundenplan',
  fr: 'github.com/acme/bibliotheque',
  pt: 'github.com/acme/academia',
  it: 'github.com/acme/trattoria',
};

export const PROJECTS = LANGS.map((l) => ({ key: KEYS[l], names: [] as string[] }));

const AGENTS = ['codex', 'claude-code', 'cursor', 'gemini'];
let k = 0;

function c(id: string, lang: Lang2, goal: string, what: string, why: string, path: string): Item {
  const at = NOW - (++k % 30) * DAY - k * 3600000;
  const body: CardBody = { goal, decisions: [{ what, why }], changed: [{ path }] };
  return { id, project: KEYS[lang], kind: 'card', body, origin: { agent: AGENTS[k % AGENTS.length], via: 'tool', source: 'agent', at, session: `${id}-s` }, flags: [], held: false, pinned: false, folded: false, created: at };
}

export const ITEMS: Item[] = [
  c('es-1', 'es', 'Ruta optimizada para los repartidores', 'calcular el orden de las paradas con el servicio de mapas', 'los conductores daban vueltas por el mismo barrio', 'src/rutas/optimizar.ts'),
  c('es-2', 'es', 'Foto como prueba de entrega', 'subir la foto comprimida al almacenamiento de objetos', 'los clientes decían que el paquete nunca llegó', 'src/entregas/foto.ts'),
  c('es-3', 'es', 'Seguimiento del pedido en el mapa', 'enviar la posición del repartidor cada diez segundos', 'los clientes llamaban para preguntar dónde estaba su pedido', 'src/seguimiento/posicion.ts'),
  c('es-4', 'es', 'Firma del cliente en la pantalla', 'guardar la firma como imagen SVG', 'las firmas en PNG ocupaban demasiado espacio', 'src/entregas/firma.ts'),
  c('es-5', 'es', 'Modo sin conexión para la aplicación del conductor', 'guardar las entregas pendientes en el teléfono y sincronizar después', 'en las zonas rurales no hay cobertura', 'src/app/offline.ts'),
  c('es-6', 'es', 'Aviso por WhatsApp cuando el paquete sale del almacén', 'mandar una plantilla aprobada por la API de mensajes', 'muchos clientes no leen el correo', 'src/avisos/whatsapp.ts'),

  c('de-1', 'de', 'Stundenplan als Kalender abonnieren', 'einen iCal-Feed pro Klasse anbieten', 'Eltern wollten die Stunden im eigenen Kalender sehen', 'src/kalender/ical.ts'),
  c('de-2', 'de', 'Vertretungsplan am Morgen aktualisieren', 'die Änderungen um sechs Uhr aus der Schulverwaltung holen', 'Lehrer meldeten sich oft erst früh am Morgen krank', 'src/jobs/vertretung.ts'),
  c('de-3', 'de', 'Raumbelegung ohne Doppelbuchungen', 'eine Sperre pro Raum und Stunde in der Datenbank setzen', 'zwei Klassen standen vor demselben Physikraum', 'src/raeume/belegung.ts'),
  c('de-4', 'de', 'Push-Nachricht bei Stundenausfall', 'Nachrichten nur an die betroffene Klasse schicken', 'alle Schüler bekamen jede Meldung und stellten sie stumm', 'src/push/ausfall.ts'),
  c('de-5', 'de', 'Datenschutz für Schülerdaten', 'Namen der Schüler nur verschlüsselt speichern', 'die Schule verlangt eine DSGVO-konforme Lösung', 'src/db/verschluesselung.ts'),
  c('de-6', 'de', 'Druckansicht für den Aushang', 'eine eigene Druckvorlage mit großer Schrift bauen', 'der Plan am schwarzen Brett war kaum lesbar', 'src/views/druck.tsx'),

  c('fr-1', 'fr', 'Prolonger un prêt en ligne', "autoriser deux prolongations si personne n'a réservé le livre", 'les lecteurs devaient venir au guichet pour prolonger', 'src/prets/prolonger.ts'),
  c('fr-2', 'fr', 'Rappel avant la date de retour', "envoyer un courriel trois jours avant l'échéance", 'beaucoup de livres revenaient en retard', 'src/jobs/rappels.ts'),
  c('fr-3', 'fr', 'Recherche dans le catalogue par auteur', "indexer les noms d'auteurs sans les accents", 'une recherche sans accent ne trouvait pas Hélène ni Émile', 'src/catalogue/recherche.ts'),
  c('fr-4', 'fr', 'Lecture des codes-barres avec la caméra du téléphone', 'utiliser la lecture intégrée au navigateur', 'les douchettes coûtaient trop cher pour les petites antennes', 'src/scan/camera.ts'),
  c('fr-5', 'fr', 'Amendes pour les retards', "plafonner l'amende au prix du livre", 'certains lecteurs devaient plus que la valeur du livre', 'src/prets/amendes.ts'),
  c('fr-6', 'fr', "Réservation d'un livre déjà emprunté", "mettre les lecteurs dans une file d'attente par titre", 'deux personnes recevaient le même avis de disponibilité', 'src/reservations/file.ts'),

  c('pt-1', 'pt', 'Reserva de vagas nas aulas de spinning', 'limitar cada aula ao número de bicicletas da sala', 'alunos chegavam e não havia bicicleta livre', 'src/aulas/vagas.ts'),
  c('pt-2', 'pt', 'Pagamento da mensalidade por Pix', 'gerar um QR code novo para cada cobrança', 'o boleto demorava dias para compensar', 'src/pagamentos/pix.ts'),
  c('pt-3', 'pt', 'Lista de espera quando a aula está cheia', 'chamar o próximo aluno da fila quando alguém cancela', 'as vagas canceladas ficavam vazias', 'src/aulas/espera.ts'),
  c('pt-4', 'pt', 'Entrada na academia com QR code no celular', 'validar o código na catraca sem internet', 'a conexão da recepção caía nos horários de pico', 'src/acesso/catraca.ts'),
  c('pt-5', 'pt', 'Ficha de treino do aluno', 'o professor monta a ficha e o aluno vê no aplicativo', 'as fichas de papel se perdiam', 'src/treinos/ficha.ts'),
  c('pt-6', 'pt', 'Avisos de aula cancelada', 'enviar notificação push até duas horas antes', 'alunos vinham para aulas que não iam acontecer', 'src/avisos/cancelamento.ts'),

  c('it-1', 'it', 'Ordini dal tavolo con il QR code', 'aprire il menu digitale legato al numero del tavolo', 'i camerieri non riuscivano a prendere tutte le ordinazioni', 'src/ordini/tavolo.ts'),
  c('it-2', 'it', 'Allergeni indicati su ogni piatto', 'salvare gli allergeni come elenco fisso per ogni piatto', 'un cliente celiaco ha ricevuto un piatto con glutine', 'src/menu/allergeni.ts'),
  c('it-3', 'it', 'Stampa delle comande in cucina', 'mandare la comanda alla stampante termica della cucina', 'i fogli scritti a mano erano illeggibili', 'src/cucina/stampa.ts'),
  c('it-4', 'it', 'Divisione del conto tra amici', 'calcolare le quote per persona lato server', 'gli arrotondamenti nel browser davano centesimi sbagliati', 'src/conto/dividi.ts'),
  c('it-5', 'it', 'Prenotazione dei tavoli per il weekend', 'bloccare il tavolo per due ore da ogni prenotazione', 'il sabato sera avevamo più prenotazioni che tavoli', 'src/prenotazioni/tavoli.ts'),
  c('it-6', 'it', 'Menu in più lingue per i turisti', 'tenere le traduzioni dei piatti in file separati', 'i turisti non capivano i nomi dei piatti', 'src/i18n/menu.ts'),
];

export type Lang2Kind = 'answer' | 'chat';
export interface Lang2Query { q: string; project: string; kind: Lang2Kind; lang: Lang2; want: string[] }

const q = (lang: Lang2, kind: Lang2Kind, text: string, ...want: string[]): Lang2Query => ({ q: text, project: KEYS[lang], kind, lang, want });

export const QUERIES: Lang2Query[] = [
  q('es', 'answer', '¿Cómo decidimos el orden de las paradas de cada ruta?', 'es-1'),
  q('es', 'answer', '¿Dónde se guardan las fotos de las entregas?', 'es-2'),
  q('es', 'answer', '¿Cada cuánto se actualiza la posición del repartidor en el mapa?', 'es-3'),
  q('es', 'answer', '¿En qué formato guardamos la firma del cliente?', 'es-4'),
  q('es', 'answer', 'La app del conductor no funciona cuando no hay cobertura', 'es-5'),
  q('es', 'answer', '¿Por qué avisamos a los clientes por WhatsApp y no por correo?', 'es-6'),
  q('es', 'chat', 'Muy bien, sigue con eso'),
  q('es', 'chat', 'Hola, ¿qué tal todo?'),

  q('de', 'answer', 'Wie können Eltern den Stundenplan in ihren Kalender holen?', 'de-1'),
  q('de', 'answer', 'Wann wird der Vertretungsplan jeden Morgen aktualisiert?', 'de-2'),
  q('de', 'answer', 'Was verhindert, dass ein Raum doppelt gebucht wird?', 'de-3'),
  q('de', 'answer', 'Warum bekommt nur die betroffene Klasse die Push-Nachricht?', 'de-4'),
  q('de', 'answer', 'Wie speichern wir die Namen der Schüler?', 'de-5'),
  q('de', 'answer', 'Der Aushang am schwarzen Brett ist schlecht lesbar', 'de-6'),
  q('de', 'chat', 'Danke, das passt so'),
  q('de', 'chat', 'Alles klar, mach weiter'),

  q('fr', 'answer', 'Comment un lecteur peut-il prolonger son prêt depuis le site ?', 'fr-1'),
  q('fr', 'answer', 'Quand envoie-t-on le rappel avant la date de retour ?', 'fr-2'),
  q('fr', 'answer', 'Pourquoi la recherche par auteur ignore les accents ?', 'fr-3'),
  q('fr', 'answer', 'Comment scanner les codes-barres sans douchette ?', 'fr-4'),
  q('fr', 'answer', "Quel est le montant maximum d'une amende de retard ?", 'fr-5'),
  q('fr', 'answer', 'Que se passe-t-il quand plusieurs lecteurs réservent le même livre ?', 'fr-6'),
  q('fr', 'chat', "Merci, c'est parfait"),
  q('fr', 'chat', 'Bonjour, tu es là ?'),

  q('pt', 'answer', 'Como limitamos o número de alunos em cada aula de spinning?', 'pt-1'),
  q('pt', 'answer', 'Por que a mensalidade passou a ser paga por Pix?', 'pt-2'),
  q('pt', 'answer', 'O que acontece com a vaga quando alguém cancela?', 'pt-3'),
  q('pt', 'answer', 'A catraca funciona sem internet?', 'pt-4'),
  q('pt', 'answer', 'Onde o aluno vê a ficha de treino?', 'pt-5'),
  q('pt', 'answer', 'Com quanto tempo de antecedência avisamos que a aula foi cancelada?', 'pt-6'),
  q('pt', 'chat', 'Valeu, ficou ótimo'),
  q('pt', 'chat', 'Oi, tudo bem?'),

  q('it', 'answer', 'Come ordinano i clienti direttamente dal tavolo?', 'it-1'),
  q('it', 'answer', 'Dove sono segnati gli allergeni di ogni piatto?', 'it-2'),
  q('it', 'answer', 'Perché le comande vengono stampate in cucina?', 'it-3'),
  q('it', 'answer', 'Come si divide il conto tra più persone?', 'it-4'),
  q('it', 'answer', 'Per quanto tempo resta bloccato un tavolo prenotato?', 'it-5'),
  q('it', 'answer', 'Il menu è tradotto per i turisti stranieri?', 'it-6'),
  q('it', 'chat', 'Grazie mille, va benissimo'),
  q('it', 'chat', 'Ciao, ci sei?'),
];
