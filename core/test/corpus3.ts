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
  prompt(G, 'the station came back after the power dipped this morning and sent garbage numbers that looked totally legit. i thought we put a checksum on the value we keep around between wakeups, where is that', 'g08'),
  prompt(G, 'when i restart one of the stations the dashbaord keeps showing old numbers for about a minute before it catches up. did we deal with this already somewhere in the api layer', 'g24', 'g23'),
  prompt(G, 'the wind graph flashes white every time fresh data lands, super distractng on the clubhouse tv. pretty sure we fought this exact thing before, what did we end up doing and what didnt help', 'g16'),
  prompt(G, 'members keep passing around the one shared dashboard password in the group chat. i want everyone to get their own way in with no typing, what did we settle on before and what got ruled out', 'g20'),
  prompt(G, 'about to ship new firmware to the roof units remotely. remind me how the wireless flashing works and what happens if the new image is broken, i really dont want to climb up there', 'g29'),
  prompt(G, 'humidity on the hill unit keeps creeping higher month after month, it says 97 right now and its clearly dry out. have we corrected for this kind of sensor aging before', 'g39'),
  prompt(G, 'units on the north side keep dying overnight now that its december and cloudy all week. what did we switch off to stretch the battery when the cells run low', 'g38'),
  prompt(P, 'when i bump servings to triple, the flour line shows a long ugly decimal rather than a clean one cup. how are we storing the quantities again, i thought this was solved', 'p02'),
  prompt(P, 'the search json keeps getting huger and phones on slow data wait forever before the box works at all. did we already chop it up into smaller pieces somehow', 'p08'),
  prompt(P, 'i swapped the picture on the banana bread recipe but the site still serves the old one, even in a private window. what was our trick to bust that', 'p11'),
  prompt(P, 'a reader said their login email never arrived and then found it sitting in junk. didnt we set up some dns records for sending already, check what we did there', 'p14'),
  prompt(P, 'calories dont budge when i double the servings, its still showing the numbers for the original batch. thought we fixed that, check how it works now', 'p23'),
  prompt(P, 'can the weekly plan dump everything into the grocery list all at once? im tired of retyping it all by hand, or did we build that already', 'p26'),
  prompt(P, 'ci deploy died again while it was crunching the huge photos, out of memroy i think. what limit did we bump last time this happened', 'p32'),
  prompt(P, 'someone pasted a food blog link and wants the recipe pulled into the site. how do we grab the ingredients from those pages, reading the plain page text was a mess with all the ads', 'p38'),
  prompt(K, 'perft count is wrong on kiwipete after my refactor. i remember a bug where capturing a rook on its home square left the castling flag alone, where did we handle that', 'k03'),
  prompt(K, 'engine keeps tossing totally won king and pawn endgames, feels like the pruning that passes a turn is wrong there. did we ever turn that off for pawn only positions', 'k08'),
  prompt(K, 'when the clock is nearly out the engine sometimes keeps thinking way past its budget and flags. how often do we even check the time inside the search loop', 'k10', 'k40'),
  prompt(K, 'folks online keep beating the bot with the same prepared trap, it plays the identical line out of book every single game. what did we do to mix that up', 'k22'),
  prompt(K, 'fresh build on the vps crashes instantly with illegal instruction but runs fine on my laptop. i think we hit this before with cpu flags, what was the fix', 'k28'),
  prompt(K, 'someone typed a giant number into the threads field on the web page and the whole box fell over. do we cap that value anywhere or not', 'k33'),
  prompt(K, 'want to retune the eval weights with a fresh batch of postions. how did we do the tuning last time and how many positions went into it', 'k16'),
  prompt(R, 'two kids both grabbed the final seat in robotics club at the exact same moment. i thought we guarded against overbooking, how does the full check actually work', 'r01'),
  prompt(R, 'kids using the district laptops get kicked out to the login screen again right after they choose their google account, round and round forever. have we seen this', 'r08'),
  prompt(R, 'first day of semester is next week and last time the app fell over during the morning rush. what did we do about that so it doesnt repeat', 'r15'),
  prompt(R, 'i want a safe copy of the app to try risky changes on without spamming every famly, did we already set one up somewhere', 'r16'),
  prompt(R, 'a regular member just renamed our club, they should not be able to do that. i thought only leaders could change that stuff, how is it checked', 'r18'),
  prompt(R, 'kids are sharing pics of their buddys check in code so they get marked present without showing up. how is the code protected right now', 'r20'),
  prompt(R, 'a leader deleted just one tuesday meeting and the whole semester of meetings vanished. wasnt that fixed at some point, how does it work now', 'r29'),
  prompt(R, 'the same student shows up twice under slightly different names and i need to combine the accounts. is there an admin tool for that already', 'r33'),

  short(G, 'rain bucket double counting', 'g04'),
  short(G, 'what runs the receiver?', 'g13'),
  short(G, 'vane in calm air', 'g40', 'gh1'),
  short(P, 'keep phone awake while cooking', 'p37'),
  short(P, 'timer silent on locked iphone', 'p40', 'ph1'),
  short(P, 'search without a server?', 'p06'),
  short(K, 'which perft positions?', 'k02'),
  short(K, 'reset hash after each game', 'k14'),
  short(K, 'search on several cores', 'k37'),
  short(R, 'times off one hour', 'r27'),
  short(R, 'old term events', 'r39'),
  short(R, 'show my waitlist spot', 'r40', 'rh1'),

  other(G, 'why not the slowest radio data rate', 'g10'),
  other(G, 'download a full year of measurements as a spreadsheet', 'g36'),
  other(G, 'cup sensor misses ticks in a storm', 'g02'),
  other(P, 'passwordless entry for saving favourites', 'p13'),
  other(P, 'sort groceries by store section', 'p20'),
  other(K, 'sorting candidate moves before searching them', 'k06'),
  other(K, 'draw when a position comes up three times', 'k18'),
  other(K, 'letting the engine play strangers on the internet', 'k26'),
  other(R, 'scanning attendance with no reception', 'r21'),
  other(R, 'silence alerts from one group', 'r37'),

  none(G, 'go on'),
  none(G, 'ok cool thanks, looks good'),
  none(G, 'lol nice one'),
  none(P, 'try again'),
  none(P, 'yes do it'),
  none(K, 'push that'),
  none(K, 'hmm that didnt work, undo it'),
  none(K, 'can you explain that again but simpler'),
  none(R, 'what next'),
  none(R, 'keep going until its done'),
  none(G, 'wire a uv index sensor into the outdoor unit, which header pins are still free'),
  none(G, 'translate the dashboard into spanish and add a language picker in the header'),
  none(P, 'add a sitemap and open graph tags so recipes look good when shared on social'),
  none(P, 'add a tip jar page with stripe checkout so readers can support the site'),
  none(P, 'make a seasonal banner on the home page that features pumpkin dishes in october'),
  none(K, 'add pondering so the engine keeps thinking on the opponents clock'),
  none(K, 'write a changelog and tag release 0.4 on github with the binaries attached'),
  none(R, 'add a budget tracker for club spending with receipt uploads'),
  none(R, 'set up sentry error tracking for the server and the frontend'),
  none(R, 'let students vote for club officers in the app, one ballot each'),

  cross(G, 'on the recipe site how did we remember each readers choice of grams versus cups between visits', 'p05'),
  cross(G, 'on the chess engine how did we make the search tests stop failing randomly on the weak ci box', 'k25'),
  cross(P, 'the chess engine bot keeps dying at night, how did we keep it alive on the rented server', 'k27'),
  cross(P, 'in the sign up app how did we get reminder mails out before each event, the cheap hosting kept dozing off', 'r24'),
  cross(K, 'for the weather station we built some rig that fakes the wind sensor input during tests, how did that work', 'g26'),
  cross(K, 'in the club app how did we throttle people hammering the event registration endpoint, want the same for our bot api', 'r38'),
  cross(R, 'the check in tablet at the gym keeps logging out, how did we keep the wall tv signed in for weeks on the weather station', 'g21'),
  cross(R, 'the recipe site has a print view that hides some stuff, how was that done? leaders want printable rosters', 'p24'),
];
