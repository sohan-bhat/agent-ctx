import type { CardBody, Item } from '../src/model.ts';

export const NOW = Date.parse('2026-11-25T10:00:00Z');
const DAY = 86400000;

export type Lang = 'es' | 'de' | 'hi' | 'ar' | 'ja' | 'zh';
export const LANGS: Lang[] = ['es', 'de', 'hi', 'ar', 'ja', 'zh'];

export const KEYS: Record<Lang, string> = {
  es: 'github.com/acme/reservas',
  de: 'github.com/acme/rechnungen',
  hi: 'github.com/acme/fees-hi',
  ar: 'github.com/acme/clinic-ar',
  ja: 'github.com/acme/zaiko',
  zh: 'github.com/acme/rooms-zh',
};

export const PROJECTS = LANGS.map((l) => ({ key: KEYS[l], names: [] as string[] }));

const AGENTS = ['codex', 'claude-code', 'cursor', 'gemini'];
let k = 0;

function c(id: string, lang: Lang, goal: string, what: string, why: string, path: string): Item {
  const at = NOW - (++k % 40) * DAY - k * 3600000;
  const body: CardBody = { goal, decisions: [{ what, why }], changed: [{ path }] };
  return { id, project: KEYS[lang], kind: 'card', body, origin: { agent: AGENTS[k % AGENTS.length], via: 'tool', source: 'agent', at, session: `${id}-s` }, flags: [], held: false, pinned: false, folded: false, created: at };
}

export const ITEMS: Item[] = [
  c('es-1', 'es', 'Pago con tarjeta en la página de reservas', 'usar el formulario alojado del proveedor de pagos', 'así no guardamos números de tarjeta', 'src/pagos/checkout.ts'),
  c('es-2', 'es', 'Recordatorio por correo un día antes de la cita', 'enviar los correos desde una cola', 'el cron gratuito se dormía', 'src/jobs/recordatorios.ts'),
  c('es-3', 'es', 'Inicio de sesión con enlace mágico', 'usar enlaces mágicos en vez de contraseñas', 'los clientes olvidaban la contraseña', 'src/auth/login.ts'),
  c('es-4', 'es', 'Caché de la lista de horarios disponibles', 'guardar la lista sesenta segundos en el borde', 'la página tardaba en cargar los lunes', 'src/routes/horarios.ts'),
  c('es-5', 'es', 'Exportar las reservas del mes a CSV', 'generar el archivo por partes', 'los meses grandes agotaban la memoria', 'src/routes/export.ts'),
  c('es-6', 'es', 'Zona horaria equivocada en las citas', 'guardar todo en UTC y mostrar la hora local', 'el cambio de horario movió las citas una hora', 'src/lib/fechas.ts'),

  c('de-1', 'de', 'Rechnungen als PDF erzeugen', 'die PDF im Hintergrund über eine Warteschlange bauen', 'große Rechnungen blockierten den Server', 'src/rechnung/pdf.ts'),
  c('de-2', 'de', 'Anmeldung mit Zwei-Faktor-Code', 'TOTP-Codes statt SMS verwenden', 'die SMS kam oft zu spät an', 'src/auth/totp.ts'),
  c('de-3', 'de', 'Steuersatz für Kunden im Ausland', 'den Steuersatz aus dem Land der Rechnungsadresse nehmen', 'die Lieferadresse war oft leer', 'src/steuer/satz.ts'),
  c('de-4', 'de', 'Mahnungen automatisch verschicken', 'die erste Mahnung nach vierzehn Tagen senden', 'Kunden beschwerten sich über zu frühe Mahnungen', 'src/jobs/mahnung.ts'),
  c('de-5', 'de', 'Export für den Steuerberater als CSV', 'das Semikolon als Trennzeichen verwenden', 'Excel in Deutschland erwartet Semikolons', 'src/export/berater.ts'),
  c('de-6', 'de', 'Suche nach Kundennummer ist langsam', 'einen Index auf die Kundennummer legen', 'die Tabelle hat inzwischen eine Million Zeilen', 'db/migrations/0042_index.sql'),

  c('hi-1', 'hi', 'फ़ीस भुगतान के लिए यूपीआई जोड़ा', 'भुगतान की पुष्टि वेबहुक से लेना', 'ऐप बंद होने पर पुष्टि छूट जाती थी', 'src/payments/upi.ts'),
  c('hi-2', 'hi', 'अभिभावकों को एसएमएस से सूचना', 'संदेश कतार से भेजना', 'एक साथ हज़ारों संदेश जाने पर सेवा रुक जाती थी', 'src/jobs/sms.ts'),
  c('hi-3', 'hi', 'लॉगिन के लिए ओटीपी', 'ओटीपी पाँच मिनट में खत्म हो', 'पुराने कोड दोबारा इस्तेमाल हो रहे थे', 'src/auth/otp.ts'),
  c('hi-4', 'hi', 'रिपोर्ट कार्ड को पीडीएफ में बदलना', 'पीडीएफ सर्वर पर बनाना', 'सस्ते फ़ोन पर ब्राउज़र बहुत धीमा था', 'src/reports/pdf.ts'),
  c('hi-5', 'hi', 'हाज़िरी का पन्ना धीमा खुलता है', 'कक्षा की सूची को कैश करना', 'सुबह सारे शिक्षक एक साथ पन्ना खोलते हैं', 'src/routes/attendance.ts'),
  c('hi-6', 'hi', 'हिंदी और अंग्रेज़ी में पूरा अनुवाद', 'अनुवाद की फ़ाइलें अलग रखना', 'नए शब्द जोड़ना आसान रहे', 'src/i18n/hi.json'),

  c('ar-1', 'ar', 'حجز المواعيد عبر الإنترنت', 'منع الحجز المزدوج بقفل في قاعدة البيانات', 'مريضان حجزا نفس الموعد', 'src/booking/lock.ts'),
  c('ar-2', 'ar', 'تذكير المرضى برسالة نصية', 'إرسال التذكير قبل الموعد بيوم', 'كثير من المرضى نسوا مواعيدهم', 'src/jobs/reminders.ts'),
  c('ar-3', 'ar', 'دعم الكتابة من اليمين إلى اليسار في الواجهة', 'استخدام خصائص css المنطقية', 'الهوامش كانت معكوسة في الواجهة العربية', 'src/styles/rtl.css'),
  c('ar-4', 'ar', 'تسجيل الدخول برقم الهاتف', 'إرسال رمز تحقق لمرة واحدة', 'كلمات المرور كانت تنسى كثيرا', 'src/auth/phone.ts'),
  c('ar-5', 'ar', 'تقرير شهري للعيادة بصيغة CSV', 'إنشاء الملف على دفعات', 'الشهور الكبيرة كانت تستهلك الذاكرة', 'src/reports/monthly.ts'),
  c('ar-6', 'ar', 'البحث عن مريض بالاسم بطيء', 'إضافة فهرس على عمود الاسم', 'الجدول فيه مئة ألف مريض', 'db/migrations/0007_name_index.sql'),

  c('ja-1', 'ja', '在庫数をリアルタイムで更新', 'WebSocketで在庫の変更を配信する', 'ポーリングではサーバーの負荷が高かった', 'src/stock/live.ts'),
  c('ja-2', 'ja', '注文確認メールの送信', 'メールはキューに入れて送る', 'セール中に送信が詰まった', 'src/jobs/mail.ts'),
  c('ja-3', 'ja', '商品画像のキャッシュ', 'CDNで一年間キャッシュする', '画像の読み込みが遅かった', 'next.config.js'),
  c('ja-4', 'ja', 'ログイン画面の二段階認証', '認証アプリのコードを使う', 'SMSは届かないことがあった', 'src/auth/totp.ts'),
  c('ja-5', 'ja', '売上レポートをCSVで出力', '文字コードはUTF-8にBOMを付ける', 'Excelで開くと文字化けした', 'src/reports/sales.ts'),
  c('ja-6', 'ja', '検索で全角と半角を区別しない', '検索の前に文字をNFKCで正規化する', '全角の型番で検索すると何も出なかった', 'src/search/normalize.ts'),

  c('zh-1', 'zh', '会议室预订冲突检测', '在数据库里用唯一约束防止重复预订', '两个人同时订了同一个会议室', 'src/booking/rooms.ts'),
  c('zh-2', 'zh', '单点登录接入', '使用公司统一的身份认证', '员工不想再多记一个密码', 'src/auth/sso.ts'),
  c('zh-3', 'zh', '会议提醒推送', '提前十五分钟发送提醒', '很多人忘了开会时间', 'src/jobs/remind.ts'),
  c('zh-4', 'zh', '导出月度报表为 Excel', '分批生成文件', '数据太多时内存不够', 'src/reports/export.ts'),
  c('zh-5', 'zh', '页面加载太慢', '把会议室列表缓存六十秒', '早上九点大家同时打开页面', 'src/routes/rooms.tsx'),
  c('zh-6', 'zh', '时区显示错误', '数据库统一存 UTC 时间', '海外同事看到的时间差了几个小时', 'src/lib/time.ts'),
];

