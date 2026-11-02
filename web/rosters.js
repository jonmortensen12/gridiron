/* Gridiron - who is on the field. Expected starters for BYU at Utah,
   2026-11-07, by the slot each one fills in sim.js.

   Researched 2026-11-02:
   - Utah: Ourlads depth chart updated 2026-10-31 (offence and the 4-2-5
     defence, numbers included); Jackson Bennee #23 (nickel) from his
     player pages.
   - BYU: TWO-DEEP's depth chart and numbers, cross-checked with KSL's
     game-7 (UCF) chart and the official week-1 chart. Running back is
     unsettled (Rex was RB1 for Notre Dame; Moa on TWO-DEEP): Rex here.
     Defensive line rotates a lot: Clegg, Tanuvasa, Purcell, Schoonover.
   A late injury or a new depth chart on game week: change it here.

   Slots: QB; X (wide left), Z (wide right), Y (slot), T (tight end),
   R (back); OL0..OL4 = LT LG C RG RT. Defence: DL0..DL3 left to right as
   the offence sees them; CB1 (offence's left), CB2, NB, LB1, LB2, S1, S2.
   K the kicker. */
(function(root){
'use strict';
var ROSTERS = {
  byu: {
    QB: [47, 'Bear', 'Bachmeier'],
    R:  [12, 'Preston', 'Rex'],
    X:  [3, 'Kyler', 'Kasper'],
    Z:  [13, 'Jojo', 'Phillips'],
    Y:  [1, 'Legend', 'Glasker'],
    T:  [7, 'Walker', 'Lyons'],
    OL0: [58, 'Paki', 'Finau'],
    OL1: [51, 'Sonny', 'Makasini'],
    OL2: [63, 'Bruce', 'Mitchell'],
    OL3: [64, 'Kyle', 'Sfarcioc'],
    OL4: [52, 'Bott', 'Mulitalo'],
    DL0: [90, 'Hunter', 'Clegg'],
    DL1: [57, 'Keanu', 'Tanuvasa'],
    DL2: [94, 'Anisi', 'Purcell'],
    DL3: [48, 'Bodie', 'Schoonover'],
    LB1: [4, 'Cade', 'Uluave'],
    LB2: [16, 'Isaiah', 'Glasker'],
    CB1: [0, 'Evan', 'Johnson'],
    CB2: [1, 'Tre', 'Alexander'],
    NB:  [32, 'Cannon', 'DeVries'],
    S1:  [11, 'Faletau', 'Satuala'],
    S2:  [3, 'Raider', 'Damuni'],
    K:   [97, 'Matthias', 'Dunn']
  },
  utah: {
    QB: [4, 'Devon', 'Dampier'],
    R:  [1, 'Wayshawn', 'Parker'],
    X:  [11, 'Ricky', 'Johnson'],
    Z:  [7, 'Braden', 'Pegan'],
    Y:  [2, 'Creed', 'Whittemore'],
    T:  [89, 'Noah', 'Bennee'],
    OL0: [76, 'Zereoue', 'Williams'],
    OL1: [75, 'Roger', 'Alderman'],
    OL2: [79, 'Alex', 'Harrison'],
    OL3: [74, 'Keith', 'Olson'],
    OL4: [73, 'Cedric', 'Jefferson'],
    DL0: [15, 'Lance', 'Holtzclaw'],
    DL1: [90, 'Jireh', 'Moe'],
    DL2: [51, 'Karson', 'Kaufusi'],
    DL3: [8, 'Ethan', 'Day'],
    LB1: [7, 'Johnathan', 'Hall'],
    LB2: [10, 'Trey', 'Reynolds'],
    CB1: [9, 'Elijah', 'Davis'],
    CB2: [11, 'Elijah', 'Reed'],
    NB:  [23, 'Jackson', 'Bennee'],
    S1:  [6, 'Nate', 'Ritchie'],
    S2:  [1, 'Rabbit', 'Evans'],
    K:   [17, 'Dillon', 'Curtis']
  }
};
/* {num, first, last, name: "#3 Kasper"} for a team and a slot, or null. */
function who(team, key){
  var r = ROSTERS[team] && ROSTERS[team][key];
  return r ? {num: r[0], first: r[1], last: r[2], name: '#' + r[0] + ' ' + r[2]} : null;
}
var API = {ROSTERS: ROSTERS, who: who};
if(typeof module !== 'undefined' && module.exports) module.exports = API;
else root.GRoster = API;
})(typeof window !== 'undefined' ? window : globalThis);
