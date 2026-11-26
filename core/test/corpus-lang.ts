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

type Lang3 = 'es' | 'de' | 'fr' | 'pt' | 'it';
const LANGS3: Lang3[] = ['es', 'de', 'fr', 'pt', 'it'];
const KEYS3: Record<Lang3, string> = {
  es: 'github.com/acme/riego',
  de: 'github.com/acme/radverleih',
  fr: 'github.com/acme/covoiturage',
  pt: 'github.com/acme/condominio',
  it: 'github.com/acme/museo',
};
const NOW3 = Date.parse('2026-11-26T15:00:00Z');
let k3 = 0;

function c3(id: string, lang: Lang3, goal: string, what: string, why: string, path: string): Item {
  const at = NOW3 - (++k3 % 30) * DAY - k3 * 3600000;
  const body: CardBody = { goal, decisions: [{ what, why }], changed: [{ path }] };
  return { id, project: KEYS3[lang], kind: 'card', body, origin: { agent: AGENTS[k3 % AGENTS.length], via: 'tool', source: 'agent', at, session: `${id}-s` }, flags: [], held: false, pinned: false, folded: false, created: at };
}

const q3 = (lang: Lang3, kind: 'answer' | 'chat', text: string, ...want: string[]) => ({ q: text, project: KEYS3[lang], kind, lang, want });

export const THIRD = {
  now: NOW3,
  langs: LANGS3,
  projects: LANGS3.map((l) => ({ key: KEYS3[l], names: [] as string[] })),
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