export type LangKind = 'answer' | 'mixed' | 'chat';
export interface LangQuery { q: string; project: string; kind: LangKind; lang: Lang; want: string[] }

const q = (lang: Lang, kind: LangKind, text: string, ...want: string[]): LangQuery => ({ q: text, project: KEYS[lang], kind, lang, want });

export const QUERIES: LangQuery[] = [
  q('es', 'answer', '¿Cómo cobramos con tarjeta en las reservas?', 'es-1'),
  q('es', 'answer', '¿Por qué los recordatorios por correo usan una cola?', 'es-2'),
  q('es', 'answer', '¿Cómo funciona el inicio de sesión con enlace mágico?', 'es-3'),
  q('es', 'answer', '¿Cuánto tiempo guardamos en caché los horarios disponibles?', 'es-4'),
  q('es', 'answer', 'Exportar las reservas a un archivo se quedaba sin memoria', 'es-5'),
  q('es', 'answer', 'Las citas salen una hora tarde por la zona horaria', 'es-6'),
  q('es', 'mixed', 'El checkout de pagos, ¿dónde está?', 'es-1'),
  q('es', 'mixed', '¿Qué cambiamos en login.ts para el inicio de sesión?', 'es-3'),
  q('es', 'chat', 'Vale, sigue así', ),
  q('es', 'chat', 'Gracias, perfecto'),

  q('de', 'answer', 'Wie erzeugen wir die PDF-Rechnungen?', 'de-1'),
  q('de', 'answer', 'Warum nutzen wir bei der Anmeldung TOTP statt SMS?', 'de-2'),
  q('de', 'answer', 'Welcher Steuersatz gilt für Kunden im Ausland?', 'de-3'),
  q('de', 'answer', 'Wann geht die erste Mahnung raus?', 'de-4'),
  q('de', 'answer', 'Welches Trennzeichen nimmt der Export für den Steuerberater?', 'de-5'),
  q('de', 'answer', 'Die Suche nach der Kundennummer dauert ewig', 'de-6'),
  q('de', 'mixed', 'Der CSV export für Excel, welches Format?', 'de-5'),
  q('de', 'mixed', 'Wo liegt der Code für totp in auth?', 'de-2'),
  q('de', 'chat', 'Danke, sieht gut aus'),
  q('de', 'chat', 'Passt, mach weiter'),

  q('hi', 'answer', 'यूपीआई से फ़ीस भुगतान कैसे होता है?', 'hi-1'),
  q('hi', 'answer', 'अभिभावकों को एसएमएस कैसे भेजते हैं?', 'hi-2'),
  q('hi', 'answer', 'ओटीपी कितनी देर में खत्म होता है?', 'hi-3'),
  q('hi', 'answer', 'रिपोर्ट कार्ड का पीडीएफ कहाँ बनता है?', 'hi-4'),
  q('hi', 'answer', 'हाज़िरी का पन्ना इतना धीमा क्यों है?', 'hi-5'),
  q('hi', 'answer', 'अनुवाद की फ़ाइलें कहाँ रखी हैं?', 'hi-6'),
  q('hi', 'mixed', 'payments में upi वाला कोड कहाँ है?', 'hi-1'),
  q('hi', 'mixed', 'attendance वाला पन्ना इतना धीमा क्यों?', 'hi-5'),
  q('hi', 'chat', 'ठीक है, आगे बढ़ो'),
  q('hi', 'chat', 'धन्यवाद, बढ़िया'),

  q('ar', 'answer', 'كيف نمنع الحجز المزدوج للمواعيد؟', 'ar-1'),
  q('ar', 'answer', 'متى يتم إرسال التذكير إلى المرضى؟', 'ar-2'),
  q('ar', 'answer', 'لماذا الهوامش معكوسة في الواجهة العربية؟', 'ar-3'),
  q('ar', 'answer', 'كيف يعمل تسجيل الدخول برقم الهاتف؟', 'ar-4'),
  q('ar', 'answer', 'التقرير الشهري بصيغة CSV كان يستهلك الذاكرة', 'ar-5'),
  q('ar', 'answer', 'البحث عن المريض بالاسم بطيء جدا', 'ar-6'),
  q('ar', 'mixed', 'أين كود rtl في ملف css؟', 'ar-3'),
  q('ar', 'mixed', 'ملف monthly report للعيادة', 'ar-5'),
  q('ar', 'chat', 'شكرا، استمر'),
  q('ar', 'chat', 'تمام، يبدو جيدا'),

  q('ja', 'answer', '在庫数はどうやってリアルタイムに更新してる？', 'ja-1'),
  q('ja', 'answer', '注文確認メールが詰まった件はどう直した？', 'ja-2'),
  q('ja', 'answer', '商品画像はどれくらいキャッシュしてる？', 'ja-3'),
  q('ja', 'answer', '二段階認証はどの方式にした？', 'ja-4'),
  q('ja', 'answer', '売上レポートのCSVが文字化けする', 'ja-5'),
  q('ja', 'answer', '全角の型番で検索できない問題', 'ja-6'),
  q('ja', 'mixed', 'websocket で在庫を配信してるところ', 'ja-1'),
  q('ja', 'mixed', 'sales レポートの csv 出力', 'ja-5'),
  q('ja', 'chat', 'ありがとう、続けて'),
  q('ja', 'chat', 'いいね、その調子で'),

  q('zh', 'answer', '怎么防止会议室被重复预订？', 'zh-1'),
  q('zh', 'answer', '单点登录用的是什么认证？', 'zh-2'),
  q('zh', 'answer', '会议提醒提前多久发送？', 'zh-3'),
  q('zh', 'answer', '月度报表导出时内存不够怎么办', 'zh-4'),
  q('zh', 'answer', '会议室列表页面加载太慢了', 'zh-5'),
  q('zh', 'answer', '海外同事看到的时间不对', 'zh-6'),
  q('zh', 'mixed', 'sso 登录的代码在哪里', 'zh-2'),
  q('zh', 'mixed', 'rooms 页面的缓存设置', 'zh-5'),
  q('zh', 'chat', '好的，继续'),
  q('zh', 'chat', '谢谢，看起来不错'),
];

