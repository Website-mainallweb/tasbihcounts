-- The name library's starting contents (docs/ADMIN.md §3.9).
--
-- Copied verbatim from site/src/lib/counter/names.ts as it stood on 2026-09-15,
-- ids and order included. The ids must match exactly: every count anyone has
-- recorded, in their browser and in counter_components, is stored under them.
--
-- That file stays in the repository as the offline fallback. This table is what
-- the site renders when it can reach the database, and what the panel edits.
--
-- Positions are spaced by ten so a name can be moved between two others without
-- renumbering the rest.

insert into public.names (id, devanagari, transliteration, meaning, grp, position) values
  ('radha', 'राधा', 'Radha', 'The beloved of Krishna', null, 10),
  ('shriradha', 'श्री राधा', 'Shri Radha', 'The queen of Vrindavan', null, 20),
  ('radhe', 'राधे राधे', 'Radhe Radhe', 'Invoking Radha', null, 30),
  ('shiv', 'शिव', 'Shiv', 'The auspicious one', null, 40),
  ('sambsadashiv', 'साम्ब सदाशिव', 'Samb Sadashiv', 'Shiva, ever auspicious, with the Mother', null, 50),
  ('mahadev', 'महादेव', 'Mahadev', 'The great god', null, 60),
  ('harharmahadev', 'हर हर महादेव', 'Har Har Mahadev', 'Glory to the great god', null, 70),
  ('hanuman', 'हनुमान', 'Hanuman', 'The devoted one', null, 80),
  ('shriram', 'श्री राम', 'Shri Ram', 'Lord Rama', null, 90),
  ('ram', 'राम', 'Ram', 'The all-pervading joy', null, 100),
  ('sitaram', 'सीता राम', 'Sita Ram', 'The divine pair', null, 110),
  ('jaishriram', 'जय श्री राम', 'Jai Shri Ram', 'Victory to Lord Rama', null, 120),
  ('krishna', 'कृष्ण', 'Krishna', 'The all-attractive one', null, 130),
  ('radhekrsna', 'राधे कृष्ण', 'Radhe Krishna', 'Radha with Krishna', null, 140),
  ('govind', 'गोविन्द', 'Govind', 'Protector of the cows', null, 150),
  ('gopal', 'गोपाल', 'Gopal', 'The cowherd boy', null, 160),
  ('vishnu', 'विष्णु', 'Vishnu', 'The preserver', null, 170),
  ('narayan', 'नारायण', 'Narayan', 'Resting place of all beings', null, 180),
  ('ganesh', 'गणेश', 'Ganesh', 'Remover of obstacles', null, 190),
  ('durga', 'दुर्गा', 'Durga', 'The invincible mother', null, 200),
  ('kali', 'काली', 'Kali', 'Mother of time', null, 210),
  ('ambe', 'अम्बे', 'Ambe', 'The mother', null, 220),
  ('lakshmi', 'लक्ष्मी', 'Lakshmi', 'Goddess of abundance', null, 230),
  ('saraswati', 'सरस्वती', 'Saraswati', 'Goddess of learning', null, 240),
  ('jagannath', 'जगन्नाथ', 'Jagannath', 'Lord of the universe', null, 250),
  ('balaji', 'बालाजी', 'Balaji', 'Venkateshwara', null, 260),
  ('khatushyam', 'खाटू श्याम', 'Khatu Shyam', 'The beloved of Khatu', null, 270),
  ('sai', 'साईं राम', 'Sai Ram', 'Sai Baba', null, 280),
  ('swaminarayan', 'स्वामिनारायण', 'Swaminarayan', 'Sahajanand Swami', null, 290),
  ('dattatreya', 'दत्तात्रेय', 'Dattatreya', 'The triple lord', null, 300),
  ('om', 'ॐ', 'Om', 'The primordial sound', null, 310),
  ('harekrsna', 'हरे कृष्ण हरे राम', 'Hare Krishna Hare Rama', 'The maha-mantra', 'mantra', 320),
  ('omnamah', 'ॐ नमः शिवाय', 'Om Namah Shivaya', 'The five-syllable mantra', 'mantra', 330),
  ('shriramjairam', 'श्री राम जय राम जय जय राम', 'Shri Ram Jai Ram Jai Jai Ram', 'The Ram taraka mantra', 'mantra', 340),
  ('omnamona', 'ॐ नमो नारायणाय', 'Om Namo Narayanaya', 'The eight-syllable mantra', 'mantra', 350),
  ('vasudev', 'ॐ नमो भगवते वासुदेवाय', 'Om Namo Bhagavate Vasudevaya', 'The twelve-syllable mantra', 'mantra', 360),
  ('omhanu', 'ॐ श्री हनुमते नमः', 'Om Shri Hanumate Namah', 'Salutations to Hanuman', 'mantra', 370),
  ('omgam', 'ॐ गं गणपतये नमः', 'Om Gam Ganapataye Namah', 'Ganesha bija mantra', 'mantra', 380),
  ('omdum', 'ॐ दुं दुर्गायै नमः', 'Om Dum Durgayai Namah', 'Durga bija mantra', 'mantra', 390),
  ('omshreem', 'ॐ श्रीं महालक्ष्म्यै नमः', 'Om Shreem Mahalakshmyai Namah', 'Lakshmi mantra', 'mantra', 400),
  ('gayatri', 'ॐ भूर्भुवः स्वः', 'Gayatri', 'The Gayatri opening', 'mantra', 410),
  ('mahamrityu', 'ॐ त्र्यम्बकं यजामहे', 'Mahamrityunjaya', 'The healing mantra', 'mantra', 420),
  ('kartikeya', 'ॐ शरवणभवाय नमः', 'Om Sharavanabhavaya Namah', 'Kartikeya mantra', 'mantra', 430),
  ('surya', 'ॐ सूर्याय नमः', 'Om Suryaya Namah', 'Salutations to the sun', 'mantra', 440),
  ('shanti', 'ॐ शांति शांति शांति', 'Om Shanti', 'Peace', 'mantra', 450)
on conflict (id) do nothing;
