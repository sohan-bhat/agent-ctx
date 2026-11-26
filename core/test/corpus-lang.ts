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