type Five = 'es' | 'de' | 'fr' | 'pt' | 'it';
const FIVE: Five[] = ['es', 'de', 'fr', 'pt', 'it'];

const KEYS2: Record<Five, string> = {
  es: 'github.com/acme/entregas',
  de: 'github.com/acme/stundenplan',
  fr: 'github.com/acme/bibliotheque',
  pt: 'github.com/acme/academia',
  it: 'github.com/acme/trattoria',
};
const NOW2 = Date.parse('2026-11-26T09:00:00Z');
let k2 = 0;

function c2(id: string, lang: Five, goal: string, what: string, why: string, path: string): Item {
  const at = NOW2 - (++k2 % 30) * DAY - k2 * 3600000;
  const body: CardBody = { goal, decisions: [{ what, why }], changed: [{ path }] };
  return { id, project: KEYS2[lang], kind: 'card', body, origin: { agent: AGENTS[k2 % AGENTS.length], via: 'tool', source: 'agent', at, session: `${id}-s` }, flags: [], held: false, pinned: false, folded: false, created: at };
}

const q2 = (lang: Five, kind: 'answer' | 'chat', text: string, ...want: string[]) => ({ q: text, project: KEYS2[lang], kind, lang, want });

export const SECOND = {
  now: NOW2,
  langs: FIVE,
  projects: FIVE.map((l) => ({ key: KEYS2[l], names: [] as string[] })),
  items: [
    c2('es-1', 'es', 'Ruta optimizada para los repartidores', 'calcular el orden de las paradas con el servicio de mapas', 'los conductores daban vueltas por el mismo barrio', 'src/rutas/optimizar.ts'),
    c2('es-2', 'es', 'Foto como prueba de entrega', 'subir la foto comprimida al almacenamiento de objetos', 'los clientes decían que el paquete nunca llegó', 'src/entregas/foto.ts'),
    c2('es-3', 'es', 'Seguimiento del pedido en el mapa', 'enviar la posición del repartidor cada diez segundos', 'los clientes llamaban para preguntar dónde estaba su pedido', 'src/seguimiento/posicion.ts'),
    c2('es-4', 'es', 'Firma del cliente en la pantalla', 'guardar la firma como imagen SVG', 'las firmas en PNG ocupaban demasiado espacio', 'src/entregas/firma.ts'),
    c2('es-5', 'es', 'Modo sin conexión para la aplicación del conductor', 'guardar las entregas pendientes en el teléfono y sincronizar después', 'en las zonas rurales no hay cobertura', 'src/app/offline.ts'),
    c2('es-6', 'es', 'Aviso por WhatsApp cuando el paquete sale del almacén', 'mandar una plantilla aprobada por la API de mensajes', 'muchos clientes no leen el correo', 'src/avisos/whatsapp.ts'),

    c2('de-1', 'de', 'Stundenplan als Kalender abonnieren', 'einen iCal-Feed pro Klasse anbieten', 'Eltern wollten die Stunden im eigenen Kalender sehen', 'src/kalender/ical.ts'),
    c2('de-2', 'de', 'Vertretungsplan am Morgen aktualisieren', 'die Änderungen um sechs Uhr aus der Schulverwaltung holen', 'Lehrer meldeten sich oft erst früh am Morgen krank', 'src/jobs/vertretung.ts'),
    c2('de-3', 'de', 'Raumbelegung ohne Doppelbuchungen', 'eine Sperre pro Raum und Stunde in der Datenbank setzen', 'zwei Klassen standen vor demselben Physikraum', 'src/raeume/belegung.ts'),
    c2('de-4', 'de', 'Push-Nachricht bei Stundenausfall', 'Nachrichten nur an die betroffene Klasse schicken', 'alle Schüler bekamen jede Meldung und stellten sie stumm', 'src/push/ausfall.ts'),
    c2('de-5', 'de', 'Datenschutz für Schülerdaten', 'Namen der Schüler nur verschlüsselt speichern', 'die Schule verlangt eine DSGVO-konforme Lösung', 'src/db/verschluesselung.ts'),
    c2('de-6', 'de', 'Druckansicht für den Aushang', 'eine eigene Druckvorlage mit großer Schrift bauen', 'der Plan am schwarzen Brett war kaum lesbar', 'src/views/druck.tsx'),

    c2('fr-1', 'fr', 'Prolonger un prêt en ligne', "autoriser deux prolongations si personne n'a réservé le livre", 'les lecteurs devaient venir au guichet pour prolonger', 'src/prets/prolonger.ts'),
    c2('fr-2', 'fr', 'Rappel avant la date de retour', "envoyer un courriel trois jours avant l'échéance", 'beaucoup de livres revenaient en retard', 'src/jobs/rappels.ts'),
    c2('fr-3', 'fr', 'Recherche dans le catalogue par auteur', "indexer les noms d'auteurs sans les accents", 'une recherche sans accent ne trouvait pas Hélène ni Émile', 'src/catalogue/recherche.ts'),
    c2('fr-4', 'fr', 'Lecture des codes-barres avec la caméra du téléphone', 'utiliser la lecture intégrée au navigateur', 'les douchettes coûtaient trop cher pour les petites antennes', 'src/scan/camera.ts'),
    c2('fr-5', 'fr', 'Amendes pour les retards', "plafonner l'amende au prix du livre", 'certains lecteurs devaient plus que la valeur du livre', 'src/prets/amendes.ts'),
    c2('fr-6', 'fr', "Réservation d'un livre déjà emprunté", "mettre les lecteurs dans une file d'attente par titre", 'deux personnes recevaient le même avis de disponibilité', 'src/reservations/file.ts'),

    c2('pt-1', 'pt', 'Reserva de vagas nas aulas de spinning', 'limitar cada aula ao número de bicicletas da sala', 'alunos chegavam e não havia bicicleta livre', 'src/aulas/vagas.ts'),
    c2('pt-2', 'pt', 'Pagamento da mensalidade por Pix', 'gerar um QR code novo para cada cobrança', 'o boleto demorava dias para compensar', 'src/pagamentos/pix.ts'),
    c2('pt-3', 'pt', 'Lista de espera quando a aula está cheia', 'chamar o próximo aluno da fila quando alguém cancela', 'as vagas canceladas ficavam vazias', 'src/aulas/espera.ts'),
    c2('pt-4', 'pt', 'Entrada na academia com QR code no celular', 'validar o código na catraca sem internet', 'a conexão da recepção caía nos horários de pico', 'src/acesso/catraca.ts'),
    c2('pt-5', 'pt', 'Ficha de treino do aluno', 'o professor monta a ficha e o aluno vê no aplicativo', 'as fichas de papel se perdiam', 'src/treinos/ficha.ts'),
    c2('pt-6', 'pt', 'Avisos de aula cancelada', 'enviar notificação push até duas horas antes', 'alunos vinham para aulas que não iam acontecer', 'src/avisos/cancelamento.ts'),

    c2('it-1', 'it', 'Ordini dal tavolo con il QR code', 'aprire il menu digitale legato al numero del tavolo', 'i camerieri non riuscivano a prendere tutte le ordinazioni', 'src/ordini/tavolo.ts'),
    c2('it-2', 'it', 'Allergeni indicati su ogni piatto', 'salvare gli allergeni come elenco fisso per ogni piatto', 'un cliente celiaco ha ricevuto un piatto con glutine', 'src/menu/allergeni.ts'),
    c2('it-3', 'it', 'Stampa delle comande in cucina', 'mandare la comanda alla stampante termica della cucina', 'i fogli scritti a mano erano illeggibili', 'src/cucina/stampa.ts'),
    c2('it-4', 'it', 'Divisione del conto tra amici', 'calcolare le quote per persona lato server', 'gli arrotondamenti nel browser davano centesimi sbagliati', 'src/conto/dividi.ts'),
    c2('it-5', 'it', 'Prenotazione dei tavoli per il weekend', 'bloccare il tavolo per due ore da ogni prenotazione', 'il sabato sera avevamo più prenotazioni che tavoli', 'src/prenotazioni/tavoli.ts'),
    c2('it-6', 'it', 'Menu in più lingue per i turisti', 'tenere le traduzioni dei piatti in file separati', 'i turisti non capivano i nomi dei piatti', 'src/i18n/menu.ts'),
  ],
  queries: [
    q2('es', 'answer', '¿Cómo decidimos el orden de las paradas de cada ruta?', 'es-1'),
    q2('es', 'answer', '¿Dónde se guardan las fotos de las entregas?', 'es-2'),
    q2('es', 'answer', '¿Cada cuánto se actualiza la posición del repartidor en el mapa?', 'es-3'),
    q2('es', 'answer', '¿En qué formato guardamos la firma del cliente?', 'es-4'),
    q2('es', 'answer', 'La app del conductor no funciona cuando no hay cobertura', 'es-5'),
    q2('es', 'answer', '¿Por qué avisamos a los clientes por WhatsApp y no por correo?', 'es-6'),
    q2('es', 'chat', 'Muy bien, sigue con eso'),
    q2('es', 'chat', 'Hola, ¿qué tal todo?'),

    q2('de', 'answer', 'Wie können Eltern den Stundenplan in ihren Kalender holen?', 'de-1'),
    q2('de', 'answer', 'Wann wird der Vertretungsplan jeden Morgen aktualisiert?', 'de-2'),
    q2('de', 'answer', 'Was verhindert, dass ein Raum doppelt gebucht wird?', 'de-3'),
    q2('de', 'answer', 'Warum bekommt nur die betroffene Klasse die Push-Nachricht?', 'de-4'),
    q2('de', 'answer', 'Wie speichern wir die Namen der Schüler?', 'de-5'),
    q2('de', 'answer', 'Der Aushang am schwarzen Brett ist schlecht lesbar', 'de-6'),
    q2('de', 'chat', 'Danke, das passt so'),
    q2('de', 'chat', 'Alles klar, mach weiter'),

    q2('fr', 'answer', 'Comment un lecteur peut-il prolonger son prêt depuis le site ?', 'fr-1'),
    q2('fr', 'answer', 'Quand envoie-t-on le rappel avant la date de retour ?', 'fr-2'),
    q2('fr', 'answer', 'Pourquoi la recherche par auteur ignore les accents ?', 'fr-3'),
    q2('fr', 'answer', 'Comment scanner les codes-barres sans douchette ?', 'fr-4'),
    q2('fr', 'answer', "Quel est le montant maximum d'une amende de retard ?", 'fr-5'),
    q2('fr', 'answer', 'Que se passe-t-il quand plusieurs lecteurs réservent le même livre ?', 'fr-6'),
    q2('fr', 'chat', "Merci, c'est parfait"),
    q2('fr', 'chat', 'Bonjour, tu es là ?'),

    q2('pt', 'answer', 'Como limitamos o número de alunos em cada aula de spinning?', 'pt-1'),
    q2('pt', 'answer', 'Por que a mensalidade passou a ser paga por Pix?', 'pt-2'),
    q2('pt', 'answer', 'O que acontece com a vaga quando alguém cancela?', 'pt-3'),
    q2('pt', 'answer', 'A catraca funciona sem internet?', 'pt-4'),
    q2('pt', 'answer', 'Onde o aluno vê a ficha de treino?', 'pt-5'),
    q2('pt', 'answer', 'Com quanto tempo de antecedência avisamos que a aula foi cancelada?', 'pt-6'),
    q2('pt', 'chat', 'Valeu, ficou ótimo'),
    q2('pt', 'chat', 'Oi, tudo bem?'),

    q2('it', 'answer', 'Come ordinano i clienti direttamente dal tavolo?', 'it-1'),
    q2('it', 'answer', 'Dove sono segnati gli allergeni di ogni piatto?', 'it-2'),
    q2('it', 'answer', 'Perché le comande vengono stampate in cucina?', 'it-3'),
    q2('it', 'answer', 'Come si divide il conto tra più persone?', 'it-4'),
    q2('it', 'answer', 'Per quanto tempo resta bloccato un tavolo prenotato?', 'it-5'),
    q2('it', 'answer', 'Il menu è tradotto per i turisti stranieri?', 'it-6'),
    q2('it', 'chat', 'Grazie mille, va benissimo'),
    q2('it', 'chat', 'Ciao, ci sei?'),
  ],
};
const KEYS3: Record<Five, string> = {
  es: 'github.com/acme/riego',
  de: 'github.com/acme/radverleih',
  fr: 'github.com/acme/covoiturage',
  pt: 'github.com/acme/condominio',
  it: 'github.com/acme/museo',
};
const NOW3 = Date.parse('2026-11-26T15:00:00Z');
let k3 = 0;

