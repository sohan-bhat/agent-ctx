import { GALE, KNIGHT, PANTRY, ROLL } from './corpus.ts';
import type { Kind2, Query2 } from './corpus2.ts';

export { ITEMS, NOW, PROJECTS } from './corpus2.ts';

const q = (kind: Kind2) => (project: string, text: string, ...want: string[]): Query2 => ({ q: text, project, kind, want });
const prompt = q('prompt');
const short = q('short');
const other = q('other');
const none = q('none');
const cross = q('cross');

const G = GALE;
const P = PANTRY;
const K = KNIGHT;
const R = ROLL;

export const QUERIES: Query2[] = [
  prompt(G, 'the gust graph keeps blinking white for a split second every time new data lands, pretty sure we wipe the whole canvas before painting it again, didnt we sort this out before', 'g16'),
  prompt(G, 'power dipped hard last night and after it came back the station sent junk for its last value, how did we decide to keep a known good reading safe through a power drop', 'g08'),
  prompt(G, 'the north ridge station keeps going dead by february, cell is flat after a week of grey skies. what did we switch off to save juice when the batery gets low', 'g38'),
  prompt(G, 'the big tv in the clubhouse is showing the password prompt again every single morning, i thought we made that wall screen stay logged in for weeks at a time', 'g21'),
  prompt(G, 'can we ship new firmware to the stations remotely so i dont have to climb the ladder every time, i think we set something up already, what happens if a build is broken', 'g29'),
  prompt(G, 'the heading jumps around near north when the vane voltage wanders on cold mornings, how are we mapping the adc value to a direction, wasnt there some kind of lookup', 'g03'),
  prompt(G, 'when i save the form for a station, fields i never touched come back blank, feels like an old bug, how did we solve it last time', 'g33'),
  prompt(G, 'two stations seem to talk over each other and the base just loses one of the packets, what did we do about resending, fixed delay or random', 'g12'),

  prompt(P, 'when i triple the pancake recipe it says to use 4.5 eggs which is silly, did we already decide how stuff you count like eggs gets rounded', 'p04'),
  prompt(P, 'folks keep saying the link we email them never arrives and then they find it sitting in their junk folder, what did we change on the sending side for that', 'p14'),
  prompt(P, 'if i double the servings the calories and protein still show the old numbers, i swear we fixed this already, where does that get calculated', 'p23'),
  prompt(P, 'my phone keeps going dark while im kneading dough and i have to unlock it with floury hands, didnt we add something to stop teh screen from sleeping', 'p37'),
  prompt(P, 'lighthouse says the search json is massive on phones and the page takes ages to get interactive, what was the plan for making it smaller', 'p08'),
  prompt(P, 'the deploy job crashed again while it was resizing the huge photos, looks like it hit a memory ceiling, what did we raise last time', 'p32'),
  prompt(P, 'can i dump every dish i planned for the week straight into the grocery list, or do people still have to copy each one across manually', 'p26'),
  prompt(P, 'someone pasted a link from a food blog and the import grabbed all the ad junk rather than the actual recipe, how is the importer meant to read those pages', 'p38'),

  prompt(K, 'we threw away a totally won pawn ending last night because the search assumed passing a turn was fine, did we turn off that trick when only pawns are left', 'k08'),
  prompt(K, 'the release binary dies with illegal instruction on the cheap server but runs fine on my laptop, did we already deal with this when building', 'k28'),
  prompt(K, 'people online keep crushing us with the exact same prep because we always open with identical moves, is there any variety in how we choose a line from the book', 'k22'),
  prompt(K, 'perft numbers dont match at four ply on that tricky test position, smells like castling after the rook gets taken in its corner, how did we handle that before', 'k03'),
  prompt(K, 'in blitz the search runs way past its budget and we flag, how often are we even looking at the clock while its searching', 'k10'),
  prompt(K, 'id like to use all four cores when analysing, did we already build some parallel search and how do the threads share what they find', 'k37'),
  prompt(K, 'the engine keeps shuffling back and forth in a winning position and doesnt notice its about to repeat a third time, how are we tracking earlier positons', 'k18'),

  prompt(R, 'kids are sending each other pics of their entry code so mates get marked present without showing up, what stops a copied code from working', 'r20'),
  prompt(R, 'a leader tried to remove just next tuesdays meeting and the whole weekly thing vanished, how are one off skips stored for repeating events', 'r29', 'r28'),
  prompt(R, 'first monday of the semester the app fell over around nine when everyone piled on at once, did we plan anything for that rush this time', 'r15', 'r09'),
  prompt(R, 'students on the managed laptops keep getting bounced to the google page over and over when signing in, i think a cookie goes missing, what was the fix', 'r08'),
  prompt(R, 'a regular member just renamed our club and changed the room, how is that even possible, i thought only leaders could touch that stuff', 'r18'),
  prompt(R, 'after the clocks went forward in march every meeting shows up an hour late, how are we storing event times in the db', 'r27', 'rr1'),
  prompt(R, 'somebody wrote a script and grabbed all the seats for the trip within a second, is there any throttle on joining events per person', 'r38'),

  short(G, 'anemometer pulse counting', 'g02'),
  short(G, 'how the dashboard gets deployed', 'g28', 'g30'),
  short(G, 'vane heading when calm', 'g40', 'gh1'),
  short(P, 'why fractions not decimals', 'p02', 'pr1'),
  short(P, 'how does dark mode work', 'p36', 'p33'),
  short(P, 'timer alarm locked iphone', 'p40', 'ph1'),
  short(K, 'hash table size setting', 'k12'),
  short(K, 'polyglot opening book', 'k21', 'k22'),
  short(K, 'contempt option default', 'k34'),
  short(R, 'waitlist auto promotion', 'r02', 'r03'),
  short(R, 'offline check in', 'r21'),
  short(R, 'show waitlist position', 'r40', 'rh1'),

  other(G, 'did members stop using one common secret and move to fingerprint unlock for the web panel', 'g20'),
  other(G, 'the station time slips a few minutes on frosty nights, how do we correct the timestamps', 'g09'),
  other(P, 'how do readers authenticate to keep bookmarked dishes', 'p13', 'p16'),
  other(P, 'how long do browsers hold on to dish pictures', 'p10', 'p11'),
  other(K, 'how did we fit the evaluation weights automatically', 'k16'),
  other(K, 'where do we keep the key the play server gives our bot account', 'k26', 'k29'),
  other(K, 'lookup of solved positions with few pieces left', 'k38'),
  other(R, 'how do moms and dads get into the app without a student account', 'r07'),
  other(R, 'guardian permission for younger kids', 'r25', 'r26'),
  other(R, 'shrinking big pictures leaders put up', 'r34'),

  none(G, 'go on'),
  none(G, 'push that'),
  none(P, 'try again'),
  none(P, 'thanks, that worked'),
  none(P, 'what next'),
  none(K, 'ok do it'),
  none(K, 'keep going with the rest'),
  none(R, 'looks good, commit it'),
  none(R, 'hmm no, undo that'),
  none(R, 'run it again'),
  none(G, 'add a translation layer so the dashboard can show german and spanish labels, start with the menu and the chart titles'),
  none(G, 'set up eslint and prettier for the dashboard code and fix whatever lint errors show up'),
  none(G, 'add a dark theme to the dashboard, a switch in the top bar would be nice'),
  none(P, 'add an rss feed so people can follow new recipes in their reader app'),
  none(P, 'add error tracking so we find out about crashes on the live site before readers email us'),
  none(K, 'can we support fischer random games where the back rank starts shuffled'),
  none(K, 'write a small bench command that prints nodes per second over a fixed list of positions'),
  none(K, 'add a pgn export button to the web gui so i can save analysed games'),
  none(R, 'translate the app into french for the exchange students, start with the sign up form'),
  none(R, 'add a page where leaders can upload a budget spreadsheet and track club spending'),

  cross(P, 'in the weather station what spreading factor did we settle on for the long range radio', 'g10'),
  cross(K, 'over in the weather station, once a station restarts the dashboard shows old numbers for a while, how was that handled', 'g24'),
  cross(R, 'on the recipe site how do we combine one ingredient when two dishes both need it', 'p19'),
  cross(G, 'in pantry notes where do we remember whether someone prefers metric units or american ones', 'p05'),
  cross(P, 'how does the chess engine order moves, killers first or captures first', 'k06'),
  cross(R, 'in knightmare how do we keep the bot alive if it crashes at night', 'k27'),
  cross(G, 'how does the club app send the heads up email the day before an event', 'r24'),
  cross(K, 'in the sign up app what happens when a student made two accounts', 'r33'),
];
