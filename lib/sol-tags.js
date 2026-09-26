'use strict';

// How tags are grouped here: StoriesOnline's fourteen categories, so the
// group's own stories are tagged the way the stories brought in from there
// already are, and then the few groups that are this group's own (the
// Swarm universe, the cast, the length, and where a draft stands).
//
// Only the categories and where a code belongs are kept here, to file a
// tag in the right place when it arrives; the tags themselves are made
// one at a time, when a story needs one.

const SOL_CATEGORIES = [
  'Age/Gender', 'Level of Consent', 'Sexual Orientations', 'Story Types', 'Science Fiction', 'Paranormal',
  'Couples', 'Incest', 'BDSM Elements', 'Groups', 'Interracial Elements', 'Sexual Activities', 'Fetishes', 'Other',
];
const OWN_GROUPS = ['Swarm', 'Cast', 'Length', 'Review status'];
const TAG_GROUPS = [...SOL_CATEGORIES, ...OWN_GROUPS];

// Which category each StoriesOnline code is filed under there -- and, with
// them, the tags this site had before, put where they belong.
const CODES = {
  'Age/Gender': ['Ma/Fa', 'Fa/Fa', 'Ma/Ma', 'Ma', 'Fa', 'Mult', 'Teenagers', 'Solo'],
  'Level of Consent': ['Blackmail', 'Coercion', 'Consensual', 'Drunk/Drugged', 'Hypnosis', 'Mind Control', 'NonConsensual', 'Rape', 'Reluctant', 'Romantic', 'Slavery'],
  'Sexual Orientations': ['Gay', 'Lesbian', 'BiSexual', 'Heterosexual', 'Homosexual', 'CrossDressing', 'Hermaphrodite', 'Shemale', 'TransGender'],
  'Story Types': ['Fiction', 'True Story', 'Crime', 'Fairy Tale', 'Fan Fiction', 'Farming', 'Futanari', 'GameLit', 'High Fantasy', 'Historical', 'Horror', 'Humor', 'Humour', 'Military', 'Mystery', 'Rags To Riches', 'Restart', 'School', 'Sports', 'Steampunk', 'Superhero', 'Tear Jerker', 'Vignettes', 'War', 'Western', 'Workplace',
    // StoriesOnline's genres, which it lists apart; here they are story types.
    'Action', 'Adventure', 'Action/Adventure', 'Biography', 'Comedy', 'Coming of Age', 'Drama', 'Erotica', 'Fantasy', 'Romance', 'Thriller', 'Suspense', 'Supernatural', 'Tragedy', 'Slice of life', 'Young Adult', 'Science Fantasy', 'Mythology'],
  'Science Fiction': ['Science Fiction', 'Aliens', 'Alternate History', 'DoOver', 'Extra Sensory Perception', 'Isekai', 'Far Past', 'Post Apocalypse', 'Post-apocalyptic', 'Robot', 'Space', 'Time Travel', 'Body Swap',
    'Shipboard', 'Planetside', 'Earth', 'Colony', 'Near future', 'Far future', 'First contact'],
  Paranormal: ['Paranormal', 'Furry', 'Genie', 'Ghost', 'Magic', 'non-anthro', 'Vampires', 'Were animal', 'Zombies', 'Demons', 'Dolls'],
  Couples: ['Cheating', 'Cuckold', 'Sharing', 'Slut Wife', 'Wife Watching', 'Wimp Husband', 'RAAC', 'BTB'],
  Incest: ['Incest', 'Mother', 'Son', 'Brother', 'Sister', 'Father', 'Daughter', 'Cousins', 'Uncle', 'Niece', 'Aunt', 'Nephew', 'Grand Parent', 'InLaws'],
  'BDSM Elements': ['BDSM', 'DomSub', 'MaleDom', 'FemaleDom', 'Humiliation', 'Light Bond', 'Rough', 'Sadistic', 'Snuff', 'Spanking', 'Torture', 'PonyBoy', 'PonyGirl'],
  Groups: ['Gang Bang', 'Group Sex', 'Group', 'Harem', 'Orgy', 'Polygamy/Polyamory', 'Polyamory', 'Polygamy', 'Swinging'],
  'Interracial Elements': ['Interracial', 'Black Male', 'Black Female', 'White Male', 'White Female', 'Oriental Male', 'Oriental Female', 'Hispanic Male', 'Hispanic Female', 'Indian Male', 'Indian Female', 'Black Couple', 'White Couple'],
  'Sexual Activities': ['Anal Sex', 'Analingus', 'Bestiality', 'Cream Pie', 'Double Penetration', 'Enema', 'Exhibitionism', 'First', 'Facial', 'Fisting', 'Flatulence', 'Food', 'Lactation', 'Massage', 'Masturbation', 'Necrophilia', 'Oral Sex', 'Pegging', 'Petting', 'Pregnancy', 'Safe Sex', 'Scatology', 'Sex Toys', 'Spitting', 'Squirting', 'Tit-Fucking', 'Voyeurism', 'Water Sports'],
  Fetishes: ['Amputee', 'Babysitter', 'BBW', 'Big Breasts', 'Body Modification', 'Clergy', 'Doctor/Nurse', 'Foot Fetish', 'Hairy', 'Leg Fetish', 'Menstrual Play', 'Muscle Mommy', 'Needles', 'Public Sex', 'Size', 'Small Breasts', 'Smoking', 'Teacher/Student', 'Infantilization'],
  Other: ['2nd POV', 'Cannibalism', 'Cat-Fighting', 'Caution', 'ENF', 'Geeks', 'Halloween', 'Indian Erotica', 'Nudism', 'Politics', 'Porn Theatre', 'Prostitution', 'Revenge', 'Royalty', 'Slow', 'Transformation', 'Violence', 'AI Generated',
    'No sex', 'Explicit sex', 'Graphic violence', 'Major character death', 'Dark themes', 'Strong language'],
};

const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const BY_KEY = new Map();
for (const [category, codes] of Object.entries(CODES)) for (const c of codes) if (!BY_KEY.has(key(c))) BY_KEY.set(key(c), category);

/** The category a tag belongs in, by its name: where StoriesOnline files it, or Other. */
function categoryFor(name) {
  const k = key(name);
  if (BY_KEY.has(k)) return BY_KEY.get(k);
  if (BY_KEY.has(k.replace(/s$/, ''))) return BY_KEY.get(k.replace(/s$/, ''));
  if (BY_KEY.has(`${k}s`)) return BY_KEY.get(`${k}s`);
  if (/^[a-z]{1,4}\/[a-z]{1,4}$/i.test(String(name).trim())) return 'Age/Gender';
  return 'Other';
}

// The groups this site used before it followed StoriesOnline, and where
// their tags go now. The site's own groups stay as they are.
const OLD_GROUPS = {
  Pairings: (name) => (categoryFor(name) === 'Groups' ? 'Groups' : 'Age/Gender'),
  Orientation: () => 'Sexual Orientations',
  Genre: (name) => (categoryFor(name) === 'Science Fiction' ? 'Science Fiction' : 'Story Types'),
  Setting: () => 'Science Fiction',
  'Content notes': () => 'Other',
};

module.exports = { OLD_GROUPS, OWN_GROUPS, SOL_CATEGORIES, TAG_GROUPS, categoryFor };