function c3(id: string, lang: Five, goal: string, what: string, why: string, path: string): Item {
  const at = NOW3 - (++k3 % 30) * DAY - k3 * 3600000;
  const body: CardBody = { goal, decisions: [{ what, why }], changed: [{ path }] };
  return { id, project: KEYS3[lang], kind: 'card', body, origin: { agent: AGENTS[k3 % AGENTS.length], via: 'tool', source: 'agent', at, session: `${id}-s` }, flags: [], held: false, pinned: false, folded: false, created: at };
}

const q3 = (lang: Five, kind: 'answer' | 'chat', text: string, ...want: string[]) => ({ q: text, project: KEYS3[lang], kind, lang, want });

export const THIRD = {
  now: NOW3,
  langs: FIVE,
  projects: FIVE.map((l) => ({ key: KEYS3[l], names: [] as string[] })),
  items: [
    c3('es3-1', 'es', 'Lectura de humedad del suelo cada hora', 'los sensores mandan la lectura por LoRa a la pasarela', 'en el campo no hay wifi ni cobertura móvil', 'src/sensores/humedad.ts'),
    c3('es3-2', 'es', 'Apagar el riego cuando llueve', 'consultar la previsión del tiempo antes de abrir las válvulas', 'se regaba justo antes de una tormenta', 'src/riego/lluvia.ts'),
    c3('es3-3', 'es', 'Alerta por fuga en la tubería', 'avisar si el caudal sigue alto con las válvulas cerradas', 'una fuga vació el depósito durante la noche', 'src/alertas/fuga.ts'),
    c3('es3-4', 'es', 'Gráfica del consumo de agua por parcela', 'sumar los litros por día en la base de datos', 'la gráfica tardaba mucho con datos por minuto', 'src/informes/consumo.ts'),
    c3('es3-5', 'es', 'Batería baja en los sensores', 'enviar un aviso cuando la batería baja del veinte por ciento', 'varios sensores se apagaron sin que nadie lo notara', 'src/sensores/bateria.ts'),
    c3('es3-6', 'es', 'Horario de riego por cultivo', 'guardar un horario distinto para cada tipo de cultivo', 'los tomates y el maíz necesitan cantidades muy diferentes', 'src/riego/horario.ts'),

    c3('de3-1', 'de', 'Fahrrad per App entsperren', 'das Schloss über Bluetooth mit einem Einmalcode öffnen', 'an vielen Stationen gibt es kein stabiles Netz', 'src/schloss/bluetooth.ts'),
    c3('de3-2', 'de', 'Abrechnung nach Minuten', 'die Fahrtzeit auf volle Minuten aufrunden und am Ende abbuchen', 'Kunden beschwerten sich über Pauschalpreise für kurze Fahrten', 'src/preise/minuten.ts'),
    c3('de3-3', 'de', 'Akkustand der E-Bikes anzeigen', 'den Akkustand alle fünf Minuten von der Station abfragen', 'Leute liehen Räder mit leerem Akku aus', 'src/stationen/akku.ts'),
    c3('de3-4', 'de', 'Schadensmeldung mit Foto', 'Fotos vom Schaden direkt an die Werkstatt schicken', 'defekte Räder standen tagelang an der Station', 'src/werkstatt/meldung.ts'),
    c3('de3-5', 'de', 'Karte der freien Räder', 'die Karte nur mit Stationen im sichtbaren Bereich laden', 'die Karte wurde auf alten Handys sehr langsam', 'src/karte/stationen.tsx'),
    c3('de3-6', 'de', 'Kaution bei der ersten Ausleihe', 'eine Kaution auf der Kreditkarte vormerken statt abbuchen', 'viele neue Kunden brachen die Anmeldung ab', 'src/zahlung/kaution.ts'),

    c3('fr3-1', 'fr', 'Partage des frais entre passagers', 'diviser le prix du trajet selon les kilomètres de chaque passager', 'les passagers du début payaient autant que ceux de la fin', 'src/frais/partage.ts'),
    c3('fr3-2', 'fr', 'Notation du conducteur après le trajet', 'demander une note seulement quand le trajet est terminé', 'des notes arrivaient avant même le départ', 'src/avis/note.ts'),
    c3('fr3-3', 'fr', 'Point de rendez-vous sur la carte', 'proposer les arrêts de bus proches comme points de rendez-vous', 'les passagers attendaient au mauvais coin de rue', 'src/carte/rendezvous.ts'),
    c3('fr3-4', 'fr', 'Vérification du permis de conduire', 'comparer la photo du permis avec un selfie', 'de faux comptes proposaient des trajets', 'src/comptes/permis.ts'),
    c3('fr3-5', 'fr', 'Messagerie entre conducteur et passagers', 'masquer les numéros de téléphone dans les messages', 'des passagers recevaient des appels après le trajet', 'src/messages/masque.ts'),
    c3('fr3-6', 'fr', 'Annulation de dernière minute', 'rembourser le passager en entier si le conducteur annule', 'des passagers perdaient leur argent sans faute de leur part', 'src/paiement/annulation.ts'),

    c3('pt3-1', 'pt', 'Aviso de encomenda na portaria', 'o porteiro fotografa a etiqueta e o morador recebe uma notificação', 'encomendas ficavam dias esquecidas na portaria', 'src/portaria/encomendas.ts'),
    c3('pt3-2', 'pt', 'Boleto do condomínio com vencimento', 'gerar o boleto todo dia primeiro com vencimento no dia dez', 'moradores reclamavam que o boleto chegava atrasado', 'src/financeiro/boleto.ts'),
    c3('pt3-3', 'pt', 'Votação online em assembleia', 'permitir um voto por apartamento com confirmação por e-mail', 'poucos moradores iam às assembleias presenciais', 'src/assembleia/votacao.ts'),
    c3('pt3-4', 'pt', 'Liberação de visitantes pelo celular', 'o morador gera um código temporário para o visitante', 'a portaria ligava para o morador a cada visita', 'src/portaria/visitantes.ts'),
    c3('pt3-5', 'pt', 'Leitura dos medidores de gás', 'o zelador digita a leitura no aplicativo uma vez por mês', 'as planilhas de papel tinham muitos erros', 'src/medidores/gas.ts'),
    c3('pt3-6', 'pt', 'Mural de avisos do prédio', 'fixar os avisos importantes no topo do mural', "avisos de manutenção da caixa d'água se perdiam entre outros posts", 'src/mural/avisos.ts'),

    c3('it3-1', 'it', 'Biglietti con orario di ingresso', "vendere i biglietti a fasce di mezz'ora", 'le sale erano troppo affollate la domenica', 'src/biglietti/fasce.ts'),
    c3('it3-2', 'it', 'Audioguida sul telefono', 'scaricare le tracce audio prima della visita', 'nelle sale sotterranee il segnale non arriva', 'src/audioguida/download.ts'),
    c3('it3-3', 'it', 'Accessibilità per visitatori ciechi', 'aggiungere descrizioni audio dettagliate delle opere principali', 'un gruppo di visitatori ciechi aveva chiesto un percorso dedicato', 'src/accessibilita/descrizioni.ts'),
    c3('it3-4', 'it', 'Conteggio dei visitatori nelle sale', 'leggere i sensori alle porte e mostrare il numero in tempo reale', "i custodi non sapevano quando chiudere l'ingresso", 'src/sale/conteggio.ts'),
    c3('it3-5', 'it', 'Mostre temporanee nel catalogo', 'segnare le opere in prestito con una data di fine', 'il catalogo mostrava opere già restituite', 'src/catalogo/mostre.ts'),
    c3('it3-6', 'it', 'Biglietto ridotto per studenti', "chiedere la tessera universitaria solo all'ingresso", 'gli studenti non riuscivano a caricare la tessera online', 'src/biglietti/ridotto.ts'),
  ],
  queries: [
    q3('es', 'answer', '¿Cómo llegan las lecturas de humedad desde el campo?', 'es3-1'),
    q3('es', 'answer', '¿Qué pasa con el riego si va a llover?', 'es3-2'),
    q3('es', 'answer', '¿Cómo detectamos una fuga en la tubería?', 'es3-3'),
    q3('es', 'answer', 'La gráfica de consumo de agua carga muy lento', 'es3-4'),
    q3('es', 'answer', '¿Cuándo avisamos de que la batería de un sensor está baja?', 'es3-5'),
    q3('es', 'answer', '¿Dónde se configura el horario de riego de cada cultivo?', 'es3-6'),
    q3('es', 'chat', 'Perfecto, muchas gracias'),
    q3('es', 'chat', 'Buenas, ¿estás ahí?'),

    q3('de', 'answer', 'Wie wird das Schloss am Fahrrad geöffnet?', 'de3-1'),
    q3('de', 'answer', 'Wird pro Minute oder pauschal abgerechnet?', 'de3-2'),
    q3('de', 'answer', 'Woher kennt die App den Akkustand der E-Bikes?', 'de3-3'),
    q3('de', 'answer', 'Wohin gehen die Fotos von einem Schaden?', 'de3-4'),
    q3('de', 'answer', 'Die Karte mit den freien Rädern lädt auf alten Handys ewig', 'de3-5'),
    q3('de', 'answer', 'Warum wird die Kaution nur vorgemerkt?', 'de3-6'),
    q3('de', 'chat', 'Super, danke dir'),
    q3('de', 'chat', 'Hallo, bist du noch da?'),

    q3('fr', 'answer', 'Comment calcule-t-on la part de chaque passager ?', 'fr3-1'),
    q3('fr', 'answer', 'Quand le passager peut-il noter le conducteur ?', 'fr3-2'),
    q3('fr', 'answer', 'Où se retrouvent le conducteur et les passagers ?', 'fr3-3'),
    q3('fr', 'answer', 'Comment vérifie-t-on le permis de conduire ?', 'fr3-4'),
    q3('fr', 'answer', 'Les numéros de téléphone sont-ils visibles dans la messagerie ?', 'fr3-5'),
    q3('fr', 'answer', 'Que se passe-t-il si le conducteur annule au dernier moment ?', 'fr3-6'),
    q3('fr', 'chat', 'Super, merci beaucoup'),
    q3('fr', 'chat', 'Salut, ça va ?'),

    q3('pt', 'answer', 'Como o morador fica sabendo que chegou uma encomenda?', 'pt3-1'),
    q3('pt', 'answer', 'Qual é o vencimento do boleto do condomínio?', 'pt3-2'),
    q3('pt', 'answer', 'Como funciona a votação online da assembleia?', 'pt3-3'),
    q3('pt', 'answer', 'Como libero a entrada de um visitante?', 'pt3-4'),
    q3('pt', 'answer', 'Quem faz a leitura dos medidores de gás?', 'pt3-5'),
    q3('pt', 'answer', 'Os avisos importantes ficam fixados no mural?', 'pt3-6'),
    q3('pt', 'chat', 'Beleza, obrigado'),
    q3('pt', 'chat', 'Olá, você está aí?'),

    q3('it', 'answer', 'Come funzionano le fasce orarie dei biglietti?', 'it3-1'),
    q3('it', 'answer', "L'audioguida funziona anche senza segnale?", 'it3-2'),
    q3('it', 'answer', 'Cosa abbiamo fatto per i visitatori ciechi?', 'it3-3'),
    q3('it', 'answer', 'Come sappiamo quante persone ci sono in ogni sala?', 'it3-4'),
    q3('it', 'answer', 'Le opere in prestito restano nel catalogo dopo la mostra?', 'it3-5'),
    q3('it', 'answer', 'Dove si controlla la tessera per il biglietto ridotto?', 'it3-6'),
    q3('it', 'chat', 'Perfetto, grazie'),
    q3('it', 'chat', 'Ciao, mi senti?'),
  ],
};

const KEYS4: Record<Five, string> = {
  es: 'github.com/acme/inmobiliaria',
  de: 'github.com/acme/werkstatt',
  fr: 'github.com/acme/covoiturage',
  pt: 'github.com/acme/farmacia',
  it: 'github.com/acme/vigneto',
};
const NOW4 = Date.parse('2026-11-27T09:00:00Z');
let k4 = 0;

function c4(id: string, lang: Five, goal: string, what: string, why: string, path: string): Item {
  const at = NOW4 - (++k4 % 30) * DAY - k4 * 3600000;
  const body: CardBody = { goal, decisions: [{ what, why }], changed: [{ path }] };
  return { id, project: KEYS4[lang], kind: 'card', body, origin: { agent: AGENTS[k4 % AGENTS.length], via: 'tool', source: 'agent', at, session: `${id}-s` }, flags: [], held: false, pinned: false, folded: false, created: at };
}

const q4 = (lang: Five, kind: 'answer' | 'chat', text: string, ...want: string[]) => ({ q: text, project: KEYS4[lang], kind, lang, want });

export const FOURTH = {
  now: NOW4,
  langs: FIVE,
  projects: FIVE.map((l) => ({ key: KEYS4[l], names: [] as string[] })),
  items: [
    c4('es-41', 'es', 'Columna precio_m2 en la tabla anuncios', 'crear la columna sin DEFAULT y rellenarla por lotes de 5000 filas', 'el ALTER TABLE con DEFAULT bloqueaba la tabla anuncios varios minutos en producción', 'db/migrations/20261103_precio_m2.sql'),
    c4('es-42', 'es', 'Índice para filtrar anuncios por barrio', 'crear un índice compuesto sobre barrio y fecha_publicacion en la tabla anuncios con CREATE INDEX CONCURRENTLY', 'EXPLAIN ANALYZE marcaba 4 segundos en el listado por barrio', 'db/migrations/20261110_idx_barrio.sql'),
    c4('es-43', 'es', 'Límite de conexiones a Postgres', 'bajar el pool a 10 conexiones por instancia y poner PgBouncer delante', 'en horas punta la API devolvía el error too many clients already', 'src/db/pool.ts'),
    c4('es-44', 'es', 'Inicio de sesión con Google para los agentes', 'pasar el flujo OAuth a PKCE y guardar el state en una cookie firmada', 'en Safari se perdía el state y el login acababa en invalid_state', 'src/auth/google.ts'),
    c4('es-45', 'es', 'Sesiones que caducaban a mitad del trabajo', 'renovar el JWT con un refresh token cada 15 minutos mientras la pestaña siga abierta', 'los agentes perdían el anuncio que estaban redactando cuando caducaba la sesión', 'src/auth/refresh.ts'),
    c4('es-46', 'es', 'Bloqueo del acceso tras contraseñas incorrectas', 'bloquear 10 minutos después de cinco intentos fallidos, contando por IP y por email', 'hubo un ataque de fuerza bruta contra el formulario de acceso', 'src/auth/intentos.ts'),
    c4('es-47', 'es', 'Imagen de Docker más ligera', 'build multi-stage con node:22-alpine copiando solo dist y las dependencias de producción', 'la imagen pesaba 1,4 GB y el despliegue superaba el tiempo límite', 'Dockerfile'),
    c4('es-48', 'es', 'Arranque seguro tras cada despliegue', 'validar las variables de entorno con zod al arrancar y salir si falta DATABASE_URL', 'un despliegue arrancó sin DATABASE_URL y todas las páginas daban 500', 'src/config/env.ts'),
    c4('es-49', 'es', 'Tests de fechas inestables en GitHub Actions', 'fijar TZ=UTC en el workflow y congelar el reloj con vi.useFakeTimers', 'los tests de fecha de publicación fallaban solo de madrugada', '.github/workflows/ci.yml'),
    c4('es-50', 'es', 'Galería de fotos descuadrada en el móvil', 'fijar aspect-ratio 4/3 en las miniaturas con object-fit cover', 'las fotos verticales sacaban el precio fuera de la tarjeta en pantallas pequeñas', 'src/components/Galeria.tsx'),

    c4('de-41', 'de', 'Teilepreise vom Großhändler zwischenspeichern', 'die Preisliste fünf Minuten in Redis halten und beim nächtlichen Import über das Key-Präfix leeren', 'jede Angebotsseite rief die API des Großhändlers neu auf', 'src/cache/teile.ts'),
    c4('de-42', 'de', 'Kalender zeigt nach dem Umbuchen alte Termine', 'den Cache-Eintrag des Tages nach jeder Umbuchung löschen statt auf die TTL zu warten', 'Kunden kamen zur alten Uhrzeit in die Werkstatt', 'src/termine/umbuchen.ts'),
    c4('de-43', 'de', 'Redis läuft voll', 'maxmemory-policy auf allkeys-lru stellen und Sitzungen mit eigener TTL ablegen', 'Redis meldete OOM command not allowed und der Checkout brach ab', 'infra/redis.conf'),
    c4('de-44', 'de', 'Rechnungen im Hintergrund erstellen', 'das PDF der Rechnung in einer BullMQ-Queue erzeugen statt im Request', 'der Request lief nach 30 Sekunden in einen Timeout', 'src/jobs/rechnung-pdf.ts'),
    c4('de-45', 'de', 'Fehlgeschlagene Jobs erneut versuchen', 'drei Versuche mit exponentiellem Backoff, danach in eine Dead-Letter-Queue', 'SMS an Kunden gingen verloren, wenn der Anbieter kurz ausfiel', 'src/jobs/retry.ts'),
    c4('de-46', 'de', 'Terminerinnerung nur einmal senden', 'die jobId aus Termin-ID und Datum bilden, damit BullMQ Duplikate verwirft', 'nach einem Neustart des Workers bekamen Kunden die SMS zweimal', 'src/jobs/erinnerung.ts'),
    c4('de-47', 'de', 'Strukturierte Logs mit pino', 'console.log durch pino ersetzen und jede Zeile als JSON mit requestId schreiben', 'in Grafana Loki ließ sich ein Fehler keinem Auftrag zuordnen', 'src/log/logger.ts'),
    c4('de-48', 'de', 'Kennzeichen und Telefonnummern aus den Logs fernhalten', 'beide Felder über die redact-Option von pino maskieren', 'bei einer Prüfung standen Kennzeichen im Klartext in den Logs', 'src/log/redact.ts'),
    c4('de-49', 'de', 'Weniger Logs in Produktion', 'LOG_LEVEL über eine Umgebungsvariable steuern und in Produktion auf warn setzen', 'die Debug-Ausgaben kosteten über 200 Euro Speicher im Monat', 'src/config/log-level.ts'),
    c4('de-50', 'de', 'Flaky Playwright-Test der Terminbuchung', 'auf die Antwort von /api/slots warten statt auf ein festes waitForTimeout', 'der Test schlug in der CI etwa jedes fünfte Mal fehl', 'e2e/buchung.spec.ts'),

    c4('fr-41', 'fr', 'Alléger le bundle principal', 'découper les routes avec import() dynamique et mettre maplibre-gl dans un chunk séparé', "le bundle dépassait 2 Mo et l'accueil mettait 6 secondes à s'afficher sur mobile", 'vite.config.ts'),
    c4('fr-42', 'fr', "Clés d'API exposées côté client", 'ne garder dans le build que les variables préfixées VITE_ et sortir la clé secrète Stripe du front', 'la clé secrète apparaissait dans le JavaScript envoyé au navigateur', '.env.production'),
    c4('fr-43', 'fr', 'Source maps envoyées à Sentry', 'générer les source maps en mode hidden et les téléverser pendant le build', 'les erreurs dans Sentry pointaient vers du code minifié illisible', 'scripts/upload-sourcemaps.mjs'),
    c4('fr-44', 'fr', "Passage à la nouvelle version de l'API Stripe", 'épingler la version 2026-09-30 dans le client et adapter les champs de PaymentIntent', 'le webhook recevait des objets sans le champ charges', 'src/paiement/stripe.ts'),
    c4('fr-45', 'fr', 'Webhooks Stripe reçus en double', "enregistrer l'id de chaque événement et ignorer ceux déjà traités", 'certains conducteurs étaient payés deux fois pour le même trajet', 'src/paiement/webhook.ts'),
    c4('fr-46', 'fr', 'Remboursement quand le conducteur annule', 'déclencher un refund Stripe automatique et prévenir le passager par e-mail', 'les passagers devaient écrire au support pour être remboursés', 'src/paiement/remboursement.ts'),
    c4('fr-47', 'fr', 'Recherche des trajets proches du passager', 'utiliser ST_DWithin avec un index GiST sur le point de départ', 'la liste des trajets proches calculait la distance pour toute la table', 'db/migrations/0042_gist_depart.sql'),
    c4('fr-48', 'fr', 'Pagination de la liste des trajets', 'remplacer OFFSET par une pagination par curseur sur date_depart et id', 'au-delà de la page 50 chaque page prenait plus de 3 secondes', 'src/trajets/liste.ts'),
    c4('fr-49', 'fr', 'Requête N+1 sur les avis des conducteurs', "charger tous les avis en une seule requête avec IN au lieu d'une requête par conducteur", "le profil d'un conducteur déclenchait 120 requêtes SQL", 'src/conducteurs/avis.ts'),
    c4('fr-50', 'fr', 'Mise à jour de date-fns en v4', 'passer aux imports nommés et donner le fuseau Europe/Paris explicitement', "après npm update les heures de départ s'affichaient avec une heure de décalage", 'src/utils/dates.ts'),

    c4('pt-41', 'pt', 'Baixa de estoque fora do caixa', 'publicar um evento no RabbitMQ a cada venda e atualizar o estoque num consumidor', 'o caixa travava esperando o sistema de estoque responder', 'src/estoque/consumidor.ts'),
    c4('pt-42', 'pt', 'Mensagens presas na fila do RabbitMQ', 'prefetch de 20 e ack manual só depois de gravar no banco', 'quando o consumidor caía as mensagens ficavam sem ack até reiniciar o broker', 'src/fila/config.ts'),
    c4('pt-43', 'pt', 'Ordem das mensagens de reposição', 'uma fila por loja com um único consumidor', 'a reposição chegava antes da venda e o estoque ficava negativo', 'src/fila/lojas.ts'),
    c4('pt-44', 'pt', 'Atualização do Node 18 para o 22', 'trocar node-sass por sass e gerar o package-lock.json de novo', 'o build quebrava no node-gyp com o Node 22', 'package.json'),
    c4('pt-45', 'pt', 'Alerta de vulnerabilidade no axios', 'subir o axios para 1.8 e rodar npm audit no CI', 'o Dependabot abriu um alerta crítico de SSRF', 'package-lock.json'),
    c4('pt-46', 'pt', 'Menos PRs de atualização', 'configurar o Renovate para agrupar as dependências de dev num PR por semana', 'chegavam 30 PRs por semana e ninguém revisava', 'renovate.json'),
    c4('pt-47', 'pt', 'Login por código SMS para os balconistas', 'gerar um código de 6 dígitos que vale 5 minutos', 'as senhas ficavam anotadas e eram compartilhadas no balcão', 'src/auth/sms.ts'),
    c4('pt-48', 'pt', 'Erro 401 depois do deploy', 'aceitar a chave antiga do JWT por 24 horas junto com a nova', 'na troca da chave todos os usuários foram deslogados', 'src/auth/chaves.ts'),
    c4('pt-49', 'pt', 'Permissões de gerente e balconista', 'checar o papel do usuário num middleware antes das rotas de /admin', 'um balconista conseguiu abrir o relatório de faturamento', 'src/auth/papeis.ts'),
    c4('pt-50', 'pt', 'Tabela de estoque estourando no tablet', 'trocar a tabela por uma lista abaixo de 768px com nome, quantidade e validade', 'no tablet do balcão a coluna de validade sumia da tela', 'src/components/TabelaEstoque.tsx'),

    c4('it-41', 'it', 'Deploy bloccato su Kubernetes', 'aggiungere una readinessProbe su /healthz con 20 secondi di attesa iniziale', 'i pod venivano uccisi prima di finire le migrazioni e il rollout restava in CrashLoopBackOff', 'k8s/deployment.yaml'),
    c4('it-42', 'it', 'Rollback automatico del deploy', 'lanciare kubectl rollout undo quando lo smoke test fallisce nella pipeline', "un deploy rotto è rimasto in produzione per un'ora di notte", '.github/workflows/deploy.yml'),
    c4('it-43', 'it', 'Cache della build nella pipeline', "salvare la cache di pnpm e dei layer Docker tra un job e l'altro", 'ogni deploy durava 18 minuti', '.github/workflows/build.yml'),
    c4('it-44', 'it', 'Ricerca dei vini per annata', 'aggiungere un indice su annata e denominazione nella tabella vini', 'lo slow query log mostrava scansioni complete da 2 secondi', 'db/migrations/2026_10_indice_annata.sql'),
    c4('it-45', 'it', 'Conteggi dei filtri del catalogo', 'precalcolare ogni notte i conteggi per regione invece di un COUNT a ogni richiesta', 'la pagina del catalogo andava in timeout il venerdì sera', 'src/catalogo/conteggi.ts'),
    c4('it-46', 'it', 'Deadlock sugli ordini durante le promozioni', 'aggiornare le righe di magazzino sempre in ordine di id dentro la transazione', 'MySQL rispondeva Deadlock found when trying to get lock', 'src/ordini/magazzino.ts'),
    c4('it-47', 'it', 'Carrello che copre il pulsante di pagamento su iPhone', 'usare env(safe-area-inset-bottom) nel footer fisso del carrello', 'su iPhone la barra di Safari nascondeva il pulsante Paga', 'src/components/CarrelloFooter.tsx'),
    c4('it-48', 'it', 'Foto delle etichette sgranate', 'servire le immagini in AVIF con srcset a tre larghezze', 'sugli schermi retina le etichette sembravano sfocate', 'src/components/FotoBottiglia.tsx'),
    c4('it-49', 'it', 'Barra laterale che salta al caricamento', 'riservare lo spazio della barra con una griglia CSS prima che arrivino i dati', 'il layout shift faceva cliccare la categoria sbagliata', 'src/layout/Sidebar.tsx'),
    c4('it-50', 'it', 'Log degli errori di pagamento', 'mandare a Sentry gli errori di Nexi con il codice esito ma senza il numero della carta', 'il supporto non capiva perché i pagamenti venivano rifiutati', 'src/pagamenti/log.ts'),
  ],
  queries: [
    q4('es', 'answer', 'qué cambios hicimos en la tabla anuncios últimamente?', 'es-41', 'es-42'),
    q4('es', 'answer', 'otra vez too many clients en postgres, que tocamos', 'es-43'),
    q4('es', 'answer', 'revisa por qué el login con Google peta en Safari', 'es-44'),
    q4('es', 'answer', 'por que caducan las sesiones tan rapido?', 'es-45'),
    q4('es', 'answer', 'por qué tarda tanto el deploy? la imagen docker es enorme', 'es-47'),
    q4('es', 'answer', 'arregla el test que falla de noche en GitHub Actions', 'es-49'),
    q4('es', 'chat', 'genial, gracias por echarme una mano'),
    q4('es', 'chat', 'puedes traducir los textos de la web al catalan?'),

    q4('de', 'answer', 'wie lange cachen wir die preisliste in redis?', 'de-41'),
    q4('de', 'answer', 'schau mal, warum umgebuchte termine im kalender falsch stehen', 'de-42'),
    q4('de', 'answer', 'OOM command not allowed beim checkout, was machen wir', 'de-43'),
    q4('de', 'answer', 'warum kommen SMS bei kunden doppelt oder gar nicht an', 'de-45', 'de-46'),
    q4('de', 'answer', 'wo wird eigentlich das pdf fur rechnungen gebaut', 'de-44'),
    q4('de', 'answer', 'wie finde ich in loki alle logs zu einem auftrag', 'de-47'),
    q4('de', 'chat', 'super, vielen dank dafür'),
    q4('de', 'chat', 'kannst du mir einen regex für postleitzahlen schreiben'),

    q4('fr', 'answer', "le bundle est trop gros, on l'a découpé comment ?", 'fr-41'),
    q4('fr', 'answer', 'les stack traces dans sentry sont illisibles, tu regardes ?', 'fr-43'),
    q4('fr', 'answer', "j'ai plus le champ charges dans PaymentIntent, c'est normal ?", 'fr-44'),
    q4('fr', 'answer', 'pourquoi des conducteurs ont ete payes deux fois ?', 'fr-45'),
    q4('fr', 'answer', "la liste des trajets rame, qu'est-ce qu'on a deja optimise ?", 'fr-47', 'fr-48'),
    q4('fr', 'answer', 'regarde pourquoi le profil conducteur envoie des centaines de requêtes', 'fr-49'),
    q4('fr', 'chat', 'top, merci beaucoup pour ca'),
    q4('fr', 'chat', "tu peux m'expliquer comment marche un rebase interactif ?"),

    q4('pt', 'answer', 'por que o caixa nao espera mais pelo estoque?', 'pt-41'),
    q4('pt', 'answer', 'olha o prefetch do consumidor, tá travando a fila', 'pt-42'),
    q4('pt', 'answer', 'estoque ficando negativo de novo, qual a causa?', 'pt-43'),
    q4('pt', 'answer', 'por que tiramos o node-sass do projeto?', 'pt-44'),
    q4('pt', 'answer', 'quem cuida das atualizacoes de dependencias, dependabot ou renovate?', 'pt-45', 'pt-46'),
    q4('pt', 'answer', 'deu 401 pra todo mundo depois do deploy, sabe por que?', 'pt-48'),
    q4('pt', 'chat', 'show de bola, brigado'),
    q4('pt', 'chat', 'consegue gerar um dockerfile pra esse projeto?'),

    q4('it', 'answer', 'perche i pod vanno in CrashLoopBackOff al deploy?', 'it-41'),
    q4('it', 'answer', "c'e un modo per annullare da solo un deploy rotto?", 'it-42'),
    q4('it', 'answer', 'la pipeline ci mette una vita, come la velocizziamo?', 'it-43'),
    q4('it', 'answer', 'perche il catalogo dei vini e cosi lento?', 'it-44', 'it-45'),
    q4('it', 'answer', 'guarda il deadlock di MySQL durante le promo', 'it-46'),
    q4('it', 'answer', "sull'iphone non riesco a premere paga, sistemalo", 'it-47'),
    q4('it', 'chat', "ottimo lavoro, grazie dell'aiuto"),
    q4('it', 'chat', "mi scrivi un'email di benvenuto per i nuovi clienti?"),
  ],
};
